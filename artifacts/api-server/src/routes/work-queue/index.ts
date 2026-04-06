import { Router } from "express";
import { db, workQueueSessionsTable, workQueueFindingsTable, tasksTable, documentsTable, complianceConstantsTable, changelogTable } from "@workspace/db";
import { desc, notInArray, inArray, isNotNull, and, eq, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { randomUUID } from "crypto";
import { propagateFromDocument } from "../../lib/propagation";
import { createReviewTasksForPropagation } from "../../lib/taskHelpers";

const router = Router();

router.get("/work-queue/status", async (_req, res) => {
  try {
    const [session] = await db
      .select()
      .from(workQueueSessionsTable)
      .where(notInArray(workQueueSessionsTable.status, ["COMPLETE", "FAILED"]))
      .orderBy(desc(workQueueSessionsTable.started_at))
      .limit(1);

    if (session) {
      return res.json({
        session,
        findings_ready: session.status === "READY" || session.status === "COMPLETE",
      });
    }

    return res.json({ session: null, findings_ready: false });
  } catch (error) {
    console.error("Failed to fetch queue status:", error);
    return res.status(500).json({ error: "Failed to fetch queue status" });
  }
});

router.post("/work-queue/start", async (_req, res) => {
  try {
    const [existing] = await db.select().from(workQueueSessionsTable)
      .where(inArray(workQueueSessionsTable.status, ["PENDING", "ANALYSING", "READY"]))
      .limit(1);

    if (existing) {
      return res.status(200).json({ session: existing, already_running: true });
    }

    const requiresReviewDocs = await db.select().from(documentsTable)
      .where(and(
        eq(documentsTable.lifecycle_status, "CURRENT"),
        eq(documentsTable.review_state, "REQUIRES_REVIEW")
      ));

    for (const doc of requiresReviewDocs) {
      const existingTask = await db.select().from(tasksTable)
        .where(and(
          eq(tasksTable.linked_document_id, doc.id),
          eq(tasksTable.type, "Review"),
          eq(tasksTable.status, "Open")
        )).limit(1);

      if (!existingTask[0]) {
        await db.insert(tasksTable).values({
          id: randomUUID(),
          title: `Review: ${doc.name}`,
          status: "Open",
          type: "Review",
          linked_document_id: doc.id,
        });
      }
    }

    const openTasks = await db.select().from(tasksTable)
      .where(and(
        eq(tasksTable.status, "Open"),
        eq(tasksTable.type, "Review"),
        isNotNull(tasksTable.linked_document_id)
      ));

    if (openTasks.length === 0) {
      const [emptySession] = await db.insert(workQueueSessionsTable).values({
        status: "COMPLETE",
        total_tasks: 0,
      }).returning();
      return res.status(200).json({ session: emptySession, already_running: false });
    }

    const documentIds = [...new Set(openTasks.map(t => t.linked_document_id as string))];
    const allDocuments = await db.select().from(documentsTable)
      .where(inArray(documentsTable.id, documentIds));

    const eligibleDocs = allDocuments.filter(
      d => d.lifecycle_status === "CURRENT" && d.review_state === "REQUIRES_REVIEW"
    );

    if (eligibleDocs.length === 0) {
      const [emptySession] = await db.insert(workQueueSessionsTable).values({
        status: "COMPLETE",
        total_tasks: 0,
      }).returning();
      return res.status(200).json({ session: emptySession, already_running: false });
    }

    const eligibleDocIds = new Set(eligibleDocs.map(d => d.id));
    const eligibleTasks = openTasks.filter(t => eligibleDocIds.has(t.linked_document_id as string));

    const constants = await db.select().from(complianceConstantsTable)
      .where(eq(complianceConstantsTable.status, "ACTIVE"));

    const prohibitedValues = constants.filter(c => c.is_prohibited);
    const canonicalValues: Record<string, string> = {};
    constants.forEach(c => {
      if (!c.is_prohibited) canonicalValues[c.key] = c.value;
    });

    const [session] = await db.insert(workQueueSessionsTable).values({
      status: "ANALYSING",
      total_tasks: eligibleDocs.length,
      analysed_tasks: 0,
    }).returning();

    res.status(202).json({ session, already_running: false });

    setImmediate(async () => {
      try {
        await runAnalysis(session.id, eligibleDocs, eligibleTasks, prohibitedValues, canonicalValues);
      } catch (err) {
        console.error("Work queue analysis failed:", err);
        await db.update(workQueueSessionsTable)
          .set({ status: "FAILED", error_message: String(err), completed_at: new Date() })
          .where(eq(workQueueSessionsTable.id, session.id));
      }
    });
  } catch (error) {
    console.error("Failed to start work queue:", error);
    return res.status(500).json({ error: "Failed to start work queue" });
  }
});

router.get("/work-queue/cards", async (_req, res) => {
  try {
    const [session] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.status, "READY"))
      .orderBy(desc(workQueueSessionsTable.started_at))
      .limit(1);

    if (!session) {
      return res.json({ cards: [], session: null });
    }

    const cards = await db.select().from(workQueueFindingsTable)
      .where(and(
        eq(workQueueFindingsTable.session_id, session.id),
        eq(workQueueFindingsTable.finding_type, "decision_card"),
        eq(workQueueFindingsTable.status, "PENDING")
      ))
      .orderBy(workQueueFindingsTable.sort_order);

    return res.json({ cards, session, total_remaining: cards.length });
  } catch (error) {
    console.error("Failed to fetch cards:", error);
    return res.status(500).json({ error: "Failed to fetch cards" });
  }
});

