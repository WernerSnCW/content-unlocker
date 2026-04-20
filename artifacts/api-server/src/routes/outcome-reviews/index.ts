// HTTP surface for Phase 4.7 + 4.8 outcome reviews.
//
// Endpoints:
//   GET    /outcome-reviews                     — list with filters (4.8)
//   GET    /outcome-reviews/count               — inbox count for nav badge (4.8)
//   GET    /outcome-reviews/by-run/:runId       — lookup by engine_run (drawer)
//   GET    /outcome-reviews/:id                 — read one review + its decisions
//   POST   /outcome-reviews/:id/hand-off        — agent → closer (with note)
//                                                 or closer → agent (bounce back)
//   POST   /outcome-reviews/:id/reclaim         — admin only; force reassign
//   POST   /outcome-reviews/:id/decisions       — upsert a per-item decision
//   POST   /outcome-reviews/:id/actioned        — mark the whole review done

import { Router, type IRouter } from "express";
import {
  db,
  outcomeReviewsTable,
  outcomeActionDecisionsTable,
  usersTable,
  agentsTable,
  contactsTable,
  engineRunsTable,
  leadConversationsTable,
} from "@workspace/db";
import { eq, and, or, inArray, desc, gte, lte, isNull, sql } from "drizzle-orm";
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

// ============================================================================
// Phase 4.8 — list + count endpoints for the dedicated Outcomes page.
// ============================================================================

// Active statuses (the ones that need operator attention). Kept as a const
// so the count endpoint and default list filter agree.
const ACTIVE_STATUSES = [
  "awaiting_review",
  "under_review",
  "handed_to_closer",
  "handed_to_agent",
] as const;

// GET /outcome-reviews — list reviews with scope + filters.
//
// Query params:
//   scope   — "mine" (default) | "all". "all" is available to closer/admin
//             roles; agents are forced to "mine" regardless of what they send.
//   status  — optional, "active" (default) | a specific status value |
//             "all" (no filter). "active" = anything still needing attention.
//   from/to — optional ISO date strings, bounds on created_at.
//   limit   — optional, default 50, max 200.
//   offset  — optional, default 0.
//
// Returns rows enriched with contact name + current owner name + handed_from
// name + decision count + the engine_run's latest outcome tag (from conv).
router.get("/outcome-reviews", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const requestedScope = req.query.scope === "all" ? "all" : "mine";
    // Agents can only ever see their own. Closers + admins can see all.
    const effectiveScope =
      authedUser.role === "agent" ? "mine" : requestedScope;

    const statusParam = typeof req.query.status === "string" ? req.query.status : "active";
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);

    const conditions: any[] = [];
    if (effectiveScope === "mine") {
      conditions.push(eq(outcomeReviewsTable.current_owner_user_id, authedUser.id));
    }
    if (statusParam === "active") {
      conditions.push(inArray(outcomeReviewsTable.status, [...ACTIVE_STATUSES]));
    } else if (statusParam !== "all" && statusParam) {
      conditions.push(eq(outcomeReviewsTable.status, statusParam));
    }
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(outcomeReviewsTable.created_at, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lte(outcomeReviewsTable.created_at, to));

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    // Aliased join helpers. Drizzle lets us select specific columns per table
    // to keep the payload compact.
    const ownerAlias = { id: usersTable.id, name: usersTable.name, email: usersTable.email };

    // Main query — reviews joined to contact + engine_run + owner user.
    // Do owner join as LEFT (current_owner_user_id can be null = unclaimed).
    const baseQuery = db
      .select({
        review: outcomeReviewsTable,
        contact: {
          id: contactsTable.id,
          first_name: contactsTable.first_name,
          last_name: contactsTable.last_name,
          phone: contactsTable.phone,
          company: contactsTable.company,
          last_call_outcome: contactsTable.last_call_outcome,
        },
        run: {
          id: engineRunsTable.id,
          call_type: engineRunsTable.call_type,
          engine_version: engineRunsTable.engine_version,
          status: engineRunsTable.status,
        },
        conv: {
          id: leadConversationsTable.id,
          tags: leadConversationsTable.tags,
          call_outcome: leadConversationsTable.call_outcome,
        },
        owner: ownerAlias,
      })
      .from(outcomeReviewsTable)
      .innerJoin(contactsTable, eq(contactsTable.id, outcomeReviewsTable.contact_id))
      .innerJoin(engineRunsTable, eq(engineRunsTable.id, outcomeReviewsTable.engine_run_id))
      .leftJoin(leadConversationsTable, eq(leadConversationsTable.id, engineRunsTable.conversation_id))
      .leftJoin(usersTable, eq(usersTable.id, outcomeReviewsTable.current_owner_user_id))
      .orderBy(desc(outcomeReviewsTable.updated_at))
      .limit(limit)
      .offset(offset);

    const rows = whereExpr ? await baseQuery.where(whereExpr) : await baseQuery;

    // Decision counts — one query keyed by review id (avoids N+1).
    const reviewIds = rows.map((r: any) => r.review.id);
    const decisionCounts = new Map<string, number>();
    if (reviewIds.length > 0) {
      const countRows = await db
        .select({
          review_id: outcomeActionDecisionsTable.outcome_review_id,
          c: sql<number>`count(*)`,
        })
        .from(outcomeActionDecisionsTable)
        .where(inArray(outcomeActionDecisionsTable.outcome_review_id, reviewIds))
        .groupBy(outcomeActionDecisionsTable.outcome_review_id);
      for (const c of countRows) decisionCounts.set(c.review_id, Number(c.c));
    }

    // Total count for pagination (same filter, no limit).
    const countQuery = db
      .select({ c: sql<number>`count(*)` })
      .from(outcomeReviewsTable);
    const [{ c: total }] = whereExpr
      ? await countQuery.where(whereExpr)
      : await countQuery;

    res.json({
      scope: effectiveScope,
      status: statusParam,
      limit,
      offset,
      total: Number(total),
      reviews: rows.map((r: any) => ({
        id: r.review.id,
        status: r.review.status,
        engine_run_id: r.review.engine_run_id,
        contact_id: r.review.contact_id,
        current_owner_user_id: r.review.current_owner_user_id,
        handed_from_user_id: r.review.handed_from_user_id,
        hand_note: r.review.hand_note,
        handed_at: r.review.handed_at,
        claimed_at: r.review.claimed_at,
        resolved_at: r.review.resolved_at,
        created_at: r.review.created_at,
        updated_at: r.review.updated_at,
        contact: r.contact,
        run: r.run,
        outcomeTag: (Array.isArray(r.conv?.tags) && r.conv.tags.length > 0)
          ? r.conv.tags[r.conv.tags.length - 1]
          : (r.conv?.call_outcome ?? null),
        owner: r.owner?.id ? r.owner : null,
        decisionCount: decisionCounts.get(r.review.id) ?? 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed_to_list_reviews" });
  }
});

// GET /outcome-reviews/count — inbox-size counters for the nav badge.
// Returns { mine, all } — both respect active-status filter. "all" is only
// populated for closer/admin; agents see mine only.
router.get("/outcome-reviews/count", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const [mineRow] = await db
      .select({ c: sql<number>`count(*)` })
      .from(outcomeReviewsTable)
      .where(and(
        eq(outcomeReviewsTable.current_owner_user_id, authedUser.id),
        inArray(outcomeReviewsTable.status, [...ACTIVE_STATUSES]),
      ));
    let allCount: number | null = null;
    if (authedUser.role === "closer" || authedUser.role === "admin") {
      const [allRow] = await db
        .select({ c: sql<number>`count(*)` })
        .from(outcomeReviewsTable)
        .where(inArray(outcomeReviewsTable.status, [...ACTIVE_STATUSES]));
      allCount = Number(allRow.c);
    }
    res.json({
      mine: Number(mineRow.c),
      all: allCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "failed_to_load_count" });
  }
});

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

