// HTTP surface for Phase 4.7 outcome reviews.
//
// Endpoints:
//   GET    /outcome-reviews/:id                — read one review + its decisions
//   POST   /outcome-reviews/:id/hand-off       — agent → closer (with note)
//                                                or closer → agent (bounce back)
//   POST   /outcome-reviews/:id/reclaim        — admin only; force reassign
//   POST   /outcome-reviews/:id/decisions      — upsert a per-item decision
//   POST   /outcome-reviews/:id/actioned       — mark the whole review done
//
// Phase 4.8 will add listing / filtering (mine / team / all, stale, etc.)
// — intentionally not here yet.

import { Router, type IRouter } from "express";
import { db, outcomeReviewsTable, outcomeActionDecisionsTable, usersTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth";
import {
  handOffReview,
  reclaimReview,
  recordActionDecision,
  markActioned,
} from "../../lib/outcomeReviews";

const router: IRouter = Router();

// Path-scoped middleware so it only fires on /outcome-reviews/* requests.
// Sub-router middleware without a path prefix leaks onto every request
// that passes through the chain (bit us twice before — see invariant #7).
router.use("/outcome-reviews", requireAuth);

// Helper — ensure the authed user has standing to mutate this review.
// Rules:
//   - owner (current_owner_user_id) can do anything operational
//     (decisions, hand-off, mark actioned)
//   - closer can hand back to original agent even if not current owner
//     (covers the "bounced back" case)
//   - admin can do anything
async function checkReviewAccess(
  reviewId: string,
  authedUserId: string,
  authedRole: "agent" | "closer" | "admin",
): Promise<{ ok: boolean; review: any | null; reason?: string }> {
  const [review] = await db.select().from(outcomeReviewsTable)
    .where(eq(outcomeReviewsTable.id, reviewId))
    .limit(1);
  if (!review) return { ok: false, review: null, reason: "review_not_found" };
  if (authedRole === "admin") return { ok: true, review };
  if (review.current_owner_user_id === authedUserId) return { ok: true, review };
  if (authedRole === "closer") return { ok: true, review };
  return { ok: false, review, reason: "not_owner_of_review" };
}

// GET /outcome-reviews/by-run/:runId — drawer lookup path.
// Returns the review (if one exists for this engine_run) + decisions +
// display-enriched owner/handed-from users. If no review exists for this
// run (e.g. the applied tag had creates_outcome_review=false), returns
// 204 with no body so the drawer can cleanly distinguish "no review" from
// "couldn't load".
router.get("/outcome-reviews/by-run/:runId", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const [review] = await db.select().from(outcomeReviewsTable)
      .where(eq(outcomeReviewsTable.engine_run_id, req.params.runId))
      .limit(1);
    if (!review) {
      res.status(204).end();
      return;
    }
    const check = await checkReviewAccess(review.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }
    const decisions = await db.select().from(outcomeActionDecisionsTable)
      .where(eq(outcomeActionDecisionsTable.outcome_review_id, review.id));

    let currentOwner: { id: string; name: string | null; email: string } | null = null;
    let handedFrom: { id: string; name: string | null; email: string } | null = null;
    if (review.current_owner_user_id) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, review.current_owner_user_id)).limit(1);
      if (u) currentOwner = u;
    }
    if (review.handed_from_user_id) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, review.handed_from_user_id)).limit(1);
      if (u) handedFrom = u;
    }

    res.json({ review, decisions, currentOwner, handedFrom });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed_to_load_review" });
  }
});

// GET /outcome-reviews/:id — read one review + its decisions
router.get("/outcome-reviews/:id", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const check = await checkReviewAccess(req.params.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }
    const decisions = await db.select().from(outcomeActionDecisionsTable)
      .where(eq(outcomeActionDecisionsTable.outcome_review_id, req.params.id));

    // Enrich owner / handed_from with display names for the drawer banner.
    let currentOwner: { id: string; name: string | null; email: string } | null = null;
    let handedFrom: { id: string; name: string | null; email: string } | null = null;
    if (check.review.current_owner_user_id) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, check.review.current_owner_user_id)).limit(1);
      if (u) currentOwner = u;
    }
    if (check.review.handed_from_user_id) {
      const [u] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.id, check.review.handed_from_user_id)).limit(1);
      if (u) handedFrom = u;
    }

    res.json({ review: check.review, decisions, currentOwner, handedFrom });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed_to_load_review" });
  }
});

