import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const complianceConstantsTable = pgTable("compliance_constants", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  value_type: text("value_type").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  is_prohibited: boolean("is_prohibited").notNull().default(false),
  prohibited_reason: text("prohibited_reason"),
  subject_to_qualifier: boolean("subject_to_qualifier").notNull().default(false),
  qualifier_text: text("qualifier_text"),
  category: text("category").notNull(),
  notes: text("notes"),
  superseded_by: text("superseded_by"),
  override_reason: text("override_reason"),
  actor: text("actor"),
  source: text("source").notNull().default("manual_ui"),
  activated_at: timestamp("activated_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const insertComplianceConstantSchema = createInsertSchema(complianceConstantsTable);
export type InsertComplianceConstant = z.infer<typeof insertComplianceConstantSchema>;
export type ComplianceConstant = typeof complianceConstantsTable.$inferSelect;
