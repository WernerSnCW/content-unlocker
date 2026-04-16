import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const callListConfigsTable = pgTable("call_list_configs", {
  id: text("id").primaryKey().$defaultFn(() => `calllist_${randomUUID().slice(0, 8)}`),
  name: text("name").notNull(),

  // Filter criteria for selecting contacts from the pool
  filter_criteria: jsonb("filter_criteria").notNull().default({}),

  daily_quota: integer("daily_quota").notNull().default(100),
  assigned_agent_id: text("assigned_agent_id"),
  active: boolean("active").notNull().default(true),

  // When true, fillQueue runs ONLY the conversions tier (tier 0) on this list
  // — no callbacks, interested, retries, or fresh. Only meaningful when the
  // assigned agent has role='closer' or 'admin' (tier 0 is gated on role).
  // Used by closers who want to focus exclusively on conversion calls.
  closing_only: boolean("closing_only").notNull().default(false),

  // Stats
  total_dispatched: integer("total_dispatched").notNull().default(0),
  total_called: integer("total_called").notNull().default(0),
  total_qualified: integer("total_qualified").notNull().default(0),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCallListConfigSchema = createInsertSchema(callListConfigsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertCallListConfig = z.infer<typeof insertCallListConfigSchema>;
export type CallListConfig = typeof callListConfigsTable.$inferSelect;
