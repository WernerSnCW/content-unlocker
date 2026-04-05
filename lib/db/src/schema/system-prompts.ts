import { pgTable, text, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemPromptsTable = pgTable("system_prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  prompt_text: text("prompt_text").notNull(),
  rubric_score: integer("rubric_score"),
  version: integer("version").default(1),
  status: text("status").default("ACTIVE"),
  last_reviewed: text("last_reviewed"),
  reviewed_by: text("reviewed_by"),
});

export const insertSystemPromptSchema = createInsertSchema(systemPromptsTable);
export type InsertSystemPrompt = z.infer<typeof insertSystemPromptSchema>;
export type SystemPrompt = typeof systemPromptsTable.$inferSelect;
