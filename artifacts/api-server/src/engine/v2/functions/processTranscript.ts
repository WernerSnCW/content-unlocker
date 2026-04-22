// C16. processTranscript — V3 orchestrator. Supersedes V2's C10.
// Returns EngineOutputV3 which is a strict superset of EngineOutput — existing
// callers that read V2 fields keep working.
import { ENGINE_VERSION } from "../version";
import type {
  CallType,
  EngineFlag,
  EngineOutputV3,
  FactFind,
  Investor,
  NextAction,
  SignalMap,
  SignalState,
} from "../types";
import { nowIso } from "../util";
import { detectPersona } from "./detectPersona";
import { detectHotButton } from "./detectHotButton";
import { analyseSignals } from "./analyseSignals";
import { evaluateGates } from "./evaluateGates";
import { routeContent } from "./routeContent";
import { generateCoverNote } from "./generateCoverNote";
import { determineNextAction } from "./determineNextAction";
import { buildCrmNote } from "./buildCrmNote";
import { validateCompliance } from "./validateCompliance";
import { detectQuestions } from "./detectQuestions";
import { analyseDemoSegments } from "./analyseDemoSegments";
import { generateEmail } from "./generateEmail";
import { determinePostCloseActions } from "./determinePostCloseActions";
import { routeToBook2 } from "./routeToBook2";
import { evaluateOutcomeRules, type EvaluationTrace } from "../outcomeRules/evaluator";
import type { LoadedOutcomeRule } from "../outcomeRules/loader";

/**
 * Optional behaviour toggles for processTranscript / processTranscriptWithLLM.
 * Keeping these opt-in rather than global env reads so tests + the
 * compare endpoint can exercise both NBA paths deterministically.
 */
export interface ProcessOptions {
  /**
   * Phase 7.1a — if provided, the rule evaluator walks these rules to
   * produce the NextAction instead of calling determineNextAction.
   * Rules must be pre-sorted by priority ascending (loadOutcomeRules
   * does this). When omitted, the legacy cascade runs.
   */
  outcomeRules?: LoadedOutcomeRule[];
}

/**
 * Diagnostic sidecar returned from the detailed orchestrator variants
 * (used by /api/engine/compare-nba). The main processTranscript return
 * type is unchanged; detailed callers use processTranscriptDetailed
 * below.
 */
export interface ProcessDetail {
  nbaTrace: EvaluationTrace | null;    // null when legacy cascade ran
  nbaSource: "legacy" | "rules";
  // Session 4 — shadow-mode legacy comparison. When the rule engine
  // produces the NBA (nbaSource === "rules") we ALSO run the legacy
  // cascade against the same context and diff. If the two disagree,
  // the diff is captured here so the webhook caller can log it.
  // Null when nbaSource === "legacy" (nothing to compare).
  shadowLegacyAction: NextAction | null;
  shadowDiff: string[] | null; // list of "field: legacy=X, rules=Y"; null means agreed
}

function applySignalUpdates(
  current: SignalMap,
  updates: { code: string; newState: string; evidence: string; confidence: "high" | "medium" | "low" }[],
): SignalMap {
  const now = nowIso();
  const next: SignalMap = { ...current };
  for (const u of updates) {
    const existing: SignalState = next[u.code] ?? {
      code: u.code,
      state: "grey",
      surfacedBy: "conversation",
      notes: "",
      updatedAt: now,
      confidence: u.confidence,
    };
    next[u.code] = {
      ...existing,
      state: u.newState as SignalState["state"],
      surfacedBy: "conversation",
      notes: u.evidence,
      updatedAt: now,
      confidence: u.confidence,
    };
  }
  return next;
}

