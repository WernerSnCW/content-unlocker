// C12. analyseDemoSegments (V3)
// Runs only for callType === "demo". Checks which segments were covered
// based on detected questions and signal updates. Flags the critical
// C4 gate violation: if C4 was amber/red after segment 2 but segment 5
// (founding round) still got covered.
import { DEMO_SEGMENTS } from "../config";
import type { CallType, DemoSegmentAnalysis, QuestionDetection, SignalUpdate } from "../types";

export interface DemoSegmentResult {
  segments: DemoSegmentAnalysis[];
  flags: { type: "critical_gate_violation"; message: string }[];
}

export function analyseDemoSegments(
  callType: CallType,
  questionsDetected: QuestionDetection[],
  signalUpdates: SignalUpdate[],
): DemoSegmentResult {
  if (callType !== "demo") {
    return { segments: [], flags: [] };
  }

  const flags: { type: "critical_gate_violation"; message: string }[] = [];
  const segments: DemoSegmentAnalysis[] = [];
  const detectedQs = new Set(questionsDetected.filter((q) => q.detected).map((q) => q.questionNumber));
  const updatedCodes = new Set(signalUpdates.map((u) => u.code));

  // Track C4 state after segment 2 for the critical-gate check
  let c4AfterSegment2: string | null = null;

  for (const seg of DEMO_SEGMENTS) {
    const questionHit = seg.questionsUsed.some((q) => detectedQs.has(q));
    const signalHit = seg.signalsSurfaced.some((code) => updatedCodes.has(code));
    const covered = questionHit || signalHit;

    const signalOutcomes: { code: string; state: string }[] = [];
    for (const code of seg.signalsSurfaced) {
      const update = signalUpdates.find((u) => u.code === code);
      if (update) signalOutcomes.push({ code, state: update.newState });
    }

    if (seg.segment === 2) {
      const c4Update = signalUpdates.find((u) => u.code === "C4");
      if (c4Update) c4AfterSegment2 = c4Update.newState;
    }

    // Segment 5 founding-round check
    if (seg.segment === 5 && covered && c4AfterSegment2 && c4AfterSegment2 !== "green") {
      flags.push({
        type: "critical_gate_violation",
        message: `C4 compliance gate was ${c4AfterSegment2} after segment 2 (EIS narrative) — founding round discussion (segment 5) should not have occurred. Route to doc 140 as follow-up.`,
      });
    }

    segments.push({
      segment: seg.segment,
      segmentName: seg.name,
      covered,
      signalOutcomes,
      skipped: !covered && seg.segment !== 6,
      skipReason: covered ? null : seg.segment === 6 ? null : "no questions asked or signals surfaced",
    });
  }

  return { segments, flags };
}
