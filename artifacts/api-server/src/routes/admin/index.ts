import { Router, type IRouter } from "express";
import { db, agentsTable, usersTable, integrationConfigsTable, contactsTable, callListConfigsTable, callListMembershipsTable, leadConversationsTable, engineOutcomeRulesTable, engineRunsTable } from "@workspace/db";
import { asc, eq, desc, and, isNull } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { logger } from "../../lib/logger";
import { randomUUID } from "crypto";
import {
  handleCallEnded,
  handleCallTagged,
  handleTranscriptionCreated,
  handleSummaryCreated,
  logWebhook,
  resolveTag,
  getTagMapping,
} from "../aircall";
import { clearQueue as clearPowerDialerQueue, getQueue as getPowerDialerQueue } from "../../lib/aircallPowerDialer";
import { seedOutcomeRules } from "../../data/seed-outcome-rules";
import { invalidateOutcomeRulesCache, loadOutcomeRules } from "../../engine/v2/outcomeRules/loader";
import { evaluateOutcomeRules, RuleCoverageError } from "../../engine/v2/outcomeRules/evaluator";
import { loadInvestor } from "../../engine/v2";

const router: IRouter = Router();

// All /admin/* routes require an authenticated user with role=admin.
// Scoped to the /admin path so this middleware does NOT run on unrelated
// API calls (e.g. /contacts/*, /call-lists/*) that happen to pass through
// this router — those are handled elsewhere.
router.use("/admin", requireAdmin);

// ==================== Agents ====================

// GET /api/admin/agents — list all agents with linked user info (if any)
router.get("/admin/agents", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: agentsTable.id,
        name: agentsTable.name,
        email: agentsTable.email,
        aircall_user_id: agentsTable.aircall_user_id,
        dialer_mode: agentsTable.dialer_mode,
        active: agentsTable.active,
        user_id: agentsTable.user_id,
        created_at: agentsTable.created_at,
        updated_at: agentsTable.updated_at,
        user_email: usersTable.email,
        user_role: usersTable.role,
        user_last_login_at: usersTable.last_login_at,
      })
      .from(agentsTable)
      .leftJoin(usersTable, eq(usersTable.id, agentsTable.user_id))
      .orderBy(desc(agentsTable.created_at));

    res.json({ agents: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/agents list failed");
    res.status(500).json({ error: "list_failed" });
  }
});

// POST /api/admin/agents — create a new agent.
// Body: { name, email, aircall_user_id?, active? }
router.post("/admin/agents", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const aircallRaw = req.body?.aircall_user_id;
  const aircall_user_id =
    aircallRaw == null || aircallRaw === ""
      ? null
      : Number(aircallRaw);
  const active = req.body?.active !== false;

  if (!name) {
    res.status(400).json({ error: "name_required" });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "valid_email_required" });
    return;
  }
  if (aircall_user_id !== null && (!Number.isFinite(aircall_user_id) || aircall_user_id <= 0)) {
    res.status(400).json({ error: "aircall_user_id_invalid" });
    return;
  }

  try {
    // Refuse to create a duplicate email — agent.email must be unique for SSO
    // to pick the right row at login.
    const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.email, email));
    if (existing) {
      res.status(409).json({ error: "email_already_exists", existing_id: existing.id });
      return;
    }

    const [created] = await db
      .insert(agentsTable)
      .values({ name, email, aircall_user_id: aircall_user_id ?? undefined, active })
      .returning();

    logger.info({ id: created.id, email }, "admin created agent");
    res.json({ agent: created });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin create agent failed");
    res.status(500).json({ error: "create_failed" });
  }
});

