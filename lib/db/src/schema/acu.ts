import { pgTable, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const acuTable = pgTable("approved_content_units", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("DRAFT"),
  source: text("source"),
  approved_by: text("approved_by"),
  approved_date: text("approved_date"),
  version: integer("version").notNull().default(1),
  expression_variants: jsonb("expression_variants").notNull().default([]),
  documents_referencing: jsonb("documents_referencing").notNull().default([]),
  cascade_on_change: boolean("cascade_on_change").notNull().default(true),
  notes: text("notes"),
});

export const insertAcuSchema = createInsertSchema(acuTable);
export type InsertAcu = z.infer<typeof insertAcuSchema>;
export type Acu = typeof acuTable.$inferSelect;
