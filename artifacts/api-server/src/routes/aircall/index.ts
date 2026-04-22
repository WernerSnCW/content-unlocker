import { Router, type IRouter } from "express";
import { db, contactsTable, leadConversationsTable, integrationConfigsTable, agentsTable, callListMembershipsTable } from "@workspace/db";
import { eq, or, sql, and, isNull, lte } from "drizzle-orm";
import { loadInvestor, processTranscript, processTranscriptDetailed, processTranscriptWithLLM, saveEngineRun, ExtractionError, loadOutcomeRules, outcomeRulesFlagEnabled } from "../../engine/v2";
import type { CallType, LoadedOutcomeRule } from "../../engine/v2";
import {
  DEFAULT_TAG_MAPPING,
  DEFAULT_COOL_OFF_DAYS,
  callbackDays,
  isAllowedCombination,
  type Outcome,
  type SideEffect,
  type TagMapping as CanonicalTagMapping,
} from "../../lib/tagModel";
import { notifyQueueChanged } from "../../lib/queueEvents";
import { maybeCreateOutcomeReview } from "../../lib/outcomeReviews";

const router: IRouter = Router();

// TagMapping now imported from lib/tagModel.ts (canonical).
type TagMapping = CanonicalTagMapping;

// Helper: get Aircall API auth header
async function getAircallAuth(): Promise<string | null> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    if (cfg?.api_id && cfg?.api_token) {
      return `Basic ${Buffer.from(`${cfg.api_id}:${cfg.api_token}`).toString("base64")}`;
    }
  } catch { /* ignore */ }
  return null;
}

// Helper: get tag mapping from config or use defaults
// Exported so admin simulator can reuse the same resolution path.
export async function getTagMapping(): Promise<TagMapping[]> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    if (cfg?.tag_mapping && Array.isArray(cfg.tag_mapping) && cfg.tag_mapping.length > 0) {
      return cfg.tag_mapping;
    }
  } catch { /* use defaults */ }
  return DEFAULT_TAG_MAPPING;
}

// Helper: get cool_off period (days) from config or use default.
// Exported for the admin simulator.
export async function getCoolOffDays(): Promise<number> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    const v = Number(cfg?.cool_off_days);
    if (Number.isFinite(v) && v >= 1 && v <= 365) return v;
  } catch { /* use default */ }
  return DEFAULT_COOL_OFF_DAYS;
}

// Helper: normalise phone for matching (strip spaces, dashes, parens)
function normalisePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)]/g, "");
}

// Helper: extract external phone number from Aircall call data (tries many payload shapes)
function extractPhone(data: any): string {
  if (data?.raw_digits) return data.raw_digits;
  if (data?.number?.digits) return data.number.digits;
  // Tag/comment events sometimes nest the call object
  if (data?.call?.raw_digits) return data.call.raw_digits;
  if (data?.call?.number?.digits) return data.call.number.digits;
  // Participants array — pick the external one
  const participants = data?.participants || data?.call?.participants;
  if (Array.isArray(participants)) {
    const ext = participants.find((p: any) => p.participant_type === "external");
    if (ext?.phone_number) return ext.phone_number;
  }
  // Contact object on the call
  if (data?.contact?.phone_number) return data.contact.phone_number;
  return "";
}

// Helper: find contact by phone number from call data
async function findContactByPhone(phoneNumber: string) {
  if (!phoneNumber) return null;
  const normalised = normalisePhone(phoneNumber);

  // Try exact match first, then normalised
  const [exact] = await db.select().from(contactsTable)
    .where(eq(contactsTable.phone, normalised))
    .limit(1);
  if (exact) return exact;

  // Try matching with or without leading +
  const withPlus = normalised.startsWith("+") ? normalised : `+${normalised}`;
  const withoutPlus = normalised.startsWith("+") ? normalised.slice(1) : normalised;

  const [fuzzy] = await db.select().from(contactsTable)
    .where(or(
      eq(contactsTable.phone, withPlus),
      eq(contactsTable.phone, withoutPlus),
    ))
    .limit(1);
  return fuzzy || null;
}

// Helper: find agent by Aircall user ID
async function findAgentByAircallUser(aircallUserId: number) {
  if (!aircallUserId) return null;
  const [agent] = await db.select().from(agentsTable)
    .where(eq(agentsTable.aircall_user_id, aircallUserId))
    .limit(1);
  return agent || null;
}

// Resolve a raw Aircall tag to its canonical outcome and side-effect using the
// configured mapping. Pure function — does not touch the database.
// Exported for the admin simulator.
export function resolveTag(tagName: string, tagMapping: TagMapping[]): { outcome: Outcome; sideEffect: SideEffect; mapping: TagMapping } | null {
  const mapping = tagMapping.find(m => m.aircall_tag.toLowerCase() === tagName.toLowerCase());
  if (!mapping) return null;
  const outcome = mapping.outcome as Outcome;
  // Defensive: reject invalid (outcome, side_effect) pairs. Fall back to "none"
  // so we still record the outcome without applying a nonsensical effect.
  const sideEffect: SideEffect = isAllowedCombination(outcome, mapping.side_effect as SideEffect)
    ? (mapping.side_effect as SideEffect)
    : "none";
  return { outcome, sideEffect, mapping };
}