// PATCH /api/admin/agents/:id — update name / aircall_user_id / active.
// Email is intentionally NOT updatable — changing it would orphan the Google
// SSO binding. Delete + recreate if email needs to change.
router.patch("/admin/agents/:id", async (req, res) => {
  const { id } = req.params;

  const updates: Partial<{
    name: string;
    aircall_user_id: number | null;
    active: boolean;
    dialer_mode: "manual" | "power_dialer";
  }> = {};

  // Optional role update — applies to the LINKED user, not the agent row.
  // Captured separately so we can coordinate a second update in the same tx.
  let nextUserRole: "agent" | "closer" | "admin" | undefined;

  if (typeof req.body?.name === "string") {
    const n = req.body.name.trim();
    if (!n) {
      res.status(400).json({ error: "name_required" });
      return;
    }
    updates.name = n;
  }
  if ("aircall_user_id" in (req.body || {})) {
    const raw = req.body.aircall_user_id;
    if (raw == null || raw === "") {
      updates.aircall_user_id = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        res.status(400).json({ error: "aircall_user_id_invalid" });
        return;
      }
      updates.aircall_user_id = n;
    }
  }
  if (typeof req.body?.active === "boolean") {
    updates.active = req.body.active;
  }
  if (typeof req.body?.dialer_mode === "string") {
    const m = req.body.dialer_mode.trim();
    if (m !== "manual" && m !== "power_dialer") {
      res.status(400).json({ error: "dialer_mode_invalid", message: "must be 'manual' or 'power_dialer'" });
      return;
    }
    updates.dialer_mode = m;
  }
  if (typeof req.body?.user_role === "string") {
    const r = req.body.user_role.trim();
    if (r !== "agent" && r !== "closer" && r !== "admin") {
      res.status(400).json({ error: "user_role_invalid", message: "must be 'agent' | 'closer' | 'admin'" });
      return;
    }
    nextUserRole = r;
  }

  if (Object.keys(updates).length === 0 && nextUserRole === undefined) {
    res.status(400).json({ error: "nothing_to_update" });
    return;
  }

  try {
    // Apply agent-row updates (if any)
    let agentRow: any;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(agentsTable)
        .set(updates as any)
        .where(eq(agentsTable.id, id))
        .returning();
      if (!updated) {
        res.status(404).json({ error: "agent_not_found" });
        return;
      }
      agentRow = updated;
    } else {
      // No agent-row changes — just fetch it to return a consistent response
      const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
      if (!existing) {
        res.status(404).json({ error: "agent_not_found" });
        return;
      }
      agentRow = existing;
    }

    // Apply linked-user role update (if requested). Only possible when the
    // agent is linked to a user — unlinked agents have no user row to update.
    if (nextUserRole !== undefined) {
      if (!agentRow.user_id) {
        res.status(409).json({
          error: "agent_not_linked_to_user",
          message: `Agent "${agentRow.name}" has no linked user yet — they must log in at least once before their role can be changed.`,
        });
        return;
      }
      await db.update(usersTable)
        .set({ role: nextUserRole })
        .where(eq(usersTable.id, agentRow.user_id));
    }

    logger.info({ id, updates, nextUserRole }, "admin updated agent");
    res.json({ agent: agentRow });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin update agent failed");
    res.status(500).json({ error: "update_failed" });
  }
});

// ==================== Power Dialer queue ops ====================

// GET /api/admin/agents/:id/power-dialer-queue — inspect what's currently
// sitting in the agent's Aircall PD queue. Useful for debugging drift
// between our app's queue and Aircall's.
router.get("/admin/agents/:id/power-dialer-queue", async (req, res) => {
  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, req.params.id));
    if (!agent) { res.status(404).json({ error: "agent_not_found" }); return; }
    if (agent.aircall_user_id == null) {
      res.status(400).json({ error: "agent_missing_aircall_user_id" });
      return;
    }
    const items = await getPowerDialerQueue(agent.aircall_user_id);
    res.json({ agent_id: agent.id, aircall_user_id: agent.aircall_user_id, items });
  } catch (err: any) {
    logger.error({ err: err.message }, "pd queue inspect failed");
    res.status(500).json({ error: "fetch_failed", message: err.message });
  }
});

// POST /api/admin/agents/:id/clear-power-dialer-queue — wipe the agent's
// Aircall PD queue. Admin tool for resetting a stuck queue or starting fresh.
// Only meaningful when the agent is in dialer_mode = "power_dialer" with an
// aircall_user_id, but we don't gate on dialer_mode — admin may have just
// toggled them back to manual and wants to clear residual Aircall state.
router.post("/admin/agents/:id/clear-power-dialer-queue", async (req, res) => {
  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, req.params.id));
    if (!agent) { res.status(404).json({ error: "agent_not_found" }); return; }
    if (agent.aircall_user_id == null) {
      res.status(400).json({
        error: "agent_missing_aircall_user_id",
        message: `Agent "${agent.name}" has no aircall_user_id. Can't identify which Aircall user's queue to clear.`,
      });
      return;
    }

    const result = await clearPowerDialerQueue(agent.aircall_user_id);
    logger.info({
      agentId: agent.id,
      aircallUserId: agent.aircall_user_id,
      deleted: result.deleted,
      errors: result.errors.length,
      triggeredBy: req.auth!.user.email,
    }, "Power Dialer queue cleared by admin");
    res.json({
      ok: true,
      agent_id: agent.id,
      aircall_user_id: agent.aircall_user_id,
      deleted: result.deleted,
      errors: result.errors,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "pd queue clear failed");
    res.status(500).json({ error: "clear_failed", message: err.message });
  }
});

// ==================== Aircall users picker ====================

