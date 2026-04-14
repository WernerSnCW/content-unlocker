import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { callListConfigsTable } from "./call-list-config";
import { contactsTable } from "./contacts";

export const callListMembershipsTable = pgTable("call_list_memberships", {
  id: text("id").primaryKey().$defaultFn(() => `mem_${randomUUID().slice(0, 8)}`),
  call_list_id: text("call_list_id").notNull().references(() => callListConfigsTable.id),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  added_at: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  removed_at: timestamp("removed_at", { withTimezone: true }), // null = active
  removal_reason: text("removal_reason"), // called, reconciled, carried_over
  outcome_at_removal: text("outcome_at_removal"), // snapshot of last_call_outcome when removed
  carried_from_id: text("carried_from_id"), // self-FK to previous membership if carried over
}, (t) => ({
  // Only one active membership per contact at a time (partial unique index on removed_at IS NULL)
  activeContactIdx: uniqueIndex("call_list_memberships_active_contact_idx")
    .on(t.contact_id)
    .where(sql`${t.removed_at} IS NULL`),
  listActiveIdx: index("call_list_memberships_list_active_idx")
    .on(t.call_list_id, t.removed_at),
}));

export const insertCallListMembershipSchema = createInsertSchema(callListMembershipsTable).omit({ id: true, added_at: true });
export type InsertCallListMembership = z.infer<typeof insertCallListMembershipSchema>;
export type CallListMembership = typeof callListMembershipsTable.$inferSelect;
