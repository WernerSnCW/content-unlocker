// Public entry point for the intelligence engine.
// Consumers: api-server transcript pipeline, admin fixture runner.

export * from "./types";
export { ENGINE_VERSION, ENGINE_SPEC, ENGINE_UPDATED } from "./version";
export { detectPersona } from "./functions/detectPersona";
export { detectHotButton } from "./functions/detectHotButton";
export { analyseSignals } from "./functions/analyseSignals";
export { evaluateGates } from "./functions/evaluateGates";
export { routeContent } from "./functions/routeContent";
export { generateCoverNote } from "./functions/generateCoverNote";
export { determineNextAction } from "./functions/determineNextAction";
export { buildCrmNote } from "./functions/buildCrmNote";
export { validateCompliance } from "./functions/validateCompliance";
export { processTranscript } from "./functions/processTranscript";

// Phase 2: persistence
export {
  loadInvestor,
  saveEngineRun,
  getEngineSignals,
  getEngineTransitions,
  getEngineRuns,
  getInvestorState,
} from "./persistence";

// Config re-exports for diagnostics / admin tooling
export {
  SIGNAL_REGISTRY,
  GATES,
  ROUTING_MAP,
  PERSONA_CONFIG,
  CALL_TYPES,
  TIMING_RULES,
  COMPLIANCE,
  RED_SIGNAL_ACTIONS,
  PIPELINE_STAGES,
} from "./config";
