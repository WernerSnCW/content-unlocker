import { pgTable, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { usersTable } from "./users";

export const agentsTable = pgTable("agents", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  name: text("name").notNull(),
  email: text("email"),
  aircall_user_id: integer("aircall_user_id").unique(), // mapped to Aircall user
  // Linked app-user (Google SSO identity). Nullable so existing rows remain valid;
  // populated at first login by email match. Unique → one user ↔ one agent.
  user_id: text("user_id").unique().references(() => usersTable.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, created_at: true, updated_at: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