router.post("/work-queue/auto-fix", async (_req, res) => {
  try {
    const [session] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.status, "READY"))
      .orderBy(desc(workQueueSessionsTable.started_at))
      .limit(1);

    if (!session) {
      return res.status(404).json({ error: "No active session" });
    }

    const autoFixFindings = await db.select().from(workQueueFindingsTable)
      .where(and(
        eq(workQueueFindingsTable.session_id, session.id),
        eq(workQueueFindingsTable.finding_type, "auto_fix"),
        eq(workQueueFindingsTable.status, "PENDING")
      ));

    if (autoFixFindings.length === 0) {
      return res.json({ applied: 0, failed: 0, message: "No auto-fixes pending", session });
    }

    let applied = 0;
    let failed = 0;

    for (const finding of autoFixFindings) {
      const [doc] = await db.select().from(documentsTable)
        .where(eq(documentsTable.id, finding.document_id));

      if (!doc) {
        await db.update(workQueueFindingsTable)
          .set({ status: "FAILED", issue_description: finding.issue_description + " [Document not found]", resolved_at: new Date() })
          .where(eq(workQueueFindingsTable.id, finding.id));
        failed++;
        continue;
      }

      if (finding.original_text && finding.proposed_fix && doc.content && doc.content.includes(finding.original_text)) {
        const newContent = doc.content.replace(finding.original_text, finding.proposed_fix);
        await db.update(documentsTable)
          .set({ content: newContent, review_state: "CLEAN" })
          .where(eq(documentsTable.id, doc.id));

        await db.update(tasksTable)
          .set({ status: "Done" })
          .where(eq(tasksTable.id, finding.task_id));

        await db.insert(changelogTable).values({
          id: randomUUID(),
          action: "AUTO_FIX_APPLIED",
          document_id: doc.id,
          details: finding.issue_description,
          triggered_by: "agent",
        });

        const result = await propagateFromDocument(doc.id);
        await createReviewTasksForPropagation(result.targets);

        await db.update(workQueueSessionsTable)
          .set({ cascaded_count: sql`cascaded_count + ${result.targets.length}` })
          .where(eq(workQueueSessionsTable.id, session.id));

        await db.update(workQueueFindingsTable)
          .set({ status: "AUTO_FIXED", resolved_at: new Date() })
          .where(eq(workQueueFindingsTable.id, finding.id));

        applied++;
      } else {
        await db.update(workQueueFindingsTable)
          .set({ status: "FAILED", issue_description: finding.issue_description + " [Original text not found in document]", resolved_at: new Date() })
          .where(eq(workQueueFindingsTable.id, finding.id));
        failed++;
      }
    }

    await db.update(workQueueSessionsTable)
      .set({ auto_fixed_count: applied })
      .where(eq(workQueueSessionsTable.id, session.id));

    const [updatedSession] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.id, session.id));

    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(workQueueFindingsTable)
      .where(and(
        eq(workQueueFindingsTable.session_id, session.id),
        eq(workQueueFindingsTable.status, "PENDING")
      ));

    if (Number(pendingCount[0].count) === 0) {
      await db.update(workQueueSessionsTable)
        .set({ status: "COMPLETE", completed_at: new Date() })
        .where(eq(workQueueSessionsTable.id, session.id));
    }

    const [finalSession] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.id, session.id));

    return res.json({ applied, failed, session: finalSession });
  } catch (error) {
    console.error("Failed to apply auto-fixes:", error);
    return res.status(500).json({ error: "Failed to apply auto-fixes" });
  }
});

