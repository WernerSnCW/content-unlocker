import { db, contactsTable, campaignConfigsTable, agentsTable } from "@workspace/db";
import { eq, and, or, sql, isNull, lte, ne, notInArray, inArray } from "drizzle-orm";

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
const COOL_OFF_DAYS = 28;

/**
 * Get the current queue status for a campaign — how many contacts
 * are already queued for today vs how many are needed to hit quota.
 */
export async function getQueueStatus(campaignId: string): Promise<QueueStatus> {
  const [campaign] = await db.select().from(campaignConfigsTable)
    .where(eq(campaignConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Callbacks due today
  const [callbackResult] = await db.select({ count: sql<number>`count(*)` })
    .from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "callback-requested"),
      lte(contactsTable.callback_date, new Date()),
      ne(contactsTable.dispatch_status, "archived"),
    ));

  // 2. Interested follow-ups
  const [interestedResult] = await db.select({ count: sql<number>`count(*)` })
    .from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "interested"),
      ne(contactsTable.dispatch_status, "archived"),
      ne(contactsTable.dispatch_status, "qualified"),
    ));

  // 3. No-answer retries (under max attempts, not in cool-off)
  const [retryResult] = await db.select({ count: sql<number>`count(*)` })
    .from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "no-answer"),
      sql`${contactsTable.call_attempts} < ${MAX_CALL_ATTEMPTS}`,
      or(
        isNull(contactsTable.cool_off_until),
        lte(contactsTable.cool_off_until, new Date()),
      ),
      ne(contactsTable.dispatch_status, "archived"),
    ));

  // 4. Already dispatched today
  const [dispatchedResult] = await db.select({ count: sql<number>`count(*)` })
    .from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date = ${today.toISOString().split("T")[0]}::date`,
    ));

  const callbacks = Number(callbackResult.count);
  const interested = Number(interestedResult.count);
  const retries = Number(retryResult.count);
  const dispatchedToday = Number(dispatchedResult.count);

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
 * Fill the call queue for a campaign. Pulls from 4 sources in priority order:
 * 1. Callbacks due today
 * 2. Interested follow-ups
 * 3. No-answer retries (under max attempts)
 * 4. Fresh contacts from pool matching campaign filters
 */
export async function fillQueue(
  campaignId: string,
  count?: number
): Promise<DispatchResult> {
  const [campaign] = await db.select().from(campaignConfigsTable)
    .where(eq(campaignConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const status = await getQueueStatus(campaignId);
  const toFill = count ?? status.fresh_needed;
  if (toFill <= 0) return { dispatched: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  const now = new Date();
  const result: DispatchResult = { dispatched: 0, callbacks: 0, interested: 0, retries: 0, fresh: 0, errors: 0 };

  // 1. Mark callbacks as dispatched
  const callbacks = await db.select().from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "callback-requested"),
      lte(contactsTable.callback_date, now),
      ne(contactsTable.dispatch_status, "dispatched"),
      ne(contactsTable.dispatch_status, "archived"),
    ));

  for (const cb of callbacks) {
    try {
      await db.update(contactsTable).set({ dispatch_status: "dispatched", dispatch_date: now })
        .where(eq(contactsTable.id, cb.id));
      result.callbacks++;
      result.dispatched++;
    } catch { result.errors++; }
  }

  // 2. Mark interested as dispatched
  const interested = await db.select().from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "interested"),
      ne(contactsTable.dispatch_status, "dispatched"),
      ne(contactsTable.dispatch_status, "archived"),
      ne(contactsTable.dispatch_status, "qualified"),
    ));

  for (const int of interested) {
    try {
      await db.update(contactsTable).set({ dispatch_status: "dispatched", dispatch_date: now })
        .where(eq(contactsTable.id, int.id));
      result.interested++;
      result.dispatched++;
    } catch { result.errors++; }
  }

  // 3. Mark retries as dispatched
  const retries = await db.select().from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.last_call_outcome, "no-answer"),
      sql`${contactsTable.call_attempts} < ${MAX_CALL_ATTEMPTS}`,
      or(isNull(contactsTable.cool_off_until), lte(contactsTable.cool_off_until, now)),
      ne(contactsTable.dispatch_status, "dispatched"),
      ne(contactsTable.dispatch_status, "archived"),
    ));

  for (const retry of retries) {
    try {
      await db.update(contactsTable).set({ dispatch_status: "dispatched", dispatch_date: now })
        .where(eq(contactsTable.id, retry.id));
      result.retries++;
      result.dispatched++;
    } catch { result.errors++; }
  }

  // 4. Fresh contacts from pool
  const freshNeeded = toFill - result.dispatched;
  if (freshNeeded > 0) {
    // Build filter conditions based on campaign criteria
    const filterConditions = [
      eq(contactsTable.dispatch_status, "pool"),
      or(isNull(contactsTable.cool_off_until), lte(contactsTable.cool_off_until, now)),
    ];

    // Apply source_list filter if specified
    const criteria = campaign.filter_criteria as Record<string, any>;
    if (criteria?.source_lists && Array.isArray(criteria.source_lists) && criteria.source_lists.length > 0) {
      filterConditions.push(inArray(contactsTable.source_list, criteria.source_lists));
    }

    // Exclude contacts with specific outcomes
    const excludeOutcomes = criteria?.exclude_outcomes || ["no-interest"];
    if (excludeOutcomes.length > 0) {
      filterConditions.push(
        or(
          isNull(contactsTable.last_call_outcome),
          sql`${contactsTable.last_call_outcome} NOT IN (${sql.raw(excludeOutcomes.map((o: string) => `'${o}'`).join(","))})`,
        )!
      );
    }

    const freshContacts = await db.select().from(contactsTable)
      .where(and(...filterConditions.filter(Boolean)))
      .orderBy(sql`RANDOM()`)
      .limit(freshNeeded);

    for (const fresh of freshContacts) {
      try {
        await db.update(contactsTable).set({
          dispatch_status: "dispatched",
          dispatch_date: now,
          campaign_name: campaign.name,
        }).where(eq(contactsTable.id, fresh.id));
        result.fresh++;
        result.dispatched++;
      } catch { result.errors++; }
    }
  }

  // Update campaign stats
  await db.update(campaignConfigsTable).set({
    total_dispatched: sql`${campaignConfigsTable.total_dispatched} + ${result.dispatched}`,
  }).where(eq(campaignConfigsTable.id, campaignId));

  return result;
}

/**
 * Start-of-day reconciliation: contacts dispatched yesterday with no call
 * record get reset to "queued" so they re-enter the pool for today.
 */
export async function reconcileUncalledContacts(): Promise<number> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find contacts dispatched yesterday that are still in "dispatched" status
  // (if they were called, their status would have changed to "called")
  const uncalled = await db.select().from(contactsTable)
    .where(and(
      eq(contactsTable.dispatch_status, "dispatched"),
      sql`${contactsTable.dispatch_date}::date < ${today.toISOString().split("T")[0]}::date`,
    ));

  let resetCount = 0;
  for (const contact of uncalled) {
    try {
      await db.update(contactsTable).set({
        dispatch_status: "pool",
        dispatch_date: null,
      }).where(eq(contactsTable.id, contact.id));
      resetCount++;
    } catch { /* ignore */ }
  }

  return resetCount;
}

/**
 * Get today's call list for a campaign — all dispatched contacts in priority order.
 */
export async function getCallList(campaignId: string): Promise<any[]> {
  const [campaign] = await db.select().from(campaignConfigsTable)
    .where(eq(campaignConfigsTable.id, campaignId));

  if (!campaign) throw new Error("Campaign not found");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const contacts = await db.select().from(contactsTable)
    .where(and(
      eq(contactsTable.campaign_name, campaign.name),
      eq(contactsTable.dispatch_status, "dispatched"),
    ))
    .orderBy(
      // Priority: callbacks first, then interested, then retries, then fresh
      sql`CASE
        WHEN ${contactsTable.last_call_outcome} = 'callback-requested' THEN 1
        WHEN ${contactsTable.last_call_outcome} = 'interested' THEN 2
        WHEN ${contactsTable.last_call_outcome} = 'no-answer' THEN 3
        ELSE 4
      END`,
      contactsTable.dispatch_date,
    );

  return contacts.map(c => ({
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
  }));
}
