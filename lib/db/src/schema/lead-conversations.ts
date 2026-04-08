import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { leadsTable } from "./leads";

export const leadConversationsTable = pgTable("lead_conversations", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  lead_id: text("lead_id").notNull().references(() => leadsTable.id),
  source: text("source").notNull(), // aircall, fireflies, manual
  external_id: text("external_id"), // Aircall call ID, Fireflies meeting ID, etc.
  direction: text("direction"), // inbound, outbound
  duration_seconds: integer("duration_seconds"),
  participants: jsonb("participants").default([]), // [{name, role, email, phone}]
  transcript_text: text("transcript_text"),
  summary: text("summary"),
  beliefs_before: jsonb("beliefs_before").default({}), // {belief_id: state} snapshot
  beliefs_after: jsonb("beliefs_after").default({}), // {belief_id: state} snapshot
  intelligence_delta: jsonb("intelligence_delta").default({}), // what changed in intelligence profile
  call_outcome: text("call_outcome"), // interested, no-interest, no-answer, callback-requested, meeting-booked, not-now
  agent_name: text("agent_name"),
  tags: jsonb("tags").default([]),
  processed_at: timestamp("processed_at", { withTimezone: true }),
  conversation_date: timestamp("conversation_date", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLeadConversationSchema = createInsertSchema(leadConversationsTable).omit({ id: true, created_at: true });
export type InsertLeadConversation = z.infer<typeof insertLeadConversationSchema>;
export type LeadConversation = typeof leadConversationsTable.$inferSelect;
