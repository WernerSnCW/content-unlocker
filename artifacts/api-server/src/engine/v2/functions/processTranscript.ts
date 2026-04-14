// C10. processTranscript — main orchestrator
import { ENGINE_VERSION } from "../version";
import type {
  CallType,
  EngineFlag,
  EngineOutput,
  FactFind,
  Investor,
  SignalMap,
  SignalState,
} from "../types";
import { nowIso } from "../util";
import { detectPersona } from "./detectPersona";
import { detectHotButton } from "./detectHotButton";
import { analyseSignals } from "./analyseSignals";
import { evaluateGates } from "./evaluateGates";
import { routeContent } from "./routeContent";
import { generateCoverNote } from "./generateCoverNote";
import { determineNextAction } from "./determineNextAction";
import { buildCrmNote } from "./buildCrmNote";
import { validateCompliance } from "./validateCompliance";

// Apply signal updates to a SignalMap, returning a new map.
function applySignalUpdates(
  current: SignalMap,
  updates: { code: string; newState: string; evidence: string; confidence: "high" | "medium" | "low" }[],
): SignalMap {
  const now = nowIso();
  const next: SignalMap = { ...current };
  for (const u of updates) {
    const existing: SignalState = next[u.code] ?? {
      code: u.code,
      state: "grey",
      surfacedBy: "conversation",
      notes: "",
      updatedAt: now,
      confidence: u.confidence,
    };
    next[u.code] = {
      ...existing,
      state: u.newState as SignalState["state"],
      surfacedBy: "conversation",
      notes: u.evidence,
      updatedAt: now,
      confidence: u.confidence,
    };
  }
  return next;
}

export function processTranscript(
  transcript: string,
  callType: CallType,
  investor: Investor,
): EngineOutput {
  const flags: EngineFlag[] = [];

  // 1. Persona
  const personaAssessment = detectPersona(transcript, investor.persona);
  const investorAfterPersona: Investor = { ...investor, persona: personaAssessment.persona };

  // 2. Hot button
  const hotButton = detectHotButton(transcript);

  // 3. Signals
  const signalUpdates = analyseSignals(transcript, investor.signals, investorAfterPersona);

  // 4. Apply updates
  const updatedSignals = applySignalUpdates(investor.signals, signalUpdates);
  const enrichedInvestor: Investor = {
    ...investorAfterPersona,
    signals: updatedSignals,
    hotButton: hotButton.primary ?? investor.hotButton,
  };

  // 5. Gates
  const gateResult = evaluateGates(updatedSignals, enrichedInvestor);
  if (gateResult.c4Compliance === "blocked") {
    flags.push({ type: "gate_blocked", message: "C4 compliance gate blocked — only doc 140 permitted" });
  }

  // 6. Content
  const content = routeContent(updatedSignals, enrichedInvestor, gateResult);

  // 7. Cover note
  let coverNoteText: string | null = null;
  if (content) {
    const note = generateCoverNote(enrichedInvestor, content);
    coverNoteText = note.text;
    if (note.flag) flags.push(note.flag);
    if (coverNoteText) (content as any).coverNoteDraft = coverNoteText;
  }

  // 8. Next action
  const nextAction = determineNextAction(callType, updatedSignals, enrichedInvestor, content, gateResult);

  // 9. CRM note
  const factFindUpdates: Partial<FactFind> = {}; // Phase 1: extraction comes in Phase 2 LLM pass
  const crmNote = buildCrmNote(callType, signalUpdates, factFindUpdates, enrichedInvestor, content, nextAction, gateResult);

  // 10. Compliance (on outbound text only)
  if (coverNoteText) {
    const compliance = validateCompliance(coverNoteText);
    for (const v of compliance.violations) {
      flags.push({
        type: "compliance_warning",
        message: `[${v.ruleId}] found "${v.found}" — correct: ${v.correct}`,
      });
    }
  }

  return {
    engineVersion: ENGINE_VERSION,
    processedAt: nowIso(),
    callType,
    investorId: investor.investorId,
    signalUpdates,
    factFindUpdates,
    personaAssessment,
    hotButton,
    demoScore: investor.demoScore,
    gateStatus: gateResult,
    nextBestAction: nextAction,
    pipelineTransition: null, // set by caller based on disposition
    crmNote,
    flags,
  };
}
