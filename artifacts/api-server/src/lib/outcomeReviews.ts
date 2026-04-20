// Outcome review lifecycle — Phase 4.7.
//
// An outcome_review is created when a call.tagged → engine-run pipeline
// completes AND the applied tag's mapping has creates_outcome_review=true.
// The review represents "this outcome needs operator action" and is owned
// by a user who walks it through approve/edit/reject decisions for each
// engine-produced action (NBA, Email, Post-Close items, Adviser Loop
// items, Book 2 routing).
//
// Handoff model:
//   - Always explicit. Manual "Hand to closer" button from the drawer.
//   - Not driven by tag.maps_to_closer (that flag affects contact-state
//     closer routing on the contact row — NOT review ownership).
//   - Bounce-back permitted: closer can hand a review back to the
//     original agent with a note.
//   - Admin can reclaim or reassign any review.
//
// This file owns the low-level ops. HTTP endpoints live in routes/
// outcome-reviews.

import {
  db,
  outcomeReviewsTable,
  outcomeActionDecisionsTable,
  contactsTable,
  callListMembershipsTable,
  callListConfigsTable,
  agentsTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { getTagMapping } from "../routes/aircall";

/**
 * Resolve the user who should own a new outcome_review for the given
 * contact. Tries in order:
 *   1. The agent assigned to the contact's MOST-RECENT call-list membership
 *      (active OR closed), via their linked user_id.
 *   2. null — unclaimed. The dedicated Outcomes page will surface these
 *      as "Unclaimed" so an admin or closer can reclaim them.
 *
 * Why most-recent rather than active-only: applyTaggedOutcomeTx (the
 * call.tagged transaction) marks the active membership as removed for
 * tags with state-changing side-effects (meeting-booked, no-interest,
 * DNC, etc). By the time transcription.created fires and we run the
 * engine + create the review, there's no "active" membership left — but
 * the AGENT WHO JUST PROCESSED THE CALL owned the most recently closed
 * one. That's the right person to route the review to.
 *
 * (Future: persist aircall_user_id on lead_conversations at call.ended
 * time and resolve from that directly. Cleaner but a larger change. See
 * Phase 4.5a notes.)
 */
async function resolveDefaultOwnerUserId(contactId: string): Promise<string | null> {
  const [row] = await db
    .select({ user_id: agentsTable.user_id })
    .from(callListMembershipsTable)
    .innerJoin(callListConfigsTable, eq(callListConfigsTable.id, callListMembershipsTable.call_list_id))
    .innerJoin(agentsTable, eq(agentsTable.id, callListConfigsTable.assigned_agent_id))
    .where(eq(callListMembershipsTable.contact_id, contactId))
    // Most recent first — either the still-active membership or the one
    // we just closed a moment ago during the call.tagged transaction.
    .orderBy(desc(callListMembershipsTable.added_at))
    .limit(1);
  return row?.user_id ?? null;
}

/**
 * Create an outcome_review if the applied tag's mapping asks for it.
 * Called from runEngineForConversation after a successful saveEngineRun.
 *
 * Returns a short status string for the webhook log, or undefined when
 * no review was created (either because no tag is configured with
 * creates_outcome_review=true, or because the contact/tag setup doesn't
 * warrant one).
 */
export async function maybeCreateOutcomeReview(input: {
  engineRunId: string;
  contactId: string;
  convTags: string[];
}): Promise<string | undefined> {
  if (!input.convTags || input.convTags.length === 0) {
    // Engine ran without a tag having been applied yet (race: transcription
    // before tagged). The engine_run exists; the review can be created
    // retroactively by a re-tag if the configured tag says so, but not
    // eagerly here.
    return undefined;
  }

  const tagMapping = await getTagMapping();
  // Check if the applied tag permits outcome_review creation. Default
  // semantics: undefined or true → create; only explicit false blocks.
  // This matches runs_engine's default-true semantic, which is critical
  // for back-compat: tag_mappings saved before 4.7 don't have this
  // field, and we want them to keep producing reviews until an admin
  // explicitly opts a tag out via Settings.
  //
  // Also: if ANY matched tag explicitly opts out, we skip (explicit
  // opt-out wins over implicit opt-in from another tag in the same
  // multi-tag call).
  let anyMappedTag = false;
  let anyExplicitOptOut = false;
  for (const tagName of input.convTags) {
    const m = tagMapping.find(x => x.aircall_tag === tagName);
    if (!m) continue;
    anyMappedTag = true;
    if (m.creates_outcome_review === false) {
      anyExplicitOptOut = true;
      break;
    }
  }
  // No matched tag at all = nothing to key off; skip. (Unmapped tags
  // are recorded via record_only path elsewhere and wouldn't warrant
  // operator review.)
  if (!anyMappedTag) return undefined;
  if (anyExplicitOptOut) return undefined;

  const ownerUserId = await resolveDefaultOwnerUserId(input.contactId);

  try {
    const [created] = await db.insert(outcomeReviewsTable).values({
      engine_run_id: input.engineRunId,
      contact_id: input.contactId,
      current_owner_user_id: ownerUserId,
      status: "awaiting_review",
    }).returning({ id: outcomeReviewsTable.id });
    return `review ${created.id} created (owner=${ownerUserId ?? "unclaimed"})`;
  } catch (err: any) {
    // Non-fatal — the engine_run still exists; a re-run or manual admin
    // action can create the review later.
    console.error("[OutcomeReview] create failed:", err?.message);
    return `review create failed: ${err?.message}`;
  }
}

/**
 * Hand an outcome_review to another user (typically agent → closer) with
 * an optional context note. Sets handed_from, hand_note, handed_at.
 * Status becomes handed_to_closer (or handed_to_agent if going back).
 */
export async function handOffReview(input: {
  reviewId: string;
  toUserId: string;
  fromUserId: string;
  note: string | null;
  statusTarget: "handed_to_closer" | "handed_to_agent";
}): Promise<void> {
  await db.update(outcomeReviewsTable)
    .set({
      current_owner_user_id: input.toUserId,
      handed_from_user_id: input.fromUserId,
      hand_note: input.note,
      handed_at: new Date(),
      status: input.statusTarget,
      updated_at: new Date(),
    })
    .where(eq(outcomeReviewsTable.id, input.reviewId));
}

/**
 * Admin-only — forcibly reclaim a review to a chosen user (or to null
 * for "unclaimed"). Clears handoff metadata because this bypasses the
 * normal handoff flow.
 */
export async function reclaimReview(input: {
  reviewId: string;
  toUserId: string | null;
  byUserId: string;
}): Promise<void> {
  await db.update(outcomeReviewsTable)
    .set({
      current_owner_user_id: input.toUserId,
      handed_from_user_id: null,
      hand_note: null,
      handed_at: null,
      status: input.toUserId ? "under_review" : "awaiting_review",
      updated_at: new Date(),
    })
    .where(eq(outcomeReviewsTable.id, input.reviewId));
  // byUserId reserved for audit logging when we add an events table later.
  void input.byUserId;
}

/**
 * Record a per-item decision (approve / edit / reject / defer).
 * Upserts on (outcome_review_id, action_type, action_key) so re-submitting
 * overwrites rather than accumulating duplicates.
 */
export async function recordActionDecision(input: {
  reviewId: string;
  engineRunId: string;
  actionType: "nba" | "email" | "post_close_item" | "adviser_loop_item" | "book2";
  actionKey: string;
  decision: "approved" | "edited" | "rejected" | "deferred";
  editedPayload: any | null;
  decidedByUserId: string;
}): Promise<void> {
  await db.insert(outcomeActionDecisionsTable)
    .values({
      outcome_review_id: input.reviewId,
      engine_run_id: input.engineRunId,
      action_type: input.actionType,
      action_key: input.actionKey,
      decision: input.decision,
      edited_payload: input.editedPayload,
      decided_by_user_id: input.decidedByUserId,
    })
    .onConflictDoUpdate({
      target: [
        outcomeActionDecisionsTable.outcome_review_id,
        outcomeActionDecisionsTable.action_type,
        outcomeActionDecisionsTable.action_key,
      ],
      set: {
        decision: input.decision,
        edited_payload: input.editedPayload,
        decided_by_user_id: input.decidedByUserId,
        decided_at: new Date(),
      },
    });
  // Reflect owner activity on the review's updated_at
  await db.update(outcomeReviewsTable)
    .set({
      updated_at: new Date(),
      // First decision flips status from awaiting_review → under_review.
      // Subsequent edits leave the status alone.
      status: "under_review",
    })
    .where(and(
      eq(outcomeReviewsTable.id, input.reviewId),
      eq(outcomeReviewsTable.status, "awaiting_review"),
    ));
}

/**
 * Mark a review as fully actioned — operator has approved/rejected all
 * relevant items and wants it off their active queue.
 */
export async function markActioned(input: {
  reviewId: string;
  resolutionNotes: string | null;
}): Promise<void> {
  await db.update(outcomeReviewsTable)
    .set({
      status: "actioned",
      resolved_at: new Date(),
      resolution_notes: input.resolutionNotes,
      updated_at: new Date(),
    })
    .where(eq(outcomeReviewsTable.id, input.reviewId));
}
