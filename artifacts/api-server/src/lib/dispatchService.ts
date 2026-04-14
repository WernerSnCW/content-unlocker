import { db, contactsTable, callListConfigsTable, callListMembershipsTable } from "@workspace/db";
import { eq, and, or, sql, isNull, lte, ne, inArray, notInArray } from "drizzle-orm";

export interface QueueStatus {
  campaign_id: string;
  campaign_name: string;
  daily_quota: number;
  callbacks_due: number;
  interested_followups: number;
  retry_eligible: number;
  already_dispatched_today: number;
  fresh_needed: number;
  total_queued: number;
}

export interface DispatchResult {
  dispatched: number;
  callbacks: number;
  interested: number;
  retries: number;
  fresh: number;
  errors: number;
}

const MAX_CALL_ATTEMPTS = 3;

/**
 * Build the base eligibility conditions for a call list based on its filter criteria.
 * These conditions filter the contacts pool by source_list, exclude_outcomes, and cool-off.
 * Does NOT include membership/dispatch_status filtering — caller adds that.
 */
function buildEligibilityConditions(campaign: any, now: Date) {
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

  return conditions;
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

  const baseEligibility = buildEligibilityConditions(campaign, now);

  // 1. Callbacks due today (eligible, outcome=callback-requested, callback_date <= now)
  const [cbRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "callback-requested"),
      lte(contactsTable.callback_date, now),
      ...baseEligibility,
    ));

  // 2. Interested follow-ups
  const [intRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "interested"),
      ...baseEligibility,
    ));

  // 3. No-answer retries (under max attempts)
  const [retryRow] = await db.select({ count: sql<number>`count(*)` }).from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "no-answer"),
      sql`${contactsTable.call_attempts} < ${MAX_CALL_ATTEMPTS}`,
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

  const callbacks = Number(cbRow.count);
  const interested = Number(intRow.count);
  const retries = Number(retryRow.count);
  const dispatchedToday = Number(dispatchedRow.count);

  const committed = callbacks + interested + retries + dispatchedToday;
  const freshNeeded = Math.max(0, campaign.daily_quota - committed);

  return {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    daily_quota: campaign.daily_quota,
    callbacks_due: callbacks,
    interested_followups: interested,
    retry_eligible: retries,
    already_dispatched_today: dispatchedToday,
    fresh_needed: freshNeeded,
    total_queued: committed,
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
  if (toFill <= 0) return { dispatched: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  const now = new Date();
  const result: DispatchResult = { dispatched: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  const unassignedSubq = sql`${contactsTable.id} NOT IN (
    SELECT ${callListMembershipsTable.contact_id} FROM ${callListMembershipsTable}
    WHERE ${callListMembershipsTable.removed_at} IS NULL
  )`;
  const baseEligibility = buildEligibilityConditions(campaign, now);

  // 1. Callbacks
  const callbacks = await db.select().from(contactsTable)
    .where(and(
      unassignedSubq,
      eq(contactsTable.last_call_outcome, "callback-requested"),
      lte(contactsTable.callback_date, now),
      ...baseEligibility,
    ))
    .limit(toFill);

  for (const cb of callbacks) {
    if (result.dispatched >= toFill) break;
    if (await dispatchContact(cb.id, campaignId, now)) {
      result.callbacks++;
      result.dispatched++;
    } else {
      result.errors++;
    }
  }

  // 2. Interested
  if (result.dispatched < toFill) {
    const interested = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        eq(contactsTable.last_call_outcome, "interested"),
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

  // 3. Retries
  if (result.dispatched < toFill) {
    const retries = await db.select().from(contactsTable)
      .where(and(
        unassignedSubq,
        eq(contactsTable.last_call_outcome, "no-answer"),
        sql`${contactsTable.call_attempts} < ${MAX_CALL_ATTEMPTS}`,
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
  if (result.dispatched < toFill) {
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
 */
export async function reconcileUncalledContacts(): Promise<number> {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find active memberships where contact dispatch_date < today and status = dispatched
  const stale = await db.select({
    membership_id: callListMembershipsTable.id,
    contact_id: callListMembershipsTable.contact_id,
  })
    .from(callListMembershipsTable)
    .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
    .where(and(
      isNull(callListMembershipsTable.removed_at),
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date < ${today.toISOString().split("T")[0]}::date`,
    ));

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

  const rows = await db.select({ contact: contactsTable })
    .from(callListMembershipsTable)
    .innerJoin(contactsTable, eq(contactsTable.id, callListMembershipsTable.contact_id))
    .where(and(
      eq(callListMembershipsTable.call_list_id, campaignId),
      isNull(callListMembershipsTable.removed_at),
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date = ${today.toISOString().split("T")[0]}::date`,
    ))
    .orderBy(
      sql`CASE
        WHEN ${contactsTable.last_call_outcome} = 'callback-requested' THEN 1
        WHEN ${contactsTable.last_call_outcome} = 'interested' THEN 2
        WHEN ${contactsTable.last_call_outcome} = 'no-answer' THEN 3
        ELSE 4
      END`,
      contactsTable.dispatch_date,
    );

  return rows.map(r => {
    const c = r.contact;
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
      priority: c.last_call_outcome === "callback-requested" ? "callback" :
                c.last_call_outcome === "interested" ? "follow-up" :
                c.last_call_outcome === "no-answer" ? "retry" : "fresh",
    };
  });
}
