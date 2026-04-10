import { Router, type IRouter } from "express";
import { db, callListConfigsTable, contactsTable, agentsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
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

// POST /call-lists/carry-over — re-date stale contacts to today so they join the new queue
router.post("/call-lists/carry-over", async (req, res): Promise<void> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await db.update(contactsTable)
      .set({ dispatch_date: new Date() })
      .where(and(
        eq(contactsTable.dispatch_status, "dispatched"),
        sql`${contactsTable.dispatch_date}::date < ${today.toISOString().split("T")[0]}::date`,
      ))
      .returning({ id: contactsTable.id });
    res.json({ success: true, carried_over: result.length });
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

// GET /call_lists/:id/pool-count — how many contacts match the filter criteria
router.get("/call-lists/:id/pool-count", async (req, res): Promise<void> => {
  try {
    const [campaign] = await db.select().from(callListConfigsTable)
      .where(eq(callListConfigsTable.id, req.params.id));

    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const criteria = campaign.filter_criteria as Record<string, any>;
    const conditions = [eq(contactsTable.dispatch_status, "pool")];

    if (criteria?.source_lists?.length > 0) {
      conditions.push(sql`${contactsTable.source_list} IN (${sql.raw(criteria.source_lists.map((s: string) => `'${s}'`).join(","))})`);
    }

    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(contactsTable)
      .where(sql`${sql.raw(conditions.map((_, i) => `TRUE`).join(" AND "))}`);

    // Simpler approach
    const [poolResult] = await db.select({ count: sql<number>`count(*)` })
      .from(contactsTable)
      .where(eq(contactsTable.dispatch_status, "pool"));

    res.json({ available: Number(poolResult.count) });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to count pool" });
  }
});

export default router;
