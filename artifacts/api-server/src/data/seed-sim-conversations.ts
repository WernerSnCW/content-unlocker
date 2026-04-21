// Phase 7.1a session 2 — Simulated long-duration conversations for
// NBA compare coverage.
//
// Werner's DB only has 60-second simulated cold calls. The compare-nba
// CLI needs demo (>=40 min) and opportunity (20-40 min) conversations
// too, to validate those rule branches against the legacy cascade in
// a real-data path. This seed inserts three clearly-labelled rows
// (id prefix `sim_nba_`) and a single sim contact (`sim_nba_contact`)
// to anchor them. Idempotent: skipped if already present.
//
// Safe to delete manually later:
//   DELETE FROM lead_conversations WHERE id LIKE 'sim_nba_%';
//   DELETE FROM contacts WHERE id = 'sim_nba_contact';

import { db, contactsTable, leadConversationsTable, engineRunsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { loadInvestor, processTranscript, saveEngineRun } from "../engine/v2";
import type { CallType } from "../engine/v2";
import { logger } from "./../lib/logger";

const SIM_CONTACT_ID = "sim_nba_contact";

interface SimConv {
  id: string;
  durationSeconds: number;
  callTypeHint: "cold_call" | "opportunity" | "demo";
  transcript: string;
}

const SIM_CONVERSATIONS: SimConv[] = [
  {
    id: "sim_nba_james_cold",
    durationSeconds: 600, // 10 min → cold_call
    callTypeHint: "cold_call",
    transcript: `
Agent: Hi James, it's Sarah calling from Unlock.
Agent: Are you familiar with EIS?
James: I've done EIS before through a Crowdcube fund but the fees are ridiculous.
I'm paying 3.5% annually and I can't even see what companies I'm in.
Agent: Are you paying additional rate?
James: Yes, additional rate. £180K income a year — I pay 45%.
Agent: Do you have capital available?
James: Just sold a rental property. Got about £640K sitting in cash.
Agent: What does the rest look like?
James: ISA at HL, SIPP, the Crowdcube stuff, another BTL property.
Agent: Is your main focus growth, protection, or wealth transfer?
James: Growth. I want better deals at lower fees. I'm after upside.
`.trim(),
  },
  {
    id: "sim_nba_margaret_demo",
    durationSeconds: 2520, // 42 min → demo
    callTypeHint: "demo",
    transcript: `
Tom: What's the main thing on your mind financially?
Margaret: I'm terrified of making a mistake I can't undo. I've got my SIPP at Aviva,
ISA at Hargreaves, some property, and a bit of cash. Nobody shows me the full picture.
I understand the EIS tax relief — 30% income tax, right? But I'm worried about
the risk. What happens if the company fails?
Margaret: OK so the downside is about 38p in the pound. That's better than I thought.
I'm interested in how the platform works for my situation specifically.
`.trim(),
  },
  {
    id: "sim_nba_duncan_opp",
    durationSeconds: 1800, // 30 min → opportunity
    callTypeHint: "opportunity",
    transcript: `
Tom: Has anything changed since we spoke?
Duncan: I've been reading through the document you sent. It all makes sense.
Tom: Based on everything we've discussed, what do you think?
Duncan: I want to do this, but I'd like to run it past my accountant first before committing.
Tom: Absolutely. Would a three-way call help?
Duncan: Yes, that would be useful.
`.trim(),
  },
];

/**
 * Idempotent. Creates the sim contact if missing, seeds the three
 * conversations, then runs the engine (keyword path) against each so
 * there are `engine_runs` rows for the Outcome Rules admin page's
 * trace view to pick up. Returns counts for logging.
 */
export async function seedSimConversations(): Promise<{
  contactCreated: boolean;
  conversationsCreated: number;
  runsCreated: number;
}> {
  // Ensure sim contact exists
  const [existingContact] = await db
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(eq(contactsTable.id, SIM_CONTACT_ID))
    .limit(1);

  let contactCreated = false;
  if (!existingContact) {
    await db.insert(contactsTable).values({
      id: SIM_CONTACT_ID,
      first_name: "NBA Sim",
      last_name: "Contact",
      email: null,
      phone: null,
      source_list: "nba_rule_engine_sim",
      dispatch_status: "archived",
    });
    contactCreated = true;
  }

  let conversationsCreated = 0;
  for (const c of SIM_CONVERSATIONS) {
    const [existingConv] = await db
      .select({ id: leadConversationsTable.id })
      .from(leadConversationsTable)
      .where(eq(leadConversationsTable.id, c.id))
      .limit(1);
    if (existingConv) continue;

    await db.insert(leadConversationsTable).values({
      id: c.id,
      contact_id: SIM_CONTACT_ID,
      source: "nba_sim",
      external_id: c.id,
      direction: "outbound",
      duration_seconds: c.durationSeconds,
      transcript_text: c.transcript,
      summary: `[${c.callTypeHint} sim] ${c.transcript.slice(0, 80)}...`,
      conversation_date: new Date(),
    });
    conversationsCreated++;
  }

  // Run the engine against each sim conversation so the trace-view
  // picker has runs to select. Idempotent: skip if an engine_run
  // already exists for this conversation. Uses the keyword path (no
  // LLM) so it runs fast and deterministically on server startup.
  let runsCreated = 0;
  for (const c of SIM_CONVERSATIONS) {
    const [existingRun] = await db
      .select({ id: engineRunsTable.id })
      .from(engineRunsTable)
      .where(eq(engineRunsTable.conversation_id, c.id))
      .limit(1);
    if (existingRun) continue;

    try {
      const investor = await loadInvestor(SIM_CONTACT_ID);
      const output = processTranscript(c.transcript, c.callTypeHint as CallType, investor);
      await saveEngineRun({
        contactId: SIM_CONTACT_ID,
        conversationId: c.id,
        callType: c.callTypeHint as CallType,
        output,
      });
      runsCreated++;
    } catch (err: any) {
      logger.warn(
        { convId: c.id, err: err.message },
        "Sim engine run failed — skipping",
      );
    }
  }

  return { contactCreated, conversationsCreated, runsCreated };
}

// Allow calling via tsx for ad-hoc re-runs. No CLI guard needed — the
// dataManager import sits in the server bundle and dataManager calls
// seedSimConversations() there. Calling this file via tsx directly
// goes through the same path without process.exit.
void sql; // keep the import shape consistent with the other seed files
