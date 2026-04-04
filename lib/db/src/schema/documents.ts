import { pgTable, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const documentsTable = pgTable("documents", {
  id: text("id").primaryKey(),
  file_code: text("file_code").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  filename: text("filename").notNull(),
  tier: integer("tier").notNull(),
  category: text("category").notNull(),
  lifecycle_status: text("lifecycle_status").notNull().default("CURRENT"),
  review_state: text("review_state").notNull().default("CLEAN"),
  version: integer("version").notNull().default(1),
  last_reviewed: text("last_reviewed").notNull(),
  description: text("description").notNull(),
  pipeline_stage_relevance: jsonb("pipeline_stage_relevance").notNull().default([]),
  persona_relevance: jsonb("persona_relevance").notNull().default([]),
  upstream_dependencies: jsonb("upstream_dependencies").notNull().default([]),
  downstream_dependents: jsonb("downstream_dependents").notNull().default([]),
  is_generated: boolean("is_generated").notNull().default(false),
  generation_brief_id: text("generation_brief_id"),
  generation_attempt: integer("generation_attempt"),
  qc_report_id: text("qc_report_id"),
  source_trace: jsonb("source_trace").notNull().default([]),
  content: text("content"),
  qc_history: jsonb("qc_history").notNull().default([]),
  gdoc_id: text("gdoc_id"),
  gdoc_url: text("gdoc_url"),
  source_pdf_path: text("source_pdf_path"),
  source_pdf_filename: text("source_pdf_filename"),
  source_pdf_imported_at: text("source_pdf_imported_at"),
  output_type: text("output_type").notNull().default("whitepaper"),
  channel: text("channel"),
  campaign_id: text("campaign_id"),
  sequence_position: integer("sequence_position"),
  sequence_id: text("sequence_id"),
  word_count: integer("word_count"),
  branch_condition: text("branch_condition"),
});

export const insertDocumentSchema = createInsertSchema(documentsTable);
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