// Apply the full set of state mutations for a tagged call, INSIDE a Drizzle
// transaction. This is the single mutation point for contact state and
// memberships — call.ended never touches them anymore. The transaction
// guarantees atomicity so other webhooks can't observe a half-applied state.
// Exported for the admin simulator. The external_id match uses `callId` so
// the simulator can pass any synthetic ID (e.g. "sim-<uuid>") and the same
// conversation row gets updated.
export async function applyTaggedOutcomeTx(
  tx: any,
  contactId: string,
  callId: string,
  tagName: string,
  resolution: { outcome: Outcome; sideEffect: SideEffect; mapping: TagMapping },
  coolOffDaysGlobal: number,
): Promise<void> {
  const { outcome, sideEffect, mapping } = resolution;
  const now = new Date();
  const contactUpdates: Record<string, any> = {
    last_call_outcome: outcome,
    call_attempts: sql`${contactsTable.call_attempts} + 1`,
    dispatch_status: "called", // default; specific side-effects may override below
    // Reset scheduling fields to NULL at the start of every tag application.
    // Fresh state each call: the side_effect (callback_Nd / cool_off) or
    // default_followup_days below may set them again. Without this reset,
    // stale values from a previous tag linger and block re-dispatch.
    callback_date: null,
    cool_off_until: null,
  };

  // 1. Close the contact's currently-active membership (if any) — this is
  //    the membership that was active during the just-finished call.
  const [activeMembership] = await tx.select().from(callListMembershipsTable)
    .where(and(
      eq(callListMembershipsTable.contact_id, contactId),
      isNull(callListMembershipsTable.removed_at),
    ))
    .limit(1);

  if (activeMembership) {
    await tx.update(callListMembershipsTable)
      .set({ removed_at: now, removal_reason: "called", outcome_at_removal: outcome })
      .where(eq(callListMembershipsTable.id, activeMembership.id));
  }

  // 2. Apply side-effect
  switch (sideEffect) {
    case "cool_off": {
      const override = typeof mapping.cool_off_days === "number" && mapping.cool_off_days >= 1
        ? mapping.cool_off_days : null;
      const days = override ?? coolOffDaysGlobal;
      const until = new Date(now);
      until.setDate(until.getDate() + days);
      contactUpdates.cool_off_until = until;
      break;
    }
    case "callback_1d":
    case "callback_2d":
    case "callback_3d":
    case "callback_7d": {
      const days = callbackDays(sideEffect) || 1;
      const callback = new Date(now);
      callback.setDate(callback.getDate() + days);
      contactUpdates.callback_date = callback;
      break;
    }
    case "global_exclude": {
      contactUpdates.dispatch_status = "archived";
      break;
    }
    case "immediate_recall": {
      // Create a fresh active membership on the same call list. We just closed
      // the previous one above, so the partial unique index is satisfied.
      if (activeMembership) {
        await tx.insert(callListMembershipsTable).values({
          call_list_id: activeMembership.call_list_id,
          contact_id: contactId,
          added_at: now,
          carried_from_id: activeMembership.id,
        });
        contactUpdates.dispatch_status = "dispatched";
        contactUpdates.dispatch_date = now;
      }
      break;
    }
    case "exclude_from_campaign":
    case "none":
    case "record_only":
      // record_only should not reach this path (handleCallTagged short-circuits
      // before calling us), but handle gracefully just in case.
      break;
  }

  // 2b. Closer handoff routing — stamp assigned_closer_id based on the
  // tag mapping's configuration. NULL clears any previous handoff assignment;
  // 'any' means any closer can pick up; a specific user id routes to that
  // closer only. Read at fillQueue time by the closer/agent role gating.
  if (mapping.maps_to_closer) {
    contactUpdates.assigned_closer_id = mapping.closer_agent_id ?? "any";
  } else {
    // Explicit clear — if a previously closer-assigned contact is re-tagged
    // with a non-handoff tag (e.g. "No Answer"), release them back to cold
    // outreach.
    contactUpdates.assigned_closer_id = null;
  }

  // 2c. Fallback follow-up date — only apply if:
  //   - the tag mapping specifies default_followup_days
  //   - the side_effect didn't already set a callback_date (i.e. NOT one of
  //     callback_1d/2d/3d/7d which explicitly schedule)
  //   - the value is a positive integer
  // Useful for "demo" tag (2-day fallback if the agent didn't capture a
  // specific meeting date) or "Cloudworkz" interested (1-day fallback).
  const defaultDays = typeof mapping.default_followup_days === "number"
    ? Math.floor(mapping.default_followup_days) : null;
  if (defaultDays && defaultDays > 0 && !contactUpdates.callback_date) {
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + defaultDays);
    contactUpdates.callback_date = fallback;
  }

  // 3. Apply contact updates atomically.
  await tx.update(contactsTable)
    .set(contactUpdates)
    .where(eq(contactsTable.id, contactId));

  // 4. Mark the conversation processed and stamp outcome + tag.
  await tx.update(leadConversationsTable)
    .set({
      call_outcome: outcome,
      tags: sql`COALESCE(${leadConversationsTable.tags}, '[]'::jsonb) || ${JSON.stringify([tagName])}::jsonb`,
      processed_at: now,
    })
    .where(eq(leadConversationsTable.external_id, String(callId)));
}

// ==================== Webhook Log (in-memory, for debugging) ====================

interface WebhookLogEntry {
  timestamp: string;
  event: string;
  status: string;
  contact_match: string | null;
  data_summary: Record<string, any>;
  raw_body: any;
}

const webhookLog: WebhookLogEntry[] = [];
const MAX_LOG_ENTRIES = 100;

export function logWebhook(event: string, status: string, contactMatch: string | null, data: any) {
  webhookLog.unshift({
    timestamp: new Date().toISOString(),
    event,
    status,
    contact_match: contactMatch,
    data_summary: {
      call_id: data?.id || data?.call_id,
      raw_digits: data?.raw_digits || data?.number?.digits,
      direction: data?.direction,
      duration: data?.duration,
      tags: data?.tags?.map((t: any) => t.name || t),
      user: data?.user?.name || data?.user?.id,
      comment: typeof data?.comments === "string" ? data.comments : data?.comments?.content || data?.note?.content || data?.note,
      tag: typeof data?.tag === "string" ? data.tag : data?.tag?.name,
    },
    raw_body: data,
  });
  if (webhookLog.length > MAX_LOG_ENTRIES) webhookLog.pop();
}

// GET /aircall/webhook-log — view recent webhook events
router.get("/aircall/webhook-log", async (_req, res): Promise<void> => {
  res.json({ entries: webhookLog, count: webhookLog.length });
});

// ==================== Webhook Endpoint ====================

