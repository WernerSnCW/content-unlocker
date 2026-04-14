// C6. generateCoverNote
// Template-based for Phase 1; observation hierarchy per spec.
// LLM assist can be added later without changing the signature.
import type { ContentRecommendation, EngineFlag, Investor } from "../types";

export interface CoverNoteResult {
  text: string | null;
  flag: EngineFlag | null;
}

const DISCLAIMER = "Capital at risk. Not financial advice.";

export function generateCoverNote(
  investor: Investor,
  content: ContentRecommendation,
): CoverNoteResult {
  const ff = investor.factFind;

  // Level 1: exact phrase (highest value)
  const exact = ff.exactPhrases?.[0]?.trim() || null;
  // Level 2: their specific situation
  const problem = ff.practicalProblem?.trim() || null;
  const outcome = ff.desiredOutcome?.trim() || null;

  // Level 5: nothing to personalise with
  if (!exact && !problem && !outcome) {
    return {
      text: null,
      flag: {
        type: "missing_data",
        message: "No Level 1 or Level 2 observation available for cover note",
      },
    };
  }

  // Build the four-line body (plus disclaimer)
  const opening = exact
    ? `You mentioned: "${exact}".`
    : problem
      ? `On our last call you described: ${problem}.`
      : `You told me you're looking to: ${outcome}.`;

  const relevance = `This ${content.docName} speaks directly to that.`;

  const payoff = outcome
    ? `Inside, you'll see exactly how we address ${outcome.toLowerCase()}.`
    : `Inside, you'll see how this applies to your situation specifically.`;

  const cta = `Have a read and we'll discuss on our next call.`;

  const text = [opening, relevance, payoff, cta, DISCLAIMER].join("\n");

  return { text, flag: null };
}
