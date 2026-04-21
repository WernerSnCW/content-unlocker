// Phase 7.1a — NBA rule seed.
//
// One-to-one translation of engine/v2/functions/determineNextAction.ts
// branches into rows. Evaluated in ascending priority order, first
// match wins. Priority gaps of 10 leave room to insert between.
//
// When the feature flag ENGINE_OUTCOME_RULES is on, the evaluator
// walks these rules instead of the hardcoded cascade. With the flag
// off (default in session 1) the cascade runs as before — seeding
// the table is safe regardless of flag state.

import { db, engineOutcomeRulesTable } from "@workspace/db";
import type { InsertEngineOutcomeRule } from "@workspace/db";

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
    action_type: "reserve_stock",
    owner: "tom",
    timing: "immediate",
    detail: "Committed — reserve + send Pack 1/Pack 2 + initiate SeedLegals",
    uses_content: false,
  },
  {
    id: "opp_s5_amber",
    priority: 20,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
      { lvalue: "signal.S5.state", op: "===", rvalue: "amber" },
    ],
    action_type: "schedule_adviser_call",
    owner: "tom",
    timing: "24_48_hours",
    detail: "Adviser loop — send Pack 2 + schedule three-way",
    uses_content: false,
  },
  {
    id: "opp_s2_red",
    priority: 30,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
      { lvalue: "signal.S2.state", op: "===", rvalue: "red" },
    ],
    action_type: "close_deal",
    owner: "system",
    timing: "immediate",
    detail: "No to investing — close as lost, check Book 2 eligibility",
    uses_content: false,
  },
  {
    id: "opp_fallback",
    priority: 40,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "opportunity" },
    ],
    action_type: "schedule_call",
    owner: "tom",
    timing: "scheduled",
    detail: "Needs time — set specific follow-up date, send remaining content",
    uses_content: true,
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
    action_type: "send_content",
    owner: "tom",
    timing: "24_48_hours",
    detail: "Pack 1 + schedule Call 3",
    uses_content: true,
  },
  {
    id: "demo_has_content",
    priority: 60,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
      { lvalue: "content", op: "!==", rvalue: null },
    ],
    action_type: "send_content",
    owner: "tom",
    timing: "24_48_hours",
    detail: "", // filled at eval time with content.docName (handled by evaluator)
    uses_content: true,
  },
  {
    id: "demo_low_score",
    priority: 70,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
      { lvalue: "investor.demoScore", op: "<", rvalue: 50 },
    ],
    action_type: "escalate_to_tom",
    owner: "tom",
    timing: "immediate",
    detail: "Low demo score — review before next action",
    uses_content: false,
  },
  {
    id: "demo_fallback",
    priority: 80,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "demo" },
    ],
    action_type: "move_to_nurture",
    owner: "system",
    timing: "scheduled",
    detail: "Demo completed — no gated content yet",
    uses_content: false,
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
    action_type: "send_content",
    owner: "agent",
    timing: "24_48_hours",
    detail: "", // filled at eval time with content.docName
    uses_content: true,
  },
  {
    id: "cold_fallback",
    priority: 100,
    enabled: true,
    when_clauses: [
      { lvalue: "callType", op: "===", rvalue: "cold_call" },
    ],
    action_type: "move_to_nurture",
    owner: "system",
    timing: "scheduled",
    detail: "No content matched — nurture track",
    uses_content: false,
  },
];

/**
 * Idempotent upsert. Writes each rule by id; existing rows are
 * overwritten to match the seed exactly. Safe to run repeatedly.
 * Returns a count of rows written.
 */
export async function seedOutcomeRules(): Promise<{ written: number; ids: string[] }> {
  const ids: string[] = [];
  for (const rule of OUTCOME_RULES_SEED) {
    await db
      .insert(engineOutcomeRulesTable)
      .values({
        ...rule,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: engineOutcomeRulesTable.id,
        set: {
          priority: rule.priority,
          enabled: rule.enabled,
          when_clauses: rule.when_clauses,
          action_type: rule.action_type,
          owner: rule.owner,
          timing: rule.timing,
          detail: rule.detail,
          uses_content: rule.uses_content,
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
