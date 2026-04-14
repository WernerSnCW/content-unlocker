// C8. buildCrmNote
import type {
  CallType,
  ContentRecommendation,
  FactFind,
  GateResult,
  Investor,
  NextAction,
  SignalUpdate,
} from "../types";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function summariseUpdates(updates: SignalUpdate[]): string {
  if (updates.length === 0) return "(no state changes)";
  return updates.map((u) => `${u.code}: ${u.previousState}→${u.newState}`).join(", ");
}

export function buildCrmNote(
  callType: CallType,
  signalUpdates: SignalUpdate[],
  factFindUpdates: Partial<FactFind>,
  investor: Investor,
  content: ContentRecommendation | null,
  nextAction: NextAction,
  gateResult: GateResult,
): string {
  const date = today();
  const contentLine = content ? `${content.docName} (doc ${content.docId})` : "—";

  if (callType === "cold_call") {
    const qt = investor.signals.QT?.state ?? "unknown";
    const ql = investor.signals.QL?.state ?? "unknown";
    const hotButton = investor.hotButton ?? "—";
    const phrase = factFindUpdates.exactPhrases?.[0] ?? investor.factFind.exactPhrases?.[0] ?? "—";
    return [
      `Cold call ${date}:`,
      `Persona: ${investor.persona}`,
      `QT: ${qt}`,
      `QL: ${ql}`,
      `Hot button: ${hotButton}`,
      `Key phrase: ${phrase}`,
      `Signals updated: ${summariseUpdates(signalUpdates)}`,
      `Next action: ${nextAction.detail}`,
    ].join("\n");
  }

  if (callType === "demo") {
    const score = investor.demoScore ?? "pending";
    const problem = factFindUpdates.practicalProblem ?? investor.factFind.practicalProblem ?? "—";
    const pressure = factFindUpdates.currentPressure ?? investor.factFind.currentPressure ?? "—";
    const outcome = factFindUpdates.desiredOutcome ?? investor.factFind.desiredOutcome ?? "—";
    const pack1 = gateResult.pack1 === "eligible"
      ? "eligible"
      : `blocked (${gateResult.pack1BlockedReasons.join(", ")})`;
    return [
      `Demo + Fact Find ${date}:`,
      `Score: ${score}/100`,
      `Persona: ${investor.persona}`,
      `Beliefs updated: ${summariseUpdates(signalUpdates)}`,
      `Fact find:`,
      `  Problem: ${problem}`,
      `  Pressure: ${pressure}`,
      `  Outcome: ${outcome}`,
      `Content sent: ${contentLine}`,
      `Pack 1 gate: ${pack1}`,
    ].join("\n");
  }

  // opportunity
  const sResolved = signalUpdates.filter((u) => u.code.startsWith("S") && u.newState === "green");
  return [
    `Call 3 ${date}:`,
    `Opened with: ${investor.factFind.practicalProblem ?? "—"}`,
    `Questions addressed: ${investor.factFind.questionsForCall3 ?? "—"}`,
    `Beliefs resolved: ${sResolved.map((u) => u.code).join(", ") || "—"}`,
    `Outcome path: ${nextAction.actionType}`,
    `Next action: ${nextAction.detail}`,
  ].join("\n");
}
