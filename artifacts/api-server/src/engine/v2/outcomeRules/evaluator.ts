// Phase 7.1a session 2 — Outcome rule evaluator.
//
// Given a set of loaded rules and an evaluation context (call type,
// signals, investor, routed content, gate result), walks rules in
// ascending priority order and returns the first match.
//
// First-match-wins. All clauses within a rule are AND-ed. No OR, no
// nesting — if you need disjunction, split into two rules at different
// priorities.
//
// The evaluator is pure and synchronous. Rule loading is the caller's
// job (via loadOutcomeRules) so processTranscript stays sync and the
// legacy determineNextAction is a drop-in alternative.

import type {
  CallType,
  ContentRecommendation,
  GateResult,
  Investor,
  NextAction,
  Owner,
  SignalMap,
} from "../types";
import type { LoadedOutcomeRule } from "./loader";
import type { OutcomeRuleClause } from "@workspace/db";

export class NotImplementedError extends Error {
  constructor(msg?: string) {
    super(msg || "not implemented");
    this.name = "NotImplementedError";
  }
}

export class RuleCoverageError extends Error {
  constructor(callType: CallType) {
    super(`No outcome rule matched for callType=${callType}. Add a fallback rule.`);
    this.name = "RuleCoverageError";
  }
}

export class UnknownLvalueError extends Error {
  constructor(lvalue: string) {
    super(`Unknown lvalue in outcome rule clause: ${lvalue}`);
    this.name = "UnknownLvalueError";
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
    // When matched === false, the first clause that failed is captured.
    failedClause?: {
      lvalue: string;
      op: string;
      rvalue: unknown;
      actual: unknown;
    };
  }>;
}

/**
 * Resolve an lvalue string against the evaluation context. Returns the
 * extracted value (may be undefined if the path doesn't resolve, e.g.
 * a signal that hasn't been seen yet — treat as "absent" which won't
 * equal any concrete rvalue).
 *
 * Supported lvalues:
 *   - `callType`                  → ctx.callType
 *   - `signal.<CODE>.state`        → ctx.signals[CODE]?.state
 *   - `gate.<name>`                → (ctx.gateResult as any)[name]
 *                                    (e.g. gate.pack1 → "eligible" | "blocked")
 *   - `investor.<field>`           → (ctx.investor as any)[field]
 *                                    Commonly: demoScore, persona
 *   - `content`                    → ctx.content (the whole object, or null)
 */
function resolveLvalue(lvalue: string, ctx: EvaluationContext): unknown {
  if (lvalue === "callType") return ctx.callType;
  if (lvalue === "content") return ctx.content;

  if (lvalue.startsWith("signal.")) {
    // signal.<CODE>.state
    const parts = lvalue.split(".");
    if (parts.length === 3 && parts[2] === "state") {
      return ctx.signals[parts[1]!]?.state;
    }
    throw new UnknownLvalueError(lvalue);
  }

  if (lvalue.startsWith("gate.")) {
    const field = lvalue.slice("gate.".length);
    return (ctx.gateResult as unknown as Record<string, unknown>)[field];
  }

  if (lvalue.startsWith("investor.")) {
    const field = lvalue.slice("investor.".length);
    return (ctx.investor as unknown as Record<string, unknown>)[field];
  }

  throw new UnknownLvalueError(lvalue);
}

/**
 * Evaluate a single clause against the context.
 *
 * Strict equality/inequality for `===`/`!==`. Coercing equality for
 * `==`/`!=` matches JavaScript's loose rules. Numeric comparisons for
 * `<`/`<=`/`>`/`>=` coerce both sides to number; NaN comparisons are
 * always false per IEEE 754.
 *
 * `null` as rvalue with `!==` / `!=` is the idiomatic "has value" check.
 */
function evaluateClause(
  clause: OutcomeRuleClause,
  ctx: EvaluationContext,
): { passed: boolean; actual: unknown } {
  const actual = resolveLvalue(clause.lvalue, ctx);
  const rvalue = clause.rvalue;

  let passed: boolean;
  switch (clause.op) {
    case "===":
      passed = actual === rvalue;
      break;
    case "!==":
      passed = actual !== rvalue;
      break;
    // eslint-disable-next-line eqeqeq
    case "==":
      // eslint-disable-next-line eqeqeq
      passed = actual == rvalue;
      break;
    // eslint-disable-next-line eqeqeq
    case "!=":
      // eslint-disable-next-line eqeqeq
      passed = actual != rvalue;
      break;
    case "<":
      passed = toNumber(actual) < toNumber(rvalue);
      break;
    case "<=":
      passed = toNumber(actual) <= toNumber(rvalue);
      break;
    case ">":
      passed = toNumber(actual) > toNumber(rvalue);
      break;
    case ">=":
      passed = toNumber(actual) >= toNumber(rvalue);
      break;
    default:
      throw new Error(`Unknown op in outcome rule clause: ${String(clause.op)}`);
  }

  return { passed, actual };
}

function toNumber(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return NaN;
}

/**
 * Evaluate loaded rules against a context. First match wins.
 *
 * Rules are assumed to be pre-sorted by priority ascending (loader
 * does this). The evaluator does NOT re-sort — it trusts the caller.
 *
 * Returns both the resulting NextAction and a trace describing which
 * rule matched (and, for the rules that didn't, the first clause that
 * failed). The trace is compact — only the failing clause, not every
 * clause — because the admin UI's trace view only surfaces the reason
 * a rule skipped, not the full evaluation.
 *
 * Throws RuleCoverageError if no rule matches. A well-formed rule set
 * must always contain a fallback (priority 40/80/100 in the seed).
 */
export function evaluateOutcomeRules(
  rules: LoadedOutcomeRule[],
  ctx: EvaluationContext,
): { action: NextAction; trace: EvaluationTrace } {
  const trace: EvaluationTrace = { matchedRuleId: null, steps: [] };

  for (const rule of rules) {
    let matched = true;
    let failed:
      | { lvalue: string; op: string; rvalue: unknown; actual: unknown }
      | undefined;

    for (const clause of rule.when_clauses) {
      const { passed, actual } = evaluateClause(clause, ctx);
      if (!passed) {
        matched = false;
        failed = {
          lvalue: clause.lvalue,
          op: clause.op,
          rvalue: clause.rvalue,
          actual,
        };
        break;
      }
    }

    trace.steps.push({
      ruleId: rule.id,
      matched,
      ...(failed ? { failedClause: failed } : {}),
    });

    if (matched) {
      trace.matchedRuleId = rule.id;

      // Build NextAction. If uses_content is true, pass the routed
      // content through; otherwise null. If detail is empty, fall back
      // to content.docName so the legacy behaviour for "send_content"
      // rules without explicit detail (demo_has_content, cold_has_content)
      // still produces a meaningful operator-facing message.
      const detail =
        rule.detail && rule.detail.length > 0
          ? rule.detail
          : rule.uses_content && ctx.content
          ? ctx.content.docName
          : rule.action_type;

      const action: NextAction = {
        actionType: rule.action_type as NextAction["actionType"],
        detail,
        owner: rule.owner as Owner,
        timing: rule.timing,
        contentToSend: rule.uses_content ? ctx.content : null,
      };

      return { action, trace };
    }
  }

  throw new RuleCoverageError(ctx.callType);
}

/**
 * True when the NBA rule engine should be used instead of the legacy
 * hardcoded cascade. Default OFF.
 */
export function outcomeRulesFlagEnabled(): boolean {
  return process.env.ENGINE_OUTCOME_RULES === "true";
}
