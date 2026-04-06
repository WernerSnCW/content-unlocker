import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "crypto";

export const beliefTransitionsTable = pgTable("belief_transitions", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  lead_id: text("lead_id").notNull(),
  belief_id: text("belief_id").notNull(),
  from_state: text("from_state").notNull(),
  to_state: text("to_state").notNull(),
  transition_date: timestamp("transition_date").defaultNow(),
  triggered_by: text("triggered_by"),
  notes: text("notes"),
});

export const insertBeliefTransitionsSchema = createInsertSchema(beliefTransitionsTable).omit({ id: true });
export type InsertBeliefTransition = z.infer<typeof insertBeliefTransitionsSchema>;
export type BeliefTransition = typeof beliefTransitionsTable.$inferSelect;