router.get("/work-queue/summary", async (_req, res) => {
  try {
    const [session] = await db.select().from(workQueueSessionsTable)
      .orderBy(desc(workQueueSessionsTable.started_at))
      .limit(1);

    if (!session) {
      return res.json({ summary: null });
    }

    const findings = await db.select().from(workQueueFindingsTable)
      .where(eq(workQueueFindingsTable.session_id, session.id));

    const autoFixed = findings.filter(f => f.status === "AUTO_FIXED").length;
    const cardsAccepted = findings.filter(f => f.status === "ACCEPTED").length;
    const cardsSkipped = findings.filter(f => f.status === "SKIPPED").length;
    const stillOpen = findings.filter(f => f.status === "PENDING" || f.status === "FAILED").length;

    return res.json({
      summary: {
        session,
        auto_fixed: autoFixed,
        cards_accepted: cardsAccepted,
        cards_skipped: cardsSkipped,
        cascaded: session.cascaded_count,
        still_open: stillOpen,
      },
    });
  } catch (error) {
    console.error("Failed to fetch summary:", error);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
});

router.post("/work-queue/cards/:findingId/accept", async (req, res) => {
  try {
    const { findingId } = req.params;

    const [finding] = await db.select().from(workQueueFindingsTable)
      .where(eq(workQueueFindingsTable.id, findingId));

    if (!finding) {
      return res.status(404).json({ error: "Finding not found" });
    }

    if (finding.status !== "PENDING") {
      return res.status(400).json({ error: "Finding already resolved" });
    }

    if (finding.finding_type !== "decision_card") {
      return res.status(400).json({ error: "Only decision_card findings can be accepted via this endpoint" });
    }

    const [doc] = await db.select().from(documentsTable)
      .where(eq(documentsTable.id, finding.document_id));

    if (finding.proposed_fix && finding.original_text && doc?.content && doc.content.includes(finding.original_text)) {
      const newContent = doc.content.replace(finding.original_text, finding.proposed_fix);
      await db.update(documentsTable)
        .set({ content: newContent, review_state: "CLEAN" })
        .where(eq(documentsTable.id, doc.id));
    } else if (!finding.original_text && doc) {
      await db.update(documentsTable)
        .set({ review_state: "CLEAN" })
        .where(eq(documentsTable.id, doc.id));
    }

    await db.update(tasksTable)
      .set({ status: "Done" })
      .where(eq(tasksTable.id, finding.task_id));

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "CARD_ACCEPTED",
      document_id: finding.document_id,
      details: finding.issue_description,
      triggered_by: "operator",
    });

    const result = await propagateFromDocument(finding.document_id);
    await createReviewTasksForPropagation(result.targets);

    await db.update(workQueueSessionsTable)
      .set({
        cards_resolved: sql`cards_resolved + 1`,
        cascaded_count: sql`cascaded_count + ${result.targets.length}`,
      })
      .where(eq(workQueueSessionsTable.id, finding.session_id));

    await db.update(workQueueFindingsTable)
      .set({ status: "ACCEPTED", resolved_at: new Date() })
      .where(eq(workQueueFindingsTable.id, finding.id));

    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(workQueueFindingsTable)
      .where(and(
        eq(workQueueFindingsTable.session_id, finding.session_id),
        eq(workQueueFindingsTable.status, "PENDING")
      ));

    if (Number(pendingCount[0].count) === 0) {
      await db.update(workQueueSessionsTable)
        .set({ status: "COMPLETE", completed_at: new Date() })
        .where(eq(workQueueSessionsTable.id, finding.session_id));
    }

    const [updatedFinding] = await db.select().from(workQueueFindingsTable)
      .where(eq(workQueueFindingsTable.id, finding.id));
    const [updatedSession] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.id, finding.session_id));

    return res.json({ finding: updatedFinding, cascaded: result.targets.length, session: updatedSession });
  } catch (error) {
    console.error("Failed to accept card:", error);
    return res.status(500).json({ error: "Failed to accept card" });
  }
});

