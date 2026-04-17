// Phase 4.9 — Build the system + user messages for Layer 1 extraction.
//
// Two-part prompt:
//
// 1. SYSTEM block (cacheable, stable per engine version) — contains:
//    - Framing: who the extractor is, what it's doing
//    - Signal registry (every signal, what it means, valid states, detection
//      patterns as EXAMPLES of the language to listen for)
//    - Question registry (the 25 diagnostic questions with response maps)
//    - Persona config (three archetypes with detection indicators)
//    - Few-shot calibration examples from the directive
//    - The exact output schema with instructions
//
// 2. USER block (per-call, not cached) — contains:
//    - Call type
//    - Current investor state (existing signal states, fact-find data)
//    - The full transcript
//
// Prompt caching via cache_control: { type: "ephemeral" } on the system
// block means we pay for config tokens ONCE every 5 minutes across all
// concurrent transcript runs, not once per call. See:
// https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
//
// The weighted patterns from A1 / A4 / A14 appear in this prompt as
// "language to listen for" examples — NOT as the matching algorithm. The
// LLM reads them for calibration and uses its own judgment.

import {
  SIGNAL_REGISTRY,
  QUESTION_REGISTRY,
  PERSONA_CONFIG,
  PROBLEM_BELIEF_PATTERNS,
} from "../config";
import { ENGINE_VERSION } from "../version";
import type { CallType, Investor } from "../types";

// Turn a signal registry entry into prompt-ready text. Keeps patterns as
// examples of the language to listen for — not as a scoring rule.
function formatSignalForPrompt(s: typeof SIGNAL_REGISTRY[number]): string {
  const lines: string[] = [];
  lines.push(`${s.code} — ${s.name} [${s.category}]`);
  lines.push(`  Valid states: ${s.validStates.join(" | ")}`);
  lines.push(`  Activation: ${s.activation}`);
  if (s.gateRole) lines.push(`  Gate role: ${s.gateRole}`);
  if (s.persona) lines.push(`  Persona-gated: ${s.persona}`);
  if (s.note) lines.push(`  Note: ${s.note}`);

  const examples: string[] = [];
  if (s.detectionPatterns && s.detectionPatterns.length > 0) {
    examples.push("  Language that suggests this signal:");
    for (const p of s.detectionPatterns) {
      examples.push(`    - "${p.pattern}"${p.note ? ` — ${p.note}` : ""}`);
    }
  }
  if (s.negativePatterns && s.negativePatterns.length > 0) {
    examples.push("  Language that negates it:");
    for (const p of s.negativePatterns) {
      examples.push(`    - "${p.pattern}"`);
    }
  }
  if (examples.length) lines.push(...examples);
  return lines.join("\n");
}

function formatQuestionForPrompt(q: typeof QUESTION_REGISTRY[number]): string {
  const lines: string[] = [];
  lines.push(`Q${q.qNum} [call ${q.call}, ${q.category}]${q.gateRole ? ` [GATE: ${q.gateRole}]` : ""}`);
  lines.push(`  Intent: ${q.text ?? "(narrative prompt — no fixed wording)"}`);
  if (q.signal) lines.push(`  Primary signal: ${q.signal}`);
  if (q.alsoSurfaces && q.alsoSurfaces.length > 0) {
    lines.push(`  Also surfaces: ${q.alsoSurfaces.join(", ")}`);
  }
  if (q.responseMap) {
    lines.push(`  Response interpretations:`);
    for (const [response, mapping] of Object.entries(q.responseMap)) {
      const parts: string[] = [];
      if (mapping.state) parts.push(`state=${mapping.state}`);
      if (mapping.outcome) parts.push(`outcome=${mapping.outcome}`);
      if (mapping.note) parts.push(mapping.note);
      lines.push(`    - "${response}" → ${parts.join(", ")}`);
    }
  }
  if (q.note) lines.push(`  Note: ${q.note}`);
  return lines.join("\n");
}

function formatPersonaForPrompt(p: typeof PERSONA_CONFIG.personas[number]): string {
  const lines: string[] = [];
  lines.push(`${p.id} — ${p.label}`);
  lines.push(`  Problem cluster: ${p.problemCluster.join(", ")}`);
  lines.push(`  Demo emphasis: ${p.demoEmphasis}`);
  lines.push(`  Language indicators:`);
  for (const pat of p.patterns) {
    lines.push(`    - "${pat.pattern}"`);
  }
  return lines.join("\n");
}

