import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";
import { engineRunsTable } from "./engine-runs";
import { usersTable } from "./users";

/**
 * State machine around a call's outcome that needs operator action.
 *
 * One row per `engine_run` IF (and only if) the applied tag is configured
 * with `creates_outcome_review=true` in the tag mapping. Created inside the
 * call.tagged transaction so the review appears alongside the contact/
 * membership state mutations atomically.
 *
 * Ownership model (Phase 4.7):
 *   - Review starts owned by the agent who made the call.
 *   - Agent can self-action (approve/edit/reject items via per-item decisions).
 *   - Agent can manually hand to a closer with an optional context note.
 *   - Closer can bounce back to the original agent.
 *   - Admin can reclaim or reassign anywhere.
 *   - `maps_to_closer` tag flag is INDEPENDENT — it affects contact-state
 *     closer routing, NOT outcome_review ownership. Handoff is always
 *     explicit and human-driven.
 *
 * Status ladder:
 *   awaiting_review   — just created, no one has claimed it
 *   under_review      — current owner is actively working it (claimed)
 *   handed_to_closer  — passed to a closer with a note
 *   handed_to_agent   — closer bounced back to the original agent
 *   actioned          — owner marked all relevant items done
 *   stale_escaped     — no movement for > N days; admin attention needed
 */
export const outcomeReviewsTable = pgTable("outcome_reviews", {
  id: text("id").primaryKey().$defaultFn(() => `rev_${randomUUID().slice(0, 12)}`),
  engine_run_id: text("engine_run_id").notNull().references(() => engineRunsTable.id),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),

  // Current owner — who is responsible for this review RIGHT NOW. Always a
  // user row (agents have user_id via SSO). Null only transiently during
  // a reassignment; in steady state this is set.
  current_owner_user_id: text("current_owner_user_id").references(() => usersTable.id),

  status: text("status").notNull().default("awaiting_review"),
  //     "awaiting_review" | "under_review" | "handed_to_closer" |
  //     "handed_to_agent" | "actioned" | "stale_escaped"

  // Handoff audit. When a review is handed, we capture the hand-from and the
  // note so the recipient sees the full context. These persist even after
  // further handoffs — readers show the LAST handoff's metadata.
  handed_from_user_id: text("handed_from_user_id").references(() => usersTable.id),
  hand_note: text("hand_note"),
  handed_at: timestamp("handed_at", { withTimezone: true }),

  claimed_at: timestamp("claimed_at", { withTimezone: true }),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  resolution_notes: text("resolution_notes"),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("outcome_reviews_owner_idx").on(t.current_owner_user_id, t.status),
  contactIdx: index("outcome_reviews_contact_idx").on(t.contact_id),
  runIdx: index("outcome_reviews_run_idx").on(t.engine_run_id),
  statusIdx: index("outcome_reviews_status_idx").on(t.status, t.updated_at),
}));

export const insertOutcomeReviewSchema = createInsertSchema(outcomeReviewsTable)
  .omit({ id: true, created_at: true, updated_at: true });
export type InsertOutcomeReview = z.infer<typeof insertOutcomeReviewSchema>;
export type OutcomeReview = typeof outcomeReviewsTable.$inferSelect;
