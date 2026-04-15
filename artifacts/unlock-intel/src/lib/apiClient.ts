/**
 * Thin fetch wrapper that:
 *   - Always sends cookies (credentials: "include") so session auth works
 *   - On 401, redirects to /login (preserving returnTo) instead of letting
 *     each caller deal with it
 *
 * Usage:
 *   import { apiFetch } from "@/lib/apiClient";
 *   const res = await apiFetch("/api/call-lists");
 *   const data = await res.json();
 *
 * Non-auth errors (404, 500, etc.) are returned as-is — callers handle them.
 */

const API_BASE = (import.meta.env.BASE_URL?.replace(/\/$/, "") || "") + "";

export class UnauthorizedError extends Error {
  constructor() {
    super("not_authenticated");
    this.name = "UnauthorizedError";
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** If true (default), a 401 response redirects to /login. Set false for the
   *  login probe itself so it can distinguish "not authed" from a real error. */
  redirectOn401?: boolean;
}

export async function apiFetch(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<Response> {
  const { redirectOn401 = true, headers, ...rest } = opts;

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      ...(rest.body && !(rest.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...rest,
  });

  if (res.status === 401) {
    if (redirectOn401) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnTo=${returnTo}`;
      // Throw so callers awaiting this promise don't proceed to parse body.
      throw new UnauthorizedError();
    }
  }

  return res;
}

/**
 * POST helper that JSON-encodes the body.
 */
export async function apiPost<T = unknown>(path: string, body?: T, opts: ApiFetchOptions = {}): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts,
  });
}

/**
 * Trigger logout. Always hard-redirects to /login afterwards so the
 * frontend state (React Query cache, etc.) is fully reset.
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", redirectOn401: false });
  } catch {
    // ignore
  }
  window.location.href = "/login";
}