// POST /outcome-reviews/:id/hand-off
// Body: { to_user_id: string, note?: string, direction: "to_closer" | "to_agent" }
router.post("/outcome-reviews/:id/hand-off", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const toUserId = typeof req.body?.to_user_id === "string" ? req.body.to_user_id : null;
    const note = typeof req.body?.note === "string" ? req.body.note.trim() || null : null;
    const direction = req.body?.direction === "to_agent" ? "to_agent" : "to_closer";
    if (!toUserId) { res.status(400).json({ error: "to_user_id_required" }); return; }

    const check = await checkReviewAccess(req.params.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }

    // If direction=to_closer, validate target user is a closer or admin.
    // If direction=to_agent, allow any user (bounce-back is liberal).
    if (direction === "to_closer") {
      const [target] = await db.select({ role: usersTable.role })
        .from(usersTable).where(eq(usersTable.id, toUserId)).limit(1);
      if (!target) { res.status(404).json({ error: "target_user_not_found" }); return; }
      if (target.role !== "closer" && target.role !== "admin") {
        res.status(400).json({ error: "target_not_closer", message: `Target user role is "${target.role}", expected closer or admin` });
        return;
      }
    }

    await handOffReview({
      reviewId: req.params.id,
      toUserId,
      fromUserId: authedUser.id,
      note,
      statusTarget: direction === "to_closer" ? "handed_to_closer" : "handed_to_agent",
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "hand_off_failed" });
  }
});

// POST /outcome-reviews/:id/reclaim  (admin only)
// Body: { to_user_id: string | null }
router.post("/outcome-reviews/:id/reclaim", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    if (authedUser.role !== "admin") {
      res.status(403).json({ error: "admin_required" });
      return;
    }
    const toUserId = typeof req.body?.to_user_id === "string" ? req.body.to_user_id : null;
    await reclaimReview({ reviewId: req.params.id, toUserId, byUserId: authedUser.id });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "reclaim_failed" });
  }
});

// POST /outcome-reviews/:id/decisions
// Body: { action_type, action_key, decision, edited_payload?: any }
router.post("/outcome-reviews/:id/decisions", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const check = await checkReviewAccess(req.params.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }

    const actionType = req.body?.action_type;
    const actionKey = req.body?.action_key;
    const decision = req.body?.decision;
    const editedPayload = req.body?.edited_payload ?? null;

    const VALID_TYPES = ["nba", "email", "post_close_item", "adviser_loop_item", "book2"] as const;
    const VALID_DECISIONS = ["approved", "edited", "rejected", "deferred"] as const;
    if (!VALID_TYPES.includes(actionType)) { res.status(400).json({ error: "invalid_action_type" }); return; }
    if (typeof actionKey !== "string" || !actionKey) { res.status(400).json({ error: "action_key_required" }); return; }
    if (!VALID_DECISIONS.includes(decision)) { res.status(400).json({ error: "invalid_decision" }); return; }

    await recordActionDecision({
      reviewId: req.params.id,
      engineRunId: check.review.engine_run_id,
      actionType,
      actionKey,
      decision,
      editedPayload,
      decidedByUserId: authedUser.id,
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "decision_failed" });
  }
});

// POST /outcome-reviews/:id/actioned — owner marks the review complete
// Body: { notes?: string }
router.post("/outcome-reviews/:id/actioned", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const check = await checkReviewAccess(req.params.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;
    await markActioned({ reviewId: req.params.id, resolutionNotes: notes });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "mark_actioned_failed" });
  }
});

// --- Helper: list closers + admins (for the drawer's Hand-to-closer picker) ---
// GET /users/closers — all users with role=closer or admin. Used by the
// drawer's hand-off dialog. Mounted off the same router for convenience.
router.get("/users/closers", async (req, res): Promise<void> => {
  void req; // unused but keeps signature parity
  try {
    const closers = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
    }).from(usersTable);
    res.json({
      closers: closers.filter((c: { role: string }) => c.role === "closer" || c.role === "admin"),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed_to_load_closers" });
  }
});

export default router;
