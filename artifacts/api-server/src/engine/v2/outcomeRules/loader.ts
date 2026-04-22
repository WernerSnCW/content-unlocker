// Phase 7.1a — Outcome rules loader.
//
// Reads enabled rules from engine_outcome_rules, ordered by priority
// ascending. Cached in memory for 60s to avoid hitting the DB on every
// engine run; invalidated by invalidateOutcomeRulesCache() on writes
// (admin CRUD in Phase 7.1b).
//
// The evaluator calls loadOutcomeRules() before walking clauses. If the
// table is empty (or the feature flag is off, though that check lives
// at the call site), callers fall back to the legacy determineNextAction
// function — session 1 keeps the legacy path as the default.

import { db, engineOutcomeRulesTable } from "@workspace/db";
import type { EngineOutcomeRule, OutcomeRuleClause, OutcomeRuleAction } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

export interface LoadedOutcomeRule extends Omit<EngineOutcomeRule, "when_clauses" | "actions"> {
  when_clauses: OutcomeRuleClause[];
  // Phase 7.1b — multi-action list. First element is the primary NBA;
  // rest flow to engine output as secondary actions. When null on the
  // row (legacy rule), the loader synthesizes a single-element list
  // from the legacy action_type/owner/timing/detail/uses_content
  // columns so the evaluator only has to handle one shape.
  actions: OutcomeRuleAction[];
}

interface CacheEntry {
  rules: LoadedOutcomeRule[];
  loadedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

export async function loadOutcomeRules(): Promise<LoadedOutcomeRule[]> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.rules;
  }

  const rows = await db
    .select()
    .from(engineOutcomeRulesTable)
    .where(eq(engineOutcomeRulesTable.enabled, true))
    .orderBy(asc(engineOutcomeRulesTable.priority));

  // jsonb comes back as `unknown` from drizzle; assert to the shape
  // declared in the schema file. Bad shapes will surface when the
  // evaluator tries to read `clause.lvalue` — we deliberately don't
  // re-validate here to keep the hot path cheap.
  const rules: LoadedOutcomeRule[] = rows.map((r: EngineOutcomeRule) => {
    // Prefer the new multi-action list when present; fall back to the
    // legacy single-action columns so rules seeded before 7.1b keep
    // working until they're migrated.
    let actions: OutcomeRuleAction[];
    if (Array.isArray(r.actions) && r.actions.length > 0) {
      actions = r.actions as unknown as OutcomeRuleAction[];
    } else {
      actions = [{
        action_type: r.action_type ?? "no_action",
        owner: r.owner ?? "system",
        timing: r.timing ?? "scheduled",
        detail: r.detail ?? "",
        uses_content: r.uses_content ?? false,
      }];
    }

    return {
      ...r,
      when_clauses: (r.when_clauses as unknown) as OutcomeRuleClause[],
      actions,
    };
  });

  cache = { rules, loadedAt: now };
  return rules;
}

/**
 * Clears the in-memory cache. Call from CRUD endpoints after a write
 * so the next engine run picks up the change. Also called implicitly
 * if CACHE_TTL_MS elapses.
 */
export function invalidateOutcomeRulesCache(): void {
  cache = null;
}

/**
 * Test helper — returns whether the cache is currently populated.
 * Useful for asserting cache behaviour in tests without exposing the
 * cache object itself.
 */
export function isOutcomeRulesCacheWarm(): boolean {
  return cache !== null && Date.now() - cache.loadedAt < CACHE_TTL_MS;
}