router.post("/aircall/webhook", async (req, res): Promise<void> => {
  // Always respond 200 quickly — Aircall retries on non-200
  const event = req.body?.event;
  const data = req.body?.data;

  if (!event || !data) {
    logWebhook(event || "unknown", "ignored", null, req.body);
    res.status(200).json({ status: "ignored", reason: "no event or data" });
    return;
  }

  // Optional: verify webhook token
  const token = req.query?.token || req.headers["x-aircall-token"];
  if (token) {
    try {
      const [config] = await db.select().from(integrationConfigsTable)
        .where(eq(integrationConfigsTable.provider, "aircall"));
      const cfg = config?.config as Record<string, any>;
      if (cfg?.webhook_token && token !== cfg.webhook_token) {
        console.warn("[Aircall Webhook] Invalid token");
        res.status(200).json({ status: "ignored", reason: "invalid token" });
        return;
      }
    } catch { /* proceed without verification */ }
  }

  try {
    if (event === "call.ended") {
      const result = await handleCallEnded(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "call.ended" });
    } else if (event === "call.tagged") {
      const result = await handleCallTagged(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "call.tagged" });
    } else if (event === "call.commented") {
      await handleCallCommented(data);
      logWebhook(event, "processed", null, data);
      res.status(200).json({ status: "processed", event: "call.commented" });
    } else if (event === "transcription.created") {
      const result = await handleTranscriptionCreated(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "transcription.created", detail: result });
    } else if (event === "summary.created") {
      const result = await handleSummaryCreated(data);
      logWebhook(event, "processed", result || null, data);
      res.status(200).json({ status: "processed", event: "summary.created", detail: result });
    } else {
      logWebhook(event, "ignored", null, data);
      res.status(200).json({ status: "ignored", event });
    }
  } catch (err: any) {
    console.error(`[Aircall Webhook] Error processing ${event}:`, err.message);
    logWebhook(event, `error: ${err.message}`, null, data);
    // Still return 200 to prevent Aircall retries on our errors
    res.status(200).json({ status: "error", message: err.message });
  }
});

// GET /aircall/webhook — health check (Aircall pings this)
router.get("/aircall/webhook", async (_req, res): Promise<void> => {
  res.json({ status: "ok", handler: "aircall-webhook" });
});

// ==================== Event Handlers ====================

// call.ended is now INFORMATIONAL ONLY. It records the call happened and stores
// the conversation row, but does NOT mutate contact state or memberships.
// All state mutations are owned by handleCallTagged so there is exactly one
// place that can change dispatch_status / call_attempts / membership state.
// This eliminates the race conditions caused by concurrent webhook delivery.
//
// If call.tagged never arrives, the background sweep (sweepUntaggedConversations)
// processes the conversation as untagged after a timeout.
export async function handleCallEnded(data: any): Promise<string | null> {
  const callId = data.id || data.call_id;
  const duration = data.duration || 0;
  const direction = data.direction || "outbound";
  const rawDigits = extractPhone(data);
  const aircallUserId = data.user?.id;
  const tags = data.tags || [];
  const agentNotes = data.comments || data.note || null;

  // Only process calls made by agents registered in our app
  const agent = await findAgentByAircallUser(aircallUserId);
  if (!agent) {
    return `skipped: Aircall user ${aircallUserId} (${data.user?.name || "unknown"}) is not a registered agent`;
  }

  // Find the contact (used to link the conversation row)
  const contact = await findContactByPhone(rawDigits);
  if (!contact) {
    console.warn(`[Aircall Webhook] call.ended — no contact found for ${rawDigits}`);
    return `no match: ${rawDigits}`;
  }

  // Idempotent upsert of the conversation record. Tagged may have created
  // a stub already; in that case we just enrich it with call-data fields.
  const [existing] = await db.select().from(leadConversationsTable)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .limit(1);

  if (existing) {
    await db.update(leadConversationsTable)
      .set({
        contact_id: existing.contact_id || contact.id,
        lead_id: existing.lead_id || contact.lead_id || null,
        duration_seconds: duration,
        agent_name: existing.agent_name || agent.name,
        agent_notes: existing.agent_notes || agentNotes,
        direction: direction === "inbound" ? "inbound" : "outbound",
      })
      .where(eq(leadConversationsTable.id, existing.id));
  } else {
    await db.insert(leadConversationsTable).values({
      contact_id: contact.id,
      lead_id: contact.lead_id || null,
      source: "aircall",
      external_id: String(callId),
      direction: direction === "inbound" ? "inbound" : "outbound",
      duration_seconds: duration,
      agent_name: agent.name,
      agent_notes: agentNotes,
      tags: tags.map((t: any) => t.name || t),
      call_outcome: null, // populated by handleCallTagged
      conversation_date: new Date(),
    });
  }

  // Notify any SSE subscribers that something on the queue might have changed
  // (some clients update on call.ended for early UI feedback).
  notifyQueueChanged({ event: "call.ended", contactId: contact.id, callId: String(callId) });

  return `recorded: ${contact.first_name} ${contact.last_name} (awaiting tag)`;
}

// call.tagged is the SOLE owner of state mutations. It runs everything inside
// a transaction so concurrent webhooks can't race against it. Order-independent:
// works whether call.ended has been processed before, after, or never (a stub
// conversation is created here if needed).
//
// Three paths:
//   1. Mapped tag with a state-changing side-effect → full transaction.
//   2. Mapped tag with side_effect = "record_only"     → append tag to
//      conversation.tags only; no state change.
//   3. Unmapped tag (not in config)                    → same as #2, so ad-hoc
//      tags added by operators are preserved without needing admin config.
// Extract the tag name from any of the shapes Aircall sends on call.tagged:
//   - data.tag = "name" (string)
//   - data.tag = { name: "..." } (object, legacy/undocumented)
//   - data.added_tag = { name: "..." } (v2 — specific tag just added)
//   - data.tags = [{ name }, ...] (v2 — full call object, last tag is newest)
//   - data.call.tags = [...] (nested call object)
function extractTagName(data: any): { name: string | null; shape: string } {
  if (typeof data?.tag === "string") return { name: data.tag, shape: "data.tag:string" };
  if (data?.tag?.name) return { name: data.tag.name, shape: "data.tag.name" };
  if (data?.added_tag?.name) return { name: data.added_tag.name, shape: "data.added_tag.name" };
  if (typeof data?.added_tag === "string") return { name: data.added_tag, shape: "data.added_tag:string" };
  const tagsArr = data?.tags || data?.call?.tags;
  if (Array.isArray(tagsArr) && tagsArr.length > 0) {
    const last = tagsArr[tagsArr.length - 1];
    const name = typeof last === "string" ? last : last?.name;
    if (name) return { name, shape: "data.tags[last].name" };
  }
  return { name: null, shape: "unknown" };
}

