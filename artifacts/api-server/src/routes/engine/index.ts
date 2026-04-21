// Inspection endpoints for the V2 intelligence engine.
// Read-only; used by Phase 4 UI and for manual verification.
import { Router, type IRouter } from "express";
import { db, engineRunsTable, leadConversationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getEngineRuns,
  getEngineSignals,
  getEngineTransitions,
  getInvestorState,
  loadInvestor,
  processTranscript,
  processTranscriptWithLLM,
  saveEngineRun,
  ENGINE_VERSION,
  ENGINE_SPEC,
  ENGINE_UPDATED,
  SIGNAL_REGISTRY,
  QUESTION_REGISTRY,
  GATES,
  ROUTING_MAP,
  PERSONA_CONFIG,
  CALL_TYPES,
  TIMING_RULES,
  COMPLIANCE,
  RED_SIGNAL_ACTIONS,
  PIPELINE_STAGES,
  DEMO_SEGMENTS,
  COLD_CALL_STEPS,
  EMAIL_TEMPLATES,
  PROBLEM_BELIEF_PATTERNS,
  POST_CLOSE_WORKFLOW,
  ADVISER_LOOP_WORKFLOW,
  BOOK2_ROUTING,
  type CallType,
} from "../../engine/v2";

function inferCallType(durationSeconds: number | null | undefined): CallType {
  const mins = Math.round((durationSeconds || 0) / 60);
  if (mins >= 40) return "demo";
  if (mins >= 20) return "opportunity";
  return "cold_call";
}

const router: IRouter = Router();

// GET /engine/version — what version is running and against which spec
router.get("/engine/version", async (_req, res): Promise<void> => {
  res.json({
    engineVersion: ENGINE_VERSION,
    spec: ENGINE_SPEC,
    updated: ENGINE_UPDATED,
    signalCount: SIGNAL_REGISTRY.length,
  });
});

// GET /engine/config/all — Phase 7.0 read-only admin viewer.
// Bundles every config surface in one response so the admin page can
// render tabs without orchestrating N requests. Public read because the
// page itself is admin-gated via AdminOnlyRoute and the existing
// per-surface endpoints (questions/signals/demo-segments/documents) are
// already unauthenticated.
router.get("/engine/config/all", async (_req, res): Promise<void> => {
  res.json({
    meta: {
      engineVersion: ENGINE_VERSION,
      spec: ENGINE_SPEC,
      updated: ENGINE_UPDATED,
    },
    signals: SIGNAL_REGISTRY,
    questions: QUESTION_REGISTRY,
    gates: GATES,
    routingMap: ROUTING_MAP,
    personaConfig: PERSONA_CONFIG,
    callTypes: CALL_TYPES,
    timingRules: TIMING_RULES,
    compliance: COMPLIANCE,
    redSignalActions: RED_SIGNAL_ACTIONS,
    pipelineStages: PIPELINE_STAGES,
    demoSegments: DEMO_SEGMENTS,
    coldCallSteps: COLD_CALL_STEPS,
    emailTemplates: EMAIL_TEMPLATES,
    problemBeliefPatterns: PROBLEM_BELIEF_PATTERNS,
    postCloseWorkflow: POST_CLOSE_WORKFLOW,
    adviserLoopWorkflow: ADVISER_LOOP_WORKFLOW,
    book2Routing: BOOK2_ROUTING,
  });
});

// GET /engine/config/questions — the QUESTION_REGISTRY, used by Outcome Drawer
// (Phase 4.6) and the PreCallPanel (Phase 5) to render question text against
// QuestionDetection rows. Public read-only config surface; no mutation. Kept
// separate from /engine/version because the response is larger and cached
// client-side.
//
// Includes `variants` when a question's text depends on persona (Q13). The
// PreCallPanel resolves the investor's persona-specific variant before
// rendering — avoids the operator seeing the placeholder text literally.
router.get("/engine/config/questions", async (_req, res): Promise<void> => {
  res.json({
    questions: QUESTION_REGISTRY.map(q => ({
      qNum: q.qNum,
      text: q.text,
      call: q.call,
      category: q.category,
      signal: q.signal,
      gateRole: q.gateRole ?? null,
      variants: q.variants ?? null,
    })),
  });
});

