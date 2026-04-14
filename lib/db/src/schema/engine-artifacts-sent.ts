import { pgTable, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";

// Log of content dispatched to a contact as a result of an engine
// recommendation. Populated when the system actually sends the document;
// engine itself only recommends.
export const engineArtifactsSentTable = pgTable("engine_artifacts_sent", {
  id: text("id").primaryKey().$defaultFn(() => `art_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  doc_id: integer("doc_id").notNull(),
  doc_name: text("doc_name").notNull(),
  trigger_signal: text("trigger_signal"),
  cover_note: text("cover_note"),
  engine_run_id: text("engine_run_id"), // soft ref to engine_runs
  sent_at: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  opened: boolean("opened"),
  opened_at: timestamp("opened_at", { withTimezone: true }),
}, (t) => ({
  contactIdx: index("engine_artifacts_contact_idx").on(t.contact_id, t.sent_at),
}));

export const insertEngineArtifactSentSchema = createInsertSchema(engineArtifactsSentTable).omit({ id: true, sent_at: true });
export type InsertEngineArtifactSent = z.infer<typeof insertEngineArtifactSentSchema>;
export type EngineArtifactSent = typeof engineArtifactsSentTable.$inferSelect;
