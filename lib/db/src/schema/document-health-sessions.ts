import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export const documentHealthSessionsTable = pgTable('document_health_sessions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  status: text('status').notNull().default('RUNNING'),
  started_at: timestamp('started_at').defaultNow(),
  completed_at: timestamp('completed_at'),
  documents_checked: integer('documents_checked').default(0),
  documents_healthy: integer('documents_healthy').default(0),
  documents_warning: integer('documents_warning').default(0),
  documents_failing: integer('documents_failing').default(0),
  error_message: text('error_message'),
});