// GET /engine/config/signals — signal catalog for display lookups.
router.get("/engine/config/signals", async (_req, res): Promise<void> => {
  res.json({
    signals: SIGNAL_REGISTRY.map(s => ({
      code: s.code,
      name: s.name,
      category: s.category,
      persona: s.persona,
      priority: s.priority,
      gateRole: s.gateRole ?? null,
    })),
  });
});

// GET /engine/config/demo-segments — the 6-segment demo agenda from
// DEMO_SEGMENTS config. Used by the pre-call panel (Phase 5) when the
// next call is a demo: show the operator the structure, durations,
// signals each segment surfaces, and any critical gates before they
// go in.
router.get("/engine/config/demo-segments", async (_req, res): Promise<void> => {
  const { DEMO_SEGMENTS } = await import("../../engine/v2/config");
  res.json({
    segments: (DEMO_SEGMENTS as any[]).map(s => ({
      segment: s.segment,
      name: s.name,
      durationMins: s.durationMins,
      screenShare: s.screenShare,
      signalsSurfaced: s.signalsSurfaced ?? [],
      alsoCaptures: s.alsoCaptures ?? [],
      captures: s.captures ?? [],
      personaBeliefsSurfaced: s.personaBeliefsSurfaced ?? null,
      expectedOutcome: s.expectedOutcome ?? null,
      criticalGate: s.criticalGate ?? null,
      note: s.note ?? null,
      questionsUsed: s.questionsUsed ?? [],
    })),
  });
});

// GET /engine/config/documents — flat list of all documents the engine
// knows about, extracted from ROUTING_MAP + attachmentRoutingTable +
// email template attachments. Used by the outcome detail page's
// attachments picker so operators can pick from the same doc universe
// the engine routes from.
//
// Deduplicated by docId. docId is the canonical reference until Phase
// 7.5 introduces the engine_document_mapping bridge table with slugs.
router.get("/engine/config/documents", async (_req, res): Promise<void> => {
  const { ROUTING_MAP: RM, EMAIL_TEMPLATES } = await import("../../engine/v2/config");
  const map = new Map<number, { docId: number; docName: string; usedFor: string[] }>();
  const note = (docId: number, docName: string, usedFor: string) => {
    const existing = map.get(docId);
    if (existing) {
      if (!existing.usedFor.includes(usedFor)) existing.usedFor.push(usedFor);
    } else {
      map.set(docId, { docId, docName, usedFor: [usedFor] });
    }
  };
  for (const r of RM as any[]) {
    if (r.docId != null) note(r.docId, r.docName, `${r.signal} → ${r.triggerStates.join("/")}`);
    if (r.altDoc?.docId != null) note(r.altDoc.docId, r.altDoc.docName, `${r.signal} alt`);
    if (r.personaVariant) {
      for (const [persona, variant] of Object.entries(r.personaVariant as Record<string, any>)) {
        if (variant?.docId != null) note(variant.docId, variant.docName, `${r.signal} ${persona}`);
      }
    }
  }
  const at = (EMAIL_TEMPLATES as any).attachmentRoutingTable;
  if (Array.isArray(at)) {
    for (const row of at) {
      if (row?.docId != null) {
        // docName isn't on these rows — use the belief code as fallback label
        note(row.docId, `Doc ${row.docId} (${row.belief || ""})`, `email routing`);
      }
    }
  }
  const docs = [...map.values()].sort((a, b) => a.docId - b.docId);
  res.json({ documents: docs });
});

