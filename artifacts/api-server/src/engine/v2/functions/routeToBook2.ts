// C15. routeToBook2 (V3)
// Decides whether to route a contact to the Book 2 (subscriber) pipeline.
// Respects exclusion rules (founding_investor permanently blocks Book 2).
import { BOOK2_ROUTING } from "../config";
import type { Book2RoutingResult, Investor, SignalMap } from "../types";

interface ContactTagsLike {
  tags?: readonly string[];
}

export function routeToBook2(
  signals: SignalMap,
  investor: Investor & ContactTagsLike,
): Book2RoutingResult | null {
  // Exclusion: founding_investor never routes to Book 2
  if (investor.tags?.includes("founding_investor")) {
    return null;
  }

  const reasons: string[] = [];
  if (signals.S2?.state === "red") reasons.push("Firm no to investing");
  if (signals.QT?.state === "not_confirmed") reasons.push("Tax rate not suitable for EIS");

  // Platform-only intent surfaced via fact-find phrases
  const platformOnly = investor.factFind?.exactPhrases?.some((p) =>
    /(just|only) the platform|platform(-| )only/i.test(p)
  );
  if (platformOnly) reasons.push("Platform interest only");

  if (reasons.length === 0) return null;

  return {
    triggered: true,
    reason: reasons.join("; "),
    actions: BOOK2_ROUTING.entryActions.map((a) => a.action),
  };
}
