import { Router, type IRouter } from "express";
import { db, usersTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildAuthorizationUrl, exchangeCode } from "../../lib/auth/oidcClient";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/requireAuth";

const router: IRouter = Router();

/**
 * GET /api/auth/google
 * Start the OAuth flow. Stores { state, codeVerifier, nonce, returnTo } in
 * the session and redirects to Google consent.
 *
 * Accepts optional ?returnTo=/some/path so the user lands where they tried
 * to go after login.
 */
router.get("/auth/google", async (req, res) => {
  try {
    const { url, state, codeVerifier, nonce } = await buildAuthorizationUrl();
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/";

    req.session.oauth = { state, codeVerifier, nonce, returnTo };
    // Ensure session is persisted before the redirect (important for sessionstore backends).
    req.session.save((err) => {
      if (err) {
        logger.error({ err }, "Failed to save session before OAuth redirect");
        res.status(500).json({ error: "session_save_failed" });
        return;
      }
      res.redirect(url);
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to build OAuth URL");
    res.status(500).json({ error: "oauth_init_failed", message: err.message });
  }
});

/**
 * GET /api/auth/callback
 * Google redirects here with ?code=&state=. We exchange the code, match the
 * email against agents.email, create/update the user row, bind the agent
 * to the user (if not already), set the session, and redirect to returnTo.
 */
router.get("/auth/callback", async (req, res) => {
  const oauth = req.session.oauth;
  if (!oauth) {
    res.status(400).send("OAuth session expired. Please try logging in again.");
    return;
  }

  // Build the URL exactly as Google sent it — openid-client validates state from here.
  const protocol = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.get("host") || "";
  const currentUrl = new URL(`${protocol}://${host}${req.originalUrl}`);

  try {
    const claims = await exchangeCode(currentUrl, {
      state: oauth.state,
      codeVerifier: oauth.codeVerifier,
      nonce: oauth.nonce,
    });

    // Gate: email must match an existing agents row.
    const [agent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.email, claims.email));

    if (!agent) {
      logger.warn({ email: claims.email }, "Login rejected — no matching agent");
      res
        .status(403)
        .send(
          `Access denied. The email ${claims.email} is not registered as an agent. Ask an admin to add you.`,
        );
      return;
    }

    if (!agent.active) {
      logger.warn({ email: claims.email, agentId: agent.id }, "Login rejected — agent inactive");
      res.status(403).send(`Agent ${agent.name} is inactive. Ask an admin to re-activate.`);
      return;
    }

    // Upsert user by google_sub.
    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.google_sub, claims.sub));

    const tokenExpiresAt = claims.expiresIn
      ? new Date(Date.now() + claims.expiresIn * 1000)
      : null;

    let user;
    if (existingUser) {
      // Only overwrite refresh_token if a new one was returned (Google only
      // returns it on first consent unless prompt=consent is used).
      [user] = await db
        .update(usersTable)
        .set({
          email: claims.email,
          name: claims.name ?? existingUser.name,
          picture: claims.picture ?? existingUser.picture,
          access_token: claims.accessToken ?? existingUser.access_token,
          refresh_token: claims.refreshToken ?? existingUser.refresh_token,
          token_expires_at: tokenExpiresAt ?? existingUser.token_expires_at,
          scopes: claims.scopes ?? existingUser.scopes,
          last_login_at: new Date(),
        })
        .where(eq(usersTable.id, existingUser.id))
        .returning();
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          google_sub: claims.sub,
          email: claims.email,
          name: claims.name,
          picture: claims.picture,
          access_token: claims.accessToken,
          refresh_token: claims.refreshToken,
          token_expires_at: tokenExpiresAt,
          scopes: claims.scopes,
          last_login_at: new Date(),
        })
        .returning();
    }

    // Bind agent to this user.
    if (agent.user_id && agent.user_id !== user.id) {
      logger.warn(
        { email: claims.email, agentId: agent.id, existingUserId: agent.user_id, newUserId: user.id },
        "Agent already linked to a different user — rejecting",
      );
      res
        .status(403)
        .send(
          `Agent ${agent.name} is linked to a different Google account. Ask an admin to resolve.`,
        );
      return;
    }
    if (!agent.user_id) {
      await db.update(agentsTable).set({ user_id: user.id }).where(eq(agentsTable.id, agent.id));
    }

    // Regenerate session ID on login to prevent session fixation.
    const returnTo = oauth.returnTo || "/";
    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err }, "Failed to regenerate session on login");
        res.status(500).send("Login failed");
        return;
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error({ err: saveErr }, "Failed to save session on login");
          res.status(500).send("Login failed");
          return;
        }
        logger.info({ userId: user.id, agentId: agent.id, email: user.email }, "Login successful");
        res.redirect(returnTo);
      });
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "OAuth callback failed");
    // Clear the oauth state so a retry starts fresh.
    req.session.oauth = undefined;
    res.status(400).send(`Login failed: ${err.message}`);
  }
});

/**
 * POST /api/auth/logout
 * Destroy the session and clear the cookie.
 */
router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "Session destroy failed");
      res.status(500).json({ error: "logout_failed" });
      return;
    }
    res.clearCookie("cu.sid");
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/me
 * Returns the logged-in user + linked agent, or 401 if not authed.
 * Used by the frontend to check session validity on page load.
 */
router.get("/auth/me", requireAuth, (req, res) => {
  const { user, agent } = req.auth!;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      aircall_user_id: agent.aircall_user_id,
      active: agent.active,
    },
  });
});

export default router;
