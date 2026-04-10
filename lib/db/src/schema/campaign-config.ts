import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const campaignConfigsTable = pgTable("campaign_configs", {
  id: text("id").primaryKey().$defaultFn(() => `campaign_${randomUUID().slice(0, 8)}`),
  name: text("name").notNull(),

  // Filter criteria for selecting contacts from the pool
  filter_criteria: jsonb("filter_criteria").notNull().default({}),
  // Example: { source_lists: ["London HNW"], companies: [], exclude_outcomes: ["no-interest"] }

  daily_quota: integer("daily_quota").notNull().default(100),
  assigned_agent_id: text("assigned_agent_id"), // FK to agents table
  active: boolean("active").notNull().default(true),

  // Stats (updated on each dispatch)
  total_dispatched: integer("total_dispatched").notNull().default(0),
  total_called: integer("total_called").notNull().default(0),
  total_qualified: integer("total_qualified").notNull().default(0),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampaignConfigSchema = createInsertSchema(campaignConfigsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertCampaignConfig = z.infer<typeof insertCampaignConfigSchema>;
export type CampaignConfig = typeof campaignConfigsTable.$inferSelect;
