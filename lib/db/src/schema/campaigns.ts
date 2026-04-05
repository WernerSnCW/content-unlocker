import { pgTable, text, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("DRAFT"),
  target_cluster: text("target_cluster").notNull(),
  personas: jsonb("personas").notNull().default([]),
  entry_stage: text("entry_stage").notNull(),
  target_stage: text("target_stage").notNull(),
  channels: jsonb("channels").notNull().default([]),
  duration_weeks: integer("duration_weeks").notNull().default(8),
  daily_volume: integer("daily_volume"),
  primary_belief: text("primary_belief"),
  secondary_beliefs: jsonb("secondary_beliefs").notNull().default([]),
  primary_cta: text("primary_cta"),
  secondary_cta: text("secondary_cta"),
  lead_magnet: text("lead_magnet"),
  compliance_constraints: jsonb("compliance_constraints").notNull().default([]),
  blocked_content: jsonb("blocked_content").notNull().default([]),
  prohibited_acus: jsonb("prohibited_acus").notNull().default([]),
  notes: text("notes"),
  sequence: jsonb("sequence").notNull().default([]),
  qc_status: text("qc_status").notNull().default("PENDING"),
  qc_report: jsonb("qc_report"),
  asset_count: integer("asset_count").notNull().default(0),
  assets_passed_qc: integer("assets_passed_qc").notNull().default(0),
  created_at: text("created_at").notNull(),
  activated_at: text("activated_at"),
});

export const campaignAssetsTable = pgTable("campaign_assets", {
  id: text("id").primaryKey(),
  campaign_id: text("campaign_id").notNull(),
  node_id: text("node_id").notNull(),
  channel: text("channel").notNull(),
  output_type: text("output_type").notNull(),
  content: text("content"),
  title: text("title").notNull(),
  day: integer("day").notNull().default(0),
  sequence_position: integer("sequence_position").notNull().default(0),
  branch_condition: text("branch_condition"),
  word_count: integer("word_count"),
  status: text("status").notNull().default("PENDING"),
  qc_status: text("qc_status").notNull().default("PENDING"),
  qc_report: jsonb("qc_report"),
  metadata: jsonb("metadata").notNull().default({}),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable);
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const insertCampaignAssetSchema = createInsertSchema(campaignAssetsTable);
export type InsertCampaignAsset = z.infer<typeof insertCampaignAssetSchema>;
export type CampaignAsset = typeof campaignAssetsTable.$inferSelect;
