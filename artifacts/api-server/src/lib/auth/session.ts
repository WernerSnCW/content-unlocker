import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import type { RequestHandler } from "express";

/**
 * express-session middleware backed by Postgres via connect-pg-simple.
 * The `session` table is auto-created on first boot (createTableIfMissing: true).
 */
export function buildSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be set (generate with: openssl rand -base64 32)");
  }
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET should be at least 32 characters");
  }

  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool: pool as any, // drizzle's pool is pg.Pool; connect-pg-simple accepts it
    tableName: "session",
    // We do NOT use createTableIfMissing — it tries to read a `table.sql`
    // file from the connect-pg-simple package at runtime, which breaks
    // under esbuild bundling (the file isn't copied into dist/). Instead,
    // the `session` table is created explicitly via SQL (see ADR 005 /
    // deployment notes). Using createTableIfMissing here throws
    // "ENOENT: no such file or directory, open '…/dist/table.sql'" on
    // every session write.
    //
    // Prune expired sessions every 15 min (default is 60s which is too chatty)
    pruneSessionInterval: 60 * 15,
  });

  const isProd = process.env.NODE_ENV === "production";

  return session({
    store,
    name: "cu.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // sliding expiry — touching the session resets maxAge
    cookie: {
      httpOnly: true,
      secure: isProd, // HTTPS only in prod; dev on localhost/Replit http OK
      sameSite: "lax", // OK for top-level OAuth redirect; not cross-site XHR
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days sliding
    },
  });
}

/**
 * Shape of data we put on req.session.
 * Only store the user_id; everything else is loaded fresh by requireAuth.
 */
declare module "express-session" {
  interface SessionData {
    userId?: string;
    // OAuth transient state — set at /api/auth/google, cleared at /callback
    oauth?: {
      state: string;
      codeVerifier: string;
      nonce: string;
      returnTo?: string;
    };
  }
}
