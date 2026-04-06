import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { leadsTable } from "./leads";

export const leadIntelligenceTable = pgTable("lead_intelligence", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  lead_id: text("lead_id").notNull().unique().references(() => leadsTable.id),

  qualification_status: text("qualification_status").default("INSUFFICIENT_DATA"),
  higher_rate_taxpayer: boolean("higher_rate_taxpayer"),
  capital_available: boolean("capital_available"),
  self_directed: boolean("self_directed"),
  open_to_early_stage_risk: boolean("open_to_early_stage_risk"),
  qualification_notes: text("qualification_notes"),

  cluster: text("cluster"),
  ifa_involved: boolean("ifa_involved"),
  already_done_eis: boolean("already_done_eis"),
  estate_above_2m: boolean("estate_above_2m"),
  assets_abroad: boolean("assets_abroad"),
  vct_aim_experience: boolean("vct_aim_experience"),

  hot_button: text("hot_button"),
  hot_button_confirmed: boolean("hot_button_confirmed").default(false),
  hot_button_quote: text("hot_button_quote"),
  spin_situation: text("spin_situation"),
  spin_problem: text("spin_problem"),
  spin_implication: text("spin_implication"),
  spin_need_payoff: text("spin_need_payoff"),

  readiness_status: text("readiness_status"),
  primary_blocker: text("primary_blocker"),
  blocker_type: text("blocker_type"),
  recommended_action: text("recommended_action"),

  profile_summary: text("profile_summary"),

  last_updated: timestamp("last_updated").defaultNow(),
});

export const insertLeadIntelligenceSchema = createInsertSchema(leadIntelligenceTable).omit({ id: true });
export type InsertLeadIntelligence = z.infer<typeof insertLeadIntelligenceSchema>;
export type LeadIntelligence = typeof leadIntelligenceTable.$inferSelect;
