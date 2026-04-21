import { pgTable, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Phase 7.1a — NBA (Next Best Action) rule engine config.
//
// Replaces the hardcoded decision cascade in engine/v2/functions/
// determineNextAction.ts. Each row is one rule. The evaluator walks
// enabled rules in priority order (ascending) and returns the first
// match's `then` block. First-match-wins; no OR, no nesting.
//
// The legacy hardcoded function stays callable and is gated via the
// `ENGINE_OUTCOME_RULES` env flag. Default OFF in session 1 — no
// behaviour change. Flag flips ON once side-by-side comparison against
// 28 fixtures + real transcripts shows zero diffs.
//
// Conditions are stored as a structured JSON clause array, not a text
// DSL. The admin UI (session 3) renders them as DSL-looking text for
// readability but the storage is always JSON — no parser to trust.
//
//   when_clauses: [
//     { lvalue: "callType",          op: "===", rvalue: "opportunity" },
//     { lvalue: "signal.S2.state",   op: "===", rvalue: "green" },
//     { lvalue: "investor.demoScore", op: "<",  rvalue: 50 },
//   ]
//
// All clauses are AND-ed. Supported lvalues: callType, signal.<CODE>.state,
// gate.<name>, investor.<field>, content. Ops: ===, !==, ==, !=, >, >=,
// <, <=. Rvalues are string | number | null.
//
// action_type mirrors engine/v2/types.ts ActionType.
// owner mirrors Owner. timing mirrors NextAction.timing.
// uses_content === true means the evaluator copies `contentToSend`
// through from the upstream routeContent() result. false means
// contentToSend is null.
export const engineOutcomeRulesTable = pgTable("engine_outcome_rules", {
  // Stable slug, e.g. "opp_all_s_green". Used by admin UI and compare
  // endpoints for diffing. Editing a rule never changes its id.
  id: text("id").primaryKey(),

  // Lower number = evaluated first. Use gaps (10, 20, 30…) so rules
  // can be inserted between without renumbering everything.
  priority: integer("priority").notNull(),

  enabled: boolean("enabled").notNull().default(true),

  // Array of {lvalue, op, rvalue} clauses, AND-ed together. See shape
  // in the file-level comment above.
  when_clauses: jsonb("when_clauses").notNull(),

  // Outcome fields — one row per action.
  action_type:  text("action_type").notNull(),
  owner:        text("owner").notNull(),
  timing:       text("timing").notNull(),
  detail:       text("detail").notNull(),
  uses_content: boolean("uses_content").notNull().default(false),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Evaluator reads enabled rules by ascending priority; covering index
  // makes the common case a single index scan.
  priorityIdx: index("engine_outcome_rules_priority_idx").on(t.enabled, t.priority),
}));

export const insertEngineOutcomeRuleSchema = createInsertSchema(engineOutcomeRulesTable).omit({ created_at: true, updated_at: true });
export type InsertEngineOutcomeRule = z.infer<typeof insertEngineOutcomeRuleSchema>;
export type EngineOutcomeRule = typeof engineOutcomeRulesTable.$inferSelect;

// Machine-readable shape of a when-clause. Kept here so the evaluator
// and admin UI import from the same source of truth.
export interface OutcomeRuleClause {
  lvalue: string;                // e.g. "callType", "signal.S2.state", "gate.pack1"
  op: "===" | "!==" | "==" | "!=" | ">" | ">=" | "<" | "<=";
  rvalue: string | number | null;
}
