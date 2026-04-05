import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importSessionsTable = pgTable("import_sessions", {
  id: text("id").primaryKey(),
  file_name: text("file_name").notNull(),
  file_hash: text("file_hash").notNull(),
  status: text("status").notNull().default("PENDING"),
  total_blocks: integer("total_blocks").notNull().default(0),
  valid_blocks: integer("valid_blocks").notNull().default(0),
  rejected_blocks: integer("rejected_blocks").notNull().default(0),
  executed_blocks: integer("executed_blocks").notNull().default(0),
  failed_blocks: integer("failed_blocks").notNull().default(0),
  block_results: jsonb("block_results").notNull().default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  completed_at: timestamp("completed_at"),
});

export const insertImportSessionSchema = createInsertSchema(importSessionsTable);
export type InsertImportSession = z.infer<typeof insertImportSessionSchema>;
export type ImportSession = typeof importSessionsTable.$inferSelect;