// Derive a pipeline transition event from call type + signal state.
// Logical event names (see ADR 004). Adapter translates to website's current enum.
function derivePipelineEvent(
  callType: CallType,
  nextActionType: string,
  gatesPack1Eligible: boolean,
  outcomePath: string | null,
): { fromEvent: string | null; toEvent: string; reason: string } | null {
  if (callType === "cold_call" && nextActionType === "send_content") {
    return { fromEvent: "awareness", toEvent: "demo_booked", reason: "Demo booked on cold call" };
  }
  if (callType === "demo") {
    if (gatesPack1Eligible) {
      return { fromEvent: "demo_done", toEvent: "pack_1_sent", reason: "Pack 1 eligible after demo" };
    }
    return { fromEvent: "demo_booked", toEvent: "demo_done", reason: "Demo completed" };
  }
  if (callType === "opportunity") {
    if (outcomePath === "committed") {
      return { fromEvent: "pack_1_sent", toEvent: "committed", reason: "Call 3 committed" };
    }
    if (outcomePath === "adviser_loop") {
      return { fromEvent: "pack_1_sent", toEvent: "due_diligence", reason: "Adviser loop triggered" };
    }
  }
  return null;
}

// Infer an outcome label from signals + nextAction for the opportunity call.
function inferOpportunityOutcome(signals: SignalMap, nextActionType: string): string | null {
  if (nextActionType === "reserve_stock") return "committed";
  if (nextActionType === "schedule_adviser_call") return "adviser_loop";
  if (nextActionType === "close_deal") return "no";
  if (nextActionType === "schedule_call") return "needs_time";
  return null;
}

export function processTranscript(
  transcript: string,
  callType: CallType,
  investor: Investor,
  opts: ProcessOptions = {},
): EngineOutputV3 {
  return processTranscriptDetailed(transcript, callType, investor, opts).output;
}

/**
 * Orchestrator with diagnostic sidecar. Same computation as
 * processTranscript but returns `detail` describing which NBA path
 * ran and (if rules path) the trace of clause evaluation. The
 * /api/engine/compare-nba endpoint uses this to surface trace info
 * alongside the diff.
 */
