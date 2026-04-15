import type { RequestHandler } from "express";
import { requireAuth } from "./requireAuth";

/**
 * Requires an authenticated user AND users.role === "admin".
 * Composes with requireAuth — runs that first to populate req.auth.
 * Non-admin authed users get 403 (not 401) so the frontend knows they're
 * logged in but just don't have the privilege.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    if (res.headersSent) return; // requireAuth already responded (e.g. 401)

    if (req.auth?.user.role !== "admin") {
      res.status(403).json({ error: "admin_only" });
      return;
    }
    next();
  });
};