function formatProblemBeliefPatterns(): string {
  const lines: string[] = ["Persona-gated problem-belief language:"];
  for (const [code, def] of Object.entries(PROBLEM_BELIEF_PATTERNS)) {
    if (!def || !def.detectionPatterns || def.detectionPatterns.length === 0) continue;
    lines.push(`  ${code} (${def.name} — ${def.persona}):`);
    for (const p of def.detectionPatterns) {
      lines.push(`    - "${p.pattern}"${p.note ? ` — ${p.note}` : ""}`);
    }
  }
  return lines.join("\n");
}

// Few-shot calibration examples lifted from the directive.
const CALIBRATION_EXAMPLES = `
CALIBRATION EXAMPLES — how to assess, not how to match:

Example 1 — Negation
  Transcript: "I'm not worried about the risk at all. I know what I'm getting into."
  Naive keyword reading: matches "worried" + "risk" → C4 amber.
  Correct assessment: C4 GREEN. The investor has processed the risk and is
  comfortable. Negation and context flip the meaning.

Example 2 — Totality over individual words
  Transcript: Investor mentions "fees" once in passing, but spends five
  minutes discussing family, inheritance, passing wealth to children, and
  IHT implications of their estate.
  Naive keyword reading: matches "fees" → weight toward Growth Seeker.
  Correct assessment: Legacy Builder. The weight of conversation content
  indicates legacy / family primacy, not fee sensitivity.

Example 3 — Paraphrase on question detection
  Tom says: "So how does the tax side sit with you?"
  Registry Question 10 (C4 diagnostic) expects: "Are you comfortable with
  the tax treatment of an EIS investment?"
  Correct detection: Question 10 was asked. Match on intent (tax comfort
  diagnostic), not literal phrasing. Tom paraphrases every call.

Example 4 — Fact-find verbatim preservation
  Investor says: "I'm terrified of making a mistake I can't undo with
  this money — it's taken me 30 years to build."
  WRONG extraction: practicalProblem = "Concerned about irreversible
  errors with their capital."
  CORRECT extraction: exactPhrases includes "I'm terrified of making a
  mistake I can't undo" verbatim. practicalProblem may quote or paraphrase
  contextually, but the investor's distinctive language is PRESERVED
  separately for downstream use in follow-up emails.

Example 5 — Question without resolution
  Transcript: Investor says "What happens if it all goes wrong?" after Tom
  explains EIS risk.
  Assessment: C4 AMBER, not red. They're engaging with the risk question
  but haven't yet landed on a resolved understanding. If they said
  "Hmm, I'm not sure that works for me" in response to the risk
  explanation, that would be C4 RED.
`.trim();

/**
 * Build the extraction prompt. Returns Anthropic-SDK-compatible content
 * blocks ready to pass to messages.create.
 *
 * The system array is cacheable; the user content is per-call.
 */
