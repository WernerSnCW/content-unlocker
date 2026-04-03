import { Router, type IRouter } from "express";
import { db, leadsTable, documentsTable, changelogTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { GetRecentActivityQueryParams, ListChangelogQueryParams } from "@workspace/api-zod";
import { getComplianceConstants, validateSeedData } from "../../lib/dataManager";
import { VALID_ARCHETYPES } from "../../../../../lib/personas";

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];
const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const leads = await db.select().from(leadsTable);
  const docs = await db.select().from(documentsTable);

  const pipelineBreakdown: Record<string, number> = {};
  for (const lead of leads) {
    pipelineBreakdown[lead.pipeline_stage] = (pipelineBreakdown[lead.pipeline_stage] || 0) + 1;
  }

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneWeekAgoStr = oneWeekAgo.toISOString().split("T")[0];

  let documentsSentThisWeek = 0;
  const recentSends: any[] = [];

  for (const lead of leads) {
    const sendLog = (lead.send_log as any[]) || [];
    for (const entry of sendLog) {
      if (entry.date >= oneWeekAgoStr) {
        documentsSentThisWeek += (entry.documents_sent || []).length;
        recentSends.push({
          lead_id: lead.id,
          lead_name: lead.name,
          date: entry.date,
          document_count: (entry.documents_sent || []).length,
        });
      }
    }
  }

  const documentsRequiringReview = docs.filter(
    (d) => d.review_state === "REQUIRES_REVIEW"
  ).length;

  const currentCleanDocs = docs.filter((d) => d.lifecycle_status === "CURRENT" && d.review_state === "CLEAN");
  const coverageGaps: Array<{ stage: string; archetype: string; document_count: number }> = [];
  for (const stage of PIPELINE_STAGES) {
    for (const archetype of VALID_ARCHETYPES) {
      const count = currentCleanDocs.filter(
        (d) =>
          (d.pipeline_stage_relevance as string[])?.includes(stage) &&
          (d.persona_relevance as string[])?.includes(archetype)
      ).length;
      if (count === 0) {
        coverageGaps.push({ stage, archetype, document_count: 0 });
      }
    }
  }

  res.json({
    total_leads: leads.length,
    total_documents: docs.length,
    documents_sent_this_week: documentsSentThisWeek,
    pipeline_breakdown: pipelineBreakdown,
    documents_requiring_review: documentsRequiringReview,
    recent_sends: recentSends.slice(0, 10),
    coverage_gaps: coverageGaps,
    coverage_gap_count: coverageGaps.length,
  });
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = params.success ? params.data.limit || 10 : 10;

  const entries = await db
    .select()
    .from(changelogTable)
    .orderBy(desc(changelogTable.timestamp))
    .limit(limit);

  res.json(
    entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      action: e.action,
      document_id: e.document_id,
      lead_id: e.lead_id,
      details: e.details,
      triggered_by: e.triggered_by,
    }))
  );
});

router.get("/changelog", async (req, res): Promise<void> => {
  const params = ListChangelogQueryParams.safeParse(req.query);
  const limit = params.success ? params.data.limit || 50 : 50;
  const documentId = params.success ? params.data.document_id : undefined;

  let query = db
    .select()
    .from(changelogTable)
    .orderBy(desc(changelogTable.timestamp))
    .limit(limit);

  const entries = documentId
    ? await db
        .select()
        .from(changelogTable)
        .where(eq(changelogTable.document_id, documentId))
        .orderBy(desc(changelogTable.timestamp))
        .limit(limit)
    : await query;

  res.json(
    entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      action: e.action,
      document_id: e.document_id,
      lead_id: e.lead_id,
      details: e.details,
      triggered_by: e.triggered_by,
    }))
  );
});

router.get("/compliance-constants", async (_req, res): Promise<void> => {
  const data = getComplianceConstants();
  res.json(data);
});

router.get("/seed/validate", async (_req, res): Promise<void> => {
  const result = validateSeedData();
  res.json(result);
});

export default router;
