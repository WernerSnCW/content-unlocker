import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { workQueueSessionsTable } from "./work-queue-sessions";

export const workQueueFindingsTable = pgTable("work_queue_findings", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  session_id: text("session_id").notNull().references(() => workQueueSessionsTable.id),
  task_id: text("task_id").notNull(),
  document_id: text("document_id").notNull(),
  document_name: text("document_name").notNull(),
  document_tier: integer("document_tier").notNull(),
  finding_type: text("finding_type").notNull(),
  issue_description: text("issue_description").notNull(),
  proposed_fix: text("proposed_fix"),
  original_text: text("original_text"),
  status: text("status").notNull().default("PENDING"),
  skip_reason: text("skip_reason"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
  resolved_at: timestamp("resolved_at"),
});

export const insertWorkQueueFindingSchema = createInsertSchema(workQueueFindingsTable).omit({ id: true });
export type InsertWorkQueueFinding = z.infer<typeof insertWorkQueueFindingSchema>;
export type WorkQueueFinding = typeof workQueueFindingsTable.$inferSelect;
