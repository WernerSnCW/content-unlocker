import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videosTable = pgTable("videos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  script_content: text("script_content"),
  duration_seconds: integer("duration_seconds"),
  format: text("format").notNull().default("portrait_mp4"),
  send_method: text("send_method").notNull().default("whatsapp"),
  persona_relevance: jsonb("persona_relevance").notNull().default([]),
  stage_relevance: jsonb("stage_relevance").notNull().default([]),
  objections_addressed: jsonb("objections_addressed").notNull().default([]),
  lifecycle_status: text("lifecycle_status").notNull().default("DRAFT"),
  review_state: text("review_state").notNull().default("REQUIRES_REVIEW"),
  created_at: text("created_at").notNull().default(""),
  updated_at: text("updated_at").notNull().default(""),
});

export const insertVideoSchema = createInsertSchema(videosTable);
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videosTable.$inferSelect;
