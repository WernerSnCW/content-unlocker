import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";

// Audit log of every signal state change. Append-only.
export const engineSignalTransitionsTable = pgTable("engine_signal_transitions", {
  id: text("id").primaryKey().$defaultFn(() => `trn_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  code: text("code").notNull(),
  from_state: text("from_state"),
  to_state: text("to_state").notNull(),
  evidence: text("evidence"),
  confidence: text("confidence"),
  engine_run_id: text("engine_run_id"), // FK to engine_runs (soft ref to avoid cycle)
  engine_version: text("engine_version"),
  transitioned_at: timestamp("transitioned_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("engine_signal_transitions_contact_idx").on(t.contact_id, t.transitioned_at),
}));

export const insertEngineSignalTransitionSchema = createInsertSchema(engineSignalTransitionsTable).omit({ id: true, transitioned_at: true });
export type InsertEngineSignalTransition = z.infer<typeof insertEngineSignalTransitionSchema>;
export type EngineSignalTransition = typeof engineSignalTransitionsTable.$inferSelect;
