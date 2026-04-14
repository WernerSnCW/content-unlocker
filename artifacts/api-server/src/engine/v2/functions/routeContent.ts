// C5. routeContent
import { ROUTING_MAP } from "../config";
import type { ContentRecommendation, GateResult, Investor, SignalMap } from "../types";

export function routeContent(
  signals: SignalMap,
  investor: Investor,
  gateResult: GateResult,
): ContentRecommendation | null {
  // Compliance gate overrides everything
  if (gateResult.c4Compliance === "blocked") {
    return {
      docId: 140,
      docName: "Access Explainer",
      triggerSignal: "C4",
      coverNoteDraft: null,
    };
  }

  for (const route of ROUTING_MAP) {
    // Special synthetic signal: PACK1_GATE
    if (route.signal === "PACK1_GATE") {
      if (route.gateCondition === "PACK1" && gateResult.pack1 === "eligible") {
        return {
          docId: route.docId ?? 0,
          docName: route.docName,
          triggerSignal: "PACK1_GATE",
          coverNoteDraft: null,
        };
      }
      continue;
    }

    const state = signals[route.signal]?.state;
    if (!state) continue;
    if (!route.triggerStates.includes(state as string)) continue;
    if (gateResult.blockedSignals.includes(route.signal)) continue;
    if (route.personaFilter && investor.persona !== route.personaFilter) continue;

    // Persona variant override
    let docId = route.docId;
    let docName = route.docName;
    if (route.personaVariant && investor.persona !== "undetermined") {
      const variant = route.personaVariant[investor.persona];
      if (variant) {
        docId = variant.docId;
        docName = variant.docName;
      }
    }

    if (docId == null) continue; // variant said "no doc"

    return {
      docId,
      docName,
      triggerSignal: route.signal,
      coverNoteDraft: null,
    };
  }

  return null;
}
