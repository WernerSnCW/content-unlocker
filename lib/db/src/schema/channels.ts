import { pgTable, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelsTable = pgTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").notNull(),
  max_words: integer("max_words"),
  max_links: integer("max_links"),
  max_ctas: integer("max_ctas"),
  max_lines: integer("max_lines"),
  max_sentences: integer("max_sentences"),
  max_duration_seconds: integer("max_duration_seconds"),
  headline_max_chars: integer("headline_max_chars"),
  body_max_chars: integer("body_max_chars"),
  subject_max_words: integer("subject_max_words"),
  subject_max_chars: integer("subject_max_chars"),
  prohibited: jsonb("prohibited").notNull().default([]),
  formats: jsonb("formats").notNull().default([]),
  cta_options: jsonb("cta_options").notNull().default([]),
  requires_meta_approval: boolean("requires_meta_approval").notNull().default(false),
  requires_cta_button: boolean("requires_cta_button").notNull().default(false),
  video_thumbnail: boolean("video_thumbnail").notNull().default(false),
  from_address: text("from_address"),
  goal: text("goal"),
  max_objection_responses: integer("max_objection_responses"),
  notes: text("notes"),
});

export const insertChannelSchema = createInsertSchema(channelsTable);
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;
