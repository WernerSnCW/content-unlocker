import { pgTable, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const acuCandidatesTable = pgTable("acu_candidates", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  importance_level: integer("importance_level"),
  importance_label: text("importance_label"),
  importance_rationale: text("importance_rationale"),
  source_document_id: text("source_document_id"),
  source_context: text("source_context"),
  appears_in_documents: jsonb("appears_in_documents").notNull().default([]),
  existing_acu_id: text("existing_acu_id"),
  status: text("status").notNull().default("PENDING_REVIEW"),
  scan_date: text("scan_date"),
  reviewed_by: text("reviewed_by"),
  review_date: text("review_date"),
  review_action: text("review_action"),
  notes: text("notes"),
});

export const acuContradictionsTable = pgTable("acu_contradictions", {
  id: text("id").primaryKey(),
  unit_a_id: text("unit_a_id"),
  unit_b_id: text("unit_b_id"),
  unit_a_content: text("unit_a_content"),
  unit_b_content: text("unit_b_content"),
  conflict_description: text("conflict_description"),
  severity: text("severity"),
  status: text("status").notNull().default("UNRESOLVED"),
  resolution: text("resolution"),
  resolved_by: text("resolved_by"),
  resolved_date: text("resolved_date"),
});

export const acuScanLogTable = pgTable("acu_scan_log", {
  id: text("id").primaryKey(),
  scan_date: text("scan_date"),
  documents_scanned: integer("documents_scanned"),
  candidates_found: integer("candidates_found"),
  new_candidates: integer("new_candidates"),
  duplicates_found: integer("duplicates_found"),
  contradictions_found: integer("contradictions_found"),
  scan_duration_ms: integer("scan_duration_ms"),
});

export const insertAcuCandidateSchema = createInsertSchema(acuCandidatesTable);
export type InsertAcuCandidate = z.infer<typeof insertAcuCandidateSchema>;
export type AcuCandidate = typeof acuCandidatesTable.$inferSelect;

export const insertAcuContradictionSchema = createInsertSchema(acuContradictionsTable);
export type InsertAcuContradiction = z.infer<typeof insertAcuContradictionSchema>;
export type AcuContradiction = typeof acuContradictionsTable.$inferSelect;

export const insertAcuScanLogSchema = createInsertSchema(acuScanLogTable);
export type InsertAcuScanLog = z.infer<typeof insertAcuScanLogSchema>;
export type AcuScanLog = typeof acuScanLogTable.$inferSelect;
