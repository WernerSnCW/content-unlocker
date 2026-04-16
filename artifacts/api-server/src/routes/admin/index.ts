import { Router, type IRouter } from "express";
import { db, agentsTable, usersTable, integrationConfigsTable, contactsTable, callListConfigsTable, callListMembershipsTable, leadConversationsTable } from "@workspace/db";
import { eq, desc, and, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../../middlewares/requireAdmin";
import { logger } from "../../lib/logger";
import { randomUUID } from "crypto";
import {
  applyTaggedOutcomeTx,
  runEngineForConversation,
  resolveTag,
  getTagMapping,
  getCoolOffDays,
} from "../aircall";

const router: IRouter = Router();

// All admin routes require an authenticated user with role=admin.
router.use(requireAdmin);

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
  }> = {};

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

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing_to_update" });
    return;
  }

  try {
    const [updated] = await db
      .update(agentsTable)
      .set(updates as any)
      .where(eq(agentsTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    logger.info({ id, updates }, "admin updated agent");
    res.json({ agent: updated });
  } catch (err: any) {
    logger.error({ err: err.message }, "admin update agent failed");
    res.status(500).json({ error: "update_failed" });
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
 * Body: {
 *   contact_id: string,
 *   agent_id: string,       // which agent "made" this call
 *   tag: string,            // name of an Aircall tag (must match tag_mapping)
 *   transcript?: string,    // full transcript text — will be stored + fed to engine
 *   summary?: string,       // optional synthetic Aircall AI summary
 *   duration_seconds?: number,
 *   direction?: "inbound" | "outbound",
 *   ensure_membership?: boolean, // default true — auto-add to Simulator list if no active membership
 * }
 *
 * Runs the full post-call path synchronously and returns a detailed report
 * so the admin can see exactly what changed.
 */
router.post("/admin/simulate-call", async (req, res) => {
  const body = req.body || {};
  const contactId = typeof body.contact_id === "string" ? body.contact_id : null;
  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;
  const tagName = typeof body.tag === "string" ? body.tag.trim() : null;
  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary : null;
  const duration = Number.isFinite(Number(body.duration_seconds)) ? Number(body.duration_seconds) : 60;
  const direction: "inbound" | "outbound" = body.direction === "inbound" ? "inbound" : "outbound";
  const ensureMembership = body.ensure_membership !== false;

  if (!contactId) { res.status(400).json({ error: "contact_id_required" }); return; }
  if (!agentId) { res.status(400).json({ error: "agent_id_required" }); return; }
  if (!tagName) { res.status(400).json({ error: "tag_required" }); return; }

  try {
    // 1. Load the chosen contact + agent (and validate they exist + active)
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
    if (!contact) { res.status(404).json({ error: "contact_not_found" }); return; }

    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) { res.status(404).json({ error: "agent_not_found" }); return; }
    if (!agent.active) { res.status(400).json({ error: "agent_inactive" }); return; }

    // 2. Resolve the tag → outcome + side_effect
    const tagMapping = await getTagMapping();
    const resolution = resolveTag(tagName, tagMapping);
    if (!resolution) {
      res.status(400).json({
        error: "tag_not_mapped",
        message: `Tag "${tagName}" is not in the configured mapping. Known tags: ${tagMapping.map(t => t.aircall_tag).join(", ")}`,
      });
      return;
    }

    // 3. Ensure the contact has an active membership if requested.
    //    Without one, applyTaggedOutcomeTx has nothing to close — which is
    //    fine for outcomes that archive (global_exclude), but weird for
    //    callback / immediate_recall paths. Default: silently add to a
    //    dedicated Simulator Test List to keep behaviour consistent.
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
        // Find or create the Simulator Test List for this agent.
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
        // Add a membership + flip contact to dispatched so the outcome tx has
        // the right state to close.
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

    // 4. Create the synthetic conversation row (as call.ended would).
    const syntheticCallId = `sim-${randomUUID()}`;
    const now = new Date();
    const [conv] = await db.insert(leadConversationsTable).values({
      contact_id: contact.id,
      lead_id: contact.lead_id || null,
      source: "aircall",
      external_id: syntheticCallId,
      direction,
      duration_seconds: duration,
      agent_name: agent.name,
      agent_notes: null,
      tags: [tagName],
      call_outcome: null,
      transcript_text: transcript || null,
      summary,
      conversation_date: now,
    }).returning();

    // 5. Apply the tag outcome in a transaction (unless it's record_only).
    let outcomeAppliedDetail = "record_only — no state change";
    const isRecordOnly = resolution.sideEffect === "record_only";
    if (!isRecordOnly) {
      const coolOffDaysGlobal = await getCoolOffDays();
      await db.transaction(async (tx) => {
        await applyTaggedOutcomeTx(tx, contact.id, syntheticCallId, tagName, resolution, coolOffDaysGlobal);
      });
      outcomeAppliedDetail = `${resolution.outcome} (${resolution.sideEffect})`;
    } else {
      // Mirror handleCallTagged's record-only path — append tag, don't mutate.
      await db.update(leadConversationsTable)
        .set({
          tags: sql`COALESCE(${leadConversationsTable.tags}, '[]'::jsonb) || ${JSON.stringify([tagName])}::jsonb`,
        })
        .where(eq(leadConversationsTable.id, conv.id));
    }

    // 6. Run the engine on the transcript (if provided).
    let engineResult: string | null = null;
    if (transcript.trim()) {
      engineResult = await runEngineForConversation(contact.id, conv.id, transcript);
    }

    // 7. Read back the final state so the admin can see exactly what changed.
    const [finalContact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contact.id));
    const [finalConv] = await db.select().from(leadConversationsTable).where(eq(leadConversationsTable.id, conv.id));
    const finalMemberships = await db.select().from(callListMembershipsTable)
      .where(eq(callListMembershipsTable.contact_id, contact.id))
      .orderBy(desc(callListMembershipsTable.added_at));

    logger.info({
      admin: req.auth!.user.email,
      contactId: contact.id,
      agentId: agent.id,
      tag: tagName,
      outcome: resolution.outcome,
    }, "DEV SIMULATE-CALL used");

    res.json({
      ok: true,
      conversation_id: conv.id,
      synthetic_call_id: syntheticCallId,
      resolved: {
        outcome: resolution.outcome,
        side_effect: resolution.sideEffect,
      },
      outcome_applied: outcomeAppliedDetail,
      engine: engineResult,
      created_simulator_list: createdSimList,
      created_simulator_membership: createdSimMembership,
      final: {
        contact: {
          id: finalContact.id,
          dispatch_status: finalContact.dispatch_status,
          last_call_outcome: finalContact.last_call_outcome,
          call_attempts: finalContact.call_attempts,
          callback_date: finalContact.callback_date,
          cool_off_until: finalContact.cool_off_until,
        },
        conversation: {
          id: finalConv.id,
          call_outcome: finalConv.call_outcome,
          tags: finalConv.tags,
          processed_at: finalConv.processed_at,
          engine_version: finalConv.engine_version,
          has_transcript: !!finalConv.transcript_text,
          has_summary: !!finalConv.summary,
        },
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

export default router;
