import { db, contactsTable, callListConfigsTable, callListMembershipsTable, integrationConfigsTable, agentsTable, usersTable } from "@workspace/db";
import { eq, and, or, sql, isNull, isNotNull, lte, ne, inArray, notInArray } from "drizzle-orm";
import { DEFAULT_MAX_CALL_ATTEMPTS } from "./tagModel";

/**
 * Resolve the role of the agent assigned to a call list. Drives closer-tier
 * gating. Returns 'agent' when the agent isn't linked to a user yet — that's
 * the safest default (no elevated access).
 */
async function resolveAgentRole(agentId: string | null): Promise<"agent" | "closer" | "admin"> {
  if (!agentId) return "agent";
  const [row] = await db
    .select({ role: usersTable.role })
    .from(agentsTable)
    .leftJoin(usersTable, eq(usersTable.id, agentsTable.user_id))
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  const role = row?.role;
  if (role === "admin") return "admin";
  if (role === "closer") return "closer";
  return "agent";
}

/**
 * Does the org have at least one active user with role='closer'?
 * Drives the fallback behaviour — when no closer exists, cold agents can
 * still pick up closer-assigned contacts so leads don't rot.
 */
async function hasAnyCloser(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(eq(usersTable.role, "closer"));
  return Number(row.count) > 0;
}

export interface QueueStatus {
  campaign_id: string;
  campaign_name: string;
  daily_quota: number;
  conversions_due: number;          // NEW — closer-assigned contacts (closer/admin lists only)
  callbacks_due: number;
  interested_followups: number;
  retry_eligible: number;
  already_dispatched_today: number;
  fresh_needed: number;
  total_queued: number;
  closer_role: "agent" | "closer" | "admin";  // NEW — surfaces the assigned agent's role
}

export interface DispatchResult {
  dispatched: number;
  conversions: number;   // NEW
  callbacks: number;
  interested: number;
  retries: number;
  fresh: number;
  errors: number;
}

// Reads the max_call_attempts setting from the Aircall integration config.
// Falls back to DEFAULT_MAX_CALL_ATTEMPTS if not set.
async function getMaxCallAttempts(): Promise<number> {
  try {
    const [config] = await db.select().from(integrationConfigsTable)
      .where(eq(integrationConfigsTable.provider, "aircall"));
    const cfg = config?.config as Record<string, any>;
    const v = Number(cfg?.max_call_attempts);
    if (Number.isFinite(v) && v >= 1 && v <= 20) return v;
  } catch { /* use default */ }
  return DEFAULT_MAX_CALL_ATTEMPTS;
}

/**
 * Build the base eligibility conditions for a call list based on its filter criteria.
 * These conditions filter the contacts pool by source_list, exclude_outcomes, and cool-off.
 * Does NOT include membership/dispatch_status filtering — caller adds that.
 *
 * `excludeCloserAssigned` — when true, adds a filter to skip any contact
 * whose assigned_closer_id is set. Used for cold-agent tiers when at least
 * one closer exists in the org. Set false for the closer's own tier, or
 * when no closer exists (fallback so cold agents still pick them up).
 */
function buildEligibilityConditions(
  campaign: any,
  now: Date,
  opts: { excludeCloserAssigned?: boolean } = {},
) {
  const conditions: any[] = [
    or(isNull(contactsTable.cool_off_until), lte(contactsTable.cool_off_until, now)),
  ];

  const criteria = (campaign.filter_criteria || {}) as Record<string, any>;
  if (Array.isArray(criteria.source_lists) && criteria.source_lists.length > 0) {
    conditions.push(inArray(contactsTable.source_list, criteria.source_lists));
  }

  const excludeOutcomes = criteria.exclude_outcomes ?? ["no-interest"];
  if (excludeOutcomes.length > 0) {
    conditions.push(
      or(
        isNull(contactsTable.last_call_outcome),
        notInArray(contactsTable.last_call_outcome, excludeOutcomes),
      )!
    );
  }

  if (opts.excludeCloserAssigned) {
    conditions.push(isNull(contactsTable.assigned_closer_id));
  }

  return conditions;
}

