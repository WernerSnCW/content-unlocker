// Phase 2: persistence layer — reads current Investor state from DB and
// writes EngineOutput back (signals, transitions, run record, investor state).
import {
  db,
  contactsTable,
  engineInvestorStateTable,
  engineSignalsTable,
  engineSignalTransitionsTable,
  engineRunsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type {
  AnyState,
  CallType,
  Confidence,
  EngineOutput,
  HotButton,
  Investor,
  Persona,
  SignalMap,
  SignalState,
} from "./types";
import { ENGINE_VERSION } from "./version";

// ============ Load ============

/**
 * Load the current Investor snapshot for a contact. Creates a blank
 * engine_investor_state row if none exists yet.
 */
export async function loadInvestor(contactId: string): Promise<Investor> {
  const [contact] = await db.select().from(contactsTable)
    .where(eq(contactsTable.id, contactId))
    .limit(1);
  if (!contact) throw new Error(`Contact not found: ${contactId}`);

  const [state] = await db.select().from(engineInvestorStateTable)
    .where(eq(engineInvestorStateTable.contact_id, contactId))
    .limit(1);

  const signalRows = await db.select().from(engineSignalsTable)
    .where(eq(engineSignalsTable.contact_id, contactId));

  const signals: SignalMap = {};
  for (const r of signalRows) {
    signals[r.code] = {
      code: r.code,
      state: r.state as AnyState,
      surfacedBy: (r.surfaced_by || "not_yet") as SignalState["surfacedBy"],
      notes: r.notes || "",
      updatedAt: r.updated_at.toISOString(),
      confidence: (r.confidence || "medium") as Confidence,
    };
  }

  return {
    investorId: contact.id,
    name: `${contact.first_name} ${contact.last_name}`.trim(),
    persona: (state?.persona as Persona) || "undetermined",
    hotButton: (state?.hot_button as HotButton) || null,
    demoScore: state?.demo_score ?? null,
    bookTrack: (state?.book_track as Investor["bookTrack"]) || null,
    decisionStyle: (state?.decision_style as Investor["decisionStyle"]) || "unknown",
    pack1Gate: (state?.pack1_gate as Investor["pack1Gate"]) || "blocked",
    signals,
    factFind: {
      practicalProblem: state?.practical_problem ?? null,
      currentPressure: state?.current_pressure ?? null,
      personalAngle: state?.personal_angle ?? null,
      desiredOutcome: state?.desired_outcome ?? null,
      exactPhrases: (state?.exact_phrases as string[]) || [],
      portfolioShape: state?.portfolio_shape ?? null,
      annualTaxLiability: state?.annual_tax_liability != null ? Number(state.annual_tax_liability) : null,
      decisionStakeholders: state?.decision_stakeholders ?? null,
      decisionStyle: (state?.decision_style as Investor["decisionStyle"]) || "unknown",
      questionsForCall3: state?.questions_for_call3 ?? null,
    },
    callHistory: [], // not hydrated — engine does not currently use it
    artifactsSent: [], // not hydrated — engine does not currently use it
  };
}

// ============ Save ============

export interface SaveEngineRunArgs {
  contactId: string;
  conversationId?: string | null;
  callType: CallType;
  output: EngineOutput;
}

/**
 * Persist an EngineOutput:
 *  - Insert engine_runs record
 *  - For each signalUpdate: upsert engine_signals + append engine_signal_transitions
 *  - Upsert engine_investor_state with persona / hot-button / pack1 gate
 * Returns the engine_run_id.
 */
export async function saveEngineRun(args: SaveEngineRunArgs): Promise<string> {
  const { contactId, conversationId, callType, output } = args;

  // 1. Insert the run record
  const [run] = await db.insert(engineRunsTable).values({
    contact_id: contactId,
    conversation_id: conversationId ?? null,
    call_type: callType,
    engine_version: output.engineVersion,
    output: output as any,
  }).returning({ id: engineRunsTable.id });

  const runId = run.id;

  // 2. Apply signal updates + transitions
  for (const update of output.signalUpdates) {
    const [found] = await db.select().from(engineSignalsTable)
      .where(and(
        eq(engineSignalsTable.contact_id, contactId),
        eq(engineSignalsTable.code, update.code),
      ))
      .limit(1);

    if (found) {
      await db.update(engineSignalsTable).set({
        state: update.newState,
        notes: update.evidence,
        evidence: update.evidence,
        confidence: update.confidence,
        surfaced_by: "conversation",
        engine_version: output.engineVersion,
        updated_at: new Date(),
      }).where(eq(engineSignalsTable.id, found.id));
    } else {
      await db.insert(engineSignalsTable).values({
        contact_id: contactId,
        code: update.code,
        state: update.newState,
        surfaced_by: "conversation",
        notes: update.evidence,
        evidence: update.evidence,
        confidence: update.confidence,
        engine_version: output.engineVersion,
      });
    }

    // Append transition
    await db.insert(engineSignalTransitionsTable).values({
      contact_id: contactId,
      code: update.code,
      from_state: update.previousState,
      to_state: update.newState,
      evidence: update.evidence,
      confidence: update.confidence,
      engine_run_id: runId,
      engine_version: output.engineVersion,
    });
  }

  // 3. Upsert investor state
  const stateUpdate = {
    contact_id: contactId,
    persona: output.personaAssessment.persona,
    persona_confidence: output.personaAssessment.confidence,
    persona_evidence: output.personaAssessment.evidence,
    hot_button: output.hotButton.primary,
    hot_button_evidence: output.hotButton.evidence,
    demo_score: output.demoScore,
    pack1_gate: output.gateStatus.pack1,
    engine_version: output.engineVersion,
  };

  const [existingState] = await db.select().from(engineInvestorStateTable)
    .where(eq(engineInvestorStateTable.contact_id, contactId))
    .limit(1);

  if (existingState) {
    await db.update(engineInvestorStateTable)
      .set(stateUpdate)
      .where(eq(engineInvestorStateTable.contact_id, contactId));
  } else {
    await db.insert(engineInvestorStateTable).values(stateUpdate);
  }

  // NBA timing is advisory only — it's persisted inside engine_runs for the
  // UI to surface as a recommendation, but it does NOT automatically mutate
  // contacts.callback_date.
  //
  // Rationale: the tag path (applyTaggedOutcomeTx) is the authoritative
  // writer for contact scheduling fields. Admin config (side_effect,
  // default_followup_days) is predictable and testable; the engine's
  // suggestion would otherwise silently override it — which created confusion
  // during smoke testing (tag config said 0-day fallback, engine wrote
  // +2 days anyway).
  //
  // When we want NBA timing to influence contact state, it'll be an explicit
  // operator-accept action in the Outcome Drawer (future work), not an
  // automatic write here.

  return runId;
}

// Convert an NBA.timing string to an absolute callback_date, or null for
// "immediate" / unrecognised values (which should leave callback_date alone
// so the contact is eligible right away).
function resolveTimingToDate(timing: string | undefined | null): Date | null {
  if (!timing) return null;
  const now = new Date();
  switch (timing) {
    case "immediate":
      return null;
    case "24_48_hours":
      return addDays(now, 2);
    case "scheduled":
      // Operator will set the date explicitly via a separate flow.
      return null;
    default: {
      // ISO date string or N_days pattern
      const isoDate = Date.parse(timing);
      if (!Number.isNaN(isoDate)) return new Date(isoDate);
      const m = timing.match(/^(\d+)_days?$/);
      if (m) return addDays(now, parseInt(m[1], 10));
      return null;
    }
  }
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

// ============ Convenience ============

export async function getEngineSignals(contactId: string) {
  return db.select().from(engineSignalsTable).where(eq(engineSignalsTable.contact_id, contactId));
}

export async function getEngineTransitions(contactId: string) {
  return db.select().from(engineSignalTransitionsTable)
    .where(eq(engineSignalTransitionsTable.contact_id, contactId));
}

export async function getEngineRuns(contactId: string) {
  return db.select().from(engineRunsTable).where(eq(engineRunsTable.contact_id, contactId));
}

export async function getInvestorState(contactId: string) {
  const [row] = await db.select().from(engineInvestorStateTable)
    .where(eq(engineInvestorStateTable.contact_id, contactId))
    .limit(1);
  return row ?? null;
}

export { ENGINE_VERSION };
