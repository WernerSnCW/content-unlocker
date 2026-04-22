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

/**
 * Render a rule's detail string, substituting `{docName}` with the
 * resolved content's docName. Empty detail falls back to docName (when
 * uses_content and content is present) or the action_type so the NBA
 * reason field is never empty.
 */
function renderDetail(
  detail: string,
  docName: string | null,
  usesContent: boolean,
  actionType: string,
): string {
  if (!detail || detail.length === 0) {
    return usesContent && docName ? docName : actionType;
  }
  if (detail.includes("{docName}")) {
    return detail.replace(/\{docName\}/g, docName ?? "");
  }
  return detail;
}

function toNumber(v: unknown): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return NaN;
}

/**
 * Phase 7.1b — One secondary action flowing out of a multi-action rule.
 * Shaped similarly to NextAction but carries the action_type in its
 * raw string form rather than the ActionType union, because the
 * secondary-action layer handles arbitrary verbs (set_next_call_type,
 * schedule_adviser_call as a side-effect, etc.) that don't have to
 * parse against the NextAction.actionType enum.
 */
export interface SecondaryAction {
  actionType: string;
  detail: string;
  owner: Owner;
  timing: string;
  contentToSend: ContentRecommendation | null;
  nextCallType?: "cold_call" | "demo" | "opportunity" | "none" | null;
}

/**
 * Evaluate loaded rules against a context. First match wins.
 *
 * Rules are assumed to be pre-sorted by priority ascending (loader
 * does this). The evaluator does NOT re-sort — it trusts the caller.
 *
 * Phase 7.1b — rules have `actions: OutcomeRuleAction[]` (non-empty).
 * The first action becomes the primary NextAction; the rest are
 * returned as `secondary` for engine output.secondaryActions.
 *
 * Returns trace describing which rule matched (and for the rules that
 * didn't, the first clause that failed). The trace is compact — only
 * the failing clause, not every clause — because the admin UI's
 * trace view only surfaces the reason a rule skipped.
 *
 * Throws RuleCoverageError if no rule matches. A well-formed rule set
 * must always contain a fallback (priority 40/80/100 in the seed).
 */
export function evaluateOutcomeRules(
  rules: LoadedOutcomeRule[],
  ctx: EvaluationContext,
): { action: NextAction; secondary: SecondaryAction[]; trace: EvaluationTrace } {
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

      if (!rule.actions || rule.actions.length === 0) {
        throw new Error(`Rule ${rule.id} matched but has no actions — loader should have synthesized one from legacy columns`);
      }

      // First action → primary NBA. Rest → secondary actions.
      const [first, ...rest] = rule.actions;
      const primary = first!;
      const primaryDetail = renderDetail(primary.detail, ctx.content?.docName ?? null, primary.uses_content, primary.action_type);

      const action: NextAction = {
        actionType: primary.action_type as NextAction["actionType"],
        detail: primaryDetail,
        owner: primary.owner as Owner,
        timing: primary.timing,
        contentToSend: primary.uses_content ? ctx.content : null,
      };

      const secondary: SecondaryAction[] = rest.map((a) => ({
        actionType: a.action_type,
        detail: renderDetail(a.detail, ctx.content?.docName ?? null, a.uses_content, a.action_type),
        owner: a.owner as Owner,
        timing: a.timing,
        contentToSend: a.uses_content ? ctx.content : null,
        nextCallType: a.next_call_type ?? null,
      }));

      // If the PRIMARY action is set_next_call_type (unusual but allowed),
      // surface its hint on a synthetic secondary entry so downstream
      // consumers (webhook persistence) don't have to dig into both.
      if (primary.action_type === "set_next_call_type" && primary.next_call_type) {
        secondary.unshift({
          actionType: "set_next_call_type",
          detail: primary.detail,
          owner: primary.owner as Owner,
          timing: primary.timing,
          contentToSend: null,
          nextCallType: primary.next_call_type,
        });
      }

      return { action, secondary, trace };
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
