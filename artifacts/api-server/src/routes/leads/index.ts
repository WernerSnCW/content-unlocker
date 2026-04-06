import { Router, type IRouter } from "express";
import { db, leadsTable, changelogTable } from "@workspace/db";
import { eq, ilike, and, sql, isNotNull } from "drizzle-orm";
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
import { resolveArchetype, PERSONA_TO_ARCHETYPE, VALID_ARCHETYPES } from "../../../../../lib/personas";
import { fuzzyMatchLeads } from "../../lib/fuzzyMatch";

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];

const router: IRouter = Router();

router.get("/leads/match", async (req, res): Promise<void> => {
  const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
  if (!name) { res.json({ matches: [], query: "" }); return; }
  const allLeads = await db.select().from(leadsTable);
  const matches = fuzzyMatchLeads(name, allLeads);
  res.json({ matches, query: name });
});

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
    confirmed_persona: l.confirmed_persona,
    confirmed_archetype: l.confirmed_archetype,
    persona_confidence: l.persona_confidence,
    stage_confidence: l.stage_confidence,
    archived: l.archived,
    send_count: ((l.send_log as any[]) || []).length,
    source: l.source,
    created_at: l.created_at.toISOString(),
    updated_at: l.updated_at.toISOString(),
  }));

  res.json(result);
});

router.post("/leads", async (req, res): Promise<void> => {
  const { name, company, pipeline_stage, detected_persona, source, transcript_filename } = req.body;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const now = new Date().toISOString().split("T")[0];
  const id = `lead_${randomUUID().slice(0, 8)}`;
  const stage = pipeline_stage || "Outreach";

  const [lead] = await db
    .insert(leadsTable)
    .values({
      id,
      name: name.trim(),
      company: company || null,
      pipeline_stage: stage,
      first_contact: now,
      last_contact: now,
      detected_persona: detected_persona || null,
      archived: false,
      send_log: [],
      stage_history: [{ stage, date: now, logged_by: "system" }],
      notes: [],
      source: source || null,
      transcript_filename: transcript_filename || null,
    })
    .returning();

  if (source === "batch_transcript") {
    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "LEAD_CREATED_FROM_TRANSCRIPT",
      lead_id: id,
      details: `Lead "${name.trim()}" created from transcript ${transcript_filename || "unknown"}. Detected persona: ${detected_persona || "N/A"}, Stage: ${stage}`,
      triggered_by: "agent",
    });
  }

  res.status(201).json({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    pipeline_stage: lead.pipeline_stage,
    first_contact: lead.first_contact,
    last_contact: lead.last_contact,
    detected_persona: lead.detected_persona,
    confirmed_persona: lead.confirmed_persona,
    confirmed_archetype: lead.confirmed_archetype,
    persona_confidence: lead.persona_confidence,
    stage_confidence: lead.stage_confidence,
    archived: lead.archived,
    send_count: 0,
    source: lead.source,
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

  const sendLog = (lead.send_log || []) as any[];
  res.json({
    id: lead.id,
    name: lead.name,
    company: lead.company,
    pipeline_stage: lead.pipeline_stage,
    first_contact: lead.first_contact,
    last_contact: lead.last_contact,
    detected_persona: lead.detected_persona,
    confirmed_persona: lead.confirmed_persona,
    confirmed_archetype: lead.confirmed_archetype,
    persona_confidence: lead.persona_confidence,
    stage_confidence: lead.stage_confidence,
    archived: lead.archived,
    source: lead.source,
    created_at: lead.created_at.toISOString(),
    updated_at: lead.updated_at.toISOString(),
    send_log: sendLog,
    send_count: sendLog.length,
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
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields provided for update" });
    return;
  }

  updates.updated_at = new Date();

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

router.post("/leads/:id/confirm-persona", async (req, res): Promise<void> => {
  const id = req.params.id;
  const { confirmed_persona, confirmed_archetype, was_correct, notes } = req.body;

  if (!confirmed_persona || !confirmed_archetype) {
    res.status(400).json({ error: "confirmed_persona and confirmed_archetype are required" });
    return;
  }

  if (!VALID_ARCHETYPES.includes(confirmed_archetype)) {
    res.status(400).json({ error: `confirmed_archetype must be one of: ${VALID_ARCHETYPES.join(", ")}` });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  await db.update(leadsTable).set({
    confirmed_persona,
    confirmed_archetype,
    updated_at: new Date(),
  }).where(eq(leadsTable.id, id));

  const action = was_correct ? "PERSONA_CONFIRMED" : "PERSONA_CORRECTED";
  const detail = was_correct
    ? `Persona "${confirmed_persona}" (${confirmed_archetype}) confirmed as correct. Detected: "${lead.detected_persona}".${notes ? ` Notes: ${notes}` : ""}`
    : `Persona corrected from "${lead.detected_persona}" to "${confirmed_persona}" (${confirmed_archetype}).${notes ? ` Notes: ${notes}` : ""}`;

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action,
    lead_id: id,
    details: detail,
    triggered_by: "agent",
  });

  res.json({ success: true, action, confirmed_persona, confirmed_archetype });
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

  const nextAction = await getNextBestAction(lead);
  res.json(nextAction);
});

export default router;
