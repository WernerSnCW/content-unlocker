// Phase 4.9 — Adapters that turn LLMExtractionResult into the exact
// shapes Layer 2 expects. The rules engine is unchanged; these adapters
// replace the keyword-based Layer 1 functions (detectPersona, detectHot-
// Button, analyseSignals, detectQuestions) as the source of those values.
//
// Why adapters instead of changing function signatures: Layer 2 funcs
// (evaluateGates, routeContent, determineNextAction, ...) consume
// { updates, persona, hotButton, questionDetections, factFindUpdates }
// — keeping those types stable isolates the switch from Layer 2.

import type {
  AnyState,
  Confidence,
  FactFind,
  HotButton,
  Investor,
  Persona,
  SignalMap,
  SignalUpdate,
} from "../types";
import type { PersonaResult } from "../functions/detectPersona";
import type { HotButtonResult } from "../functions/detectHotButton";
import type { QuestionDetection } from "../types";
import type { LLMExtractionResult } from "./extractionSchema";

const QUAL_STATES = new Set(["confirmed", "not_confirmed", "unknown"]);
const VALID_BELIEF_TRANSITIONS = new Set([
  "grey->amber",
  "grey->green",
  "grey->red",
  "grey->n_a",
  "amber->green",
  "amber->red",
  "green->amber",
  "red->amber",
]);
const TRANSITIONS_REQUIRING_HIGH_CONFIDENCE = new Set(["green->amber", "red->amber"]);

function isTransitionValid(from: AnyState, to: AnyState, confidence: Confidence): boolean {
  if (from === to) return false;
  if (QUAL_STATES.has(from) || QUAL_STATES.has(to)) {
    // Qualification signals transition freely between confirmed/not_confirmed/unknown
    return QUAL_STATES.has(from) && QUAL_STATES.has(to);
  }
  const key = `${from}->${to}`;
  if (!VALID_BELIEF_TRANSITIONS.has(key)) return false;
  if (TRANSITIONS_REQUIRING_HIGH_CONFIDENCE.has(key) && confidence !== "high") return false;
  return true;
}

export function extractionToPersona(r: LLMExtractionResult): PersonaResult {
  return {
    persona: r.persona.classification as Persona,
    confidence: r.persona.confidence,
    evidence: r.persona.evidence || "",
  };
}

export function extractionToHotButton(r: LLMExtractionResult): HotButtonResult {
  return {
    primary: r.hotButton.primary as HotButton | null,
    evidence: r.hotButton.evidence || "",
  };
}

/**
 * Turn the LLM's proposed signal map into validated SignalUpdate[]
 * records. Drops invalid transitions (same as the keyword-era
 * analyseSignals did via isTransitionValid) so Layer 2 never sees an
 * illegal state change.
 *
 * NOTE: LLMExtractionResult.signals only contains signals the LLM formed
 * a view on (per prompt directive). Omitted signals preserve their current
 * state — exactly what analyseSignals's "absence = no update" contract
 * already does. So iterating the extraction map directly is the right
 * shape.
 */
export function extractionToSignalUpdates(
  r: LLMExtractionResult,
  currentSignals: SignalMap,
): SignalUpdate[] {
  const updates: SignalUpdate[] = [];
  for (const [code, proposal] of Object.entries(r.signals)) {
    const prev = currentSignals[code]?.state;
    const isQual = QUAL_STATES.has(proposal.proposedState);
    const effectivePrev: AnyState = prev ?? (isQual ? "unknown" : "grey") as AnyState;
    const proposedState = proposal.proposedState as AnyState;
    if (!isTransitionValid(effectivePrev, proposedState, proposal.confidence)) continue;
    if (effectivePrev === proposedState) continue;
    updates.push({
      code,
      previousState: String(effectivePrev),
      newState: String(proposedState),
      evidence: proposal.evidence || "",
      confidence: proposal.confidence,
    });
  }
  return updates;
}

/**
 * Convert LLM-detected questions into the shape Layer 2 consumes.
 * Fills in the registry's signal target so rendering can show the
 * signal each question targets. Preserves the call-number filter:
 * only questions relevant to this call type are returned.
 */
