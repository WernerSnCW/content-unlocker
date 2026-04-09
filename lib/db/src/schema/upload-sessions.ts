import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const uploadSessionsTable = pgTable("upload_sessions", {
  id: text("id").primaryKey().$defaultFn(() => `upload_${randomUUID().slice(0, 8)}`),
  source_list: text("source_list").notNull(),
  filename: text("filename"),
  uploaded_by: text("uploaded_by"),
  status: text("status").notNull().default("processing"), // processing, ready_for_review, committed, cancelled
  total_rows: integer("total_rows").notNull().default(0),
  new_count: integer("new_count").notNull().default(0),
  duplicate_count: integer("duplicate_count").notNull().default(0),
  possible_match_count: integer("possible_match_count").notNull().default(0),
  invalid_count: integer("invalid_count").notNull().default(0),
  committed_count: integer("committed_count").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUploadSessionSchema = createInsertSchema(uploadSessionsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertUploadSession = z.infer<typeof insertUploadSessionSchema>;
export type UploadSession = typeof uploadSessionsTable.$inferSelect;