export async function handleCallTagged(data: any): Promise<string | null> {
  const callId = data.call_id || data.id || data.call?.id;
  const extraction = extractTagName(data);
  if (!extraction.name) {
    // Surface the actual payload shape so we can see what Aircall sent.
    const topKeys = Object.keys(data || {}).join(",");
    const snippet = JSON.stringify(data).slice(0, 500);
    return `no tag found; top keys: [${topKeys}]; snippet: ${snippet}`;
  }
  const tagName = extraction.name;
  if (!callId) return `no call_id; top keys: [${Object.keys(data || {}).join(",")}]`;

  const tagMapping = await getTagMapping();
  const resolution = resolveTag(tagName, tagMapping);

  // Find or create the conversation record so the tag has somewhere to land.
  let [conv] = await db.select().from(leadConversationsTable)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .limit(1);

  let contactId = conv?.contact_id ?? null;

  if (!conv) {
    const auth = await getAircallAuth();
    if (!auth) return `no conversation for ${callId} AND no Aircall API credentials`;
    const callResp = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
      headers: { Authorization: auth },
    });
    if (!callResp.ok) {
      return `no conversation for ${callId} AND call fetch returned ${callResp.status}`;
    }
    const callData = await callResp.json() as any;
    const call = callData?.call || callData;
    const agent = await findAgentByAircallUser(call?.user?.id);
    if (!agent) {
      return `skipped: Aircall user ${call?.user?.id} (${call?.user?.name || "unknown"}) is not a registered agent`;
    }
    const phone = extractPhone(call);
    const contact = await findContactByPhone(phone);
    if (!contact) return `no contact for phone ${phone}`;
    const [inserted] = await db.insert(leadConversationsTable).values({
      contact_id: contact.id,
      lead_id: contact.lead_id || null,
      source: "aircall",
      external_id: String(callId),
      direction: call.direction === "inbound" ? "inbound" : "outbound",
      duration_seconds: call.duration ?? null,
      agent_name: agent.name,
      tags: [tagName],
      call_outcome: null,
      conversation_date: new Date(),
    }).returning();
    conv = inserted;
    contactId = contact.id;
  }

  if (!contactId) return `no contact_id on conversation ${conv?.id}`;

  // Path 2 + 3: record-only or unmapped tag. Just append to tags array.
  // No state mutation, no processed_at change — some other (mapped) tag will
  // close the call, or the untagged sweep will.
  const isRecordOnly = !resolution || resolution.sideEffect === "record_only";
  if (isRecordOnly) {
    await db.update(leadConversationsTable)
      .set({
        tags: sql`COALESCE(${leadConversationsTable.tags}, '[]'::jsonb) || ${JSON.stringify([tagName])}::jsonb`,
      })
      .where(eq(leadConversationsTable.external_id, String(callId)));
    const reason = resolution ? "record_only" : "unmapped";
    return `tag "${tagName}" recorded (${reason}) — no state change`;
  }

  // Path 1: state-changing outcome. Run the full transaction.
  // Idempotent: if already processed by an earlier state-changing tag, skip.
  if (conv?.processed_at) {
    return `already processed at ${conv.processed_at.toISOString()} — skipping "${tagName}"`;
  }

  const coolOffDaysGlobal = await getCoolOffDays();
  await db.transaction(async (tx) => {
    await applyTaggedOutcomeTx(tx, contactId!, String(callId), tagName, resolution!, coolOffDaysGlobal);
  });

  // Fetch name so the SSE payload carries enough for the frontend to add a
  // tray entry when handleCallEnded never ran (Power Dialer, Simulator,
  // any out-of-band path).
  let contactName: string | undefined;
  try {
    const [c] = await db.select({ first_name: contactsTable.first_name, last_name: contactsTable.last_name })
      .from(contactsTable).where(eq(contactsTable.id, contactId!)).limit(1);
    if (c) contactName = `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || undefined;
  } catch { /* non-fatal */ }

  notifyQueueChanged({ event: "call.tagged", contactId, contactName, callId: String(callId) });

  // Power Dialer parity with the in-app queue.
  // When side_effect = immediate_recall, the tx above creates a fresh
  // membership so the contact re-appears at the bottom of our in-app call
  // list. The equivalent in Power Dialer mode is to append the contact's
  // phone number to the agent's Aircall PD queue so the agent reaches them
  // again at the end of the session.
  //
  // Only fires when the call's agent is in dialer_mode = "power_dialer".
  // Failure here does NOT roll back the DB tx — app state is correct,
  // Aircall queue may just drift (operator can re-send to PD).
  if (resolution!.sideEffect === "immediate_recall" && !String(callId).startsWith("sim-")) {
    try {
      const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId!));
      const [convUpdated] = await db.select().from(leadConversationsTable)
        .where(eq(leadConversationsTable.external_id, String(callId)))
        .limit(1);
      const agentName = convUpdated?.agent_name;
      const [agentRow] = agentName
        ? await db.select().from(agentsTable).where(eq(agentsTable.name, agentName)).limit(1)
        : [null as any];
      if (agentRow?.dialer_mode === "power_dialer" && agentRow.aircall_user_id && contact?.phone) {
        const { pushNumbers } = await import("../../lib/aircallPowerDialer");
        const push = await pushNumbers(agentRow.aircall_user_id, [contact.phone]);
        logWebhook(
          "aircall.power_dialer_requeue",
          push.pushed > 0 ? "processed" : `failed: ${push.failedBatches.map(b => b.body).join(";")}`,
          contactId,
          { phone: contact.phone, aircall_user_id: agentRow.aircall_user_id, pushed: push.pushed },
        );
      }
    } catch (err: any) {
      console.warn(`[Aircall Webhook] PD requeue failed for contact ${contactId}:`, err.message);
      logWebhook("aircall.power_dialer_requeue", `error: ${err.message}`, contactId, {});
    }
  }

  return `tagged → ${resolution!.outcome} (${resolution!.sideEffect})`;
}

async function handleCallCommented(data: any) {
  const callId = data.call_id || data.id;
  const comment = data.comment || data.content || data.text || "";
  if (!callId || !comment) return;

  // Update agent_notes on the conversation record
  const [updated] = await db.update(leadConversationsTable)
    .set({ agent_notes: comment })
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id });

  if (updated) {
    console.log(`[Aircall Webhook] call.commented — stored agent notes for call ${callId}`);
  }
}

// Infer the spec's call type. Phase 7.1b — prefers a persisted hint on
// the contact (set by the previous run's `set_next_call_type` secondary
// action) before falling back to duration. The hint is cleared after
// use so a stale hint doesn't misclassify a later call.
function inferCallType(
  durationSeconds: number | null | undefined,
  hint?: string | null,
): CallType {
  if (hint === "cold_call" || hint === "demo" || hint === "opportunity") {
    return hint;
  }
  const mins = Math.round((durationSeconds || 0) / 60);
  if (mins >= 40) return "demo";
  if (mins >= 20) return "opportunity";
  return "cold_call";
}

// Run the V2 engine against a stored transcript and persist the output.
// Returns a short status string for the webhook log.
// Exported for the admin simulator.
//
// Phase 4.7 gating: if the conversation has been tagged and the applied
// tag's mapping has `runs_engine === false`, skip the engine run entirely.
// Saves tokens on terminal / informational tags (DNC, No Answer, etc.)
// where engine output adds no value. If tagging hasn't happened yet (race
// where transcription.created arrives before call.tagged), we run — the
// default is engine-ON for backward compatibility.
export async function runEngineForConversation(
  contactId: string,
  conversationId: string,
  transcript: string,
): Promise<string> {
  try {
    const [conv] = await db.select().from(leadConversationsTable)
      .where(eq(leadConversationsTable.id, conversationId))
      .limit(1);
    if (!conv) return `engine: conversation ${conversationId} not found`;

    // Gate: check applied tag against tag_mapping.runs_engine
    const convTags = Array.isArray(conv.tags) ? (conv.tags as string[]) : [];
    if (convTags.length > 0) {
      const tagMapping = await getTagMapping();
      // Walk tags in reverse (last-applied first — this is the most
      // recently state-changing tag in typical flows).
      for (const tagName of [...convTags].reverse()) {
        const mapping = tagMapping.find(m => m.aircall_tag === tagName);
        if (mapping && mapping.runs_engine === false) {
          return `engine skipped: tag "${tagName}" configured runs_engine=false`;
        }
      }
    }

    // Phase 7.1b — read the contact's next-call-type hint (if any) to
    // prefer it over duration-based inference. Cleared immediately so
    // the hint only applies to this one call — a stale hint left behind
    // would misclassify a later call.
    const [contactRow] = await db
      .select({ next_call_type_hint: contactsTable.next_call_type_hint })
      .from(contactsTable)
      .where(eq(contactsTable.id, contactId))
      .limit(1);
    const callTypeHint = contactRow?.next_call_type_hint ?? null;
    if (callTypeHint) {
      await db
        .update(contactsTable)
        .set({ next_call_type_hint: null })
        .where(eq(contactsTable.id, contactId));
    }

    const callType = inferCallType(conv.duration_seconds, callTypeHint);
    const investor = await loadInvestor(contactId);

    // Phase 4.9 — Layer 1 selection.
    // Flag: ENGINE_LAYER_1_LLM=true switches persona/hot-button/signals/
    // questions/fact-find extraction from keyword pattern matching to a
    // Claude Sonnet call. Per directive: NO fallback to keyword on LLM
    // failure. Record the failure and let an admin reprocess.
    const useLLM = process.env.ENGINE_LAYER_1_LLM === "true";

    // Phase 7.1a — Outcome rules selection. Flag off = legacy cascade
    // (undefined rules → processTranscript falls back to determineNextAction).
    // Flag on = walk the DB-backed engine_outcome_rules, error loudly if
    // no rule matches (caught upstream, engine_run still persists).
    let outcomeRules: LoadedOutcomeRule[] | undefined;
    if (outcomeRulesFlagEnabled()) {
      try {
        outcomeRules = await loadOutcomeRules();
      } catch (err: any) {
        console.error("[Engine 7.1a] loadOutcomeRules failed:", err.message);
        // Fall through with rules undefined — legacy path runs.
      }
    }

    let output;
    let runId;
    let shadowDetail: { shadowDiff: string[] | null; nbaSource: "legacy" | "rules" } | null = null;
    let nextCallTypeHintToStamp: string | null = null;
    if (useLLM) {
      try {
        const llmRun = await processTranscriptWithLLM(transcript, callType, investor, { outcomeRules });
        output = llmRun.output;
        shadowDetail = { shadowDiff: llmRun.detail.shadowDiff, nbaSource: llmRun.detail.nbaSource };
        nextCallTypeHintToStamp = llmRun.detail.nextCallTypeHint;
        // Sum the two LLM calls (extraction + email) into a single audit
        // record on engine_runs. Keeps the schema flat — reporting can
        // treat one engine_run = one transcript cycle with its total
        // token/time cost. Email audit is null for cold-call template
        // path and opportunity calls (no LLM email), so we handle nulls.
        const e = llmRun.audit;
        const m = llmRun.emailAudit;
        runId = await saveEngineRun({
          contactId,
          conversationId,
          callType,
          output,
          llm: {
            status: "ok",
            model: e.model,
            latencyMs: e.latencyMs + (m?.latencyMs ?? 0),
            inputTokens: e.inputTokens + (m?.inputTokens ?? 0),
            outputTokens: e.outputTokens + (m?.outputTokens ?? 0),
            cacheReadTokens: e.cacheReadTokens + (m?.cacheReadTokens ?? 0),
            cacheCreationTokens: e.cacheCreationTokens + (m?.cacheCreationTokens ?? 0),
            extraction: llmRun.rawExtraction,
          },
        });
      } catch (err: any) {
        // Directive rule: never fall back silently to keyword path. Mark
        // as failed so it's visible to admins. Output is a minimal
        // placeholder so drawer doesn't crash on run read; admin can
        // re-run from the reprocess endpoint.
        const reason = err instanceof ExtractionError ? err.reason : "unknown";
        const message = err?.message || String(err);
        console.error("[Engine V3 LLM] extraction failed:", { reason, message });
        // Persist a minimal failed-run record. We don't have a real
        // EngineOutput, but saveEngineRun requires one for schema. Build
        // a stub that renders as "no analysis available".
        const stubOutput: any = {
          engineVersion: "failed",
          processedAt: new Date().toISOString(),
          callType,
          investorId: investor.investorId,
          signalUpdates: [],
          factFindUpdates: {},
          personaAssessment: { persona: investor.persona, confidence: "low", evidence: "LLM extraction failed" },
          hotButton: { primary: investor.hotButton, evidence: "" },
          demoScore: investor.demoScore,
          gateStatus: { c4Compliance: "open", pack1: "blocked", pack1BlockedReasons: ["engine_failed"], activeRoute: "pending", blockedSignals: [] },
          nextBestAction: { actionType: "schedule_call", detail: "Engine extraction failed — review transcript manually", owner: "agent", timing: "immediate", contentToSend: null },
          pipelineTransition: null,
          crmNote: "Engine extraction failed. Admin can reprocess via /engine/reprocess.",
          flags: [{ type: "missing_data", message: `Layer 1 LLM extraction failed: ${reason}` }],
          questionsDetected: [],
          demoSegmentAnalysis: null,
          emailDraft: null,
          postCloseActions: null,
          adviserLoopActions: null,
          book2Routing: null,
        };
        runId = await saveEngineRun({
          contactId,
          conversationId,
          callType,
          output: stubOutput,
          llm: { status: "failed", error: `${reason}: ${message}` },
        });
        return `engine run ${runId}: FAILED (${reason}) — admin can reprocess`;
      }
    } else {
      // Pre-4.9 keyword path. Stays runnable until we delete it after
      // LLM path is validated.
      const kw = processTranscriptDetailed(transcript, callType, investor, { outcomeRules });
      output = kw.output;
      shadowDetail = { shadowDiff: kw.detail.shadowDiff, nbaSource: kw.detail.nbaSource };
      nextCallTypeHintToStamp = kw.detail.nextCallTypeHint;
      runId = await saveEngineRun({
        contactId,
        conversationId,
        callType,
        output,
        llm: { status: "keyword" },
      });
    }

    // Session 4 shadow-mode: log any divergence between the rule
    // engine and the legacy cascade.
    if (shadowDetail && shadowDetail.nbaSource === "rules" && shadowDetail.shadowDiff) {
      console.warn(
        `[NBA shadow diff] runId=${runId} contactId=${contactId} callType=${callType} diffs=${JSON.stringify(shadowDetail.shadowDiff)}`,
      );
    }

    // Phase 7.1b — persist the next-call-type hint on the contact so
    // the next transcription webhook classifies correctly. Only stamp
    // when the rule actually produced one AND it's not "none" (none
    // means terminal — don't pre-set, let duration take over).
    if (nextCallTypeHintToStamp && nextCallTypeHintToStamp !== "none") {
      await db
        .update(contactsTable)
        .set({ next_call_type_hint: nextCallTypeHintToStamp })
        .where(eq(contactsTable.id, contactId));
    }
    // `processTranscript` (non-detailed) is still used elsewhere, keep
    // as a reference so it stays exported.
    void processTranscript;

    // Tag the conversation with the engine version that processed it
    await db.update(leadConversationsTable)
      .set({ engine_version: output.engineVersion })
      .where(eq(leadConversationsTable.id, conversationId));

    // Phase 4.7 — create outcome_review when the applied tag's mapping
    // has creates_outcome_review=true (default true for backward compat).
    // Skip silently on config=false or when we can't resolve an owner
    // (resolver falls back through Aircall user → active call list's
    // assigned agent → null). A null owner means "unclaimed" — an admin
    // or closer can pick it up from the dedicated Outcomes page later.
    const reviewStatus = await maybeCreateOutcomeReview({
      engineRunId: runId,
      contactId,
      convTags,
    });

    return `engine ${output.engineVersion} run ${runId}: ${output.signalUpdates.length} signal updates, persona=${output.personaAssessment.persona}, next=${output.nextBestAction.actionType}${reviewStatus ? " | " + reviewStatus : ""}`;
  } catch (err: any) {
    console.error("[Aircall Webhook] engine run failed:", err);
    return `engine run failed: ${err.message}`;
  }
}

export async function handleTranscriptionCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  // Simulator bypass — if the call_id has the sim- prefix AND the payload
  // carries the transcript inline, use it directly without hitting the
  // Aircall API. Real Aircall IDs are numeric strings; they never match
  // this prefix, so there's no risk of collision. See admin/simulate-call.
  const isSimulated = String(callId).startsWith("sim-");
  let transcriptionData: any;
  if (isSimulated) {
    // Admin simulator — transcript comes inline; no Aircall API fetch.
    // Use the pre-formatted text as the transcript directly, bypassing
    // the utterance-collapsing logic below (which assumes Aircall's
    // structured response).
    transcriptionData = {
      __sim_bypass: true,
      __sim_transcript_text: typeof data._sim_transcript === "string" ? data._sim_transcript : "",
      summary: typeof data._sim_summary === "string" ? data._sim_summary : undefined,
    };
  } else {
    // Real flow — fetch the transcript from Aircall API.
    const auth = await getAircallAuth();
    if (!auth) return "no Aircall API credentials configured";

    const url = `https://api.aircall.io/v1/calls/${callId}/transcription`;
    const response = await fetch(url, { headers: { Authorization: auth } });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
    }

    transcriptionData = await response.json() as any;
  }

  // Aircall shape (2026): { transcription: { content: { utterances: [{ text, participant_type, ... }] } } }
  let transcriptText = "";
  // Simulator bypass short-circuit — transcript already in final shape.
  if (transcriptionData?.__sim_bypass) {
    transcriptText = transcriptionData.__sim_transcript_text || "";
  }
  const utterances = transcriptText ? [] : (
    transcriptionData?.transcription?.content?.utterances
    || transcriptionData?.content?.utterances
    || transcriptionData?.transcription?.utterances
    || []
  );

  if (Array.isArray(utterances) && utterances.length > 0) {
    // Collapse consecutive utterances from the same participant into one line
    const lines: string[] = [];
    let currentSpeaker = "";
    let currentText: string[] = [];
    const flush = () => {
      if (currentText.length > 0) {
        lines.push(`${currentSpeaker}: ${currentText.join(" ")}`);
        currentText = [];
      }
    };
    for (const u of utterances) {
      const speaker = u.participant_type === "internal" ? "Agent"
                    : u.participant_type === "external" ? "Contact"
                    : (u.speaker || u.role || "Speaker");
      const text = (u.text || u.content || "").trim();
      if (!text) continue;
      if (speaker !== currentSpeaker) {
        flush();
        currentSpeaker = speaker;
      }
      currentText.push(text);
    }
    flush();
    transcriptText = lines.join("\n");
  } else {
    // Legacy / fallback shapes
    const segments = transcriptionData?.transcription?.segments
      || transcriptionData?.segments
      || transcriptionData?.data?.segments
      || [];
    if (Array.isArray(segments) && segments.length > 0) {
      transcriptText = segments.map((s: any) =>
        `${s.speaker || s.role || "Speaker"}: ${s.text || s.content || ""}`
      ).join("\n");
    } else if (typeof transcriptionData?.transcription?.text === "string") {
      transcriptText = transcriptionData.transcription.text;
    } else if (typeof transcriptionData?.text === "string") {
      transcriptText = transcriptionData.text;
    }
  }

  // Extract Aircall AI summary if provided on the same response
  const aircallSummary = transcriptionData?.transcription?.summary ||
                         transcriptionData?.summary ||
                         transcriptionData?.data?.summary || null;

  if (!transcriptText && !aircallSummary) {
    // Surface the response shape so we can adapt the parser
    const topKeys = Object.keys(transcriptionData || {}).join(",");
    const innerKeys = transcriptionData?.transcription && typeof transcriptionData.transcription === "object"
      ? Object.keys(transcriptionData.transcription).join(",")
      : "(not an object)";
    const snippet = JSON.stringify(transcriptionData).slice(0, 400);
    return `empty transcript+summary; top keys: [${topKeys}]; transcription keys: [${innerKeys}]; snippet: ${snippet}`;
  }

  // Build the update payload
  const conversationUpdate: Record<string, any> = {};
  if (transcriptText) conversationUpdate.transcript_text = transcriptText;
  if (aircallSummary) conversationUpdate.summary = aircallSummary;

  const summary = `stored${aircallSummary ? " transcript+summary" : " transcript"} (${transcriptText.length} chars)`;

  // Update the conversation record with transcript and summary
  const [updated] = await db.update(leadConversationsTable)
    .set(conversationUpdate)
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id, contact_id: leadConversationsTable.contact_id });

  if (updated) {
    let engineStatus = "";
    if (updated.contact_id && transcriptText) {
      engineStatus = " | " + await runEngineForConversation(updated.contact_id, updated.id, transcriptText);
    }
    return `${summary} (updated existing)${engineStatus}`;
  }

  // No conversation record yet — call.ended might not have arrived first.
  // Fetch call data so we can verify the call was made by one of our agents
  // before creating a record. For simulated IDs there's no Aircall call to
  // fetch — the simulator always fires call.ended first, so reaching here
  // for a sim- ID indicates a bug.
  if (isSimulated) {
    return "simulator: no prior conversation row (call.ended should have fired first)";
  }
  const auth = await getAircallAuth();
  if (!auth) return "no Aircall API credentials configured for fallback fetch";
  const callResponse = await fetch(`https://api.aircall.io/v1/calls/${callId}`, {
    headers: { Authorization: auth },
  });
  if (!callResponse.ok) {
    return `no existing conversation AND call fetch returned ${callResponse.status}`;
  }
  const callData = await callResponse.json() as any;
  const call = callData?.call || callData;
  const aircallUserId = call?.user?.id;
  const agent = await findAgentByAircallUser(aircallUserId);
  if (!agent) {
    return `skipped: Aircall user ${aircallUserId} (${call?.user?.name || "unknown"}) is not a registered agent`;
  }
  const rawDigits = extractPhone(call);
  const contact = await findContactByPhone(rawDigits);
  if (!contact) return `no existing conversation AND no contact for phone ${rawDigits}`;
  const [inserted] = await db.insert(leadConversationsTable).values({
    contact_id: contact.id,
    lead_id: contact.lead_id || null,
    source: "aircall",
    external_id: String(callId),
    direction: "outbound",
    agent_name: agent.name,
    transcript_text: transcriptText || null,
    summary: aircallSummary || null,
    conversation_date: new Date(),
  }).returning({ id: leadConversationsTable.id });

  let engineStatus = "";
  if (inserted && transcriptText) {
    engineStatus = " | " + await runEngineForConversation(contact.id, inserted.id, transcriptText);
  }
  return `${summary} (new conversation, contact ${contact.first_name} ${contact.last_name})${engineStatus}`;
}

