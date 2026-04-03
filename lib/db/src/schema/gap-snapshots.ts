import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const gapSnapshotsTable = pgTable("gap_snapshots", {
  id: text("id").primaryKey(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  matrix_gaps: jsonb("matrix_gaps").notNull().default([]),
  type_gaps: jsonb("type_gaps").notNull().default([]),
  recommendation_gaps: jsonb("recommendation_gaps").notNull().default([]),
  information_readiness: jsonb("information_readiness").notNull().default({}),
  summary: jsonb("summary").notNull().default({}),
  total_gaps: integer("total_gaps").notNull().default(0),
  file_path: text("file_path").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export type GapSnapshot = typeof gapSnapshotsTable.$inferSelect;
