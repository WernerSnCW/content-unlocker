import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { outcomeReviewsTable } from "./outcome-reviews";
import { engineRunsTable } from "./engine-runs";
import { usersTable } from "./users";

/**
 * Per-item operator decision on an engine-produced action.
 *
 * An engine_run produces several parallel "action objects" the operator can
 * act on independently — the NBA, the Email Draft, each Post-Close
 * checklist item, each Adviser Loop action, the Book 2 routing. Each one
 * gets its own decision row so we have full audit of which items were
 * approved, which were edited (with the edited payload), which were
 * rejected, and who decided what when.
 *
 * Relationship to outcome_reviews:
 *   - Every decision belongs to an outcome_review (which belongs to an
 *     engine_run).
 *   - Multiple decisions per review (one per actionable item).
 *   - Unique per (outcome_review_id, action_type, action_key) — idempotent
 *     resubmissions overwrite.
 *
 * Rendering notes (Phase 4.7 drawer):
 *   Items not yet decided → "Approve / Edit / Reject" buttons visible.
 *   Items decided → shows "✓ Approved by X at Y · [Undo]" (rejected: red,
 *   edited: amber with diff link).
 */
export const outcomeActionDecisionsTable = pgTable("outcome_action_decisions", {
  id: text("id").primaryKey().$defaultFn(() => `dec_${randomUUID().slice(0, 12)}`),
  outcome_review_id: text("outcome_review_id").notNull().references(() => outcomeReviewsTable.id),
  engine_run_id: text("engine_run_id").notNull().references(() => engineRunsTable.id),

  // What kind of engine action this decision targets.
  action_type: text("action_type").notNull(),
  //     "nba" | "email" | "post_close_item" | "adviser_loop_item" | "book2"

  // Uniquely identifies WHICH instance of the action type within the run.
  // For singleton types (nba, email, book2) this is a constant string like
  // "primary". For list types (post_close_item, adviser_loop_item) it's
  // something like "post_close:send_confirmation_email" or
  // "adviser_loop:pre_call:prepare_adviser_brief" — whatever the engine
  // emits as a stable identifier for that action.
  action_key: text("action_key").notNull(),

  decision: text("decision").notNull(),
  //     "approved" | "edited" | "rejected" | "deferred"

  // When decision = "edited", the final operator-approved shape of the
  // action (subject/body for email, action/owner/timing for items, etc.).
  // Engine's original is still in engine_runs.output — this is the overlay.
  edited_payload: jsonb("edited_payload"),

  decided_by_user_id: text("decided_by_user_id").notNull().references(() => usersTable.id),
  decided_at: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reviewIdx: index("outcome_action_decisions_review_idx").on(t.outcome_review_id),
  // Idempotency — one active decision per (review, action_type, action_key).
  // "Undo" clears the row; re-submitting overwrites via onConflict on upsert.
  uniquePerItem: uniqueIndex("outcome_action_decisions_unique_per_item")
    .on(t.outcome_review_id, t.action_type, t.action_key),
}));

export const insertOutcomeActionDecisionSchema = createInsertSchema(outcomeActionDecisionsTable)
  .omit({ id: true, decided_at: true });
export type InsertOutcomeActionDecision = z.infer<typeof insertOutcomeActionDecisionSchema>;
export type OutcomeActionDecision = typeof outcomeActionDecisionsTable.$inferSelect;
