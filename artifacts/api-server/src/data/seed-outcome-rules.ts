// Phase 7.1a — NBA rule seed. Phase 7.1b — multi-action.
//
// One-to-one translation of engine/v2/functions/determineNextAction.ts
// branches into rows. Evaluated in ascending priority order, first
// match wins. Priority gaps of 10 leave room to insert between.
//
// Phase 7.1b: each rule's `actions` is an ordered list. First action
// becomes the primary NBA (identical to what the legacy cascade
// produces — parity check enforces this). Additional actions flow to
// engine output.secondaryActions.
//
// Every rule also sets `set_next_call_type` as a secondary action so
// the next transcription webhook for the same contact classifies
// correctly without relying on duration heuristic. This is the fix
// for "demo got cut short — next call should still be demo" and
// similar operator corrections.
//
// The legacy single-action columns (action_type, owner, timing,
// detail, uses_content) are NOT populated in new rows. They remain in
// the schema as nullable for backward-compat — loader falls back to
// them when `actions` is null on legacy rows.

import { db, engineOutcomeRulesTable } from "@workspace/db";
import type { InsertEngineOutcomeRule, OutcomeRuleAction } from "@workspace/db";

/**
 * Helper: build a "set next call type" action used as a secondary.
 * `timing` is informational — this action is consumed by the webhook
 * after run persistence, not actioned by an operator.
 */
function setNextCall(type: "cold_call" | "demo" | "opportunity" | "none", owner: "agent" | "tom" | "system" = "system"): OutcomeRuleAction {
  return {
    action_type: "set_next_call_type",
    owner,
    timing: "immediate",
    detail: `Next call type: ${type}`,
    uses_content: false,
    next_call_type: type,
  };
}

