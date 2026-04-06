import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";
import { documentHealthSessionsTable } from "./document-health-sessions";

export const documentHealthScoresTable = pgTable('document_health_scores', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  session_id: text('session_id').notNull().references(() => documentHealthSessionsTable.id),
  document_id: text('document_id').notNull(),
  document_name: text('document_name').notNull(),
  document_tier: integer('document_tier').notNull(),
  document_file_code: text('document_file_code').notNull(),

  identity_status: text('identity_status').notNull().default('PASS'),
  identity_issues: jsonb('identity_issues').default([]),

  targeting_status: text('targeting_status').notNull().default('PASS'),
  targeting_issues: jsonb('targeting_issues').default([]),

  belief_status: text('belief_status').notNull().default('PASS'),
  belief_issues: jsonb('belief_issues').default([]),

  compliance_status: text('compliance_status').notNull().default('PASS'),
  compliance_issues: jsonb('compliance_issues').default([]),

  propagation_status: text('propagation_status').notNull().default('PASS'),
  propagation_issues: jsonb('propagation_issues').default([]),

  content_status: text('content_status').notNull().default('PASS'),
  content_issues: jsonb('content_issues').default([]),

  delivery_status: text('delivery_status').notNull().default('PASS'),
  delivery_issues: jsonb('delivery_issues').default([]),

  overall_status: text('overall_status').notNull().default('PASS'),

  created_at: timestamp('created_at').defaultNow(),
});
