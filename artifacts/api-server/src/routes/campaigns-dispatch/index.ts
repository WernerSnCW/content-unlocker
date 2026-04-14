import { Router, type IRouter } from "express";
import { db, callListConfigsTable, contactsTable, agentsTable, callListMembershipsTable } from "@workspace/db";
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import { getQueueStatus, fillQueue, getCallList, reconcileUncalledContacts } from "../../lib/dispatchService";

const router: IRouter = Router();

// ==================== Campaign CRUD ====================

// GET /call_lists — list all call_lists
router.get("/call-lists", async (req, res): Promise<void> => {
  try {
    const call_lists = await db.select().from(callListConfigsTable).orderBy(desc(callListConfigsTable.created_at));

    // Enrich with agent names
    const agents = await db.select().from(agentsTable);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const enriched = call_lists.map(c => ({
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

// GET /call-lists/today-outcomes — count contacts called today grouped by outcome
router.get("/call-lists/today-outcomes", async (req, res): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await db.select({
      outcome: contactsTable.last_call_outcome,
      count: sql<number>`count(*)`,
    })
      .from(contactsTable)
      .where(and(
        eq(contactsTable.dispatch_status, "called"),
        sql`${contactsTable.updated_at}::date = ${today.toISOString().split("T")[0]}::date`,
      ))
      .groupBy(contactsTable.last_call_outcome);

    const outcomes: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const key = row.outcome || "unknown";
      outcomes[key] = Number(row.count);
      total += Number(row.count);
    }
    res.json({ total, outcomes });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch today's outcomes" });
  }
});

// GET /call-lists/stale-count — count dispatched contacts from previous days still in queue
router.get("/call-lists/stale-count", async (req, res): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(contactsTable)
      .where(and(
        eq(contactsTable.dispatch_status, "dispatched"),
        sql`${contactsTable.dispatch_date}::date < ${today.toISOString().split("T")[0]}::date`,
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

// POST /call_lists/reconcile — reset uncalled contacts from yesterday
router.post("/call-lists/reconcile", async (req, res): Promise<void> => {
  try {
    const resetCount = await reconcileUncalledContacts();
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
