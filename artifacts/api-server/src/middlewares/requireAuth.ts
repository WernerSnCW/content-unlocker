import type { RequestHandler } from "express";
import { db, usersTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Loads the logged-in user + linked agent from the session and attaches
 * them to req.auth. Rejects with 401 if:
 *   - no session
 *   - session references a user that no longer exists
 *   - user is not linked to any agent (shouldn't happen — binding is set at login)
 *   - linked agent is inactive
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "not_authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    // Session points to a deleted user — clear it.
    req.session.destroy(() => {
      res.status(401).json({ error: "user_not_found" });
    });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.user_id, user.id));
  if (!agent) {
    res.status(403).json({ error: "no_agent_linked" });
    return;
  }
  if (!agent.active) {
    res.status(403).json({ error: "agent_inactive" });
    return;
  }

  req.auth = { user, agent };
  next();
};