export async function handleSummaryCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  // Simulator bypass — inline summary from payload; skip Aircall fetch.
  const isSimulated = String(callId).startsWith("sim-");
  let summaryData: any;
  if (isSimulated) {
    if (typeof data._sim_summary !== "string" || !data._sim_summary.trim()) {
      return "simulator: no _sim_summary provided — nothing to store";
    }
    summaryData = { summary: data._sim_summary };
  } else {
    const auth = await getAircallAuth();
    if (!auth) return "no Aircall API credentials configured";

    const url = `https://api.aircall.io/v1/calls/${callId}/summary`;
    const response = await fetch(url, { headers: { Authorization: auth } });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
    }

    summaryData = await response.json() as any;
  }
  // Aircall may return the summary under various keys — try the common ones
  const summaryText: string =
    summaryData?.summary?.content ||
    summaryData?.summary?.text ||
    summaryData?.content ||
    summaryData?.text ||
    (typeof summaryData?.summary === "string" ? summaryData.summary : "") ||
    "";

  if (!summaryText) {
    const keys = Object.keys(summaryData || {}).join(",");
    return `empty summary; response keys: [${keys}]`;
  }

  // Update existing conversation record (only exists if call.ended already passed agent filter)
  const [updated] = await db.update(leadConversationsTable)
    .set({ summary: summaryText })
    .where(eq(leadConversationsTable.external_id, String(callId)))
    .returning({ id: leadConversationsTable.id });

  if (updated) return `stored summary (${summaryText.length} chars) on existing conversation`;

  // Fallback — no conversation yet. Verify call is from our agent before inserting.
  const callResp = await fetch(`https://api.aircall.io/v1/calls/${callId}`, { headers: { Authorization: auth } });
  if (!callResp.ok) return `no existing conversation AND call fetch returned ${callResp.status}`;
  const callData = await callResp.json() as any;
  const call = callData?.call || callData;
  const agent = await findAgentByAircallUser(call?.user?.id);
  if (!agent) {
    return `skipped: Aircall user ${call?.user?.id} (${call?.user?.name || "unknown"}) is not a registered agent`;
  }
  const rawDigits = extractPhone(call);
  const contact = await findContactByPhone(rawDigits);
  if (!contact) return `no existing conversation AND no contact for phone ${rawDigits}`;

  await db.insert(leadConversationsTable).values({
    contact_id: contact.id,
    lead_id: contact.lead_id || null,
    source: "aircall",
    external_id: String(callId),
    direction: "outbound",
    agent_name: agent.name,
    summary: summaryText,
    conversation_date: new Date(),
  });
  return `stored summary (${summaryText.length} chars) on new conversation for ${contact.first_name} ${contact.last_name}`;
}