export function extractionToQuestionDetections(
  r: LLMExtractionResult,
  callType: "cold_call" | "demo" | "opportunity",
  // Registry lookup map so we can pull the signal target / gate role
  registryByNum: Map<number, { qNum: number; signal: string | null; call: 1 | 2 | 3; gateRole?: string }>,
): QuestionDetection[] {
  const callNum = callType === "cold_call" ? 1 : callType === "demo" ? 2 : 3;
  const out: QuestionDetection[] = [];
  const seen = new Set<number>();

  // Start with whatever the LLM reported.
  for (const q of r.questionsDetected) {
    const def = registryByNum.get(q.questionNumber);
    if (!def) continue;
    if (def.call !== callNum) continue;
    seen.add(q.questionNumber);
    out.push({
      questionNumber: q.questionNumber,
      detected: q.detected,
      signalTarget: def.signal,
      investorResponse: q.investorResponse,
      inferredState: q.inferredSignalState,
      confidence: "medium" as Confidence, // LLM doesn't return per-question confidence; medium is the reasonable default
    });
  }

  // Fill in anything the LLM didn't report as detected=false. Ensures the
  // rules engine and drawer always see a complete per-question list for
  // this call type — a missing entry is semantically different from
  // "not detected" for gate-role questions.
  for (const def of registryByNum.values()) {
    if (def.call !== callNum) continue;
    if (seen.has(def.qNum)) continue;
    out.push({
      questionNumber: def.qNum,
      detected: false,
      signalTarget: def.signal,
      investorResponse: null,
      inferredState: null,
      confidence: "low",
    });
  }

  return out;
}

/**
 * Fact-find extraction — NEW capability the keyword layer never produced.
 * The LLM returns the investor's own words for each field. This becomes
 * a Partial<FactFind> update the rules engine merges into investor state.
 *
 * Never clobbers existing non-null values with null from the LLM — the
 * LLM might omit a field that was captured on a prior call, and we
 * preserve that history.
 */
export function extractionToFactFindUpdates(
  r: LLMExtractionResult,
  currentFactFind: FactFind,
): Partial<FactFind> {
  const out: Partial<FactFind> = {};
  const f = r.factFind;

  const preserveNonNull = <K extends keyof FactFind>(key: K, newVal: FactFind[K] | null | undefined) => {
    if (newVal == null || newVal === "") return;
    out[key] = newVal as FactFind[K];
  };

  preserveNonNull("practicalProblem", f.practicalProblem);
  preserveNonNull("currentPressure", f.currentPressure);
  preserveNonNull("personalAngle", f.personalAngle);
  preserveNonNull("desiredOutcome", f.desiredOutcome);
  preserveNonNull("portfolioShape", f.portfolioShape);
  preserveNonNull("annualTaxLiability", f.annualTaxLiability);
  preserveNonNull("decisionStakeholders", f.decisionStakeholders);
  preserveNonNull("questionsForCall3", f.questionsForCall3);

  // decisionStyle: never downgrade to "unknown" if we already know.
  if (f.decisionStyle && f.decisionStyle !== "unknown") {
    out.decisionStyle = f.decisionStyle;
  } else if (!currentFactFind.decisionStyle || currentFactFind.decisionStyle === "unknown") {
    out.decisionStyle = f.decisionStyle;
  }

  // exactPhrases — accumulate rather than replace. Distinctive language
  // from earlier calls stays available for downstream use (emails, etc.).
  if (Array.isArray(f.exactPhrases) && f.exactPhrases.length > 0) {
    const existing = new Set((currentFactFind.exactPhrases || []).map(p => p.trim().toLowerCase()));
    const additions = f.exactPhrases.filter(p => p && !existing.has(p.trim().toLowerCase()));
    if (additions.length > 0) {
      out.exactPhrases = [...(currentFactFind.exactPhrases || []), ...additions];
    }
  }

  return out;
}

/**
 * Demo score — LLM returns 0..100 for demo calls. Rules engine uses it
 * for Pack 1 gate evaluation. Returns null for non-demo calls.
 */
export function extractionToDemoScore(r: LLMExtractionResult): number | null {
  if (typeof r.demoScore !== "number") return null;
  return Math.max(0, Math.min(100, Math.round(r.demoScore)));
}
