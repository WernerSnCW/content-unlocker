import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const integrationConfigsTable = pgTable("integration_configs", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  provider: text("provider").notNull().unique(), // aircall, pipedrive, fireflies, google_calendar
  config: jsonb("config").notNull().default({}), // provider-specific: credentials, webhook URL, settings
  enabled: boolean("enabled").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIntegrationConfigSchema = createInsertSchema(integrationConfigsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertIntegrationConfig = z.infer<typeof insertIntegrationConfigSchema>;
export type IntegrationConfig = typeof integrationConfigsTable.$inferSelect;

/*
Config JSONB structure per provider:

aircall: {
  api_id: string,
  api_token: string,
  webhook_token: string,
  webhook_url: string,
  transcription_mode: "ai_assist" | "external",
  transcription_api_key?: string,  // only if external
}

pipedrive: {
  api_token: string,
}

fireflies: {
  webhook_secret: string,
}

google_calendar: {
  client_id: string,
  client_secret: string,
  redirect_uri: string,
  access_token?: string,
  refresh_token?: string,
}
*/
