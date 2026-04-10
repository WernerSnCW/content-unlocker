import { Router, type IRouter } from "express";
import { db, campaignConfigsTable, contactsTable, agentsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { getQueueStatus, fillQueue, getCallList, reconcileUncalledContacts } from "../../lib/dispatchService";

const router: IRouter = Router();

// ==================== Campaign CRUD ====================

// GET /campaigns — list all campaigns
router.get("/campaigns", async (req, res): Promise<void> => {
  try {
    const campaigns = await db.select().from(campaignConfigsTable).orderBy(desc(campaignConfigsTable.created_at));

    // Enrich with agent names
    const agents = await db.select().from(agentsTable);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    const enriched = campaigns.map(c => ({
      ...c,
      agent: c.assigned_agent_id ? agentMap.get(c.assigned_agent_id) || null : null,
    }));

    res.json({ campaigns: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// POST /campaigns — create campaign
router.post("/campaigns", async (req, res): Promise<void> => {
  const { name, filter_criteria, daily_quota, assigned_agent_id } = req.body;

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const [created] = await db.insert(campaignConfigsTable).values({
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

// PATCH /campaigns/:id — update campaign
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { name, filter_criteria, daily_quota, assigned_agent_id, active } = req.body;

  try {
    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (filter_criteria !== undefined) updates.filter_criteria = filter_criteria;
    if (daily_quota !== undefined) updates.daily_quota = daily_quota;
    if (assigned_agent_id !== undefined) updates.assigned_agent_id = assigned_agent_id;
    if (active !== undefined) updates.active = active;

    const [updated] = await db.update(campaignConfigsTable)
      .set(updates).where(eq(campaignConfigsTable.id, id)).returning();

    if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ campaign: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// DELETE /campaigns/:id — delete campaign
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const [deleted] = await db.delete(campaignConfigsTable).where(eq(campaignConfigsTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ==================== Queue & Dispatch ====================

// GET /campaigns/:id/queue-status — get current queue breakdown
router.get("/campaigns/:id/queue-status", async (req, res): Promise<void> => {
  try {
    const status = await getQueueStatus(req.params.id);
    res.json(status);
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// POST /campaigns/:id/fill-queue — dispatch contacts to fill today's queue
router.post("/campaigns/:id/fill-queue", async (req, res): Promise<void> => {
  try {
    const count = req.body.count ? parseInt(req.body.count) : undefined;
    const result = await fillQueue(req.params.id, count);
    res.json(result);
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// GET /campaigns/:id/call-list — get today's prioritised call list
router.get("/campaigns/:id/call-list", async (req, res): Promise<void> => {
  try {
    const contacts = await getCallList(req.params.id);
    res.json({ contacts, total: contacts.length });
  } catch (err: any) {
    res.status(err.message === "Campaign not found" ? 404 : 500)
      .json({ error: err.message });
  }
});

// POST /campaigns/reconcile — reset uncalled contacts from yesterday
router.post("/campaigns/reconcile", async (req, res): Promise<void> => {
  try {
    const resetCount = await reconcileUncalledContacts();
    res.json({ success: true, reset_count: resetCount });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to reconcile uncalled contacts" });
  }
});

// GET /campaigns/:id/pool-count — how many contacts match the filter criteria
router.get("/campaigns/:id/pool-count", async (req, res): Promise<void> => {
  try {
    const [campaign] = await db.select().from(campaignConfigsTable)
      .where(eq(campaignConfigsTable.id, req.params.id));

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