// ==================== Background Sweep ====================
// Fallback for the rare case where call.tagged never arrives for a given call.
// Only marks the conversation itself as processed — does NOT touch the
// currently active membership, because that membership may belong to a
// LATER call (e.g. an immediate_recall from a different, successfully tagged
// call). Closing the current membership here would wipe legitimate recalls.
//
// The sweep will only close a membership if it was active *at the time* of
// the stale conversation AND is still active now (i.e. no later event has
// closed it). This narrow scope prevents collateral damage.

const UNTAGGED_TIMEOUT_MIN = 10;

export async function sweepUntaggedConversations(): Promise<{ swept: number; closedMemberships: number }> {
  const cutoff = new Date(Date.now() - UNTAGGED_TIMEOUT_MIN * 60_000);

  const stale = await db.select().from(leadConversationsTable)
    .where(and(
      isNull(leadConversationsTable.processed_at),
      eq(leadConversationsTable.source, "aircall"),
      lte(leadConversationsTable.created_at, cutoff),
    ));

  let swept = 0;
  let closedMemberships = 0;

  for (const conv of stale) {
    if (!conv.contact_id) continue;
    try {
      await db.transaction(async (tx) => {
        const now = new Date();

        // Only touch a membership if (a) it was added BEFORE this conversation
        // (i.e. existed when the call in question happened) AND (b) it is
        // still active now (nothing else has closed it).
        // Any membership added AFTER this conversation's created_at belongs
        // to a LATER call and must not be disturbed by this sweep.
        const [targetMembership] = await tx.select().from(callListMembershipsTable)
          .where(and(
            eq(callListMembershipsTable.contact_id, conv.contact_id!),
            isNull(callListMembershipsTable.removed_at),
            lte(callListMembershipsTable.added_at, conv.created_at),
          ))
          .orderBy(sql`${callListMembershipsTable.added_at} DESC`)
          .limit(1);

        let touchedMembership = false;
        if (targetMembership) {
          await tx.update(callListMembershipsTable)
            .set({ removed_at: now, removal_reason: "untagged-timeout", outcome_at_removal: null })
            .where(eq(callListMembershipsTable.id, targetMembership.id));
          // Only bump contact state when we've actually closed a membership.
          await tx.update(contactsTable).set({
            dispatch_status: "called",
            call_attempts: sql`${contactsTable.call_attempts} + 1`,
          }).where(eq(contactsTable.id, conv.contact_id!));
          touchedMembership = true;
        }

        // Always mark the conversation processed so the sweep doesn't keep
        // finding it on every run.
        await tx.update(leadConversationsTable)
          .set({ processed_at: now, call_outcome: touchedMembership ? "untagged" : "untagged-stale" })
          .where(eq(leadConversationsTable.id, conv.id));

        if (touchedMembership) closedMemberships++;
      });
      swept++;
    } catch (err: any) {
      console.warn(`[Aircall sweep] failed to process conversation ${conv.id}:`, err?.message);
    }
  }

  if (closedMemberships > 0) {
    notifyQueueChanged({ event: "untagged-sweep" });
  }
  return { swept, closedMemberships };
}

// Schedule the sweep to run periodically in-process. Idempotent — safe to call
// multiple times during boot; will only register once.
let sweepInterval: ReturnType<typeof setInterval> | null = null;
export function startUntaggedSweep(): void {
  if (sweepInterval) return;
  // Run every 5 minutes
  sweepInterval = setInterval(() => {
    sweepUntaggedConversations().catch(err => console.warn("[Aircall sweep] error:", err?.message));
  }, 5 * 60 * 1000);
}

// Manual trigger for diagnostics: POST /aircall/sweep-untagged
router.post("/aircall/sweep-untagged", async (_req, res): Promise<void> => {
  try {
    const result = await sweepUntaggedConversations();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