router.post("/work-queue/cards/:findingId/skip", async (req, res) => {
  try {
    const { findingId } = req.params;
    const { reason } = req.body || {};

    const validReasons = ["Not relevant", "Needs more context", "Defer"];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({ error: "Invalid skip reason" });
    }

    const [finding] = await db.select().from(workQueueFindingsTable)
      .where(eq(workQueueFindingsTable.id, findingId));

    if (!finding) {
      return res.status(404).json({ error: "Finding not found" });
    }

    if (finding.status !== "PENDING") {
      return res.status(400).json({ error: "Finding already resolved" });
    }

    if (finding.finding_type !== "decision_card") {
      return res.status(400).json({ error: "Only decision_card findings can be skipped via this endpoint" });
    }

    await db.update(workQueueFindingsTable)
      .set({ status: "SKIPPED", skip_reason: reason, resolved_at: new Date() })
      .where(eq(workQueueFindingsTable.id, finding.id));

    await db.update(workQueueSessionsTable)
      .set({ cards_skipped: sql`cards_skipped + 1` })
      .where(eq(workQueueSessionsTable.id, finding.session_id));

    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(workQueueFindingsTable)
      .where(and(
        eq(workQueueFindingsTable.session_id, finding.session_id),
        eq(workQueueFindingsTable.status, "PENDING")
      ));

    if (Number(pendingCount[0].count) === 0) {
      await db.update(workQueueSessionsTable)
        .set({ status: "COMPLETE", completed_at: new Date() })
        .where(eq(workQueueSessionsTable.id, finding.session_id));
    }

    const [updatedFinding] = await db.select().from(workQueueFindingsTable)
      .where(eq(workQueueFindingsTable.id, finding.id));
    const [updatedSession] = await db.select().from(workQueueSessionsTable)
      .where(eq(workQueueSessionsTable.id, finding.session_id));

    return res.json({ finding: updatedFinding, session: updatedSession });
  } catch (error) {
    console.error("Failed to skip card:", error);
    return res.status(500).json({ error: "Failed to skip card" });
  }
});