/**
 * Preview eligibility counts for a hypothetical call list — used by the
 * Create Call List dialog to show admins what they'll get BEFORE the list
 * exists. Does not require a persisted campaign row; accepts a partial
 * config object.
 */
export async function previewEligibility(campaign: {
  assigned_agent_id: string | null;
  closing_only?: boolean;
  filter_criteria?: Record<string, any>;
}): Promise<{
  conversions_due: number;
  callbacks_due: number;
  interested_followups: number;
  retry_eligible: number;
  pool_available: number;
  closer_role: "agent" | "closer" | "admin";
  closing_only: boolean;
}> {
  const now = new Date();
  const role = await resolveAgentRole(campaign.assigned_agent_id);
  const isCloserCapable = role === "closer" || role === "admin";
  const closersExist = await hasAnyCloser();
  const excludeCloserAssigned = !isCloserCapable && closersExist;
  const closingOnly = !!campaign.closing_only && isCloserCapable;

  let agentUserId: string | null = null;
  if (isCloserCapable && campaign.assigned_agent_id) {
    const [r] = await db
      .select({ user_id: agentsTable.user_id })
      .from(agentsTable)
      .where(eq(agentsTable.id, campaign.assigned_agent_id))
      .limit(1);
    agentUserId = r?.user_id ?? null;
  }

  const unassignedSubq = sql`${contactsTable.id} NOT IN (
    SELECT ${callListMembershipsTable.contact_id} FROM ${callListMembershipsTable}
    WHERE ${callListMembershipsTable.removed_at} IS NULL
  )`;
  const baseEligibility = buildEligibilityConditions(campaign, now, { excludeCloserAssigned });
  const maxAttempts = await getMaxCallAttempts();
  const dueFilter = or(
    isNull(contactsTable.callback_date),
    lte(contactsTable.callback_date, now),
  );

  // Conversions tier (closer/admin only)
  let conversionsDue = 0;
  if (isCloserCapable) {
    const closerBase = buildEligibilityConditions(campaign, now, { excludeCloserAssigned: false });
    const closerFilter = agentUserId
      ? or(eq(contactsTable.assigned_closer_id, "any"), eq(contactsTable.assigned_closer_id, agentUserId))!
      : eq(contactsTable.assigned_closer_id, "any");
    const [cRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
      .where(and(unassignedSubq, isNotNull(contactsTable.assigned_closer_id), closerFilter, dueFilter, ...closerBase));
    conversionsDue = Number(cRow.count);
  }

  // If closing_only, everything else is zero (tier skipped by fillQueue).
  if (closingOnly) {
    return {
      conversions_due: conversionsDue,
      callbacks_due: 0, interested_followups: 0, retry_eligible: 0, pool_available: 0,
      closer_role: role, closing_only: true,
    };
  }

  const [cbRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(unassignedSubq, eq(contactsTable.last_call_outcome, "callback-requested"),
               lte(contactsTable.callback_date, now), ...baseEligibility));
  const [intRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(unassignedSubq, eq(contactsTable.last_call_outcome, "interested"),
               dueFilter, ...baseEligibility));
  const [retryRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(unassignedSubq,
               or(eq(contactsTable.last_call_outcome, "no-answer"), eq(contactsTable.last_call_outcome, "hung-up")),
               sql`${contactsTable.call_attempts} < ${maxAttempts}`,
               dueFilter, ...baseEligibility));
  const [freshRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(unassignedSubq, eq(contactsTable.dispatch_status, "pool"),
               isNull(contactsTable.last_call_outcome), ...baseEligibility));

  return {
    conversions_due: conversionsDue,
    callbacks_due: Number(cbRow.count),
    interested_followups: Number(intRow.count),
    retry_eligible: Number(retryRow.count),
    pool_available: Number(freshRow.count),
    closer_role: role,
    closing_only: false,
  };
}

/**
 * Get the current queue status for a campaign — how many contacts
 * are already dispatched for today vs how many more are eligible to reach quota.
 */
export async function getQueueStatus(campaignId: string): Promise<QueueStatus> {
  const [campaign] = await db.select().from(callListConfigsTable)
    .where(eq(callListConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Contacts currently without an active membership — eligible to be picked up
  const unassignedSubq = sql`${contactsTable.id} NOT IN (
    SELECT ${callListMembershipsTable.contact_id} FROM ${callListMembershipsTable}
    WHERE ${callListMembershipsTable.removed_at} IS NULL
  )`;

  // Role + closer-existence gates the closer handoff tier and the
  // cold-agent "exclude closer-assigned" filter.
  const role = await resolveAgentRole(campaign.assigned_agent_id);
  const isCloserCapable = role === "closer" || role === "admin";
  const closersExist = await hasAnyCloser();
  // Cold-agent lists should exclude closer-assigned contacts ONLY when
  // closers exist. If no closer exists, fallback: cold agents see them.
  const excludeCloserAssigned = !isCloserCapable && closersExist;

  // Resolve the closer's user_id — needed for "specific closer" matches.
  // For agents (not closer/admin), we never run the closer tier, so this
  // can be null.
  let agentUserId: string | null = null;
  if (isCloserCapable && campaign.assigned_agent_id) {
    const [r] = await db
      .select({ user_id: agentsTable.user_id })
      .from(agentsTable)
      .where(eq(agentsTable.id, campaign.assigned_agent_id))
      .limit(1);
    agentUserId = r?.user_id ?? null;
  }

  const baseEligibility = buildEligibilityConditions(campaign, now, { excludeCloserAssigned });
  const maxAttempts = await getMaxCallAttempts();
  const closingOnly = !!campaign.closing_only && isCloserCapable;

  // Universal "not due yet" filter used by interested/retry buckets:
  // eligible if callback_date IS NULL or callback_date <= now.
  const dueFilter = or(
    isNull(contactsTable.callback_date),
    lte(contactsTable.callback_date, now),
  );

  // 0. Conversions (closer handoff) — only for closer/admin-assigned lists.
  //    Contacts with assigned_closer_id = 'any' OR = this agent's user_id,
  //    respecting cool_off + due filter. Not gated by last_call_outcome —
  //    the tag's maps_to_closer decided, which is already stamped on the row.
  let conversionsDue = 0;
  if (isCloserCapable) {
    // For closer tier, we do NOT apply the excludeCloserAssigned filter —
    // it's the opposite (we WANT closer-assigned contacts here).
    const closerBase = buildEligibilityConditions(campaign, now, { excludeCloserAssigned: false });
    const closerFilter = agentUserId
      ? or(
          eq(contactsTable.assigned_closer_id, "any"),
          eq(contactsTable.assigned_closer_id, agentUserId),
        )!
      : eq(contactsTable.assigned_closer_id, "any");
    const [convRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
      .where(and(
        unassignedSubq,
        isNotNull(contactsTable.assigned_closer_id),
        closerFilter,
        dueFilter,
        ...closerBase,
      ));
    conversionsDue = Number(convRow.count);
  }

  // 1. Callbacks due today (eligible, outcome=callback-requested, callback_date <= now)
  const [cbRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "callback-requested"),
      lte(contactsTable.callback_date, now),
      ...baseEligibility,
    ));

  // 2. Interested follow-ups — respect scheduled callback_date
  const [intRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "interested"),
      dueFilter,
      ...baseEligibility,
    ));

  // 3. No-answer / hung-up retries (under max attempts, due)
  const [retryRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      or(
        eq(contactsTable.last_call_outcome, "no-answer"),
        eq(contactsTable.last_call_outcome, "hung-up"),
      ),
      sql`${contactsTable.call_attempts} < ${maxAttempts}`,
      dueFilter,
      ...baseEligibility,
    ));

  // 4. Already dispatched today (active memberships on this list, dispatched today)
  const [dispatchedRow] = await db.select({ count: sql<number>`count(*)` })
    .from(contactsTable)
    .innerJoin(
      callListMembershipsTable,
      eq(callListMembershipsTable.contact_id, contactsTable.id),
    )
    .where(and(
      eq(callListMembershipsTable.call_list_id, campaignId),
      isNull(callListMembershipsTable.removed_at),
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date = ${today.toISOString().split("T")[0]}::date`,
    ));

  // In closing_only mode, the non-conversion tiers are irrelevant — zero them
  // out so the status preview reflects what fillQueue will actually dispatch.
  const callbacks = closingOnly ? 0 : Number(cbRow.count);
  const interested = closingOnly ? 0 : Number(intRow.count);
  const retries = closingOnly ? 0 : Number(retryRow.count);
  const dispatchedToday = Number(dispatchedRow.count);

  const committed = conversionsDue + callbacks + interested + retries + dispatchedToday;
  // Fresh quota only matters when non-conversion tiers run.
  const freshNeeded = closingOnly ? 0 : Math.max(0, campaign.daily_quota - committed);

  return {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    daily_quota: campaign.daily_quota,
    conversions_due: conversionsDue,
    callbacks_due: callbacks,
    interested_followups: interested,
    retry_eligible: retries,
    already_dispatched_today: dispatchedToday,
    fresh_needed: freshNeeded,
    total_queued: committed,
    closer_role: role,
  };
}

/**
 * Dispatch a single contact to a call list: create an active membership and
 * update the contact's denormalized dispatch_status/date. Safe against
 * double-dispatch via the partial unique index on active memberships.
 */
async function dispatchContact(
  contactId: string,
  callListId: string,
  now: Date,
): Promise<boolean> {
  try {
    await db.insert(callListMembershipsTable).values({
      call_list_id: callListId,
      contact_id: contactId,
      added_at: now,
    });
    await db.update(contactsTable)
      .set({ dispatch_status: "dispatched", dispatch_date: now })
      .where(eq(contactsTable.id, contactId));
    return true;
  } catch {
    return false; // likely unique index violation — contact already has active membership
  }
}

/**
 * Fill the call queue for a campaign. Pulls from 4 sources in priority order:
 * 1. Callbacks due today
 * 2. Interested follow-ups
 * 3. No-answer retries (under max attempts)
 * 4. Fresh contacts from pool matching campaign filters
 *
 * Eligibility: contact has no active membership AND matches filter_criteria.
 */
export async function fillQueue(
  campaignId: string,
  count?: number,
): Promise<DispatchResult> {
  const [campaign] = await db.select().from(callListConfigsTable)
    .where(eq(callListConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const status = await getQueueStatus(campaignId);
  const toFill = count ?? status.fresh_needed;
  if (toFill <= 0) return { dispatched: 0, conversions: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  const now = new Date();
  const result: DispatchResult = { dispatched: 0, conversions: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  const unassignedSubq = sql`${contactsTable.id} NOT IN (
    SELECT ${callListMembershipsTable.contact_id} FROM ${callListMembershipsTable}
    WHERE ${callListMembershipsTable.removed_at} IS NULL
  )`;

  // Role / closer gating — mirror of getQueueStatus so fillQueue behaves
  // consistently with the preview.
  const role = await resolveAgentRole(campaign.assigned_agent_id);
  const isCloserCapable = role === "closer" || role === "admin";
  const closersExist = await hasAnyCloser();
  const excludeCloserAssigned = !isCloserCapable && closersExist;

  let agentUserId: string | null = null;
  if (isCloserCapable && campaign.assigned_agent_id) {
    const [r] = await db
      .select({ user_id: agentsTable.user_id })
      .from(agentsTable)
      .where(eq(agentsTable.id, campaign.assigned_agent_id))
      .limit(1);
    agentUserId = r?.user_id ?? null;
  }

  const baseEligibility = buildEligibilityConditions(campaign, now, { excludeCloserAssigned });
  const maxAttempts = await getMaxCallAttempts();
  const dueFilter = or(
    isNull(contactsTable.callback_date),
    lte(contactsTable.callback_date, now),
  );

  // 0. Conversions (closer handoff tier) — only for closer/admin-assigned lists.
  if (isCloserCapable) {
    const closerBase = buildEligibilityConditions(campaign, now, { excludeCloserAssigned: false });
    const closerFilter = agentUserId
      ? or(
          eq(contactsTable.assigned_closer_id, "any"),
          eq(contactsTable.assigned_closer_id, agentUserId),
        )!
      : eq(contactsTable.assigned_closer_id, "any");
    const conversions = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        isNotNull(contactsTable.assigned_closer_id),
        closerFilter,
        dueFilter,
        ...closerBase,
      ))
      .limit(toFill);

    for (const c of conversions) {
      if (result.dispatched >= toFill) break;
      if (await dispatchContact(c.id, campaignId, now)) {
        result.conversions++;
        result.dispatched++;
      } else {
        result.errors++;
      }
    }
  }

  // If the list is configured closing_only AND the agent is a closer, skip
  // tiers 1-4 entirely. The closer-only setting is ignored for non-closer
  // agents (shouldn't be configurable on their lists, but defensive).
  const closingOnly = !!campaign.closing_only && isCloserCapable;

  // 1. Callbacks — only if slots remain after conversions tier
  if (!closingOnly && result.dispatched < toFill) {
    const callbacks = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        eq(contactsTable.last_call_outcome, "callback-requested"),
        lte(contactsTable.callback_date, now),
        ...baseEligibility,
      ))
      .limit(toFill - result.dispatched);

    for (const cb of callbacks) {
      if (result.dispatched >= toFill) break;
      if (await dispatchContact(cb.id, campaignId, now)) {
        result.callbacks++;
        result.dispatched++;
      } else {
        result.errors++;
      }
    }
  }

  // 2. Interested (respect scheduled callback_date)
  if (!closingOnly && result.dispatched < toFill) {
    const interested = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        eq(contactsTable.last_call_outcome, "interested"),
        dueFilter,
        ...baseEligibility,
      ))
      .limit(toFill - result.dispatched);

    for (const it of interested) {
      if (result.dispatched >= toFill) break;
      if (await dispatchContact(it.id, campaignId, now)) {
        result.interested++;
        result.dispatched++;
      } else {
        result.errors++;
      }
    }
  }

  // 3. Retries (no-answer / hung-up under max attempts, respecting due date)
  if (!closingOnly && result.dispatched < toFill) {
    const retries = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        or(
          eq(contactsTable.last_call_outcome, "no-answer"),
          eq(contactsTable.last_call_outcome, "hung-up"),
        ),
        sql`${contactsTable.call_attempts} < ${maxAttempts}`,
        dueFilter,
        ...baseEligibility,
      ))
      .limit(toFill - result.dispatched);

    for (const r of retries) {
      if (result.dispatched >= toFill) break;
      if (await dispatchContact(r.id, campaignId, now)) {
        result.retries++;
        result.dispatched++;
      } else {
        result.errors++;
      }
    }
  }

  // 4. Fresh from pool (no outcome yet)
  if (!closingOnly && result.dispatched < toFill) {
    const fresh = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        eq(contactsTable.dispatch_status, "pool"),
        isNull(contactsTable.last_call_outcome),
        ...baseEligibility,
      ))
      .orderBy(sql`RANDOM()`)
      .limit(toFill - result.dispatched);

    for (const f of fresh) {
      if (result.dispatched >= toFill) break;
      if (await dispatchContact(f.id, campaignId, now)) {
        result.fresh++;
        result.dispatched++;
      } else {
        result.errors++;
      }
    }
  }

  // Update campaign stats
  if (result.dispatched > 0) {
    await db.update(callListConfigsTable).set({
      total_dispatched: sql`${callListConfigsTable.total_dispatched} + ${result.dispatched}`,
    }).where(eq(callListConfigsTable.id, campaignId));
  }

  return result;
}

/**
 * Start-of-day reconciliation: close memberships for contacts dispatched
 * yesterday or earlier that were never called. Reset their dispatch state.
 *
 * Optional agentId scope: when provided, only reconcile memberships on call
 * lists assigned to that agent. This keeps each operator's "Start Fresh"
 * action from wiping another operator's stale contacts.
 */
export async function reconcileUncalledContacts(agentId?: string | null): Promise<number> {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const conditions = [
    isNull(callListMembershipsTable.removed_at),
    eq(contactsTable.dispatch_status, "dispatched"),
    sql`${contactsTable.dispatch_date}::date < ${todayStr}::date`,
  ];
  // Agent scope via call_list_configs.assigned_agent_id
  const query = agentId
    ? db.select({
        membership_id: callListMembershipsTable.id,
        contact_id: callListMembershipsTable.contact_id,
      })
        .from(callListMembershipsTable)
        .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
        .innerJoin(callListConfigsTable, eq(callListConfigsTable.id, callListMembershipsTable.call_list_id))
        .where(and(...conditions, eq(callListConfigsTable.assigned_agent_id, agentId)))
    : db.select({
        membership_id: callListMembershipsTable.id,
        contact_id: callListMembershipsTable.contact_id,
      })
        .from(callListMembershipsTable)
        .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
        .where(and(...conditions));

  const stale = await query;

  let resetCount = 0;
  for (const row of stale) {
    try {
      await db.update(callListMembershipsTable)
        .set({ removed_at: now, removal_reason: "reconciled" })
        .where(eq(callListMembershipsTable.id, row.membership_id));
      await db.update(contactsTable)
        .set({ dispatch_status: "pool", dispatch_date: null })
        .where(eq(contactsTable.id, row.contact_id));
      resetCount++;
    } catch { /* ignore */ }
  }

  return resetCount;
}

/**
 * Get today's call list for a campaign — all dispatched contacts on
 * active memberships, in priority order.
 */
export async function getCallList(campaignId: string): Promise<any[]> {
  const [campaign] = await db.select().from(callListConfigsTable)
    .where(eq(callListConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows = await db.select({
    contact: contactsTable,
    membershipCarriedFrom: callListMembershipsTable.carried_from_id,
  })
    .from(callListMembershipsTable)
    .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
    .where(and(
      eq(callListMembershipsTable.call_list_id, campaignId),
      isNull(callListMembershipsTable.removed_at),
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date = ${today.toISOString().split("T")[0]}::date`,
    ))
    .orderBy(
      // Priority tiers (lower is higher priority):
      //   0 conversions — closer-handoff tagged, closer/admin list
      //   1 callbacks
      //   2 interested
      //   3 retries (no-answer / hung-up under max)
      //   4 fresh
      //   5 immediate_recall (carried_from_id set, retry-eligible outcome)
      sql`CASE
        WHEN ${contactsTable.assigned_closer_id} IS NOT NULL THEN 0
        WHEN ${callListMembershipsTable.carried_from_id} IS NOT NULL
             AND ${contactsTable.last_call_outcome} IN ('no-answer', 'hung-up')
          THEN 5
        WHEN ${contactsTable.last_call_outcome} = 'callback-requested' THEN 1
        WHEN ${contactsTable.last_call_outcome} = 'interested' THEN 2
        WHEN ${contactsTable.last_call_outcome} IN ('no-answer', 'hung-up') THEN 3
        ELSE 4
      END`,
      contactsTable.dispatch_date,
    );

  return rows.map(r => {
    const c = r.contact;
    const isRecall = r.membershipCarriedFrom != null
      && (c.last_call_outcome === "no-answer" || c.last_call_outcome === "hung-up");
    const priority = c.assigned_closer_id != null ? "conversion"
      : isRecall ? "recall"
      : c.last_call_outcome === "callback-requested" ? "callback"
      : c.last_call_outcome === "interested" ? "follow-up"
      : (c.last_call_outcome === "no-answer" || c.last_call_outcome === "hung-up") ? "retry"
      : "fresh";
    return {
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      call_attempts: c.call_attempts,
      last_call_outcome: c.last_call_outcome,
      callback_date: c.callback_date,
      dispatch_status: c.dispatch_status,
      assigned_closer_id: c.assigned_closer_id,
      priority,
    };
  });
}
