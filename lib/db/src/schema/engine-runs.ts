import { pgTable, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";
import { contactsTable } from "./contacts";
import { leadConversationsTable } from "./lead-conversations";

// Every invocation of processTranscript(). Stores the full EngineOutput
// JSON for replay/debug and for reconstructing decisions after the fact.
export const engineRunsTable = pgTable("engine_runs", {
  id: text("id").primaryKey().$defaultFn(() => `run_${randomUUID().slice(0, 8)}`),
  contact_id: text("contact_id").notNull().references(() => contactsTable.id),
  conversation_id: text("conversation_id").references(() => leadConversationsTable.id),
  call_type: text("call_type").notNull(), // cold_call | demo | opportunity
  engine_version: text("engine_version").notNull(),
  output: jsonb("output").notNull(), // full EngineOutput

  // Phase 4.9 — Layer 1 LLM extraction audit.
  // status: "ok" = extraction (or keyword path) succeeded and produced
  //   this output. "failed" = Layer 1 call errored and we persisted a
  //   placeholder; admin can reprocess. "keyword" = legacy pattern-based
  //   path ran (pre-4.9 or flag off).
  status: text("status").notNull().default("keyword"),
  llm_extraction: jsonb("llm_extraction"),     // the raw LLMExtractionResult when status=ok
  llm_model: text("llm_model"),                 // e.g. "claude-sonnet-4-6"
  llm_latency_ms: integer("llm_latency_ms"),
  llm_input_tokens: integer("llm_input_tokens"),
  llm_output_tokens: integer("llm_output_tokens"),
  llm_cache_read_tokens: integer("llm_cache_read_tokens"),
  llm_cache_creation_tokens: integer("llm_cache_creation_tokens"),
  llm_error: text("llm_error"),                 // populated when status=failed

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contactIdx: index("engine_runs_contact_idx").on(t.contact_id, t.created_at),
  statusIdx: index("engine_runs_status_idx").on(t.status, t.created_at),
}));

export const insertEngineRunSchema = createInsertSchema(engineRunsTable).omit({ id: true, created_at: true });
export type InsertEngineRun = z.infer<typeof insertEngineRunSchema>;
export type EngineRun = typeof engineRunsTable.$inferSelect;
