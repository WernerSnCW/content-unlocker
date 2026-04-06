import { pgTable, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const beliefRegistryTable = pgTable("belief_registry", {
  id: text("id").primaryKey(),
  cluster: text("cluster").notNull(),
  cluster_display_name: text("cluster_display_name"),
  cluster_tagline: text("cluster_tagline"),
  name: text("name").notNull(),
  description: text("description"),
  belief_type: text("belief_type").notNull(),
  policy_status: text("policy_status").default("active"),
  gates: jsonb("gates").default([]),
  prerequisite_beliefs: jsonb("prerequisite_beliefs").default([]),
  is_hard_gate: boolean("is_hard_gate").default(false),
  primary_document_id: text("primary_document_id"),
  supporting_document_ids: jsonb("supporting_document_ids").default([]),
  created_at: timestamp("created_at").defaultNow(),
});

export const insertBeliefRegistrySchema = createInsertSchema(beliefRegistryTable);
export type InsertBeliefRegistry = z.infer<typeof insertBeliefRegistrySchema>;
export type BeliefRegistry = typeof beliefRegistryTable.$inferSelect;
