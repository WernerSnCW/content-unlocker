import { Router } from "express";
import { db, documentHealthSessionsTable, documentHealthScoresTable, documentsTable, tasksTable, complianceConstantsTable, beliefRegistryTable, leadsTable } from "@workspace/db";
import { desc, asc, eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

router.post("/document-health/run", async (_req, res) => {
  try {
    const [existing] = await db.select().from(documentHealthSessionsTable)
      .where(eq(documentHealthSessionsTable.status, "RUNNING"))
      .limit(1);

    if (existing) {
      return res.status(200).json({ session: existing, already_running: true });
    }

    const [session] = await db.insert(documentHealthSessionsTable).values({
      id: randomUUID(),
      status: "RUNNING",
    }).returning();

    res.status(202).json({ session, already_running: false });

    setImmediate(async () => {
      try {
        await runHealthCheck(session.id);
      } catch (err) {
        console.error("Health check failed:", err);
        await db.update(documentHealthSessionsTable)
          .set({ status: "FAILED", error_message: String(err), completed_at: new Date() })
          .where(eq(documentHealthSessionsTable.id, session.id));
      }
    });
  } catch (error) {
    console.error("Failed to start health check:", error);
    return res.status(500).json({ error: "Failed to start health check" });
  }
});

router.get("/document-health/latest", async (_req, res) => {
  try {
    const [session] = await db.select().from(documentHealthSessionsTable)
      .orderBy(desc(documentHealthSessionsTable.started_at))
      .limit(1);

    if (!session) return res.json({ session: null, scores: [], system_findings: null });

    const scores = await db.select().from(documentHealthScoresTable)
      .where(eq(documentHealthScoresTable.session_id, session.id))
      .orderBy(
        asc(documentHealthScoresTable.document_tier),
        asc(documentHealthScoresTable.document_name)
      );

    const beliefRegistry = await db.select().from(beliefRegistryTable);
    const allDocs = await db.select({
      belief_targets: documentsTable.belief_targets,
      persona_relevance: documentsTable.persona_relevance,
      pipeline_stage_relevance: documentsTable.pipeline_stage_relevance,
    }).from(documentsTable)
      .where(eq(documentsTable.lifecycle_status, "CURRENT"));

    const allMappedBeliefIds = new Set<string>();
    for (const doc of allDocs) {
      const targets = (doc.belief_targets as Array<{ belief_id: string }>) || [];
      for (const t of targets) {
        allMappedBeliefIds.add(t.belief_id);
      }
    }
    const beliefsWithNoDoc = beliefRegistry
      .filter(b => !allMappedBeliefIds.has(b.id))
      .map(b => ({ id: b.id, name: b.name, cluster: b.cluster }));

    const personaSet = new Set<string>();
    const stageSet = new Set<string>();
    const comboCovered = new Set<string>();
    for (const doc of allDocs) {
      const personas = (doc.persona_relevance as string[]) || [];
      const stages = (doc.pipeline_stage_relevance as string[]) || [];
      for (const p of personas) { personaSet.add(p); }
      for (const s of stages) { stageSet.add(s); }
      for (const p of personas) {
        for (const s of stages) {
          comboCovered.add(`${p}|${s}`);
        }
      }
    }
    const stageCoverageGaps: Array<{ persona: string; stage: string }> = [];
    for (const p of personaSet) {
      for (const s of stageSet) {
        if (!comboCovered.has(`${p}|${s}`)) {
          stageCoverageGaps.push({ persona: p, stage: s });
        }
      }
    }

    const neverSentDocs = scores
      .filter(s => s.delivery_status === "WARN")
      .map(s => ({ name: (s as any).document_name, id: (s as any).document_id }));

    return res.json({
      session,
      scores,
      system_findings: {
        beliefs_with_no_doc: beliefsWithNoDoc,
        stage_coverage_gaps: stageCoverageGaps,
        never_sent_docs: neverSentDocs,
      },
    });
  } catch (error) {
    console.error("Failed to fetch health check:", error);
    return res.status(500).json({ error: "Failed to fetch health check" });
  }
});

async function runHealthCheck(sessionId: string): Promise<void> {
  const allDocs = await db.select().from(documentsTable)
    .where(eq(documentsTable.lifecycle_status, "CURRENT"));

  const allDocsForPropagation = await db.select().from(documentsTable);

  const constants = await db.select().from(complianceConstantsTable)
    .where(eq(complianceConstantsTable.status, "ACTIVE"));
  const prohibitedValues = constants.filter(c => c.is_prohibited);

  const beliefRegistry = await db.select().from(beliefRegistryTable);

  const openReviewTasks = await db.select().from(tasksTable)
    .where(and(
      eq(tasksTable.type, "Review"),
      eq(tasksTable.status, "Open")
    ));

  const allLeads = await db.select({ id: leadsTable.id, send_log: leadsTable.send_log }).from(leadsTable);
  const allSendEvents: Array<{ document_id: string; lead_id: string; date: string }> = [];

  for (const lead of allLeads) {
    const sendLog = lead.send_log as Array<{ send_id: string; date: string; documents_sent: string[] }> || [];
    for (const entry of sendLog) {
      for (const docId of (entry.documents_sent || [])) {
        allSendEvents.push({ document_id: docId, lead_id: lead.id, date: entry.date });
      }
    }
  }

  let healthyCount = 0;
  let warningCount = 0;
  let failingCount = 0;

  for (const doc of allDocs) {
    const identity = checkIdentity(doc);
    const targeting = checkTargeting(doc);
    const belief = checkBelief(doc, beliefRegistry);
    const compliance = checkCompliance(doc, prohibitedValues, openReviewTasks);
    const propagation = checkPropagation(doc, allDocsForPropagation);
    const content = checkContent(doc);
    const delivery = checkDelivery(doc, allSendEvents);

    const statuses = [identity.status, targeting.status, belief.status, compliance.status, propagation.status, content.status, delivery.status];
    const overall = statuses.includes("FAIL") ? "FAIL" : statuses.includes("WARN") ? "WARN" : "PASS";

    if (overall === "PASS") healthyCount++;
    else if (overall === "WARN") warningCount++;
    else failingCount++;

    await db.insert(documentHealthScoresTable).values({
      id: randomUUID(),
      session_id: sessionId,
      document_id: doc.id,
      document_name: doc.name,
      document_tier: doc.tier,
      document_file_code: doc.file_code,
      identity_status: identity.status,
      identity_issues: identity.issues,
      targeting_status: targeting.status,
      targeting_issues: targeting.issues,
      belief_status: belief.status,
      belief_issues: belief.issues,
      compliance_status: compliance.status,
      compliance_issues: compliance.issues,
      propagation_status: propagation.status,
      propagation_issues: propagation.issues,
      content_status: content.status,
      content_issues: content.issues,
      delivery_status: delivery.status,
      delivery_issues: delivery.issues,
      overall_status: overall,
    });

    await db.update(documentHealthSessionsTable)
      .set({ documents_checked: allDocs.indexOf(doc) + 1 })
      .where(eq(documentHealthSessionsTable.id, sessionId));
  }

  await db.update(documentHealthSessionsTable)
    .set({
      status: "COMPLETE",
      completed_at: new Date(),
      documents_checked: allDocs.length,
      documents_healthy: healthyCount,
      documents_warning: warningCount,
      documents_failing: failingCount,
    })
    .where(eq(documentHealthSessionsTable.id, sessionId));
}

type DimensionResult = { status: string; issues: Array<Record<string, any>> };

function checkIdentity(doc: any): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  if (!doc.tier) issues.push({ field: "tier", message: "Missing tier" });
  if (!doc.category) issues.push({ field: "category", message: "Missing category" });
  if (!doc.description || doc.description.trim() === "") issues.push({ field: "description", message: "Missing description" });
  if (!doc.file_code) issues.push({ field: "file_code", message: "Missing file_code" });
  const status = issues.length === 0 ? "PASS" : issues.length <= 1 ? "WARN" : "FAIL";
  return { status, issues };
}