// GET /api/admin/aircall/users — proxy to Aircall to fetch their user list
// so the admin UI can offer a dropdown instead of free-text numeric IDs.
router.get("/admin/aircall/users", async (_req, res) => {
  try {
    const [config] = await db
      .select()
      .from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    if (!config) {
      res.status(400).json({ error: "aircall_not_configured" });
      return;
    }
    const aircallConfig = config.config as Record<string, any>;
    const apiId = aircallConfig.api_id;
    const apiToken = aircallConfig.api_token;
    if (!apiId || !apiToken) {
      res.status(400).json({ error: "aircall_credentials_missing" });
      return;
    }

    const authHeader = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
    const response = await fetch("https://api.aircall.io/v1/users", {
      headers: { Authorization: `Basic ${authHeader}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      res.status(502).json({
        error: `aircall_returned_${response.status}`,
        aircall_status: response.status,
        aircall_body: body.slice(0, 400),
      });
      return;
    }

    const data = (await response.json()) as { users?: any[] };
    const users = (data.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
      available: u.available,
    }));
    res.json({ users });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin aircall users fetch failed");
    res.status(500).json({ error: "aircall_fetch_failed" });
  }
});

// ==================== Simulator support ====================

// GET /api/admin/tag-mapping — returns the current tag mapping so the
// simulator UI can offer a dropdown of valid tag names.
router.get("/admin/tag-mapping", async (_req, res) => {
  try {
    const mapping = await getTagMapping();
    res.json({ mapping });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin tag-mapping fetch failed");
    res.status(500).json({ error: "fetch_failed" });
  }
});

// ==================== Call Simulator ====================

/**
 * POST /api/admin/simulate-call
 *
 * Fires the same sequence of events Aircall would, through the SAME webhook
 * handlers (handleCallEnded → handleCallTagged → handleTranscriptionCreated
 * → handleSummaryCreated). Payloads are constructed in real Aircall shape
 * so payload parsing, contact resolution by phone, agent resolution by
 * aircall_user_id, and tag extraction are all exercised. Each event is
 * recorded in the webhook log so you can see it at /webhook-log.
 *
 * The only bypass is the Aircall API fetch inside transcription.created +
 * summary.created — those handlers detect the sim- prefix on call_id and
 * use the inline transcript/summary from the payload instead of fetching.
 *
 * Body: {
 *   contact_id: string,
 *   agent_id: string,
 *   tag: string,
 *   transcript?: string,
 *   summary?: string,
 *   duration_seconds?: number,
 *   direction?: "inbound" | "outbound",
 *   ensure_membership?: boolean,
 * }
 */
router.post("/admin/simulate-call", async (req, res) => {
  const body = req.body || {};
  const contactId = typeof body.contact_id === "string" ? body.contact_id : null;
  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;
  const tagName = typeof body.tag === "string" ? body.tag.trim() : null;
  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary : null;
  let duration = Number.isFinite(Number(body.duration_seconds)) ? Number(body.duration_seconds) : 60;

  // Phase 7.1a session 4 improvement B — explicit call_type override.
  // The engine's inferCallType() today maps duration → type (<20min cold,
  // 20–40 opportunity, ≥40 demo). When the simulator caller picks a call
  // type explicitly we translate it back to a representative duration so
  // the existing webhook chain + engine infer the right type downstream.
  // Belt-and-braces: duration is still used as the safety net for real
  // calls where no hint is available.
  const callTypeOverride = typeof body.call_type === "string" ? body.call_type : null;
  if (callTypeOverride === "cold_call") duration = 600;        // 10 min
  else if (callTypeOverride === "opportunity") duration = 1800; // 30 min
  else if (callTypeOverride === "demo") duration = 2520;        // 42 min
  // any other value falls through to the caller-supplied duration

  const direction: "inbound" | "outbound" = body.direction === "inbound" ? "inbound" : "outbound";
  const ensureMembership = body.ensure_membership !== false;

  if (!contactId) { res.status(400).json({ error: "contact_id_required" }); return; }
  if (!agentId) { res.status(400).json({ error: "agent_id_required" }); return; }
  if (!tagName) { res.status(400).json({ error: "tag_required" }); return; }

  try {
    // 1. Validate inputs.
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) { res.status(404).json({ error: "contact_not_found" }); return; }

    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) { res.status(404).json({ error: "agent_not_found" }); return; }
    if (!agent.active) { res.status(400).json({ error: "agent_inactive" }); return; }
    if (agent.aircall_user_id == null) {
      res.status(400).json({
        error: "agent_missing_aircall_user_id",
        message: `Agent "${agent.name}" has no aircall_user_id. The webhook handlers look agents up by Aircall user ID; set it via Admin → Agents before simulating.`,
      });
      return;
    }
    if (!contact.phone) {
      res.status(400).json({
        error: "contact_missing_phone",
        message: `Contact "${contact.first_name} ${contact.last_name}" has no phone number. The webhook handlers look contacts up by phone.`,
      });
      return;
    }

    const tagMapping = await getTagMapping();
    const resolution = resolveTag(tagName, tagMapping);
    if (!resolution) {
      res.status(400).json({
        error: "tag_not_mapped",
        message: `Tag "${tagName}" is not in the configured mapping. Known tags: ${tagMapping.map(t => t.aircall_tag).join(", ")}`,
      });
      return;
    }

    // 2. Ensure an active membership exists if the admin asked us to.
    //    Done BEFORE firing webhooks so handleCallTagged's transaction has
    //    something to close. Mirrors the real world where a contact is
    //    always on a call list when they get called.
    let createdSimList = false;
    let createdSimMembership = false;
    if (ensureMembership) {
      const [activeMembership] = await db.select().from(callListMembershipsTable)
        .where(and(
          eq(callListMembershipsTable.contact_id, contactId),
          isNull(callListMembershipsTable.removed_at),
        ))
        .limit(1);

      if (!activeMembership) {
        const simListName = `Simulator Test List — ${agent.name}`;
        let [simList] = await db.select().from(callListConfigsTable)
          .where(eq(callListConfigsTable.name, simListName))
          .limit(1);
        if (!simList) {
          [simList] = await db.insert(callListConfigsTable).values({
            name: simListName,
            assigned_agent_id: agent.id,
            daily_quota: 1000,
            filter_criteria: { source_lists: [], exclude_outcomes: [] },
            active: true,
          }).returning();
          createdSimList = true;
        }
        await db.insert(callListMembershipsTable).values({
          call_list_id: simList.id,
          contact_id: contactId,
          added_at: new Date(),
        });
        await db.update(contactsTable)
          .set({ dispatch_status: "dispatched", dispatch_date: new Date() })
          .where(eq(contactsTable.id, contactId));
        createdSimMembership = true;
      }
    }

    // 3. Fire the 4 webhook events in sequence, through the REAL handlers.
    //    Each payload is shaped the way Aircall actually sends it, so the
    //    full parse → resolve → act → log pipeline runs. Each handler's
    //    response is captured for the result panel.
    const syntheticCallId = `sim-${randomUUID()}`;
    const nowIso = new Date().toISOString();
    const agentAircallId = agent.aircall_user_id;

    const eventResults: Array<{ event: string; result: string | null; error?: string }> = [];

    // --- call.ended ---
    const callEndedPayload = {
      id: syntheticCallId,
      direction,
      duration,
      raw_digits: contact.phone,
      number: { digits: contact.phone },
      user: { id: agentAircallId, name: agent.name },
      tags: [],
      started_at: nowIso,
      ended_at: nowIso,
    };
    try {
      const r = await handleCallEnded(callEndedPayload);
      logWebhook("call.ended", "processed", r || null, callEndedPayload);
      eventResults.push({ event: "call.ended", result: r });
    } catch (err: any) {
      logWebhook("call.ended", `error: ${err.message}`, null, callEndedPayload);
      eventResults.push({ event: "call.ended", result: null, error: err.message });
    }

    // --- call.tagged ---
    const callTaggedPayload = {
      call_id: syntheticCallId,
      tag: { name: tagName },
      // Aircall v2 also sends full call object on tagged — include for parity
      call: {
        id: syntheticCallId,
        user: { id: agentAircallId, name: agent.name },
        raw_digits: contact.phone,
        direction,
        duration,
      },
    };
    try {
      const r = await handleCallTagged(callTaggedPayload);
      logWebhook("call.tagged", "processed", r || null, callTaggedPayload);
      eventResults.push({ event: "call.tagged", result: r });
    } catch (err: any) {
      logWebhook("call.tagged", `error: ${err.message}`, null, callTaggedPayload);
      eventResults.push({ event: "call.tagged", result: null, error: err.message });
    }

    // --- transcription.created (only if transcript provided) ---
    if (transcript.trim()) {
      const transPayload = {
        call_id: syntheticCallId,
        _sim_transcript: transcript,
        _sim_summary: summary || undefined, // capture Aircall's "summary bundled with transcript" shape too
      };
      try {
        const r = await handleTranscriptionCreated(transPayload);
        logWebhook("transcription.created", "processed", r || null, transPayload);
        eventResults.push({ event: "transcription.created", result: r });
      } catch (err: any) {
        logWebhook("transcription.created", `error: ${err.message}`, null, transPayload);
        eventResults.push({ event: "transcription.created", result: null, error: err.message });
      }
    } else {
      eventResults.push({ event: "transcription.created", result: "skipped — no transcript provided" });
    }

    // --- summary.created (only if summary provided) ---
    if (summary) {
      const summaryPayload = {
        call_id: syntheticCallId,
        _sim_summary: summary,
      };
      try {
        const r = await handleSummaryCreated(summaryPayload);
        logWebhook("summary.created", "processed", r || null, summaryPayload);
        eventResults.push({ event: "summary.created", result: r });
      } catch (err: any) {
        logWebhook("summary.created", `error: ${err.message}`, null, summaryPayload);
        eventResults.push({ event: "summary.created", result: null, error: err.message });
      }
    } else {
      eventResults.push({ event: "summary.created", result: "skipped — no summary provided" });
    }

    // 4. Read back the final state.
    const [finalContact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contact.id));
    const [finalConv] = await db.select().from(leadConversationsTable)
      .where(eq(leadConversationsTable.external_id, syntheticCallId))
      .limit(1);
    const finalMemberships = await db.select().from(callListMembershipsTable)
      .where(eq(callListMembershipsTable.contact_id, contact.id))
      .orderBy(desc(callListMembershipsTable.added_at));

    logger.info({
      admin: req.auth!.user.email,
      contactId: contact.id,
      agentId: agent.id,
      tag: tagName,
      outcome: resolution.outcome,
      events: eventResults.map(e => ({ event: e.event, result: e.result })),
    }, "simulate-call completed");

    res.json({
      ok: true,
      synthetic_call_id: syntheticCallId,
      resolved: {
        outcome: resolution.outcome,
        side_effect: resolution.sideEffect,
      },
      events: eventResults,
      created_simulator_list: createdSimList,
      created_simulator_membership: createdSimMembership,
      final: {
        contact: finalContact ? {
          id: finalContact.id,
          dispatch_status: finalContact.dispatch_status,
          last_call_outcome: finalContact.last_call_outcome,
          call_attempts: finalContact.call_attempts,
          callback_date: finalContact.callback_date,
          cool_off_until: finalContact.cool_off_until,
        } : null,
        conversation: finalConv ? {
          id: finalConv.id,
          call_outcome: finalConv.call_outcome,
          tags: finalConv.tags,
          processed_at: finalConv.processed_at,
          engine_version: finalConv.engine_version,
          has_transcript: !!finalConv.transcript_text,
          has_summary: !!finalConv.summary,
        } : null,
        memberships: finalMemberships.map(m => ({
          id: m.id,
          call_list_id: m.call_list_id,
          added_at: m.added_at,
          removed_at: m.removed_at,
          removal_reason: m.removal_reason,
          outcome_at_removal: m.outcome_at_removal,
        })),
      },
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "simulate-call failed");
    res.status(500).json({ error: "simulate_failed", message: err.message });
  }
});

// ==================== Phase 7.1a — NBA Outcome Rules ====================

// GET /api/admin/agents/:id/call-lists — lists assigned to this agent,
// each with currently-active memberships (contacts on that list now).
// Used by the /admin/simulate-call page to flow agent → list → contact
// matching how agents actually work (they call from their own lists,
// not arbitrary contacts from the pool).
router.get("/admin/agents/:id/call-lists", async (req, res) => {
  try {
    const agentId = req.params.id;
    const lists = await db
      .select({
        id: callListConfigsTable.id,
        name: callListConfigsTable.name,
        active: callListConfigsTable.active,
        closing_only: callListConfigsTable.closing_only,
        daily_quota: callListConfigsTable.daily_quota,
      })
      .from(callListConfigsTable)
      .where(eq(callListConfigsTable.assigned_agent_id, agentId));

    // Fetch active memberships per list in parallel. Cap at 100 per list
    // so the simulator picker stays usable.
    const withContacts = await Promise.all(
      lists.map(async (l: typeof lists[number]) => {
        const rows = await db
          .select({
            id: contactsTable.id,
            first_name: contactsTable.first_name,
            last_name: contactsTable.last_name,
            phone: contactsTable.phone,
            dispatch_status: contactsTable.dispatch_status,
            last_call_outcome: contactsTable.last_call_outcome,
            membership_added_at: callListMembershipsTable.added_at,
          })
          .from(callListMembershipsTable)
          .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
          .where(and(
            eq(callListMembershipsTable.call_list_id, l.id),
            isNull(callListMembershipsTable.removed_at),
          ))
          .orderBy(desc(callListMembershipsTable.added_at))
          .limit(100);
        return { ...l, contacts: rows };
      }),
    );

    res.json({ lists: withContacts });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/agents/:id/call-lists failed");
    res.status(500).json({ error: "list_failed", message: err.message });
  }
});

// GET /api/admin/engine-outcome-rules — list all rules, priority asc.
// Read-only in session 1. Editing ships in 7.1b.
router.get("/admin/engine-outcome-rules", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(engineOutcomeRulesTable)
      .orderBy(asc(engineOutcomeRulesTable.priority));
    res.json({ rules: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-outcome-rules list failed");
    res.status(500).json({ error: "list_failed", message: err.message });
  }
});

// POST /api/admin/engine-outcome-rules/seed — idempotent seed/reset of
// the 10 rules translated from determineNextAction. Safe to call
// repeatedly; upserts by id. Werner runs this once after the schema
// push to populate the table.
router.post("/admin/engine-outcome-rules/seed", async (_req, res) => {
  try {
    const result = await seedOutcomeRules();
    invalidateOutcomeRulesCache();
    res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-outcome-rules seed failed");
    res.status(500).json({ error: "seed_failed", message: err.message });
  }
});

// ---------- Phase 7.1b — CRUD on rules ----------
//
// All three endpoints share validation and cache invalidation. Cache
// invalidation on every write means the next engine run picks up the
// change within milliseconds, not within the 60s TTL.

const ALLOWED_OPS = new Set(["===", "!==", "==", "!=", ">", ">=", "<", "<="]);
const ALLOWED_LVALUE_ROOTS = new Set(["callType", "content"]);
const ALLOWED_LVALUE_PREFIXES = ["signal.", "gate.", "investor."];

/**
 * Normalise and validate a rule payload. Returns a {rule, errors} tuple.
 * Errors is non-empty when the input is malformed. All shape drift is
 * reported up-front so the UI can show a single error summary.
 */
function validateRulePayload(body: any): { rule: any; errors: string[] } {
  const errors: string[] = [];
  const out: any = {};

  if (typeof body?.id !== "string" || !body.id.trim()) {
    errors.push("id is required and must be a non-empty string");
  } else {
    out.id = body.id.trim();
  }

  const pri = Number(body?.priority);
  if (!Number.isFinite(pri) || pri < 0 || pri > 100000) {
    errors.push("priority must be a number between 0 and 100000");
  } else {
    out.priority = Math.round(pri);
  }

  out.enabled = body?.enabled !== false; // default true

  // when_clauses: array of {lvalue, op, rvalue}
  if (!Array.isArray(body?.when_clauses) || body.when_clauses.length === 0) {
    errors.push("when_clauses must be a non-empty array");
  } else {
    const normalised: any[] = [];
    body.when_clauses.forEach((c: any, i: number) => {
      if (typeof c?.lvalue !== "string" || !c.lvalue) {
        errors.push(`clause ${i}: lvalue is required`);
        return;
      }
      const isRoot = ALLOWED_LVALUE_ROOTS.has(c.lvalue);
      const isPrefixed = ALLOWED_LVALUE_PREFIXES.some((p) => c.lvalue.startsWith(p));
      if (!isRoot && !isPrefixed) {
        errors.push(`clause ${i}: lvalue "${c.lvalue}" not in allowed list (callType, content, signal.*, gate.*, investor.*)`);
      }
      if (typeof c?.op !== "string" || !ALLOWED_OPS.has(c.op)) {
        errors.push(`clause ${i}: op "${c?.op}" not in allowed set (${[...ALLOWED_OPS].join(", ")})`);
      }
      // rvalue can be string, number, or null; reject undefined/objects
      const rtype = typeof c?.rvalue;
      if (c.rvalue !== null && rtype !== "string" && rtype !== "number") {
        errors.push(`clause ${i}: rvalue must be string, number, or null`);
      }
      normalised.push({ lvalue: c.lvalue, op: c.op, rvalue: c.rvalue ?? null });
    });
    out.when_clauses = normalised;
  }

  // actions: array of {action_type, owner, timing, detail, uses_content, next_call_type?}
  if (!Array.isArray(body?.actions) || body.actions.length === 0) {
    errors.push("actions must be a non-empty array (at least one action)");
  } else {
    const normalised: any[] = [];
    body.actions.forEach((a: any, i: number) => {
      if (typeof a?.action_type !== "string" || !a.action_type) {
        errors.push(`action ${i}: action_type is required`);
        return;
      }
      if (typeof a?.owner !== "string" || !a.owner) {
        errors.push(`action ${i}: owner is required`);
      }
      if (typeof a?.timing !== "string" || !a.timing) {
        errors.push(`action ${i}: timing is required`);
      }
      if (typeof a?.detail !== "string") {
        errors.push(`action ${i}: detail must be a string (empty OK)`);
      }
      // set_next_call_type requires a valid next_call_type
      if (a.action_type === "set_next_call_type") {
        const nct = a.next_call_type;
        if (!["cold_call", "demo", "opportunity", "none"].includes(nct)) {
          errors.push(`action ${i}: set_next_call_type requires next_call_type in [cold_call, demo, opportunity, none]`);
        }
      }
      normalised.push({
        action_type: a.action_type,
        owner: a.owner,
        timing: a.timing,
        detail: a.detail ?? "",
        uses_content: !!a.uses_content,
        next_call_type: a.next_call_type ?? null,
      });
    });
    out.actions = normalised;
  }

  return { rule: out, errors };
}

// POST /api/admin/engine-outcome-rules — create a new rule. 409 on id
// collision so the operator knows to pick a different slug.
router.post("/admin/engine-outcome-rules", async (req, res) => {
  const { rule, errors } = validateRulePayload(req.body);
  if (errors.length > 0) {
    res.status(400).json({ error: "validation_failed", messages: errors });
    return;
  }
  try {
    const [existing] = await db.select({ id: engineOutcomeRulesTable.id })
      .from(engineOutcomeRulesTable)
      .where(eq(engineOutcomeRulesTable.id, rule.id))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "rule_id_exists", id: rule.id });
      return;
    }
    const [created] = await db.insert(engineOutcomeRulesTable).values({
      id: rule.id,
      priority: rule.priority,
      enabled: rule.enabled,
      when_clauses: rule.when_clauses,
      actions: rule.actions,
      // Legacy single-action columns intentionally left null for new rows.
      action_type: null,
      owner: null,
      timing: null,
      detail: null,
      uses_content: false,
      updated_at: new Date(),
    }).returning();
    invalidateOutcomeRulesCache();
    res.status(201).json({ rule: created });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-outcome-rules create failed");
    res.status(500).json({ error: "create_failed", message: err.message });
  }
});

// PUT /api/admin/engine-outcome-rules/:id — update the rule with the
// given id. The id in the URL and body must match to avoid accidentally
// renaming. Only mutable fields are written.
router.put("/admin/engine-outcome-rules/:id", async (req, res) => {
  const idFromUrl = req.params.id;
  if (req.body?.id && req.body.id !== idFromUrl) {
    res.status(400).json({ error: "id_mismatch", message: "URL id and body id must match" });
    return;
  }
  const payload = { ...req.body, id: idFromUrl };
  const { rule, errors } = validateRulePayload(payload);
  if (errors.length > 0) {
    res.status(400).json({ error: "validation_failed", messages: errors });
    return;
  }
  try {
    const [existing] = await db.select({ id: engineOutcomeRulesTable.id })
      .from(engineOutcomeRulesTable)
      .where(eq(engineOutcomeRulesTable.id, idFromUrl))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "rule_not_found", id: idFromUrl });
      return;
    }
    const [updated] = await db.update(engineOutcomeRulesTable)
      .set({
        priority: rule.priority,
        enabled: rule.enabled,
        when_clauses: rule.when_clauses,
        actions: rule.actions,
        // Clear legacy columns on update so upgraded rules don't leave
        // stale single-action data behind.
        action_type: null,
        owner: null,
        timing: null,
        detail: null,
        uses_content: false,
        updated_at: new Date(),
      })
      .where(eq(engineOutcomeRulesTable.id, idFromUrl))
      .returning();
    invalidateOutcomeRulesCache();
    res.json({ rule: updated });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-outcome-rules update failed");
    res.status(500).json({ error: "update_failed", message: err.message });
  }
});

// DELETE /api/admin/engine-outcome-rules/:id — permanent delete. Prefer
// disable (enabled=false) for reversibility; delete is only for genuinely
// retired rules.
router.delete("/admin/engine-outcome-rules/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const result = await db.delete(engineOutcomeRulesTable)
      .where(eq(engineOutcomeRulesTable.id, id))
      .returning({ id: engineOutcomeRulesTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "rule_not_found", id });
      return;
    }
    invalidateOutcomeRulesCache();
    res.json({ ok: true, id });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-outcome-rules delete failed");
    res.status(500).json({ error: "delete_failed", message: err.message });
  }
});

// GET /api/admin/engine-runs/recent — recent engine runs for the trace-view
// picker on the Outcome Rules admin page. Returns enough context for the
// picker to display meaningful labels (contact name, call type, NBA action,
// created_at) without the full output blob.
router.get("/admin/engine-runs/recent", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = await db
      .select({
        id: engineRunsTable.id,
        contact_id: engineRunsTable.contact_id,
        conversation_id: engineRunsTable.conversation_id,
        call_type: engineRunsTable.call_type,
        engine_version: engineRunsTable.engine_version,
        created_at: engineRunsTable.created_at,
        output: engineRunsTable.output,
        contact_first_name: contactsTable.first_name,
        contact_last_name: contactsTable.last_name,
      })
      .from(engineRunsTable)
      .leftJoin(contactsTable, eq(contactsTable.id, engineRunsTable.contact_id))
      .orderBy(desc(engineRunsTable.created_at))
      .limit(limit);

    // Only surface the bits of the output that matter for the picker.
    const runs = rows.map((r: typeof rows[number]) => ({
      id: r.id,
      contactId: r.contact_id,
      contactName: [r.contact_first_name, r.contact_last_name].filter(Boolean).join(" ") || r.contact_id,
      conversationId: r.conversation_id,
      callType: r.call_type,
      engineVersion: r.engine_version,
      createdAt: r.created_at,
      nbaActionType: (r.output as any)?.nextBestAction?.actionType ?? null,
      nbaDetail: (r.output as any)?.nextBestAction?.detail ?? null,
    }));

    res.json({ runs });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin/engine-runs/recent failed");
    res.status(500).json({ error: "list_failed", message: err.message });
  }
});

// POST /api/admin/engine-outcome-rules/trace — re-evaluate the rules
// against the stored context of a specific engine run. Returns the full
// step-by-step trace (which rule matched, which failed and on which
// clause). The evaluator is pure, so this replay is deterministic.
//
// Body: { runId: string }
//
// CAVEAT: signals used for replay are the CURRENT engine_signals for the
// contact (via loadInvestor), NOT a snapshot from the run time. For most
// debugging use this is fine — the contact's state rarely churns between
// runs. If you need strict at-time replay, we'll add a snapshot column
// in Phase 7.1b.
router.post("/admin/engine-outcome-rules/trace", async (req, res) => {
  try {
    const runId = typeof req.body?.runId === "string" ? req.body.runId : null;
    if (!runId) {
      res.status(400).json({ error: "runId_required" });
      return;
    }

    const [run] = await db
      .select()
      .from(engineRunsTable)
      .where(eq(engineRunsTable.id, runId))
      .limit(1);
    if (!run) {
      res.status(404).json({ error: "run_not_found" });
      return;
    }

    const output = run.output as any;
    const callType = run.call_type as "cold_call" | "demo" | "opportunity";
    const investor = await loadInvestor(run.contact_id);
    const rules = await loadOutcomeRules();

    // Reconstruct evaluation context. Signals come from the investor's
    // CURRENT state (caveat noted above). gateResult and content come
    // straight from the stored run output — those are what the engine
    // used at run time.
    const ctx = {
      callType,
      signals: investor.signals,
      investor,
      content: output?.nextBestAction?.contentToSend ?? null,
      gateResult: output?.gateStatus ?? {
        c4Compliance: "open",
        pack1: "blocked",
        pack1BlockedReasons: [],
        activeRoute: "pending",
        blockedSignals: [],
      },
    };

    let action: any = null;
    let trace: any = null;
    let evaluatorError: string | null = null;
    try {
      const r = evaluateOutcomeRules(rules, ctx);
      action = r.action;
      trace = r.trace;
    } catch (err: any) {
      evaluatorError = err instanceof RuleCoverageError ? err.message : (err?.message || String(err));
    }

    res.json({
      runId: run.id,
      contactId: run.contact_id,
      contactName: [run.contact_id].filter(Boolean).join(" "),
      callType,
      runCreatedAt: run.created_at,
      replay: {
        action,
        trace,
        evaluatorError,
      },
      // Include the stored NBA for side-by-side comparison in the UI
      stored: {
        nextBestAction: output?.nextBestAction ?? null,
      },
      caveat:
        "Replay uses CURRENT engine_signals for the contact, not a snapshot from run time. " +
        "Gate status and routed content come from the stored run output.",
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "admin/engine-outcome-rules/trace failed");
    res.status(500).json({ error: "trace_failed", message: err.message });
  }
});

// POST /api/admin/engine-outcome-rules/preview — Phase 7.1b session 2.5
// Evaluate rules against a SYNTHETIC context instead of a stored run.
router.post("/admin/engine-outcome-rules/preview", async (req, res) => {
  try {
    const body = req.body || {};
    const callType = body.callType;
    if (!["cold_call", "demo", "opportunity"].includes(callType)) {
      res.status(400).json({ error: "callType required (cold_call|demo|opportunity)" });
      return;
    }
    const signals: any = {};
    const now = new Date().toISOString();
    for (const [code, state] of Object.entries(body.signals || {})) {
      signals[code] = { code, state, surfacedBy: "preview", notes: "", updatedAt: now, confidence: "high" };
    }
    const investor: any = {
      investorId: "preview",
      persona: body.investor?.persona || "undetermined",
      hotButton: body.investor?.hotButton || null,
      demoScore: body.investor?.demoScore ?? null,
      signals,
      factFind: {},
    };
    const gateResult = body.gateResult || {
      c4Compliance: "open",
      pack1: "blocked",
      pack1BlockedReasons: [],
      activeRoute: "pending",
      blockedSignals: [],
    };
    const content = body.content ?? null;
    const storedRules = await loadOutcomeRules();
    let rules: any[] = storedRules as any;
    if (body.draftRule) {
      const draft = {
        ...body.draftRule,
        actions: body.draftRule.actions || [],
        when_clauses: body.draftRule.when_clauses || [],
        created_at: new Date(),
        updated_at: new Date(),
      };
      const withoutSameId = (storedRules as any[]).filter((r) => r.id !== draft.id);
      rules = [...withoutSameId, draft].sort((a, b) => a.priority - b.priority);
    }
    try {
      const result = evaluateOutcomeRules(rules as any, { callType, signals, investor, content, gateResult });
      res.json({
        matchedRuleId: result.trace.matchedRuleId,
        action: result.action,
        secondary: result.secondary,
        trace: result.trace,
      });
    } catch (err: any) {
      if (err instanceof RuleCoverageError) {
        res.json({ matchedRuleId: null, action: null, secondary: [], trace: null, error: err.message });
        return;
      }
      throw err;
    }
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "admin/engine-outcome-rules/preview failed");
    res.status(500).json({ error: "preview_failed", message: err.message });
  }
});

export default router;
