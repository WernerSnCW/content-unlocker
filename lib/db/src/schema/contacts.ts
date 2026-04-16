import { pgTable, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const contactsTable = pgTable("contacts", {
  id: text("id").primaryKey().$defaultFn(() => `contact_${randomUUID().slice(0, 8)}`),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),

  // Ingestion tracking
  source_list: text("source_list"), // name of the CSV/list this contact came from
  upload_batch: text("upload_batch"), // batch ID for grouping uploads
  dedup_status: text("dedup_status").default("clean"), // clean, duplicate, merged

  // Dispatch state (source of truth for list membership is call_list_memberships)
  dispatch_status: text("dispatch_status").notNull().default("pool"), // pool, queued, dispatched, called, qualified, archived
  dispatch_date: timestamp("dispatch_date", { withTimezone: true }),

  // Call tracking
  call_attempts: integer("call_attempts").notNull().default(0),
  last_call_outcome: text("last_call_outcome"), // interested, no-interest, no-answer, callback-requested, meeting-booked, not-now
  callback_date: timestamp("callback_date", { withTimezone: true }),
  outreach_paused_until: timestamp("outreach_paused_until", { withTimezone: true }),
  cool_off_until: timestamp("cool_off_until", { withTimezone: true }),

  // Closer-handoff routing.
  //   NULL   — no handoff; contact is handled by outreach agents per normal tiers
  //   'any'  — any user with role='closer' can pick up
  //   <uuid> — specific user id (a closer) picks up
  // Stamped at tag-application time (applyTaggedOutcomeTx) based on the
  // tag_mapping entry's maps_to_closer + closer_agent_id fields. Closers
  // can pick up their own id or 'any'; other roles can't pick up anything
  // with this column set (unless no closers exist → fallback per config).
  assigned_closer_id: text("assigned_closer_id"),

  // External system IDs (null until pushed)
  aircall_contact_id: integer("aircall_contact_id").unique(),
  pipedrive_person_id: integer("pipedrive_person_id").unique(),
  pipedrive_deal_id: integer("pipedrive_deal_id"),

  // Link to intelligence layer (null until first transcript analysed)
  lead_id: text("lead_id"),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