function checkTargeting(doc: any): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  const personas = (doc.persona_relevance as string[]) || [];
  const stages = (doc.pipeline_stage_relevance as string[]) || [];
  if (personas.length === 0) issues.push({ field: "persona_relevance", message: "No persona targeting — document will never be recommended" });
  if (stages.length === 0) issues.push({ field: "pipeline_stage_relevance", message: "No stage targeting — document will never be recommended" });
  const status = issues.length === 0 ? "PASS" : issues.length === 2 ? "FAIL" : "WARN";
  return { status, issues };
}

function checkBelief(doc: any, beliefRegistry: any[]): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  const targets = (doc.belief_targets as Array<{ belief_id: string; state_from: string; state_to: string }>) || [];
  if (targets.length === 0) {
    issues.push({ field: "belief_targets", message: "No belief mapping — document cannot contribute to belief progression" });
  } else {
    for (const target of targets) {
      const belief = beliefRegistry.find(b => b.id === target.belief_id);
      if (!belief) issues.push({ field: "belief_targets", message: `References non-existent belief: ${target.belief_id}` });
      if (belief && belief.policy_status === "blocked_pending_legal") {
        issues.push({ field: "belief_targets", message: `Targets legally blocked belief: ${target.belief_id}` });
      }
    }
  }
  const status = issues.length === 0 ? "PASS" : issues.some(i => i.message.includes("non-existent")) ? "FAIL" : "WARN";
  return { status, issues };
}

