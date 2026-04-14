import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";
import { leadConversationsTable } from "./lead-conversations";

// Every invocation of processTranscript(). Stores the full EngineOutput
// JSON for replay/debug and for reconstructing decisions after the fact.
export const engineRunsTable = pgTable("engine_runs", {
  id: text("id").primaryKey().$defaultFn(() => `run_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  conversation_id: text("conversation_id").references(() => leadConversationsTable.id),
  call_type: text("call_type").notNull(), // cold_call | demo | opportunity
  engine_version: text("engine_version").notNull(),
  output: jsonb("output").notNull(), // full EngineOutput
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("engine_runs_contact_idx").on(t.contact_id, t.created_at),
}));

export const insertEngineRunSchema = createInsertSchema(engineRunsTable).omit({ id: true, created_at: true });
export type InsertEngineRun = z.infer<typeof insertEngineRunSchema>;
export type EngineRun = typeof engineRunsTable.$inferSelect;
