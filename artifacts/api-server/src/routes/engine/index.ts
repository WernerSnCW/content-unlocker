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
  saveEngineRun,
  ENGINE_VERSION,
  ENGINE_SPEC,
  ENGINE_UPDATED,
  SIGNAL_REGISTRY,
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

export default router;
