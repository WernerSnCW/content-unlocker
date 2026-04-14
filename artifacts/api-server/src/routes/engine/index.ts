// Inspection endpoints for the V2 intelligence engine.
// Read-only; used by Phase 4 UI and for manual verification.
import { Router, type IRouter } from "express";
import { db, engineRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getEngineRuns,
  getEngineSignals,
  getEngineTransitions,
  getInvestorState,
  ENGINE_VERSION,
  ENGINE_SPEC,
  ENGINE_UPDATED,
  SIGNAL_REGISTRY,
} from "../../engine/v2";

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

export default router;
