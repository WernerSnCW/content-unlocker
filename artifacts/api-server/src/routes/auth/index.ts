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

// ============================================================================
// DEV-ONLY LOGIN BYPASS
// ============================================================================
// Gated by TWO conditions that must BOTH be true:
//   1. NODE_ENV !== "production"   (no deployed app ever satisfies this)
//   2. ALLOW_DEV_LOGIN === "true"  (explicit opt-in env var)
// A deployed/published Replit sets NODE_ENV=production, so even if someone
// forgets the flag the endpoint is unreachable there. This is a dev-only
// convenience so you can test the auth-protected app without setting up GCP
// OAuth first.
// ============================================================================

function isDevLoginAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_LOGIN === "true"
  );
}

/**
 * GET /api/auth/dev-mode
 * Public probe used by the login page to decide whether to render the
 * dev-quick-login form. Returns { enabled: false } when disabled so the
 * response is always shape-stable.
 */
router.get("/auth/dev-mode", async (_req, res) => {
  if (!isDevLoginAllowed()) {
    res.json({ enabled: false });
    return;
  }
  try {
    const agents = await db
      .select({
        id: agentsTable.id,
        name: agentsTable.name,
        email: agentsTable.email,
      })
      .from(agentsTable)
      .where(eq(agentsTable.active, true));
    res.json({ enabled: true, agents });
  } catch (err: any) {
    logger.error({ err: err.message }, "dev-mode probe failed");
    res.json({ enabled: true, agents: [] });
  }
});

/**
 * POST /api/auth/dev-login
 * Body: { agent_id: string }
 * Creates (or reuses) a synthetic user row for the given agent and sets
 * the session. The synthetic user has google_sub "dev-<agentId>" so real
 * Google logins (real subs) can never collide with it.
 */
router.post("/auth/dev-login", async (req, res) => {
  if (!isDevLoginAllowed()) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const agentId = typeof req.body?.agent_id === "string" ? req.body.agent_id : null;
  if (!agentId) {
    res.status(400).json({ error: "agent_id_required" });
    return;
  }

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) {
      res.status(404).json({ error: "agent_not_found" });
      return;
    }
    if (!agent.active) {
      res.status(403).json({ error: "agent_inactive" });
      return;
    }

    const syntheticSub = `dev-${agent.id}`;
    const email = agent.email || `${agent.id}@dev.local`;

    // Upsert the synthetic user. If a real Google user with the same email
    // exists, reuse it (so dev-login doesn't create duplicate rows).
    const [existingByEmail] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    let user;
    if (existingByEmail) {
      [user] = await db
        .update(usersTable)
        .set({ last_login_at: new Date() })
        .where(eq(usersTable.id, existingByEmail.id))
        .returning();
    } else {
      [user] = await db
        .insert(usersTable)
        .values({
          google_sub: syntheticSub,
          email,
          name: agent.name,
          last_login_at: new Date(),
        })
        .returning();
    }

    // Bind agent to user if not already bound.
    if (!agent.user_id) {
      await db.update(agentsTable).set({ user_id: user.id }).where(eq(agentsTable.id, agent.id));
    } else if (agent.user_id !== user.id) {
      res.status(409).json({ error: "agent_bound_to_different_user" });
      return;
    }

    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err }, "dev-login session regenerate failed");
        res.status(500).json({ error: "session_failed" });
        return;
      }
      req.session.userId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          logger.error({ err: saveErr }, "dev-login session save failed");
          res.status(500).json({ error: "session_failed" });
          return;
        }
        logger.warn(
          { userId: user.id, agentId: agent.id, email: user.email },
          "DEV-LOGIN used — do not enable in production",
        );
        res.json({
          ok: true,
          user: { id: user.id, email: user.email, name: user.name },
          agent: { id: agent.id, name: agent.name },
        });
      });
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, "dev-login failed");
    res.status(500).json({ error: "dev_login_failed", message: err.message });
  }
});

// ============================================================================
// /auth/me (protected) — session probe used by the frontend
// ============================================================================

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
