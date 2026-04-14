// C3. analyseSignals
import { SIGNAL_REGISTRY } from "../config";
import type { AnyState, Confidence, Investor, SignalMap, SignalUpdate } from "../types";
import { countOccurrences, isSignalActive, lower } from "../util";

// Valid transitions. Everything else is invalid.
const TRANSITIONS_REQUIRING_HIGH_CONFIDENCE = new Set(["green->amber", "red->amber"]);
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
const QUAL_STATES = new Set(["confirmed", "not_confirmed", "unknown"]);

interface Scored {
  net: number;
  positive: number;
  negative: number;
  matched: string[];
}

function scoreSignal(
  transcript: string,
  detection: readonly { pattern: string; weight: number }[] | undefined,
  negative: readonly { pattern: string; weight: number }[] | undefined,
): Scored {
  const text = lower(transcript);
  let positive = 0;
  let negativeSum = 0;
  const matched: string[] = [];
  for (const p of detection ?? []) {
    const occ = countOccurrences(text, p.pattern);
    if (occ > 0) {
      positive += p.weight * occ;
      matched.push(p.pattern);
    }
  }
  for (const p of negative ?? []) {
    const occ = countOccurrences(text, p.pattern);
    if (occ > 0) {
      negativeSum += p.weight * occ; // weights are already negative
      matched.push(`!${p.pattern}`);
    }
  }
  return { net: positive + negativeSum, positive, negative: negativeSum, matched };
}

function confidenceFromScore(score: Scored): Confidence {
  const absNet = Math.abs(score.net);
  if (absNet >= 8) return "high";
  if (absNet >= 4) return "medium";
  return "low";
}

function proposeBeliefState(net: number): AnyState | null {
  if (net >= 8) return "green";
  if (net >= 4) return "amber";
  if (net <= -4) return "red";
  return null;
}

function proposeQualState(net: number): AnyState | null {
  if (net >= 4) return "confirmed";
  if (net <= -4) return "not_confirmed";
  return null;
}

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

export function analyseSignals(
  transcript: string,
  currentSignals: SignalMap,
  investor: Investor,
): SignalUpdate[] {
  const sorted = [...SIGNAL_REGISTRY].sort((a, b) => a.priority - b.priority);
  const updates: SignalUpdate[] = [];

  for (const def of sorted) {
    if (!isSignalActive(def.activation, currentSignals, investor)) continue;

    const scored = scoreSignal(transcript, def.detectionPatterns, def.negativePatterns);

    const isQual = def.category === "qualification";
    const proposed = isQual ? proposeQualState(scored.net) : proposeBeliefState(scored.net);
    if (!proposed) continue;

    const prev = currentSignals[def.code]?.state ?? (isQual ? "unknown" : "grey");
    const confidence = confidenceFromScore(scored);

    if (!isTransitionValid(prev as AnyState, proposed, confidence)) continue;
    if (prev === proposed) continue;

    updates.push({
      code: def.code,
      previousState: String(prev),
      newState: String(proposed),
      evidence: scored.matched.join(", "),
      confidence,
    });
  }

  return updates;
}
