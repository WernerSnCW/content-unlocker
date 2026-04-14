// Shared helpers used by the function modules.
import type { SignalMap, Investor } from "./types";

export function lower(s: string): string {
  return (s || "").toLowerCase();
}

// Count occurrences of `pattern` (case-insensitive) in `text`.
export function countOccurrences(text: string, pattern: string): number {
  if (!pattern) return 0;
  const t = lower(text);
  const p = lower(pattern);
  let count = 0;
  let from = 0;
  while (true) {
    const idx = t.indexOf(p, from);
    if (idx === -1) break;
    count++;
    from = idx + p.length;
  }
  return count;
}

// Evaluate a signal activation string like "signals.S1 === 'green'" or "persona === 'growth_seeker'"
// Limited vocabulary to keep this safe and deterministic — no eval().
export function isSignalActive(
  activation: string,
  signals: SignalMap,
  investor: Investor,
): boolean {
  if (!activation || activation === "always") return true;

  // persona === '<persona>'
  const personaMatch = activation.match(/^persona\s*===\s*['"]([^'"]+)['"]$/);
  if (personaMatch) return investor.persona === personaMatch[1];

  // signals.<CODE> === '<state>'
  const signalMatch = activation.match(/^signals\.(\w+)\s*===\s*['"]([^'"]+)['"]$/);
  if (signalMatch) {
    const [, code, state] = signalMatch;
    return signals[code]?.state === state;
  }

  // Unknown expression — fail closed (inactive). Log once so we can add support.
  // eslint-disable-next-line no-console
  console.warn(`[engine/v2] Unsupported activation expression: ${activation}`);
  return false;
}

export function nowIso(): string {
  return new Date().toISOString();
}
