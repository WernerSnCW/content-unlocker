import { pgTable, text, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
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
  notes: jsonb("notes").notNull().default([]),
  source: text("source"),
  transcript_filename: text("transcript_filename"),
  transcript_text: text("transcript_text"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ created_at: true, updated_at: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
