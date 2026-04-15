import type { User, Agent } from "@workspace/db";

/**
 * Augment Express Request with req.auth, populated by the requireAuth middleware.
 * Endpoints that use requireAuth can rely on these being present (non-null).
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: User;
        agent: Agent;
      };
    }
  }
}

export {};
