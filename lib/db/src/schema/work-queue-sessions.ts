import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const workQueueSessionsTable = pgTable("work_queue_sessions", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  status: text("status").notNull().default("PENDING"),
  started_at: timestamp("started_at").defaultNow(),
  completed_at: timestamp("completed_at"),
  total_tasks: integer("total_tasks").default(0),
  analysed_tasks: integer("analysed_tasks").default(0),
  auto_fixed_count: integer("auto_fixed_count").default(0),
  cards_total: integer("cards_total").default(0),
  cards_resolved: integer("cards_resolved").default(0),
  cards_skipped: integer("cards_skipped").default(0),
  cascaded_count: integer("cascaded_count").default(0),
  error_message: text("error_message"),
});

export const insertWorkQueueSessionSchema = createInsertSchema(workQueueSessionsTable).omit({ id: true });
export type InsertWorkQueueSession = z.infer<typeof insertWorkQueueSessionSchema>;
export type WorkQueueSession = typeof workQueueSessionsTable.$inferSelect;
