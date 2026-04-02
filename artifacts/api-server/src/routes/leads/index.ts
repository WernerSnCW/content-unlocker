import { Router, type IRouter } from "express";
import { db, leadsTable } from "@workspace/db";
import { eq, ilike, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  ListLeadsQueryParams,
  CreateLeadBody,
  GetLeadParams,
  UpdateLeadParams,
  UpdateLeadBody,
  GetLeadNextActionParams,
} from "@workspace/api-zod";
import { getNextBestAction } from "../../lib/dataManager";

const router: IRouter = Router();

router.get("/leads", async (req, res): Promise<void> => {
  const params = ListLeadsQueryParams.safeParse(req.query);
  const search = params.success ? params.data.search : undefined;
  const stage = params.success ? params.data.stage : undefined;

  const conditions = [];
  if (search) {
    conditions.push(ilike(leadsTable.name, `%${search}%`));
  }
  if (stage) {
    conditions.push(eq(leadsTable.pipeline_stage, stage));
  }

  const leads = await db
    .select()
    .from(leadsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(leadsTable.updated_at);

  const result = leads.map((l) => ({
    id: l.id,
    name: l.name,
    company: l.company,
    pipeline_stage: l.pipeline_stage,
    first_contact: l.first_contact,
    last_contact: l.last_contact,
    detected_persona: l.detected_persona,
    archived: l.archived,
    send_count: ((l.send_log as any[]) || []).length,
    created_at: l.created_at.toISOString(),
    updated_at: l.updated_at.toISOString(),
  }));

  res.json(result);
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date().toISOString().split("T")[0];
  const id = `lead_${randomUUID().slice(0, 8)}`;

  const [lead] = await db
    .insert(leadsTable)
    .values({
      id,
      name: parsed.data.name,
      company: parsed.data.company || null,
      pipeline_stage: parsed.data.pipeline_stage || "Outreach",
      first_contact: now,
      last_contact: now,
      detected_persona: null,
      archived: false,
      send_log: [],
      stage_history: [{ stage: parsed.data.pipeline_stage || "Outreach", date: now, logged_by: "system" }],
      notes: [],
    })
    .returning();

  res.status(201).json({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    pipeline_stage: lead.pipeline_stage,
    first_contact: lead.first_contact,
    last_contact: lead.last_contact,
    detected_persona: lead.detected_persona,
    archived: lead.archived,
    send_count: 0,
    created_at: lead.created_at.toISOString(),
    updated_at: lead.updated_at.toISOString(),
  });
});

router.get("/leads/:id", async (req, res): Promise<void> => {
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, params.data.id));

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.json({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    pipeline_stage: lead.pipeline_stage,
    first_contact: lead.first_contact,
    last_contact: lead.last_contact,
    detected_persona: lead.detected_persona,
    archived: lead.archived,
    created_at: lead.created_at.toISOString(),
    updated_at: lead.updated_at.toISOString(),
    send_log: lead.send_log || [],
    stage_history: lead.stage_history || [],
    notes: lead.notes || [],
  });
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const params = UpdateLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const updates: any = {};
  if (parsed.data.pipeline_stage !== undefined) {
    updates.pipeline_stage = parsed.data.pipeline_stage;
    const stageHistory = (existing.stage_history as any[]) || [];
    stageHistory.push({
      stage: parsed.data.pipeline_stage,
      date: new Date().toISOString().split("T")[0],
      logged_by: "agent",
    });
    updates.stage_history = stageHistory;
  }
  if (parsed.data.detected_persona !== undefined) updates.detected_persona = parsed.data.detected_persona;
  if (parsed.data.archived !== undefined) updates.archived = parsed.data.archived;
  if (parsed.data.company !== undefined) updates.company = parsed.data.company;

  const [lead] = await db
    .update(leadsTable)
    .set(updates)
    .where(eq(leadsTable.id, params.data.id))
    .returning();

  res.json({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    pipeline_stage: lead.pipeline_stage,
    first_contact: lead.first_contact,
    last_contact: lead.last_contact,
    detected_persona: lead.detected_persona,
    archived: lead.archived,
    created_at: lead.created_at.toISOString(),
    updated_at: lead.updated_at.toISOString(),
    send_log: lead.send_log || [],
    stage_history: lead.stage_history || [],
    notes: lead.notes || [],
  });
});

router.get("/leads/:id/next-action", async (req, res): Promise<void> => {
  const params = GetLeadNextActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const nextAction = getNextBestAction(lead);
  res.json(nextAction);
});

export default router;