export function buildExtractionPrompt(args: {
  transcript: string;
  investor: Investor;
  callType: CallType;
}): {
  system: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  userMessage: string;
} {
  // ---------- SYSTEM (cacheable) ----------
  const framing = `
You are the Layer 1 extractor of the Unlock investor intelligence engine
(engine version ${ENGINE_VERSION}). Your job is to read a sales call
transcript and return a structured JSON extraction that the deterministic
rules engine then consumes to make decisions about content routing,
follow-up actions, and pipeline transitions.

You do NOT make rules decisions. You do NOT route content, pick next
actions, or evaluate gates. Those happen in Layer 2 using your output.
Your only job: extract what was SAID and MEANT, accurately and in the
investor's own words where possible.

CRITICAL: Read for intent, not keywords. Negation flips meaning. Context
disambiguates. Totality beats individual words. The weighted patterns
below are EXAMPLES of the language to listen for — NOT a matching
algorithm to follow mechanically.
`.trim();

  const signalBlock = [
    "SIGNAL REGISTRY — 17 signals the investor's state maps to.",
    "For each signal in your output, use a state from its valid-states list.",
    "",
    SIGNAL_REGISTRY.map(formatSignalForPrompt).join("\n\n"),
  ].join("\n");

  const questionBlock = [
    "QUESTION REGISTRY — diagnostic questions Tom asks.",
    "For each, report whether it was asked (exactly or by paraphrase),",
    "the investor's response in their own words, and the implied signal state.",
    "",
    QUESTION_REGISTRY.map(formatQuestionForPrompt).join("\n\n"),
  ].join("\n");

  const personaBlock = [
    "PERSONA ARCHETYPES — three types. Classify based on totality of conversation.",
    "A passing mention of one archetype's keyword doesn't override five minutes",
    "of the other archetype's concerns. Use your judgment on weight.",
    "",
    PERSONA_CONFIG.personas.map(formatPersonaForPrompt).join("\n\n"),
    "",
    formatProblemBeliefPatterns(),
  ].join("\n");

  const outputSchema = `
OUTPUT SCHEMA — return exactly this JSON object, nothing else.

{
  "persona": {
    "classification": "preserver" | "growth_seeker" | "legacy_builder" | "undetermined",
    "confidence": "high" | "medium" | "low",
    "evidence": "the specific phrase(s) that informed this — prefer verbatim"
  },
  "hotButton": {
    "primary": "family" | "freedom" | "legacy" | "relief" | "significance" | null,
    "evidence": "specific phrase"
  },
  "signals": {
    "C3": { "proposedState": "amber", "confidence": "high", "evidence": "they said X", "stateChanged": true },
    ...one entry per signal you formed a view on. OMIT signals you have no evidence
       on — Layer 2 will preserve the investor's current state for untouched signals.
  },
  "factFind": {
    "practicalProblem": "string or null",
    "currentPressure": "string or null",
    "personalAngle": "string or null",
    "desiredOutcome": "string or null",
    "exactPhrases": ["verbatim distinctive phrase 1", "verbatim distinctive phrase 2", ...],
    "portfolioShape": "string or null",
    "annualTaxLiability": "number or null (GBP)",
    "decisionStakeholders": "string or null",
    "decisionStyle": "quick" | "thorough" | "unknown",
    "questionsForCall3": "string or null"
  },
  "questionsDetected": [
    {
      "questionNumber": 1,
      "detected": true,
      "investorResponse": "their actual words",
      "inferredSignalState": "amber"
    },
    ...
  ],
  "demoScore": 75 | null
}

RULES:
- Return ONLY the JSON object. No markdown fences, no preamble, no trailing text.
- exactPhrases is the HIGHEST-VALUE field. Capture the investor's distinctive
  language verbatim. Do not paraphrase, clean up, or formalise.
- Absence of discussion = OMIT the signal entry. Do not fabricate "grey" for
  signals that weren't touched. Grey means actively surfaced as unknown.
- For questionsDetected, report on every registry question. detected=false is
  valid — it tells the rules engine the question wasn't asked.
- demoScore only when callType=demo. null otherwise.
- stateChanged is relative to the current investor state supplied in the user
  message.
- Confidence: high when the evidence is unambiguous; medium for reasonable
  inference; low when the signal is weak or could go either way.
`.trim();

  // Cache-control markers on each system block. The SDK combines them into
  // a single cache breakpoint per marker; we use one at the end so everything
  // above is cached as a unit.
  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [
    { type: "text", text: framing },
    { type: "text", text: signalBlock },
    { type: "text", text: questionBlock },
    { type: "text", text: personaBlock },
    { type: "text", text: CALIBRATION_EXAMPLES },
    { type: "text", text: outputSchema, cache_control: { type: "ephemeral" } },
  ];

  // ---------- USER (per-call) ----------
  const currentSignalLines: string[] = [];
  for (const [code, s] of Object.entries(args.investor.signals ?? {})) {
    currentSignalLines.push(`  ${code} = ${s.state}${s.notes ? ` (${s.notes.slice(0, 80)})` : ""}`);
  }
  const currentFactFind = args.investor.factFind ?? {};
  const existingFacts: string[] = [];
  for (const [k, v] of Object.entries(currentFactFind)) {
    if (v != null && v !== "") {
      const display = typeof v === "string" ? v.slice(0, 120) : JSON.stringify(v);
      existingFacts.push(`  ${k} = ${display}`);
    }
  }

  const userMessage = `
Call type: ${args.callType}

Current investor state (preserve these unless the transcript changes them):
Persona: ${args.investor.persona ?? "undetermined"}
Hot button: ${args.investor.hotButton ?? "none"}
Signals:
${currentSignalLines.length ? currentSignalLines.join("\n") : "  (no prior signals)"}

Existing fact-find:
${existingFacts.length ? existingFacts.join("\n") : "  (none)"}

TRANSCRIPT:
${args.transcript}
`.trim();

  return { system: systemBlocks, userMessage };
}