export function processTranscriptDetailed(
  transcript: string,
  callType: CallType,
  investor: Investor,
  opts: ProcessOptions = {},
): { output: EngineOutputV3; detail: ProcessDetail } {
  const flags: EngineFlag[] = [];

  // 1. Persona
  const personaAssessment = detectPersona(transcript, investor.persona);
  const investorAfterPersona: Investor = { ...investor, persona: personaAssessment.persona };

  // 2. Hot button
  const hotButton = detectHotButton(transcript);

  // 3. Signals — V3 analyseSignals now merges A14 problem-belief patterns
  const signalUpdates = analyseSignals(transcript, investor.signals, investorAfterPersona);

  // 4. Apply updates
  const updatedSignals = applySignalUpdates(investor.signals, signalUpdates);
  const enrichedInvestor: Investor = {
    ...investorAfterPersona,
    signals: updatedSignals,
    hotButton: hotButton.primary ?? investor.hotButton,
  };

  // 5. V3 — detect questions + demo segments
  const questionsDetected = detectQuestions(transcript, callType, enrichedInvestor);
  const demoSegResult = analyseDemoSegments(callType, questionsDetected, signalUpdates);
  for (const f of demoSegResult.flags) {
    flags.push({ type: "gate_blocked", message: f.message });
  }

  // 6. Gates
  const gateResult = evaluateGates(updatedSignals, enrichedInvestor);
  if (gateResult.c4Compliance === "blocked") {
    flags.push({ type: "gate_blocked", message: "C4 compliance gate blocked — only doc 140 permitted" });
  }

  // 7. Content routing
  const content = routeContent(updatedSignals, enrichedInvestor, gateResult);

  // 8. Cover note (kept for V2 compatibility; V3 consumers should use emailDraft instead)
  let coverNoteText: string | null = null;
  if (content) {
    const note = generateCoverNote(enrichedInvestor, content);
    coverNoteText = note.text;
    if (note.flag) flags.push(note.flag);
    if (coverNoteText) (content as any).coverNoteDraft = coverNoteText;
  }

  // 9. V3 — email draft
  const emailResult = generateEmail(enrichedInvestor, callType, content, signalUpdates, gateResult);
  if (emailResult.flag) flags.push(emailResult.flag);
  const emailDraft = emailResult.email;

  // 10. Next action — Phase 7.1a. When rules are supplied, walk them;
  // otherwise fall back to the legacy determineNextAction cascade.
  // Session 4 — shadow mode: when rules path runs, also compute the
  // legacy NBA for the same context so the webhook can log any diff.
  let nextAction;
  let nbaTrace: EvaluationTrace | null = null;
  let nbaSource: "legacy" | "rules";
  let shadowLegacyAction: NextAction | null = null;
  let shadowDiff: string[] | null = null;
  if (opts.outcomeRules && opts.outcomeRules.length > 0) {
    const r = evaluateOutcomeRules(opts.outcomeRules, {
      callType,
      signals: updatedSignals,
      investor: enrichedInvestor,
      content,
      gateResult,
    });
    nextAction = r.action;
    nbaTrace = r.trace;
    nbaSource = "rules";

    // Shadow-compute legacy for parity logging. Cheap — pure function.
    shadowLegacyAction = determineNextAction(callType, updatedSignals, enrichedInvestor, content, gateResult);
    shadowDiff = diffNextAction(shadowLegacyAction, nextAction);
  } else {
    nextAction = determineNextAction(callType, updatedSignals, enrichedInvestor, content, gateResult);
    nbaSource = "legacy";
  }

  // 11. CRM note
  const factFindUpdates: Partial<FactFind> = {};
  const crmNote = buildCrmNote(callType, signalUpdates, factFindUpdates, enrichedInvestor, content, nextAction, gateResult);

  // 12. Compliance on outbound (email body takes precedence over cover note)
  const textToCheck = emailDraft?.body ?? coverNoteText ?? "";
  if (textToCheck) {
    const compliance = validateCompliance(textToCheck);
    for (const v of compliance.violations) {
      flags.push({
        type: "compliance_warning",
        message: `[${v.ruleId}] found "${v.found}" — correct: ${v.correct}`,
      });
    }
  }

  // 13. Post-close / adviser-loop actions
  const outcomePath = inferOpportunityOutcome(updatedSignals, nextAction.actionType);
  const { postCloseActions, adviserLoopActions } = determinePostCloseActions(outcomePath, enrichedInvestor);

  // 14. Book 2 routing
  const book2Routing = routeToBook2(updatedSignals, enrichedInvestor);

  // 15. Pipeline transition (logical event names — adapter resolves)
  const pipelineTransition = derivePipelineEvent(
    callType,
    nextAction.actionType,
    gateResult.pack1 === "eligible",
    outcomePath,
  );

  return {
    output: {
      engineVersion: ENGINE_VERSION,
      processedAt: nowIso(),
      callType,
      investorId: investor.investorId,
      signalUpdates,
      factFindUpdates,
      personaAssessment,
      hotButton,
      demoScore: investor.demoScore,
      gateStatus: gateResult,
      nextBestAction: nextAction,
      pipelineTransition,
      crmNote,
      flags,
      // V3 additions
      questionsDetected,
      demoSegmentAnalysis: callType === "demo" ? demoSegResult.segments : null,
      emailDraft,
      postCloseActions,
      adviserLoopActions,
      book2Routing,
    },
    detail: { nbaTrace, nbaSource, shadowLegacyAction, shadowDiff },
  };
}

/**
 * Session-4 shadow-mode diff. Compares two NextAction objects across
 * the five observable fields. Returns null for identical (agreement),
 * or a list of "field: legacy=X, rules=Y" strings for the webhook to
 * log.
 *
 * This MUST be a top-level function declaration (not a const arrow)
 * so it's hoisted and available to both processTranscriptDetailed
 * and processTranscriptWithLLM regardless of file order. Previous
 * attempt placed the definition after processTranscriptWithLLM which
 * the runtime refused to resolve — engine runs failed with
 * "diffNextAction is not defined".
 */
function diffNextAction(a: NextAction, b: NextAction): string[] | null {
  const diffs: string[] = [];
  if (a.actionType !== b.actionType)
    diffs.push(`actionType: legacy=${a.actionType}, rules=${b.actionType}`);
  if (a.owner !== b.owner)
    diffs.push(`owner: legacy=${a.owner}, rules=${b.owner}`);
  if (a.timing !== b.timing)
    diffs.push(`timing: legacy=${a.timing}, rules=${b.timing}`);
  if (a.detail !== b.detail)
    diffs.push(`detail: legacy="${a.detail}", rules="${b.detail}"`);
  const aDoc = a.contentToSend?.docId ?? null;
  const bDoc = b.contentToSend?.docId ?? null;
  if (aDoc !== bDoc) diffs.push(`contentDoc: legacy=${aDoc}, rules=${bDoc}`);
  return diffs.length > 0 ? diffs : null;
}

