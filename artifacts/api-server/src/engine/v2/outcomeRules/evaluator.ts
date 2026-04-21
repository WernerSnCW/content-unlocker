// Phase 7.1a — Outcome rule evaluator.
//
// STUB for session 1. Session 2 fills in the clause-evaluation logic
// and the compare endpoint that diffs this against the legacy
// determineNextAction() output. For now, this module exports:
//
//   - the `evaluateOutcomeRules` entry point (throws NotImplemented
//     if called — guarded by the ENGINE_OUTCOME_RULES flag upstream)
//   - the type of the result it will return, which matches the shape
//     of `NextAction` so session-2 wiring is a drop-in replacement
//
// The feature flag `ENGINE_OUTCOME_RULES=true` is NOT checked here —
// that's the caller's job (in processTranscript). This function is
// the new path; if called, it must produce a NextAction. The stub
// throws so an accidental flag flip in session 1 fails loud, not
// silently.

import type { CallType, ContentRecommendation, GateResult, Investor, NextAction, SignalMap } from "../types";
import type { LoadedOutcomeRule } from "./loader";

export class NotImplementedError extends Error {
  constructor() {
    super("evaluateOutcomeRules: clause evaluation ships in Phase 7.1a session 2");
    this.name = "NotImplementedError";
  }
}

export class RuleCoverageError extends Error {
  constructor(callType: CallType) {
    super(`No outcome rule matched for callType=${callType}. Add a fallback rule.`);
    this.name = "RuleCoverageError";
  }
}

export interface EvaluationContext {
  callType: CallType;
  signals: SignalMap;
  investor: Investor;
  content: ContentRecommendation | null;
  gateResult: GateResult;
}

export interface EvaluationTrace {
  matchedRuleId: string | null;
  steps: Array<{
    ruleId: string;
    matched: boolean;
    failedClause?: { lvalue: string; op: string; rvalue: unknown; actual: unknown };
  }>;
}

/**
 * Evaluate loaded rules against a context. First match wins.
 *
 * Session 1 — stub. Throws `NotImplementedError`.
 * Session 2 — implements clause evaluation (see DSL in the schema
 * file's top comment). Returns {action, trace}.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function evaluateOutcomeRules(
  _rules: LoadedOutcomeRule[],
  _ctx: EvaluationContext,
): { action: NextAction; trace: EvaluationTrace } {
  throw new NotImplementedError();
}

/**
 * True when the NBA rule engine should be used instead of the legacy
 * hardcoded cascade. Default OFF — the rules must be seeded first and
 * the evaluator must ship (session 2) before this is safe to flip on.
 */
export function outcomeRulesFlagEnabled(): boolean {
  return process.env.ENGINE_OUTCOME_RULES === "true";
}
