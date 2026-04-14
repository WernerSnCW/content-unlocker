// C4. evaluateGates
import { GATES, SIGNAL_REGISTRY } from "../config";
import type { GateResult, Investor, SignalMap } from "../types";

export function evaluateGates(signals: SignalMap, investor: Investor): GateResult {
  const result: GateResult = {
    c4Compliance: "open",
    pack1: "blocked",
    pack1BlockedReasons: [],
    activeRoute: "pending",
    blockedSignals: [],
  };

  const sorted = [...GATES].sort((a, b) => a.evaluationOrder - b.evaluationOrder);

  for (const gate of sorted) {
    switch (gate.id) {
      case "C4_COMPLIANCE": {
        const open = gate.condition ? gate.condition(signals, investor) : false;
        result.c4Compliance = open ? "open" : "blocked";
        if (!open) {
          // Block everything below the compliance-gate priority (C4 priority is 6)
          const c4Priority = SIGNAL_REGISTRY.find((s) => s.code === "C4")?.priority ?? 6;
          for (const s of SIGNAL_REGISTRY) {
            if (s.priority > c4Priority) result.blockedSignals.push(s.code);
          }
        }
        break;
      }
      case "PERSONA": {
        const ok = gate.condition ? gate.condition(signals, investor) : false;
        if (!ok) {
          for (const s of SIGNAL_REGISTRY) {
            if (s.category === "problem" && !result.blockedSignals.includes(s.code)) {
              result.blockedSignals.push(s.code);
            }
          }
        }
        break;
      }
      case "S_CLUSTER": {
        const ok = gate.condition ? gate.condition(signals, investor) : false;
        if (!ok) {
          for (const code of ["S2", "S3", "S4", "S5", "S6"]) {
            if (!result.blockedSignals.includes(code)) result.blockedSignals.push(code);
          }
        }
        break;
      }
      case "S2_ROUTING": {
        if (gate.routeMap) {
          const s2 = signals.S2?.state;
          const mapped = s2 ? gate.routeMap[s2 as keyof typeof gate.routeMap] : undefined;
          if (mapped) {
            result.activeRoute = mapped as GateResult["activeRoute"];
          }
        }
        break;
      }
      case "PACK1": {
        const reasons: string[] = [];
        if (signals.S2?.state !== "green") reasons.push("S2 not green");
        if (signals.C4?.state !== "green") reasons.push("C4 not green");
        if ((investor.demoScore ?? 0) < 70) reasons.push(`demo_score < 70 (${investor.demoScore ?? 0})`);
        if (reasons.length === 0) {
          result.pack1 = "eligible";
        } else {
          result.pack1 = "blocked";
          result.pack1BlockedReasons = reasons;
        }
        break;
      }
    }
  }

  return result;
}
