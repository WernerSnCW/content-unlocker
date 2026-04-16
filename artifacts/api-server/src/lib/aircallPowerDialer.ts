import { db, integrationConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Aircall Power Dialer service.
 *
 * Aircall Power Dialer (Professional plan only) is a sequential auto-dialer
 * inside the Aircall Workspace. Each Aircall user has ONE active dialer
 * campaign — a queue of phone numbers. The agent clicks "Start session" in
 * the Aircall Workspace to dial through the queue.
 *
 * This service wraps the three REST endpoints Aircall exposes:
 *   GET    /v1/users/:user_id/dialer_campaign/phone_numbers
 *   POST   /v1/users/:user_id/dialer_campaign/phone_numbers
 *   DELETE /v1/users/:user_id/dialer_campaign/phone_numbers/:id
 *
 * Auth: Basic (api_id:api_token) — read from integration_configs, same
 * credentials used for webhook fetching elsewhere in the app.
 *
 * Rate limit: 60 req/min per Aircall company. The high-level operations
 * below chunk POST bodies at 100 numbers each, so the worst case for a
 * queue of 500 contacts is 5 POST + 1 DELETE-per-existing-item. A normal
 * 50-contact push is 1 DELETE pass (deletes each item individually — yes,
 * that's how Aircall designed it) + 1 POST.
 */

const AIRCALL_API_BASE = "https://api.aircall.io";
const POST_CHUNK_SIZE = 100;

export interface PowerDialerQueueItem {
  id: number;
  phone_number: string;
  added_at?: string;
}

async function getAircallAuthHeader(): Promise<string> {
  const [config] = await db
    .select()
    .from(integrationConfigsTable)
    .where(eq(integrationConfigsTable.provider, "aircall"));
  const cfg = config?.config as Record<string, any> | undefined;
  if (!cfg?.api_id || !cfg?.api_token) {
    throw new Error("Aircall integration not configured (api_id + api_token required)");
  }
  return `Basic ${Buffer.from(`${cfg.api_id}:${cfg.api_token}`).toString("base64")}`;
}

async function callAircall(
  path: string,
  init: RequestInit & { body?: any },
): Promise<{ ok: boolean; status: number; body: any }> {
  const auth = await getAircallAuthHeader();
  const headers: Record<string, string> = {
    Authorization: auth,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && typeof init.body !== "string") {
    headers["Content-Type"] = "application/json";
    init = { ...init, body: JSON.stringify(init.body) };
  }
  const res = await fetch(`${AIRCALL_API_BASE}${path}`, { ...init, headers });
  let body: any = null;
  const text = await res.text().catch(() => "");
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Fetch the current Power Dialer queue for a user.
 * Returns the list of queued items (empty array if no active campaign).
 */
export async function getQueue(aircallUserId: number): Promise<PowerDialerQueueItem[]> {
  const r = await callAircall(
    `/v1/users/${aircallUserId}/dialer_campaign/phone_numbers`,
    { method: "GET" },
  );
  if (!r.ok) {
    if (r.status === 404) return []; // no active campaign
    throw new Error(`Aircall GET queue returned ${r.status}: ${summariseBody(r.body)}`);
  }
  const items = r.body?.phone_numbers || r.body?.items || r.body || [];
  if (!Array.isArray(items)) return [];
  return items.map((x: any) => ({
    id: x.id,
    phone_number: x.phone_number || x.number,
    added_at: x.added_at || x.created_at,
  }));
}

/**
 * Delete every item in the user's current Power Dialer queue.
 * Aircall's API requires per-item DELETE (no bulk clear). Runs sequentially
 * to stay well under the 60 req/min company rate limit on small queues.
 */
export async function clearQueue(aircallUserId: number): Promise<{ deleted: number; errors: Array<{ id: number; error: string }> }> {
  const items = await getQueue(aircallUserId);
  let deleted = 0;
  const errors: Array<{ id: number; error: string }> = [];
  for (const item of items) {
    const r = await callAircall(
      `/v1/users/${aircallUserId}/dialer_campaign/phone_numbers/${item.id}`,
      { method: "DELETE" },
    );
    if (r.ok) deleted++;
    else errors.push({ id: item.id, error: `DELETE returned ${r.status}: ${summariseBody(r.body)}` });
  }
  return { deleted, errors };
}

/**
 * Push a list of phone numbers onto the user's Power Dialer queue.
 * Chunks into POST_CHUNK_SIZE batches. Does NOT clear first — caller is
 * responsible for calling clearQueue() if a replace-not-append semantic is
 * needed (see syncQueue below).
 */
export async function pushNumbers(
  aircallUserId: number,
  phoneNumbers: string[],
): Promise<{ pushed: number; failedBatches: Array<{ batch: string[]; status: number; body: string }> }> {
  // Deduplicate + strip empties; preserve order otherwise.
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const p of phoneNumbers) {
    const s = (p || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    clean.push(s);
  }

  let pushed = 0;
  const failedBatches: Array<{ batch: string[]; status: number; body: string }> = [];
  for (let i = 0; i < clean.length; i += POST_CHUNK_SIZE) {
    const batch = clean.slice(i, i + POST_CHUNK_SIZE);
    const r = await callAircall(
      `/v1/users/${aircallUserId}/dialer_campaign/phone_numbers`,
      { method: "POST", body: { phone_numbers: batch } },
    );
    if (r.ok) {
      pushed += batch.length;
    } else {
      failedBatches.push({ batch, status: r.status, body: summariseBody(r.body) });
    }
  }
  return { pushed, failedBatches };
}

/**
 * Convenience: full replace of the user's queue.
 * Clears then pushes. Returns a combined report so the UI can surface any
 * partial failures.
 */
export async function syncQueue(
  aircallUserId: number,
  phoneNumbers: string[],
): Promise<{
  cleared: number;
  clearErrors: Array<{ id: number; error: string }>;
  pushed: number;
  failedBatches: Array<{ batch: string[]; status: number; body: string }>;
}> {
  const clear = await clearQueue(aircallUserId);
  if (clear.errors.length > 0) {
    logger.warn({ aircallUserId, errors: clear.errors }, "Power Dialer clearQueue had errors");
  }
  const push = await pushNumbers(aircallUserId, phoneNumbers);
  return {
    cleared: clear.deleted,
    clearErrors: clear.errors,
    pushed: push.pushed,
    failedBatches: push.failedBatches,
  };
}

function summariseBody(body: any): string {
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 300);
  try { return JSON.stringify(body).slice(0, 300); } catch { return String(body).slice(0, 300); }
}
