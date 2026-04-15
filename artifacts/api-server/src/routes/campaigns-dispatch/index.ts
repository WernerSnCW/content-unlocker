import { Router, type IRouter } from "express";
import { db, callListConfigsTable, contactsTable, agentsTable, callListMembershipsTable, leadConversationsTable } from "@workspace/db";
import { eq, and, or, desc, sql, isNull } from "drizzle-orm";
import { getQueueStatus, fillQueue, getCallList, reconcileUncalledContacts } from "../../lib/dispatchService";
import { requireAuth } from "../../middlewares/requireAuth";

const router: IRouter = Router();

// Entire router requires an authenticated agent. Agent-scoped endpoints
// derive scope from req.auth.agent; CRUD endpoints still operate on :id
// but are protected so unauthed callers can't enumerate or mutate them.
router.use(requireAuth);

// ==================== Campaign CRUD ====================

// GET /call_lists — lists assigned to the logged-in agent, plus unassigned
// lists (so admins who haven't yet assigned can still see them). Scope is
// derived from req.auth.agent.id; no client-supplied agent_id is accepted.
router.get("/call-lists", async (req, res): Promise<void> => {
  try {
    const agentId = req.auth!.agent.id;

    const rows = await db.select().from(callListConfigsTable)
      .where(or(
        eq(callListConfigsTable.assigned_agent_id, agentId),
        isNull(callListConfigsTable.assigned_agent_id),
      ))
      .orderBy(desc(callListConfigsTable.created_at));

    const agents = await db.select().from(agentsTable);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const enriched = rows.map(c => ({
      ...c,
      agent: c.assigned_agent_id ? agentMap.get(c.assigned_agent_id) || null : null,
    }));

    res.json({ call_lists: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch call_lists" });
  }
});

// POST /call_lists — create campaign
router.post("/call-lists", async (req, res): Promise<void> => {
  const { name, filter_criteria, daily_quota, assigned_agent_id } = req.body;

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [created] = await db.insert(callListConfigsTable).values({
      name: name.trim(),
      filter_criteria: filter_criteria || {},
      daily_quota: daily_quota || 100,
      assigned_agent_id: assigned_agent_id || null,
    }).returning();

    res.json({ campaign: created });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// PATCH /call_lists/:id — update campaign
router.patch("/call-lists/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { name, filter_criteria, daily_quota, assigned_agent_id, active } = req.body;

  try {
    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (filter_criteria !== undefined) updates.filter_criteria = filter_criteria;
    if (daily_quota !== undefined) updates.daily_quota = daily_quota;
    if (assigned_agent_id !== undefined) updates.assigned_agent_id = assigned_agent_id;
    if (active !== undefined) updates.active = active;

    const [updated] = await db.update(callListConfigsTable)
      .set(updates).where(eq(callListConfigsTable.id, id)).returning();

    if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ campaign: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// DELETE /call_lists/:id — delete campaign
router.delete("/call-lists/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const [deleted] = await db.delete(callListConfigsTable).where(eq(callListConfigsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ==================== Queue & Dispatch ====================

// GET /call_lists/:id/queue-status — get current queue breakdown
router.get("/call-lists/:id/queue-status", async (req, res): Promise<void> => {
  try {
    const status = await getQueueStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// POST /call_lists/:id/fill-queue — dispatch contacts to fill today's queue
router.post("/call-lists/:id/fill-queue", async (req, res): Promise<void> => {
  try {
    const count = req.body.count ? parseInt(req.body.count) : undefined;
    const result = await fillQueue(req.params.id, count);
    res.json(result);
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// GET /call_lists/:id/call-list — get today's prioritised call list
router.get("/call-lists/:id/call-list", async (req, res): Promise<void> => {
  try {
    const contacts = await getCallList(req.params.id);
    res.json({ contacts, total: contacts.length });
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// GET /call-lists/today-outcomes — count CALLS (conversations) made today, grouped by outcome.
// Always scoped to the logged-in agent (agent_name match on conversations).
// A contact called twice today (e.g. immediate_recall) counts as 2 here.
router.get("/call-lists/today-outcomes", async (req, res): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateFilter = sql`${leadConversationsTable.conversation_date}::date = ${today.toISOString().split("T")[0]}::date`;

    const agentName = req.auth!.agent.name;
    const agentNameFilter = eq(leadConversationsTable.agent_name, agentName);

    const whereClause = and(eq(leadConversationsTable.source, "aircall"), dateFilter, agentNameFilter);

    // Per-outcome breakdown
    const rows = await db.select({
      outcome: leadConversationsTable.call_outcome,
      count: sql<number>`count(*)`,
    })
      .from(leadConversationsTable)
      .where(whereClause)
      .groupBy(leadConversationsTable.call_outcome);

    // Unique contacts called today — one count regardless of how many calls
    const [uniqueRow] = await db.select({
      uniqueContacts: sql<number>`count(distinct ${leadConversationsTable.contact_id})`,
    })
      .from(leadConversationsTable)
      .where(whereClause);

    const outcomes: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const key = row.outcome || "pending";
      outcomes[key] = Number(row.count);
      total += Number(row.count);
    }
    res.json({
      total,
      uniqueContacts: Number(uniqueRow?.uniqueContacts ?? 0),
      outcomes,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch today's outcomes" });
  }
});

// GET /call-lists/stale-count — count stale dispatched contacts whose
// ACTIVE membership belongs to a call list assigned to the logged-in agent.
router.get("/call-lists/stale-count", async (req, res): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];
    const agentId = req.auth!.agent.id;

    const [result] = await db.select({ count: sql<number>`count(distinct ${contactsTable.id})` })
      .from(contactsTable)
      .innerJoin(callListMembershipsTable, eq(callListMembershipsTable.contact_id, contactsTable.id))
      .innerJoin(callListConfigsTable, eq(callListConfigsTable.id, callListMembershipsTable.call_list_id))
      .where(and(
        eq(contactsTable.dispatch_status, "dispatched"),
        sql`${contactsTable.dispatch_date}::date < ${todayStr}::date`,
        isNull(callListMembershipsTable.removed_at),
        eq(callListConfigsTable.assigned_agent_id, agentId),
      ));
    res.json({ stale_count: Number(result.count) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to count stale contacts" });
  }
});

// POST /call-lists/carry-over — move stale dispatched contacts onto a target list
// Required body: { target_call_list_id }
router.post("/call-lists/carry-over", async (req, res): Promise<void> => {
  try {
    const targetListId = req.body?.target_call_list_id?.toString().trim();
    if (!targetListId) {
      res.status(400).json({ error: "target_call_list_id is required" });
      return;
    }

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find active memberships whose contacts are dispatched from a previous day
    const stale = await db.select({
      membership_id: callListMembershipsTable.id,
      contact_id: callListMembershipsTable.contact_id,
    })
      .from(callListMembershipsTable)
      .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
      .where(and(
        isNull(callListMembershipsTable.removed_at),
        eq(contactsTable.dispatch_status, "dispatched"),
        sql`${contactsTable.dispatch_date}::date < ${today.toISOString().split("T")[0]}::date`,
      ));

    let carriedOver = 0;
    for (const row of stale) {
      try {
        // Close the old membership
        await db.update(callListMembershipsTable)
          .set({ removed_at: now, removal_reason: "carried_over" })
          .where(eq(callListMembershipsTable.id, row.membership_id));

        // Create a new membership on the target list
        await db.insert(callListMembershipsTable).values({
          call_list_id: targetListId,
          contact_id: row.contact_id,
          added_at: now,
          carried_from_id: row.membership_id,
        });

        // Re-date the contact for today
        await db.update(contactsTable)
          .set({ dispatch_date: now })
          .where(eq(contactsTable.id, row.contact_id));

        carriedOver++;
      } catch { /* skip on error */ }
    }

    res.json({ success: true, carried_over: carriedOver });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to carry over contacts" });
  }
});

// POST /call_lists/reconcile — reset uncalled contacts from yesterday.
// Always scoped to the logged-in agent's call lists.
router.post("/call-lists/reconcile", async (req, res): Promise<void> => {
  try {
    const resetCount = await reconcileUncalledContacts(req.auth!.agent.id);
    res.json({ success: true, reset_count: resetCount });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to reconcile uncalled contacts" });
  }
});

// GET /call_lists/:id/pool-count — how many pool contacts match this list's filter
router.get("/call-lists/:id/pool-count", async (req, res): Promise<void> => {
  try {
    const [campaign] = await db.select().from(callListConfigsTable)
      .where(eq(callListConfigsTable.id, req.params.id));

    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const criteria = (campaign.filter_criteria || {}) as Record<string, any>;
    const conditions: any[] = [eq(contactsTable.dispatch_status, "pool")];
    if (Array.isArray(criteria.source_lists) && criteria.source_lists.length > 0) {
      conditions.push(sql`${contactsTable.source_list} IN (${sql.raw(criteria.source_lists.map((s: string) => `'${s.replace(/'/g, "''")}'`).join(","))})`);
    }

    const [poolResult] = await db.select({ count: sql<number>`count(*)` })
      .from(contactsTable)
      .where(and(...conditions));

    res.json({ available: Number(poolResult.count) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to count pool" });
  }
});

export default router;
