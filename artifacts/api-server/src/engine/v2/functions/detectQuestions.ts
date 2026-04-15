// C11. detectQuestions (V3)
// Fuzzy-match diagnostic questions against the transcript. Returns every
// question in the registry with detected=true/false — app needs to know
// what wasn't asked as well as what was.
import { QUESTION_REGISTRY } from "../config";
import type { CallType, Confidence, Investor, QuestionDetection } from "../types";
import { lower } from "../util";

// Extract a few keywords from the question text we can look for. This is a
// lightweight heuristic — we're not trying to perfectly parse NLP.
function extractKeywords(text: string): string[] {
  const stop = new Set([
    "the", "a", "an", "is", "are", "you", "your", "do", "does", "did",
    "to", "of", "in", "on", "at", "for", "with", "and", "or", "but",
    "this", "that", "these", "those", "it", "its", "i", "we", "they",
    "be", "been", "being", "have", "has", "had", "as", "what", "how",
    "why", "can", "could", "would", "should", "will", "any", "about",
    "else", "who",
  ]);
  return lower(text)
    .replace(/[?.,!:;()[\]"/'""]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w));
}

// Does the transcript mention at least ceil(N/2) of the question's keywords?
function matchesQuestion(transcript: string, questionText: string): { matched: boolean; quality: "exact" | "paraphrase" | "partial" } {
  const t = lower(transcript);
  const exactHit = t.includes(lower(questionText.replace(/\?$/, "").trim()));
  if (exactHit) return { matched: true, quality: "exact" };

  const kws = extractKeywords(questionText);
  if (kws.length === 0) return { matched: false, quality: "partial" };
  const hits = kws.filter((k) => t.includes(k)).length;
  const needed = Math.ceil(kws.length / 2);
  if (hits >= needed) return { matched: true, quality: "paraphrase" };
  if (hits > 0) return { matched: true, quality: "partial" };
  return { matched: false, quality: "partial" };
}

// Find an investor response to a question by looking at text that follows the
// question keywords. Returns a 200-char window after the best hit, or the last
// 200 chars of the transcript as a fallback.
function findResponseContext(transcript: string, questionText: string): string {
  const t = lower(transcript);
  const qLower = lower(questionText);
  const idx = t.indexOf(qLower);
  if (idx >= 0) {
    return transcript.slice(idx + questionText.length, idx + questionText.length + 300);
  }
  // Fallback: look at keyword position
  const kws = extractKeywords(questionText);
  let best = -1;
  for (const kw of kws) {
    const i = t.indexOf(kw);
    if (i > best) best = i;
  }
  if (best === -1) return "";
  return transcript.slice(best, best + 300);
}

// Map a response snippet to a state using the question's responseMap.
function inferState(
  response: string,
  responseMap: Record<string, { state?: string; outcome?: string; note?: string }> | undefined,
): { state: string | null; matchedKey: string | null } {
  if (!responseMap) return { state: null, matchedKey: null };
  const r = lower(response);
  for (const [key, val] of Object.entries(responseMap)) {
    if (r.includes(lower(key))) {
      return { state: val.state ?? val.outcome ?? null, matchedKey: key };
    }
  }
  return { state: null, matchedKey: null };
}

export function detectQuestions(transcript: string, callType: CallType, investor?: Investor): QuestionDetection[] {
  const callNum = callType === "cold_call" ? 1 : callType === "demo" ? 2 : 3;
  const out: QuestionDetection[] = [];

  for (const q of QUESTION_REGISTRY) {
    if (q.call !== callNum) continue;

    // Q12 — narrative detection, no question text. Look for scarcity cues.
    if (q.qNum === 12 && q.text === null) {
      const t = lower(transcript);
      const narrativeHits = ["scarce", "ifa can't", "outside regulated", "nobody shows me"];
      const matched = narrativeHits.some((h) => t.includes(h));
      out.push({
        questionNumber: 12,
        detected: matched,
        signalTarget: "C2",
        investorResponse: null,
        inferredState: matched ? "amber" : null,
        confidence: matched ? "medium" : "low",
      });
      continue;
    }

    // Q13 — persona-specific variant
    if (q.qNum === 13 && q.variants) {
      const persona = investor?.persona;
      if (!persona || persona === "undetermined") {
        out.push({
          questionNumber: 13,
          detected: false,
          signalTarget: null,
          investorResponse: null,
          inferredState: null,
          confidence: "low",
        });
        continue;
      }
      const variant = q.variants[persona as string];
      if (!variant) {
        out.push({
          questionNumber: 13,
          detected: false,
          signalTarget: null,
          investorResponse: null,
          inferredState: null,
          confidence: "low",
        });
        continue;
      }
      const m = matchesQuestion(transcript, variant.text);
      const response = m.matched ? findResponseContext(transcript, variant.text) : null;
      const confidence: Confidence = m.quality === "exact" ? "high" : m.quality === "paraphrase" ? "medium" : "low";
      out.push({
        questionNumber: 13,
        detected: m.matched,
        signalTarget: variant.signal,
        investorResponse: response,
        inferredState: null,
        confidence,
      });
      continue;
    }

    if (!q.text) continue;
    const m = matchesQuestion(transcript, q.text);

    if (!m.matched) {
      out.push({
        questionNumber: q.qNum,
        detected: false,
        signalTarget: q.signal,
        investorResponse: null,
        inferredState: null,
        confidence: "low",
      });
      continue;
    }

    const response = findResponseContext(transcript, q.text);
    const { state } = inferState(response, q.responseMap as Record<string, { state?: string; outcome?: string }> | undefined);
    const confidence: Confidence = m.quality === "exact" && state
      ? "high"
      : m.quality === "paraphrase" && state ? "medium" : "low";

    out.push({
      questionNumber: q.qNum,
      detected: true,
      signalTarget: q.signal,
      investorResponse: response ? response.slice(0, 200) : null,
      inferredState: state,
      confidence,
    });
  }

  return out;
}