/**
 * Phase 4.9 — LLM-powered orchestrator. Replaces keyword pattern matching
 * in Layer 1 (persona, hot-button, signals, questions, fact-find) with a
 * single LLM extraction call. Layer 2 (gates, routing, NBA, etc.) is the
 * same pure-function path — no LLM calls there.
 *
 * Flag-gated: callers should consult ENGINE_LAYER_1_LLM before calling
 * this. Caller (runEngineForConversation) handles the flag check so
 * processTranscript (keyword path) stays sync for test fixtures.
 *
 * Returns the same EngineOutputV3 shape as processTranscript plus an
 * opaque `llmAudit` sidecar for persistence into engine_runs. Throws on
 * LLM failure — caller marks the engine_run status="failed".
 */
import { extractViaLLM, type ExtractionAudit } from "../llm/extractViaLLM";
import {
  extractionToPersona,
  extractionToHotButton,
  extractionToSignalUpdates,
  extractionToQuestionDetections,
  extractionToFactFindUpdates,
  extractionToDemoScore,
} from "../llm/adaptExtraction";
import { generateEmailWithLLM } from "../llm/generateEmailWithLLM";
import { QUESTION_REGISTRY } from "../config";

export async function processTranscriptWithLLM(
  transcript: string,
  callType: CallType,
  investor: Investor,
  opts: ProcessOptions = {},
): Promise<{
  output: EngineOutputV3;
  audit: ExtractionAudit;
  emailAudit: ExtractionAudit | null;
  rawExtraction: unknown;
  detail: ProcessDetail;
}> {
  const flags: EngineFlag[] = [];

  // --- Layer 1 ---
  const { result: extraction, audit } = await extractViaLLM({ transcript, investor, callType });

  const personaAssessment = extractionToPersona(extraction);
  const investorAfterPersona: Investor = { ...investor, persona: personaAssessment.persona };

  const hotButton = extractionToHotButton(extraction);

  const signalUpdates = extractionToSignalUpdates(extraction, investor.signals);
  const updatedSignals = applySignalUpdates(investor.signals, signalUpdates);

  // Fact-find: LLM produces this (keyword path didn't). Merge into investor
  // state so downstream rules (Pack 1 gate, email template selection, etc.)
  // see the fresh fact-find from this call.
  const factFindUpdates = extractionToFactFindUpdates(extraction, investor.factFind);
  const mergedFactFind = { ...investor.factFind, ...factFindUpdates };

  // Demo score: LLM-inferred, only meaningful for demo calls. Prefer the
  // LLM value over the investor's persisted demoScore for this run's
  // gate evaluation so Pack 1 gating reflects the latest call.
  const demoScoreFromLLM = extractionToDemoScore(extraction);
  const effectiveDemoScore = demoScoreFromLLM ?? investor.demoScore;

  const enrichedInvestor: Investor = {
    ...investorAfterPersona,
    signals: updatedSignals,
    hotButton: hotButton.primary ?? investor.hotButton,
    demoScore: effectiveDemoScore,
    factFind: mergedFactFind,
  };

  // Questions: LLM intent-matches paraphrases. Adapter ensures full
  // per-call-type coverage regardless of what the LLM chose to return.
  const registryByNum = new Map(
    QUESTION_REGISTRY.map((q) => [
      q.qNum,
      { qNum: q.qNum, signal: q.signal, call: q.call, gateRole: q.gateRole },
    ]),
  );
  const questionsDetected = extractionToQuestionDetections(extraction, callType, registryByNum);

  const demoSegResult = analyseDemoSegments(callType, questionsDetected, signalUpdates);
  for (const f of demoSegResult.flags) flags.push({ type: "gate_blocked", message: f.message });

  // --- Layer 2 (pure rules — identical to keyword path) ---
  const gateResult = evaluateGates(updatedSignals, enrichedInvestor);
  if (gateResult.c4Compliance === "blocked") {
    flags.push({ type: "gate_blocked", message: "C4 compliance gate blocked — only doc 140 permitted" });
  }

  const content = routeContent(updatedSignals, enrichedInvestor, gateResult);

  let coverNoteText: string | null = null;
  if (content) {
    const note = generateCoverNote(enrichedInvestor, content);
    coverNoteText = note.text;
    if (note.flag) flags.push(note.flag);
    if (coverNoteText) (content as any).coverNoteDraft = coverNoteText;
  }

  // Phase 4.9 session 2 — LLM email generation replaces the template path
  // for demo-call follow-ups. Cold-call EMAIL_1 (confirmation) stays as a
  // template — no personalisation beyond name makes an LLM call pointless.
  // Opportunity calls produce no email. Email generation runs AFTER Layer 2
  // routing/gates so attachment selection is already decided; the LLM only
  // generates the subject + body.
  const emailLLMResult = await generateEmailWithLLM({
    investor: enrichedInvestor,
    callType,
    content,
    signalUpdates,
    gateResult,
  });
  if (emailLLMResult.flag) flags.push(emailLLMResult.flag);
  const emailDraft = emailLLMResult.email;
  const emailAudit = emailLLMResult.audit;

  // NBA — Phase 7.1a + session-4 shadow mode. See keyword path above
  // for the same pattern.
  let nextAction;
  let nbaTrace: EvaluationTrace | null = null;
  let nbaSource: "legacy" | "rules";
  let shadowLegacyAction: NextAction | null = null;
  let shadowDiff: string[] | null = null;
  if (opts.outcomeRules && opts.outcomeRules.length > 0) {
    const r = evaluateOutcomeRules(opts.outcomeRules, {
      callType,
      signals: updatedSignals,
      investor: enrichedInvestor,
      content,
      gateResult,
    });
    nextAction = r.action;
    nbaTrace = r.trace;
    nbaSource = "rules";
    shadowLegacyAction = determineNextAction(callType, updatedSignals, enrichedInvestor, content, gateResult);
    shadowDiff = diffNextAction(shadowLegacyAction, nextAction);
  } else {
    nextAction = determineNextAction(callType, updatedSignals, enrichedInvestor, content, gateResult);
    nbaSource = "legacy";
  }

  const crmNote = buildCrmNote(callType, signalUpdates, factFindUpdates, enrichedInvestor, content, nextAction, gateResult);

  const textToCheck = emailDraft?.body ?? coverNoteText ?? "";
  if (textToCheck) {
    const compliance = validateCompliance(textToCheck);
    for (const v of compliance.violations) {
      flags.push({
        type: "compliance_warning",
        message: `[${v.ruleId}] found "${v.found}" — correct: ${v.correct}`,
      });
    }
  }

  const outcomePath = inferOpportunityOutcome(updatedSignals, nextAction.actionType);
  const { postCloseActions, adviserLoopActions } = determinePostCloseActions(outcomePath, enrichedInvestor);

  const book2Routing = routeToBook2(updatedSignals, enrichedInvestor);

  const pipelineTransition = derivePipelineEvent(
    callType,
    nextAction.actionType,
    gateResult.pack1 === "eligible",
    outcomePath,
  );

  const output: EngineOutputV3 = {
    engineVersion: ENGINE_VERSION,
    processedAt: nowIso(),
    callType,
    investorId: investor.investorId,
    signalUpdates,
    factFindUpdates,
    personaAssessment,
    hotButton,
    demoScore: effectiveDemoScore,
    gateStatus: gateResult,
    nextBestAction: nextAction,
    pipelineTransition,
    crmNote,
    flags,
    questionsDetected,
    demoSegmentAnalysis: callType === "demo" ? demoSegResult.segments : null,
    emailDraft,
    postCloseActions,
    adviserLoopActions,
    book2Routing,
  };

  return {
    output,
    audit,
    emailAudit,
    rawExtraction: extraction,
    detail: { nbaTrace, nbaSource, shadowLegacyAction, shadowDiff },
  };
}
