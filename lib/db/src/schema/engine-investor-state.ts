import { pgTable, text, timestamp, jsonb, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";

// Per-contact profile state maintained by the V2 intelligence engine.
// One row per contact. Mirrors the Investor interface minus signals (which
// live in engine_signals) and callHistory (which lives in lead_conversations).
export const engineInvestorStateTable = pgTable("engine_investor_state", {
  id: text("id").primaryKey().$defaultFn(() => `eis_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().unique().references(() => contactsTable.id),

  persona: text("persona").notNull().default("undetermined"), // preserver | growth_seeker | legacy_builder | undetermined
  persona_confidence: text("persona_confidence"),
  persona_evidence: text("persona_evidence"),

  hot_button: text("hot_button"), // family | freedom | legacy | relief | significance
  hot_button_evidence: text("hot_button_evidence"),

  demo_score: integer("demo_score"),
  book_track: text("book_track"), // book_1 | nurture
  decision_style: text("decision_style").notNull().default("unknown"),
  pack1_gate: text("pack1_gate").notNull().default("blocked"),

  // Fact find — free-text fields captured from the transcript
  practical_problem: text("practical_problem"),
  current_pressure: text("current_pressure"),
  personal_angle: text("personal_angle"),
  desired_outcome: text("desired_outcome"),
  exact_phrases: jsonb("exact_phrases").default([]).$type<string[]>(),
  portfolio_shape: text("portfolio_shape"),
  annual_tax_liability: numeric("annual_tax_liability"),
  decision_stakeholders: text("decision_stakeholders"),
  questions_for_call3: text("questions_for_call3"),

  engine_version: text("engine_version"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEngineInvestorStateSchema = createInsertSchema(engineInvestorStateTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertEngineInvestorState = z.infer<typeof insertEngineInvestorStateSchema>;
export type EngineInvestorState = typeof engineInvestorStateTable.$inferSelect;