function checkCompliance(doc: any, prohibitedValues: any[], openReviewTasks: any[]): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  if (doc.review_state === "REQUIRES_REVIEW") {
    const hasOpenTask = openReviewTasks.some(t => t.linked_document_id === doc.id);
    issues.push({
      field: "review_state",
      message: `Flagged for review${hasOpenTask ? " (task exists)" : " (NO open task — invisible to Work Queue)"}`,
      has_task: hasOpenTask,
    });
  }
  if (doc.content) {
    for (const prohibited of prohibitedValues) {
      if (doc.content.toLowerCase().includes(prohibited.value.toLowerCase())) {
        issues.push({
          field: "content",
          message: `Contains prohibited value: "${prohibited.value}" — ${prohibited.prohibited_reason || "must not appear"}`,
          prohibited_value: prohibited.value,
        });
      }
    }
  }
  const status = issues.length === 0 ? "PASS" : issues.some(i => i.field === "content") ? "FAIL" : "WARN";
  return { status, issues };
}

function checkPropagation(doc: any, allDocs: any[]): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  const upstreamIds = (doc.upstream_dependencies as string[]) || [];
  if (doc.tier > 1 && upstreamIds.length === 0) {
    issues.push({
      field: "upstream_dependencies",
      message: `Tier ${doc.tier} document has no upstream dependencies — changes to Tier 1 documents will not cascade to this document`,
    });
  }
  for (const upId of upstreamIds) {
    const upDoc = allDocs.find(d => d.id === upId);
    if (!upDoc) {
      issues.push({ field: "upstream_dependencies", message: `References non-existent document: ${upId}` });
    } else if (upDoc.lifecycle_status !== "CURRENT") {
      issues.push({ field: "upstream_dependencies", message: `References ${upDoc.lifecycle_status} document: ${upDoc.name}` });
    }
  }
  const status = issues.length === 0 ? "PASS" : issues.some(i => i.message.includes("non-existent")) ? "FAIL" : "WARN";
  return { status, issues };
}

function checkContent(doc: any): DimensionResult {
  const issues: Array<Record<string, any>> = [];
  if (!doc.content) {
    issues.push({ field: "content", message: "No content — document has nothing to deliver" });
  } else if (doc.content.trim().length < 100) {
    issues.push({ field: "content", message: `Stub content — only ${doc.content.trim().length} characters` });
  } else if (doc.content.trim().length < 500) {
    issues.push({ field: "content", message: `Thin content — only ${doc.content.trim().length} characters` });
  }
  const status = issues.length === 0 ? "PASS" : issues.some(i => i.message.includes("No content") || i.message.includes("Stub")) ? "FAIL" : "WARN";
  return { status, issues };
}

function checkDelivery(doc: any, allSendEvents: Array<{ document_id: string; lead_id: string; date: string }>): DimensionResult {
  const docEvents = allSendEvents.filter(e => e.document_id === doc.id);
  const timesSent = docEvents.length;
  const uniqueLeads = new Set(docEvents.map(e => e.lead_id)).size;
  const issues: Array<Record<string, any>> = [];
  if (timesSent === 0) {
    issues.push({
      field: "delivery",
      message: "Never sent to any lead",
      times_sent: 0,
      unique_leads: 0,
    });
  }
  const status = issues.length === 0 ? "PASS" : "WARN";
  return { status, issues };
}

export default router;
