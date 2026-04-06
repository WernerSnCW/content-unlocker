import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { leadsTable } from "./leads";
import { beliefRegistryTable } from "./belief-registry";

export const leadBeliefsTable = pgTable("lead_beliefs", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  lead_id: text("lead_id").notNull().references(() => leadsTable.id),
  belief_id: text("belief_id").notNull().references(() => beliefRegistryTable.id),
  state: text("state").notNull().default("UNKNOWN"),
  investor_relevance: text("investor_relevance").default("standard"),
  relevance_rationale: text("relevance_rationale"),
  established_date: text("established_date"),
  evidence: text("evidence"),
  evidence_source: text("evidence_source"),
  confidence: text("confidence"),
  last_updated: timestamp("last_updated").defaultNow(),
  updated_by: text("updated_by"),
}, (table) => ({
  unique_lead_belief: unique().on(table.lead_id, table.belief_id),
}));

export const insertLeadBeliefsSchema = createInsertSchema(leadBeliefsTable).omit({ id: true });
export type InsertLeadBelief = z.infer<typeof insertLeadBeliefsSchema>;
export type LeadBelief = typeof leadBeliefsTable.$inferSelect;
