import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sheetSyncSessionsTable = pgTable("sheet_sync_sessions", {
  id: text("id").primaryKey(),
  sheet_url: text("sheet_url").notNull(),
  status: text("status").notNull().default("RUNNING"),
  rows_found: integer("rows_found").notNull().default(0),
  leads_created: integer("leads_created").notNull().default(0),
  leads_updated: integer("leads_updated").notNull().default(0),
  leads_skipped: integer("leads_skipped").notNull().default(0),
  rows_failed: integer("rows_failed").notNull().default(0),
  error_message: text("error_message"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
});

export const insertSheetSyncSessionSchema = createInsertSchema(sheetSyncSessionsTable).omit({ created_at: true });
export type InsertSheetSyncSession = z.infer<typeof insertSheetSyncSessionSchema>;
export type SheetSyncSession = typeof sheetSyncSessionsTable.$inferSelect;
