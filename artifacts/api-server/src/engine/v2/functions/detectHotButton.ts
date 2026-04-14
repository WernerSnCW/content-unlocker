// C2. detectHotButton
import { PERSONA_CONFIG } from "../config";
import type { HotButton } from "../types";
import { countOccurrences, lower } from "../util";

export interface HotButtonResult {
  primary: HotButton | null;
  evidence: string;
}

export function detectHotButton(transcript: string): HotButtonResult {
  const text = lower(transcript);

  let best: { id: HotButton; count: number; matched: string[] } | null = null;

  for (const hb of PERSONA_CONFIG.hotButtons) {
    let count = 0;
    const matched: string[] = [];
    for (const p of hb.patterns) {
      const c = countOccurrences(text, p);
      if (c > 0) {
        count += c;
        matched.push(p);
      }
    }
    if (count > (best?.count ?? 0)) {
      best = { id: hb.id, count, matched };
    }
  }

  if (!best || best.count === 0) return { primary: null, evidence: "" };
  return { primary: best.id, evidence: best.matched.join(", ") };
}
