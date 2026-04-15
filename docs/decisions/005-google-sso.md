# ADR 005 — Google Workspace SSO for operator auth

**Status:** Accepted
**Date:** 2026-04-15
**Author:** Werner / Claude Code session

## Context

Until this change, the app had no authentication. The "active operator" was
chosen via a dropdown on Call Command, persisted in `localStorage` as
`activeAgentId`. That was a single-developer dev convenience and never a
production auth model. It doesn't hold up once more than one agent shares
the tool, because:

- Any human on the same browser can switch to any agent's identity with a
  click. Attribution of actions to the real human is impossible.
- The agent-scoped server endpoints trust a client-supplied `?agent_id=X`
  query param. Anyone can spoof it.
- The Aircall widget has its own login (cookies against
  `workspace.aircall.io`) that doesn't follow the dropdown. Switching agents
  in our UI while staying logged in as someone else in Aircall causes calls
  to be attributed to the wrong person on the Aircall side. This was the
  symptom that made the model's weakness visible.
- Google Calendar integration is on the roadmap. That needs OAuth anyway —
  doing auth once, properly, avoids a second migration later.

The MVP will have 2+ concurrent agents. Ship-blocker unless resolved.

## Decision

Replace the `localStorage.activeAgentId` picker with Google Workspace SSO.
The logged-in user *is* the active agent. Agent scope is derived from the
authenticated session on the server, not from any client-supplied parameter.

### Specifically

1. **Identity provider:** Google OIDC (openid-client). Calendar scope can be
   added to the same OAuth client later without re-wiring.
2. **Access gate:** email must match an existing `agents.email` row.
   Unmatched emails are rejected at callback time. This is a pre-admitted
   set of operators — no self-signup.
3. **Data model:** separate `users` table (OAuth identity + tokens) from
   `agents` (domain role). `agents.user_id` is a nullable unique FK that is
   populated at first login by email match. Allows future admin role without
   coupling identity to role.
4. **Sessions:** server-side, Postgres-backed via `connect-pg-simple`. HTTP-
   only `cu.sid` cookie, SameSite=Lax, Secure in prod, 7-day sliding expiry.
   Session ID regenerated on login to prevent fixation.
5. **Route protection:** every agent-scoped endpoint sits behind a
   `requireAuth` middleware that loads `req.auth = { user, agent }` and 401s
   when absent. The four `campaigns-dispatch` endpoints that previously took
   `?agent_id=` / `{ agent_id }` now derive scope from `req.auth.agent.id`.
6. **Aircall identity:** unchanged — the widget is still a separate login
   surface that the human manages manually. When `aircallUser.id` does not
   match `currentUser.agent.aircall_user_id`, Call Command shows an amber
   mismatch banner. Dialling is not blocked; the banner is advisory.

### What we rejected

- **JWT in cookie instead of server-side sessions.** Simpler but no
  revocation, awkward refresh-token storage, harder to rotate secrets. The
  small complexity win isn't worth it for a multi-agent tool.
- **`passport-google-oauth20`.** Works, but `openid-client` is more
  standards-based, ESM-native, easier to extend with additional OIDC
  providers or additional scopes (Calendar).
- **Merging `users` into `agents`.** Fewer tables, but couples identity with
  role. Future admin users would force a migration.
- **Keeping the picker as a "view switcher" for admins.** Would re-open
  every security hole this ADR exists to close. Admin views come later with
  an explicit admin-role mechanism.

## Consequences

### Positive

- Multi-agent attribution is reliable: every API call is bound to a known
  human via the session cookie.
- Invariant #5 (Call Command is agent-scoped) becomes server-enforced instead
  of client-cooperating.
- Calendar integration in a future phase reuses the existing OAuth client —
  just adds scopes and a refresh flow. No second auth migration.
- Unauthed access to agent-scoped endpoints returns 401 and cleanly routes
  to `/login` via the frontend's `apiClient` wrapper.

### Negative / accepted

- Same-browser-same-profile two-agent use is not possible (only one cookie
  at a time per domain). This matches how every cookie-based webapp behaves
  (Gmail, Slack). Agents need their own device or their own browser profile.
- Admin "view any agent's queue" is gone until a proper admin UI lands. For
  now, admins either use an agent account or run DB queries. Acceptable
  trade-off given the MVP scope.
- An operator still has to log into the Aircall widget separately. We can
  detect mismatch but we cannot programmatically switch Aircall user —
  that's an Aircall Everywhere SDK limitation (their login uses
  `workspace.aircall.io` cookies, no API to set user from our side).

## Setup required

- **GCP Console:** create OAuth 2.0 Client ID (Web application).
  - Authorized JavaScript origins: `{APP_URL}`
  - Authorized redirect URIs: `{APP_URL}/api/auth/callback`
  - Scopes requested initially: `openid email profile`
- **Env vars on Replit:**
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_WORKSPACE_DOMAIN` (optional; sets `hd=` hint for UX only — the
    real gate is agents.email match)
  - `SESSION_SECRET` (32+ bytes, random; `openssl rand -base64 32`)
  - `APP_URL` (base URL for callback + cookie domain)
- **Agents table:** all rows that should be allowed to log in must have
  `email` set before they attempt SSO. Run
  `SELECT id, name, email FROM agents WHERE email IS NULL` and backfill.

## Out of scope (separate future ADRs)

- Google Calendar integration (booking, availability) — separate work, will
  add `calendar.events` + `calendar.readonly` scopes and a refresh-token
  refresh flow to the same OAuth client.
- Admin role and admin UI.
- Programmatic Aircall user switching — blocked by SDK limitations, not on
  the roadmap.

## References

- Implementation commits: `61feb7a` (schema) → `03aebac` (mismatch banner).
- Plan file: `.claude/plans/frolicking-sleeping-eagle.md`.
