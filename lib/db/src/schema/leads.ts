import { pgTable, text, boolean, timestamp, jsonb, doublePrecision, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadsTable = pgTable("leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  pipeline_stage: text("pipeline_stage").notNull().default("Outreach"),
  first_contact: text("first_contact").notNull(),
  last_contact: text("last_contact").notNull(),
  detected_persona: text("detected_persona"),
  confirmed_persona: text("confirmed_persona"),
  confirmed_archetype: text("confirmed_archetype"),
  persona_confidence: doublePrecision("persona_confidence"),
  stage_confidence: doublePrecision("stage_confidence"),
  archived: boolean("archived").notNull().default(false),
  send_log: jsonb("send_log").notNull().default([]),
  stage_history: jsonb("stage_history").notNull().default([]),
  notes_legacy: jsonb("notes_legacy").default([]),
  notes: text("notes"),
  source: text("source"),
  transcript_filename: text("transcript_filename"),
  transcript_text: text("transcript_text"),

  // Contact details (for Pipedrive sync + Aircall matching)
  email: text("email"),
  phone: text("phone"),

  // Call outcome tracking (for Aircall integration + call queue)
  call_attempts: integer("call_attempts").notNull().default(0),
  last_call_outcome: text("last_call_outcome"), // interested, no-interest, no-answer, callback-requested, meeting-booked, not-now
  callback_date: timestamp("callback_date", { withTimezone: true }),
  outreach_paused_until: timestamp("outreach_paused_until", { withTimezone: true }),

  // Campaign/batch tracking (for Pipedrive field mapping + wave tracking)
  batch_date: text("batch_date"),
  campaign_name: text("campaign_name"),
  sequence_stage: text("sequence_stage"),

  // External CRM link (for Pipedrive sync)
  pipedrive_person_id: integer("pipedrive_person_id").unique(),

  // Link to contact pool (set when contact's first transcript is analysed)
  contact_id: text("contact_id"),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ created_at: true, updated_at: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
