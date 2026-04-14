// C1. detectPersona
import { PERSONA_CONFIG } from "../config";
import type { Confidence, Persona } from "../types";
import { countOccurrences, lower } from "../util";

export interface PersonaResult {
  persona: Persona;
  confidence: Confidence;
  evidence: string;
}

interface Score {
  id: Persona;
  weight: number;
  matched: string[];
}

export function detectPersona(transcript: string, currentPersona: Persona): PersonaResult {
  const text = lower(transcript);

  const scores: Score[] = PERSONA_CONFIG.personas.map((p) => {
    let weight = 0;
    const matched: string[] = [];
    for (const pat of p.patterns) {
      const occurrences = countOccurrences(text, pat.pattern);
      if (occurrences > 0) {
        weight += pat.weight * occurrences;
        matched.push(pat.pattern);
      }
    }
    return { id: p.id, weight, matched };
  });

  scores.sort((a, b) => b.weight - a.weight);
  const top = scores[0];
  const second = scores[1];

  // Hysteresis: if an existing persona is set and no new persona crosses the
  // threshold, keep the existing one. Prevents single-call noise from resetting.
  if (!top || top.weight < PERSONA_CONFIG.threshold) {
    if (currentPersona !== "undetermined") {
      return { persona: currentPersona, confidence: "low", evidence: "no new persona above threshold — kept existing" };
    }
    return { persona: "undetermined", confidence: "low", evidence: "" };
  }
  if (second && top.weight === second.weight) {
    if (currentPersona !== "undetermined") {
      return { persona: currentPersona, confidence: "low", evidence: "tie detected — kept existing" };
    }
    return { persona: "undetermined", confidence: "low", evidence: "tie detected" };
  }

  // Hysteresis: only override an existing persona if the margin is decisive
  if (currentPersona !== "undetermined" && currentPersona !== top.id) {
    const currentScore = scores.find((s) => s.id === currentPersona)?.weight ?? 0;
    if (top.weight - currentScore < 4) {
      return {
        persona: currentPersona,
        confidence: "low",
        evidence: `kept existing — new persona margin < 4 (${top.id}:${top.weight} vs ${currentPersona}:${currentScore})`,
      };
    }
  }

  const margin = top.weight - (second?.weight ?? 0);
  const confidence: Confidence = margin >= 6 ? "high" : margin >= 3 ? "medium" : "low";

  return {
    persona: top.id,
    confidence,
    evidence: top.matched.join(", "),
  };
}
