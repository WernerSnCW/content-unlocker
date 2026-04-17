// Phase 4.9 — Layer 1 LLM extraction result schema.
//
// This is the exact structure the extraction LLM call returns. Layer 2
// (gates, routing, NBA, etc.) consumes this and produces the engine output.
// Directive reference: docs/402b_DIRECTIVE_Engine_Implementation_V1.md
//
// CRITICAL INVARIANT: this shape is the boundary between the non-
// deterministic extraction layer and the deterministic rules layer. If
// something doesn't fit cleanly here, either the extraction prompt needs
// to return more, or Layer 2 needs to compute it from the base data —
// but Layer 2 NEVER calls the LLM.

import type { Confidence, Persona, HotButton } from "../types";

// States the LLM may propose per signal. Mirrors engine types.
type ProposedSignalState =
  | "green" | "amber" | "grey" | "red" | "n_a"
  | "confirmed" | "not_confirmed" | "unknown";

export interface LLMExtractionResult {
  // ------------------------------------------------------------------
  // Persona assessment
  // ------------------------------------------------------------------
  persona: {
    classification: Persona;            // "preserver" | "growth_seeker" | "legacy_builder" | "undetermined"
    confidence: Confidence;
    evidence: string;                   // the specific passage(s) that informed this — verbatim if possible
  };

  // ------------------------------------------------------------------
  // Hot button — the primary emotional driver surfaced on this call
  // ------------------------------------------------------------------
  hotButton: {
    primary: HotButton | null;          // "family" | "freedom" | "legacy" | "relief" | "significance" | null
    evidence: string;
  };

  // ------------------------------------------------------------------
  // Signal assessments — one entry per signal code the LLM touched.
  // Absence of a key means "current state preserved". Directive: "Absence
  // of discussion = leave as current state (do not change to grey — grey
  // means never surfaced)."
  // ------------------------------------------------------------------
  signals: {
    [code: string]: {
      proposedState: ProposedSignalState;
      confidence: Confidence;
      evidence: string;                 // the specific transcript passage that supports this
      stateChanged: boolean;            // did this change from the investor's current state?
    };
  };

  // ------------------------------------------------------------------
  // Fact-find extractions — investor's own words, never paraphrased.
  // exactPhrases is the HIGHEST-VALUE field — powers every follow-up email.
  // ------------------------------------------------------------------
  factFind: {
    practicalProblem: string | null;        // their actual words describing the situation they want help with
    currentPressure: string | null;         // what's making them act now
    personalAngle: string | null;           // family / legacy / life context that matters to them
    desiredOutcome: string | null;          // what success looks like in their words
    exactPhrases: string[];                 // verbatim distinctive phrases — anchor material for follow-up
    portfolioShape: string | null;          // their description of their current portfolio composition
    annualTaxLiability: number | null;      // GBP number if stated; null otherwise
    decisionStakeholders: string | null;    // who else decides — "sole", "with wife", "via IFA", etc.
    decisionStyle: "quick" | "thorough" | "unknown";
    questionsForCall3: string | null;       // things they said they'd want to revisit or think about
  };

  // ------------------------------------------------------------------
  // Question detection — one entry per question in QUESTION_REGISTRY the
  // LLM evaluated. For questions the LLM has no view on, omit the entry.
  // ------------------------------------------------------------------
  questionsDetected: Array<{
    questionNumber: number;
    detected: boolean;
    investorResponse: string | null;        // their actual words if the question was asked and answered
    inferredSignalState: string | null;     // which state the response implies, if any
  }>;

  // ------------------------------------------------------------------
  // Demo score — 0..100. Only populated for demo calls; null otherwise.
  // Inferred from engagement, follow-up questions, objections etc.
  // ------------------------------------------------------------------
  demoScore: number | null;
}

/**
 * Structural validator — checks that the LLM returned a shape we can
 * consume. Does not validate semantic correctness (state values per
 * signal's validStates, confidence levels, etc.) — that's Layer 2's job.
 * Returns null on success, human-readable error on failure.
 */
export function validateExtractionShape(x: unknown): string | null {
  if (!x || typeof x !== "object") return "not an object";
  const r = x as any;
  if (!r.persona || typeof r.persona !== "object") return "missing persona";
  if (typeof r.persona.classification !== "string") return "persona.classification not a string";
  if (typeof r.persona.confidence !== "string") return "persona.confidence not a string";

  if (!r.hotButton || typeof r.hotButton !== "object") return "missing hotButton";
  // hotButton.primary may be null — no stricter check

  if (!r.signals || typeof r.signals !== "object" || Array.isArray(r.signals)) {
    return "signals must be an object keyed by code";
  }

  if (!r.factFind || typeof r.factFind !== "object") return "missing factFind";
  if (!Array.isArray(r.factFind.exactPhrases)) return "factFind.exactPhrases must be an array";

  if (!Array.isArray(r.questionsDetected)) return "questionsDetected must be an array";

  if (r.demoScore !== null && typeof r.demoScore !== "number") {
    return "demoScore must be number or null";
  }

  return null;
}
