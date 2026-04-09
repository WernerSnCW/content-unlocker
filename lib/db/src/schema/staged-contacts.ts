import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { uploadSessionsTable } from "./upload-sessions";

export const stagedContactsTable = pgTable("staged_contacts", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  session_id: text("session_id").notNull().references(() => uploadSessionsTable.id),
  row_number: integer("row_number").notNull(),

  // Parsed & normalised contact data
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),

  // Dedup result
  dedup_status: text("dedup_status").notNull().default("pending"), // new, exact_duplicate, possible_match, invalid
  match_reason: text("match_reason"),
  matched_contact_id: text("matched_contact_id"), // ID of existing contact that matched
  matched_details: jsonb("matched_details").default({}), // {first_name, last_name, email, phone, company} of match

  // User decision (for possible matches)
  decision: text("decision"), // skip, update, create (null = pending)

  // Validation
  invalid_reason: text("invalid_reason"),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStagedContactSchema = createInsertSchema(stagedContactsTable).omit({ id: true, created_at: true });
export type InsertStagedContact = z.infer<typeof insertStagedContactSchema>;
export type StagedContact = typeof stagedContactsTable.$inferSelect;
