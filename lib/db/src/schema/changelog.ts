import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const changelogTable = pgTable("changelog", {
  id: text("id").primaryKey(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  action: text("action").notNull(),
  document_id: text("document_id"),
  lead_id: text("lead_id"),
  details: text("details").notNull(),
  triggered_by: text("triggered_by"),
});

export const insertChangelogSchema = createInsertSchema(changelogTable).omit({ timestamp: true });
export type InsertChangelog = z.infer<typeof insertChangelogSchema>;
export type Changelog = typeof changelogTable.$inferSelect;
