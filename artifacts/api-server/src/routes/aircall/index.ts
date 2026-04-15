import { Router, type IRouter } from "express";
import { db, contactsTable, leadConversationsTable, integrationConfigsTable, agentsTable, callListMembershipsTable } from "@workspace/db";
import { eq, or, sql, and, isNull, lte } from "drizzle-orm";
import { loadInvestor, processTranscript, saveEngineRun } from "../../engine/v2";
import type { CallType } from "../../engine/v2";
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
async function getTagMapping(): Promise<TagMapping[]> {
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
async function getCoolOffDays(): Promise<number> {
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
function resolveTag(tagName: string, tagMapping: TagMapping[]): { outcome: Outcome; sideEffect: SideEffect; mapping: TagMapping } | null {
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
async function applyTaggedOutcomeTx(
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

function logWebhook(event: string, status: string, contactMatch: string | null, data: any) {
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
async function handleCallEnded(data: any): Promise<string | null> {
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
async function handleCallTagged(data: any): Promise<string | null> {
  const callId = data.call_id || data.id;
  const tag = data.tag;
  if (!tag) return "no tag in payload";
  const tagName = typeof tag === "string" ? tag : tag.name;
  if (!tagName) return "no tag name";
  if (!callId) return "no call_id";

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

  notifyQueueChanged({ event: "call.tagged", contactId, callId: String(callId) });

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

// Infer the spec's call type from call duration. Defaults to cold_call.
function inferCallType(durationSeconds: number | null | undefined): CallType {
  const mins = Math.round((durationSeconds || 0) / 60);
  if (mins >= 40) return "demo";
  if (mins >= 20) return "opportunity";
  return "cold_call";
}

// Run the V2 engine against a stored transcript and persist the output.
// Returns a short status string for the webhook log.
async function runEngineForConversation(
  contactId: string,
  conversationId: string,
  transcript: string,
): Promise<string> {
  try {
    const [conv] = await db.select().from(leadConversationsTable)
      .where(eq(leadConversationsTable.id, conversationId))
      .limit(1);
    if (!conv) return `engine: conversation ${conversationId} not found`;

    const callType = inferCallType(conv.duration_seconds);
    const investor = await loadInvestor(contactId);
    const output = processTranscript(transcript, callType, investor);
    const runId = await saveEngineRun({ contactId, conversationId, callType, output });

    // Tag the conversation with the engine version that processed it
    await db.update(leadConversationsTable)
      .set({ engine_version: output.engineVersion })
      .where(eq(leadConversationsTable.id, conversationId));

    return `engine ${output.engineVersion} run ${runId}: ${output.signalUpdates.length} signal updates, persona=${output.personaAssessment.persona}, next=${output.nextBestAction.actionType}`;
  } catch (err: any) {
    console.error("[Aircall Webhook] engine run failed:", err);
    return `engine run failed: ${err.message}`;
  }
}

async function handleTranscriptionCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  // Fetch the transcript from Aircall API
  const auth = await getAircallAuth();
  if (!auth) return "no Aircall API credentials configured";

  const url = `https://api.aircall.io/v1/calls/${callId}/transcription`;
  const response = await fetch(url, { headers: { Authorization: auth } });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
  }

  const transcriptionData = await response.json() as any;

  // Aircall shape (2026): { transcription: { content: { utterances: [{ text, participant_type, ... }] } } }
  let transcriptText = "";
  const utterances = transcriptionData?.transcription?.content?.utterances
    || transcriptionData?.content?.utterances
    || transcriptionData?.transcription?.utterances
    || [];

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
  // before creating a record.
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

async function handleSummaryCreated(data: any): Promise<string> {
  const callId = data.call_id || data.id;
  if (!callId) return "no call_id in payload";

  const auth = await getAircallAuth();
  if (!auth) return "no Aircall API credentials configured";

  const url = `https://api.aircall.io/v1/calls/${callId}/summary`;
  const response = await fetch(url, { headers: { Authorization: auth } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return `API ${response.status} from ${url} — ${body.slice(0, 200)}`;
  }

  const summaryData = await response.json() as any;
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
// Fallback for the rare case where call.tagged never arrives. Treats any
// conversation that has a duration_seconds (i.e. call.ended ran) but no
// processed_at after a timeout as "untagged" and applies a default close.

const UNTAGGED_TIMEOUT_MIN = 10;

export async function sweepUntaggedConversations(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - UNTAGGED_TIMEOUT_MIN * 60_000);

  const stale = await db.select().from(leadConversationsTable)
    .where(and(
      isNull(leadConversationsTable.processed_at),
      eq(leadConversationsTable.source, "aircall"),
      lte(leadConversationsTable.created_at, cutoff),
    ));

  let swept = 0;
  for (const conv of stale) {
    if (!conv.contact_id) continue;
    try {
      await db.transaction(async (tx) => {
        const now = new Date();
        // Close the active membership as 'untagged'
        const [activeMembership] = await tx.select().from(callListMembershipsTable)
          .where(and(
            eq(callListMembershipsTable.contact_id, conv.contact_id!),
            isNull(callListMembershipsTable.removed_at),
          ))
          .limit(1);
        if (activeMembership) {
          await tx.update(callListMembershipsTable)
            .set({ removed_at: now, removal_reason: "untagged-timeout", outcome_at_removal: null })
            .where(eq(callListMembershipsTable.id, activeMembership.id));
        }
        // Increment attempts and mark contact called
        await tx.update(contactsTable).set({
          dispatch_status: "called",
          call_attempts: sql`${contactsTable.call_attempts} + 1`,
        }).where(eq(contactsTable.id, conv.contact_id!));
        // Mark conversation processed
        await tx.update(leadConversationsTable)
          .set({ processed_at: now, call_outcome: "untagged" })
          .where(eq(leadConversationsTable.id, conv.id));
      });
      swept++;
    } catch (err: any) {
      console.warn(`[Aircall sweep] failed to process conversation ${conv.id}:`, err?.message);
    }
  }

  if (swept > 0) {
    notifyQueueChanged({ event: "untagged-sweep" });
  }
  return { swept };
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