// GET /outcome-reviews/:id — read one review + its decisions + contact
// + (latest) conversation tag for outcome classification. One-shot load
// for the outcome detail page — avoids follow-on client fetches.
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

    // Contact + last-call outcome for header display
    const [contact] = await db.select({
      id: contactsTable.id,
      first_name: contactsTable.first_name,
      last_name: contactsTable.last_name,
      email: contactsTable.email,
      phone: contactsTable.phone,
      company: contactsTable.company,
      last_call_outcome: contactsTable.last_call_outcome,
    }).from(contactsTable).where(eq(contactsTable.id, check.review.contact_id)).limit(1);

    // Latest conversation tag (for the outcome-taxonomy badge in the header)
    let outcomeTag: string | null = null;
    try {
      const [conv] = await db.select({
        tags: leadConversationsTable.tags,
        call_outcome: leadConversationsTable.call_outcome,
      }).from(leadConversationsTable)
        .innerJoin(engineRunsTable, eq(engineRunsTable.conversation_id, leadConversationsTable.id))
        .where(eq(engineRunsTable.id, check.review.engine_run_id))
        .limit(1);
      if (conv) {
        const tags = Array.isArray(conv.tags) ? (conv.tags as string[]) : [];
        outcomeTag = tags[tags.length - 1] ?? conv.call_outcome ?? null;
      }
    } catch { /* non-fatal */ }

    res.json({ review: check.review, decisions, currentOwner, handedFrom, contact: contact ?? null, outcomeTag });
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

// POST /outcome-reviews/:id/notes — save operator notes without
// actioning. Separate from /actioned so operators can save working
// notes mid-review without prematurely flipping state to "actioned".
// Body: { notes: string | null }
router.post("/outcome-reviews/:id/notes", async (req, res): Promise<void> => {
  try {
    const authedUser = req.auth!.user;
    const check = await checkReviewAccess(req.params.id, authedUser.id, authedUser.role as any);
    if (!check.ok) {
      res.status(check.reason === "review_not_found" ? 404 : 403).json({ error: check.reason });
      return;
    }
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    await db.update(outcomeReviewsTable)
      .set({ resolution_notes: notes, updated_at: new Date() })
      .where(eq(outcomeReviewsTable.id, req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "save_notes_failed" });
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
