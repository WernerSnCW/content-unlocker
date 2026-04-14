import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";

// Current signal state per contact. One row per (contact, signal code).
// States:
//   Belief signals: green | amber | grey | red | n_a
//   Qualification signals (QT/QL): confirmed | not_confirmed | unknown
export const engineSignalsTable = pgTable("engine_signals", {
  id: text("id").primaryKey().$defaultFn(() => `sig_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  code: text("code").notNull(), // QT, QL, C1-C4, G1-G3, L1-L2, P2-P3, S1-S6
  state: text("state").notNull(),
  surfaced_by: text("surfaced_by").notNull().default("not_yet"), // question | conversation | not_yet
  notes: text("notes"),
  evidence: text("evidence"),
  confidence: text("confidence").notNull().default("medium"), // high | medium | low
  engine_version: text("engine_version"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactCodeIdx: uniqueIndex("engine_signals_contact_code_idx").on(t.contact_id, t.code),
}));

export const insertEngineSignalSchema = createInsertSchema(engineSignalsTable).omit({ id: true, updated_at: true });
export type InsertEngineSignal = z.infer<typeof insertEngineSignalSchema>;
export type EngineSignal = typeof engineSignalsTable.$inferSelect;