async function runAnalysis(
  sessionId: string,
  documents: Array<typeof documentsTable.$inferSelect>,
  tasks: Array<typeof tasksTable.$inferSelect>,
  prohibitedValues: Array<typeof complianceConstantsTable.$inferSelect>,
  canonicalValues: Record<string, string>
): Promise<void> {
  const prohibitedList = prohibitedValues
    .map(p => `- PROHIBITED: "${p.value}" (${p.label}) — ${p.prohibited_reason || "must not appear"}`)
    .join("\n");

  const canonicalList = Object.entries(canonicalValues)
    .map(([key, val]) => `- ${key}: correct value is "${val}"`)
    .join("\n");

  for (const document of documents) {
    const task = tasks.find(t => t.linked_document_id === document.id);
    if (!task) continue;

    if (!document.content || document.content.trim() === "") {
      await db.insert(workQueueFindingsTable).values({
        session_id: sessionId,
        task_id: task.id,
        document_id: document.id,
        document_name: document.name,
        document_tier: document.tier,
        finding_type: "decision_card",
        issue_description: "Document has no content — cannot be analysed.",
        proposed_fix: null,
        original_text: null,
        status: "PENDING",
        sort_order: (document.tier * 100),
      });

      await db.update(workQueueSessionsTable)
        .set({ analysed_tasks: sql`analysed_tasks + 1` })
        .where(eq(workQueueSessionsTable.id, sessionId));
      continue;
    }

    const taskContext = task.context ? `\nOPERATOR CONTEXT (additional guidance from the operator about this review):\n${task.context}\n` : "";

    const prompt = `You are reviewing an investor document for compliance violations and content quality issues.

DOCUMENT NAME: ${document.name}
DOCUMENT TIER: ${document.tier}
${taskContext}
PROHIBITED VALUES (must never appear in any investor-facing document):
${prohibitedList}

CANONICAL VALUES (correct values that must be used):
${canonicalList}

DOCUMENT CONTENT:
${document.content}

Analyse this document and return a JSON array of findings. Return JSON only — no other text.

Each finding must be:
{
  "finding_type": "auto_fix" | "decision_card",
  "issue_description": "specific description of the problem",
  "original_text": "the exact text that contains the problem (max 100 chars)",
  "proposed_fix": "the exact replacement text or specific suggestion",
  "severity": "HIGH" | "MEDIUM" | "LOW"
}

Rules for classification:
- "auto_fix": the document contains a prohibited value or an incorrect canonical figure that has a known correct replacement. The fix is a direct text substitution. No judgement required.
- "decision_card": a content quality issue that requires operator judgement — missing framing, structural gaps, tone problems, outdated arguments, missing belief alignment.

Rules for findings:
- Only report real issues. If the document is compliant and high quality, return an empty array [].
- For auto_fix: original_text must be the exact string to replace. proposed_fix must be the exact replacement string.
- For decision_card: proposed_fix must be a specific, short, actionable suggestion — not a vague comment.
- Do not invent issues. Do not report issues not supported by the document content.
- Maximum 10 findings per document.
- Order findings: auto_fix first, then decision_card by severity (HIGH → MEDIUM → LOW).`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error(`No JSON array found in Claude response for document ${document.id}`);
      await db.update(workQueueSessionsTable)
        .set({ analysed_tasks: sql`analysed_tasks + 1` })
        .where(eq(workQueueSessionsTable.id, sessionId));
      continue;
    }

    let findings: Array<{
      finding_type: string;
      issue_description: string;
      original_text?: string;
      proposed_fix?: string;
      severity: string;
    }>;
    try {
      findings = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(`JSON parse error for document ${document.id}:`, parseErr);
      await db.insert(workQueueFindingsTable).values({
        session_id: sessionId,
        task_id: task.id,
        document_id: document.id,
        document_name: document.name,
        document_tier: document.tier,
        finding_type: "decision_card",
        issue_description: "Analysis produced unparseable results — manual review required.",
        proposed_fix: null,
        original_text: null,
        status: "PENDING",
        sort_order: (document.tier * 100),
      });
      await db.update(workQueueSessionsTable)
        .set({ analysed_tasks: sql`analysed_tasks + 1` })
        .where(eq(workQueueSessionsTable.id, sessionId));
      continue;
    }

    if (findings.length > 0) {
      await db.insert(workQueueFindingsTable).values(
        findings.map((f, i) => ({
          session_id: sessionId,
          task_id: task.id,
          document_id: document.id,
          document_name: document.name,
          document_tier: document.tier,
          finding_type: f.finding_type,
          issue_description: f.issue_description,
          original_text: f.original_text || null,
          proposed_fix: f.proposed_fix || null,
          status: "PENDING",
          sort_order: (document.tier * 100) + i,
        }))
      );
    }

    await db.update(workQueueSessionsTable)
      .set({ analysed_tasks: sql`analysed_tasks + 1` })
      .where(eq(workQueueSessionsTable.id, sessionId));
  }

  const allFindings = await db.select().from(workQueueFindingsTable)
    .where(eq(workQueueFindingsTable.session_id, sessionId));

  const cardCount = allFindings.filter(f => f.finding_type === "decision_card").length;

  await db.update(workQueueSessionsTable)
    .set({
      status: "READY",
      cards_total: cardCount,
      auto_fixed_count: 0,
      completed_at: new Date(),
    })
    .where(eq(workQueueSessionsTable.id, sessionId));
}

export default router;