// GET /engine/contact/:id — full engine view of one contact
router.get("/engine/contact/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const [state, signals, transitions, runs] = await Promise.all([
      getInvestorState(id),
      getEngineSignals(id),
      getEngineTransitions(id),
      getEngineRuns(id),
    ]);
    res.json({
      contactId: id,
      investorState: state,
      signals,
      transitions: transitions.sort((a, b) =>
        b.transitioned_at.getTime() - a.transitioned_at.getTime()),
      runs: runs
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map(r => ({
          id: r.id,
          conversation_id: r.conversation_id,
          call_type: r.call_type,
          engine_version: r.engine_version,
          created_at: r.created_at,
          // Include just the summary of the output to keep payload small
          summary: {
            persona: (r.output as any)?.personaAssessment?.persona,
            hotButton: (r.output as any)?.hotButton?.primary,
            signalUpdateCount: (r.output as any)?.signalUpdates?.length ?? 0,
            nextAction: (r.output as any)?.nextBestAction?.actionType,
            c4Compliance: (r.output as any)?.gateStatus?.c4Compliance,
            pack1: (r.output as any)?.gateStatus?.pack1,
            flags: (r.output as any)?.flags?.length ?? 0,
          },
        })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load engine view" });
  }
});

// GET /engine/runs/:id — full EngineOutput JSON for a single run (debugging)
router.get("/engine/runs/:id", async (req, res): Promise<void> => {
  try {
    const [run] = await db.select().from(engineRunsTable)
      .where(eq(engineRunsTable.id, req.params.id))
      .limit(1);
    if (!run) { res.status(404).json({ error: "Run not found" }); return; }
    res.json(run);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /engine/reprocess — re-run the engine against a stored transcript.
// Body: { conversation_id?, call_id?, call_type? }  (supply either id)
// Useful for back-filling transcripts captured before the engine was wired in.
router.post("/engine/reprocess", async (req, res): Promise<void> => {
  try {
    const { conversation_id, call_id, call_type } = req.body || {};
    if (!conversation_id && !call_id) {
      res.status(400).json({ error: "conversation_id or call_id required" });
      return;
    }

    const [conv] = conversation_id
      ? await db.select().from(leadConversationsTable).where(eq(leadConversationsTable.id, conversation_id)).limit(1)
      : await db.select().from(leadConversationsTable).where(eq(leadConversationsTable.external_id, String(call_id))).limit(1);

    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    if (!conv.transcript_text) { res.status(400).json({ error: "Conversation has no transcript" }); return; }
    if (!conv.contact_id) { res.status(400).json({ error: "Conversation has no contact_id" }); return; }

    const callType = (call_type as CallType) || inferCallType(conv.duration_seconds);
    const investor = await loadInvestor(conv.contact_id);
    const output = processTranscript(conv.transcript_text, callType, investor);
    const runId = await saveEngineRun({
      contactId: conv.contact_id,
      conversationId: conv.id,
      callType,
      output,
    });

    await db.update(leadConversationsTable)
      .set({ engine_version: output.engineVersion })
      .where(eq(leadConversationsTable.id, conv.id));

    res.json({
      runId,
      contactId: conv.contact_id,
      conversationId: conv.id,
      callType,
      engineVersion: output.engineVersion,
      summary: {
        persona: output.personaAssessment.persona,
        hotButton: output.hotButton.primary,
        signalUpdates: output.signalUpdates.length,
        nextAction: output.nextBestAction.actionType,
        c4Compliance: output.gateStatus.c4Compliance,
        pack1: output.gateStatus.pack1,
        flags: output.flags.length,
      },
    });
  } catch (err: any) {
    console.error("[engine/reprocess] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /engine/compare — Phase 4.9 validation tool.
// Runs both the keyword path and the LLM path against the same
// transcript + investor state. Returns both EngineOutputV3s plus a
// simple diff summary so admins can eyeball where the two paths
// disagree. Neither run is persisted — purely read-only evaluation.
//
// Body: { conversation_id?, call_id? }  — reuses a stored transcript.
//
// Use this to build confidence before deleting the keyword path.
router.post("/engine/compare", async (req, res): Promise<void> => {
  try {
    const { conversation_id, call_id } = req.body || {};
    if (!conversation_id && !call_id) {
      res.status(400).json({ error: "conversation_id or call_id required" });
      return;
    }

    const [conv] = conversation_id
      ? await db.select().from(leadConversationsTable).where(eq(leadConversationsTable.id, conversation_id)).limit(1)
      : await db.select().from(leadConversationsTable).where(eq(leadConversationsTable.external_id, String(call_id))).limit(1);

    if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    if (!conv.transcript_text) { res.status(400).json({ error: "Conversation has no transcript" }); return; }
    if (!conv.contact_id) { res.status(400).json({ error: "Conversation has no contact_id" }); return; }

    const callType = inferCallType(conv.duration_seconds);
    const investor = await loadInvestor(conv.contact_id);

    // Keyword path — instant, deterministic.
    const keywordOut = processTranscript(conv.transcript_text, callType, investor);

    // LLM path — 10-30s depending on transcript length.
    let llmOut: any = null;
    let llmError: string | null = null;
    try {
      const r = await processTranscriptWithLLM(conv.transcript_text, callType, investor);
      llmOut = r.output;
    } catch (err: any) {
      llmError = err?.message || String(err);
    }

    // Build a compact diff summary highlighting the points that matter:
    // persona / hot-button / signal state deltas / NBA / gate outcomes /
    // email draft presence.
    const diff = llmOut ? buildCompareDiff(keywordOut as any, llmOut) : null;

    res.json({
      conversationId: conv.id,
      contactId: conv.contact_id,
      callType,
      keyword: keywordOut,
      llm: llmOut,
      llmError,
      diff,
    });
  } catch (err: any) {
    console.error("[engine/compare] failed:", err);
    res.status(500).json({ error: err.message });
  }
});

function buildCompareDiff(keyword: any, llm: any): any {
  const kSignals = new Map<string, string>();
  for (const u of keyword.signalUpdates || []) kSignals.set(u.code, u.newState);
  const lSignals = new Map<string, string>();
  for (const u of llm.signalUpdates || []) lSignals.set(u.code, u.newState);
  const allCodes = new Set<string>([...kSignals.keys(), ...lSignals.keys()]);
  const signalDiffs: Array<{ code: string; keyword: string | null; llm: string | null; agreed: boolean }> = [];
  for (const c of allCodes) {
    const k = kSignals.get(c) ?? null;
    const l = lSignals.get(c) ?? null;
    signalDiffs.push({ code: c, keyword: k, llm: l, agreed: k === l });
  }
  return {
    persona: {
      keyword: keyword.personaAssessment?.persona ?? null,
      llm: llm.personaAssessment?.persona ?? null,
      agreed: (keyword.personaAssessment?.persona ?? null) === (llm.personaAssessment?.persona ?? null),
    },
    hotButton: {
      keyword: keyword.hotButton?.primary ?? null,
      llm: llm.hotButton?.primary ?? null,
      agreed: (keyword.hotButton?.primary ?? null) === (llm.hotButton?.primary ?? null),
    },
    nextAction: {
      keyword: keyword.nextBestAction?.actionType ?? null,
      llm: llm.nextBestAction?.actionType ?? null,
      agreed: (keyword.nextBestAction?.actionType ?? null) === (llm.nextBestAction?.actionType ?? null),
    },
    c4Compliance: {
      keyword: keyword.gateStatus?.c4Compliance ?? null,
      llm: llm.gateStatus?.c4Compliance ?? null,
      agreed: (keyword.gateStatus?.c4Compliance ?? null) === (llm.gateStatus?.c4Compliance ?? null),
    },
    pack1: {
      keyword: keyword.gateStatus?.pack1 ?? null,
      llm: llm.gateStatus?.pack1 ?? null,
      agreed: (keyword.gateStatus?.pack1 ?? null) === (llm.gateStatus?.pack1 ?? null),
    },
    signalCount: {
      keyword: keyword.signalUpdates?.length ?? 0,
      llm: llm.signalUpdates?.length ?? 0,
    },
    signalsPerCode: signalDiffs,
    emailDraftAttachment: {
      keyword: keyword.emailDraft?.attachmentDocName ?? null,
      llm: llm.emailDraft?.attachmentDocName ?? null,
      agreed: (keyword.emailDraft?.attachmentDocName ?? null) === (llm.emailDraft?.attachmentDocName ?? null),
    },
    factFindDelta: {
      keyword: Object.keys(keyword.factFindUpdates ?? {}).length,
      llm: Object.keys(llm.factFindUpdates ?? {}).length,
    },
  };
}

export default router;
