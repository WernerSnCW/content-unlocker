import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

/**
 * App user identity — populated on first successful Google SSO.
 * A user MAY be linked to an agent row via agents.user_id; that linkage
 * is established at first login by matching user.email to agents.email.
 */
export const usersTable = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  google_sub: text("google_sub").notNull().unique(), // stable Google user ID (sub claim)
  email: text("email").notNull().unique(),
  name: text("name"),
  picture: text("picture"),
  // OAuth tokens — stored for future Calendar scope use.
  // refresh_token is only returned on first consent (access_type=offline, prompt=consent).
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  token_expires_at: timestamp("token_expires_at", { withTimezone: true }),
  scopes: text("scopes"), // space-separated OAuth scopes currently granted
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  last_login_at: timestamp("last_login_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, created_at: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