export const OUTCOME_RULES_SEED: InsertEngineOutcomeRule[] = [
  // ---- opportunity ----
  {
    id: "opp_all_s_green",
    priority: 10,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
      { lvalue: "signal.S2.state", op: "===", rvalue: "green" },
      { lvalue: "signal.S3.state", op: "===", rvalue: "green" },
      { lvalue: "signal.S4.state", op: "===", rvalue: "green" },
      { lvalue: "signal.S5.state", op: "===", rvalue: "green" },
      { lvalue: "signal.S6.state", op: "===", rvalue: "green" },
    ],
    actions: [
      {
        action_type: "reserve_stock",
        owner: "tom",
        timing: "immediate",
        detail: "Committed — reserve + send Pack 1/Pack 2 + initiate SeedLegals",
        uses_content: false,
      },
      setNextCall("none", "tom"),  // terminal — deal done
    ],
  },
  {
    id: "opp_s5_amber",
    priority: 20,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
      { lvalue: "signal.S5.state", op: "===", rvalue: "amber" },
    ],
    actions: [
      {
        action_type: "schedule_adviser_call",
        owner: "tom",
        timing: "24_48_hours",
        detail: "Adviser loop — send Pack 2 + schedule three-way",
        uses_content: false,
      },
      setNextCall("opportunity", "tom"),  // next call still a closing call
    ],
  },
  {
    id: "opp_s2_red",
    priority: 30,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
      { lvalue: "signal.S2.state", op: "===", rvalue: "red" },
    ],
    actions: [
      {
        action_type: "close_deal",
        owner: "system",
        timing: "immediate",
        detail: "No to investing — close as lost, check Book 2 eligibility",
        uses_content: false,
      },
      setNextCall("none"),  // terminal — deal lost
    ],
  },
  {
    id: "opp_fallback",
    priority: 40,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
    ],
    actions: [
      {
        action_type: "schedule_call",
        owner: "tom",
        timing: "scheduled",
        detail: "Needs time — set specific follow-up date, send remaining content",
        uses_content: true,
      },
      setNextCall("opportunity", "tom"),  // still on closing path
    ],
  },

  // ---- demo ----
  {
    id: "demo_pack1_eligible",
    priority: 50,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
      { lvalue: "gate.pack1", op: "===", rvalue: "eligible" },
    ],
    actions: [
      {
        action_type: "send_content",
        owner: "tom",
        timing: "24_48_hours",
        detail: "Pack 1 + schedule Call 3",
        uses_content: true,
      },
      setNextCall("opportunity", "tom"),  // Pack 1 eligible → go to Call 3
    ],
  },
  {
    id: "demo_has_content",
    priority: 60,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
      { lvalue: "content", op: "!==", rvalue: null },
    ],
    actions: [
      {
        action_type: "send_content",
        owner: "tom",
        timing: "24_48_hours",
        // Legacy cascade uses just the docName here (no "Send " prefix).
        detail: "{docName}",
        uses_content: true,
      },
      setNextCall("opportunity", "tom"),  // demo landed, still try Call 3
    ],
  },
  {
    id: "demo_low_score",
    priority: 70,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
      { lvalue: "investor.demoScore", op: "<", rvalue: 50 },
    ],
    actions: [
      {
        action_type: "escalate_to_tom",
        owner: "tom",
        timing: "immediate",
        detail: "Low demo score — review before next action",
        uses_content: false,
      },
      setNextCall("demo", "tom"),  // demo didn't land — redo it
    ],
  },
  {
    id: "demo_fallback",
    priority: 80,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
    ],
    actions: [
      {
        action_type: "move_to_nurture",
        owner: "system",
        timing: "scheduled",
        detail: "Demo completed — no gated content yet",
        uses_content: false,
      },
      setNextCall("demo"),  // demo wasn't enough — continue demo track
    ],
  },

  // ---- cold_call ----
  {
    id: "cold_has_content",
    priority: 90,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "cold_call" },
      { lvalue: "content", op: "!==", rvalue: null },
    ],
    actions: [
      {
        action_type: "send_content",
        owner: "agent",
        timing: "24_48_hours",
        // Legacy cascade prepends "Send " here (parity with the cold-call
        // branch of determineNextAction). {docName} substitutes at eval time.
        detail: "Send {docName}",
        uses_content: true,
      },
      setNextCall("demo", "agent"),  // booked demo → next is a demo
    ],
  },
  {
    id: "cold_fallback",
    priority: 100,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "cold_call" },
    ],
    actions: [
      {
        action_type: "move_to_nurture",
        owner: "system",
        timing: "scheduled",
        detail: "No content matched — nurture track",
        uses_content: false,
      },
      setNextCall("cold_call"),  // no demo booked — try cold again later
    ],
  },
];

/**
 * Idempotent upsert. Writes each rule by id; existing rows are
 * overwritten to match the seed exactly. Safe to run repeatedly.
 *
 * Phase 7.1b — clears the legacy single-action columns on each write
 * so upgrading from the 7.1a schema (where only those columns were
 * populated) to 7.1b (actions list only) produces clean rows.
 * Returns a count of rows written.
 */
export async function seedOutcomeRules(): Promise<{ written: number; ids: string[] }> {
  const ids: string[] = [];
  for (const rule of OUTCOME_RULES_SEED) {
    await db
      .insert(engineOutcomeRulesTable)
      .values({
        ...rule,
        // Clear legacy columns on insert so new rows are clean.
        action_type: null,
        owner: null,
        timing: null,
        detail: null,
        uses_content: false,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: engineOutcomeRulesTable.id,
        set: {
          priority: rule.priority,
          enabled: rule.enabled,
          when_clauses: rule.when_clauses,
          actions: rule.actions,
          // Clear legacy columns so upgraded rows don't leave stale data.
          action_type: null,
          owner: null,
          timing: null,
          detail: null,
          uses_content: false,
          updated_at: new Date(),
        },
      });
    ids.push(rule.id);
  }
  return { written: ids.length, ids };
}

// NOTE: This module intentionally has no CLI entrypoint. The
// `import.meta.url === file://${process.argv[1]}` pattern matches
// when esbuild bundles everything into a single dist/index.mjs and
// kills the server at startup (process.exit(0) fires after the seed
// runs, before express binds). Invoke seedOutcomeRules() from
// dataManager.seedDatabase() and from the admin endpoint instead.
