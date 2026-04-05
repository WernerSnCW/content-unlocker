import { pgTable, text, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const outputTemplatesTable = pgTable("output_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  output_type: text("output_type").notNull(),
  channel: text("channel"),
  parent_template_id: text("parent_template_id"),
  sections: jsonb("sections").notNull(),
  formatting_rules: jsonb("formatting_rules").notNull(),
  required_acus: jsonb("required_acus").default([]),
  prohibited_acus: jsonb("prohibited_acus").default([]),
  generation_prompt_prefix: text("generation_prompt_prefix"),
  export_formats: jsonb("export_formats").default(["docx"]),
  version: integer("version").default(1),
});

export const insertOutputTemplateSchema = createInsertSchema(outputTemplatesTable);
export type InsertOutputTemplate = z.infer<typeof insertOutputTemplateSchema>;
export type OutputTemplate = typeof outputTemplatesTable.$inferSelect;
