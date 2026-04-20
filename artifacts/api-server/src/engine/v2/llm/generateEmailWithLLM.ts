// Phase 4.9 session 2 — LLM-powered post-demo email generation.
//
// Replaces the template assembly in generateEmail.generateEmail2 with
// a single Claude Sonnet call. Fires only when content routing has
// produced a send action (i.e. a demo call with resolved attachment).
// EMAIL_1 (demo confirmation, cold-call path) stays as a template —
// it's a generic confirmation with no personalisation beyond name, so
// an LLM call adds no value there.
//
// Per directive: at most two LLM calls per transcript cycle
// (Layer 1 extraction + this one).
//
// What stays deterministic:
//   - Attachment routing (which doc to attach based on signals + Pack 1 gate)
//   - Compliance check on the generated body (C9 is exact-string matching)
//
// What the LLM generates:
//   - Subject line
//   - Body (using investor's verbatim language from exactPhrases)

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "../../../lib/claudeTimeout";
import { EMAIL_TEMPLATES, COMPLIANCE } from "../config";
import type {
  CallType,
  ContentRecommendation,
  EmailOutput,
  EngineFlag,
  GateResult,
  Investor,
  SignalUpdate,
} from "../types";
import { validateCompliance } from "../functions/validateCompliance";
import type { ExtractionAudit } from "./extractViaLLM";
import { ExtractionError } from "./extractViaLLM";

const DEFAULT_MODEL = process.env.ENGINE_EMAIL_MODEL || "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 4096;
const EMAIL_TIMEOUT_MS = 90_000;
const EMAIL_PROMPT_VERSION = "v1.0.0";

const DISCLAIMER = "Capital at risk. This is an introduction, not financial advice.";

export interface GenerateEmailLLMResult {
  email: EmailOutput | null;
  flag: EngineFlag | null;
  audit: ExtractionAudit | null; // null when we didn't call the LLM (e.g. cold-call EMAIL_1 template path)
}

// Look up the doc name for an attachment ID. Mirrors the tiny map in
// the legacy generateEmail so we stay consistent while we transition.
function signalDocName(docId: number): string {
  const map: Record<number, string> = {
    100: "One-Pager",
    120: "Pack 1",
    140: "Access Explainer",
    150: "EIS Investors Secret Weapon",
    160: "EIS Case Studies",
    170: "IHT Planning",
    180: "EIS Fee Comparison",
    181: "Portfolio Stress Test",
    182: "BPR Explainer",
  };
  return map[docId] || `Document ${docId}`;
}

// Same attachment routing as the legacy generator. Deterministic.
function resolveAttachment(
  signals: { code: string; newState: string }[],
  pack1Eligible: boolean,
  fallback: ContentRecommendation | null,
): { docId: number | null; docName: string | null; angle: string | null; trigger: string | null } {
  if (pack1Eligible) {
    const match = EMAIL_TEMPLATES.attachmentRoutingTable.find((r) => r.belief === "PACK1_GATE");
    if (match) return { docId: match.docId, docName: "Pack 1 — Founding Investor Brief", angle: match.angle, trigger: "PACK1_GATE" };
  }
  for (const route of EMAIL_TEMPLATES.attachmentRoutingTable) {
    if (route.belief === "PACK1_GATE") continue;
    const signal = signals.find((s) => s.code === route.belief && s.newState === route.state);
    if (signal) {
      return { docId: route.docId, docName: signalDocName(route.docId), angle: route.angle, trigger: route.belief };
    }
  }
  if (fallback) {
    return { docId: fallback.docId, docName: fallback.docName, angle: null, trigger: fallback.triggerSignal };
  }
  return { docId: null, docName: null, angle: null, trigger: null };
}

/**
 * EMAIL_1 — demo confirmation, cold-call path. Kept as template; no LLM.
 * Pure personalisation is just first name, which the LLM can't improve on.
 */
function generateEmail1Template(investor: Investor): EmailOutput {
  const tpl = EMAIL_TEMPLATES.demoConfirmation;
  const firstName = investor.name.split(" ")[0] || "there";
  const body = [
    `Hi ${firstName},`,
    ``,
    `Good to speak. Looking forward to [DAY] at [TIME].`,
    ``,
    `This call is about EIS and the platform — not the investment itself. We'll cover the statutory mechanics of EIS, walk through the platform live, and there'll be time for your questions. What we won't cover is any specific investment opportunity unless you want to.`,
    ``,
    `EIS is about asymmetric risk — discipline, not a punt. Certain conditions need to align. The call gives us a chance to see whether they do in your situation.`,
    ``,
    `Duration: 15–20 minutes plus questions. Video call, screen share on my side.`,
    ``,
    `I've attached a short overview — no need to read in advance. It'll make sense afterwards.`,
    ``,
    `Tom`,
    ``,
    DISCLAIMER,
  ].join("\n");

  const compliance = validateCompliance(body);
  return {
    templateId: tpl.id,
    subject: tpl.subject,
    body,
    attachmentDocId: tpl.attachment?.docId ?? null,
    attachmentDocName: tpl.attachment?.docName ?? null,
    coverNoteAngle: null,
    personalisationSources: ["name"],
    complianceCheck: { passed: compliance.passed, violations: compliance.violations.map((v) => `[${v.ruleId}] ${v.found}`) },
    timing: tpl.timing,
  };
}

/**
 * EMAIL_2 — post-demo follow-up. LLM-generated subject + body using the
 * investor's verbatim language from fact-find. Compliance validated
 * deterministically after generation.
 */
async function generateEmail2WithLLM(args: {
  investor: Investor;
  signalUpdates: SignalUpdate[];
  content: ContentRecommendation | null;
  gateResult: GateResult;
}): Promise<GenerateEmailLLMResult> {
  const { investor, signalUpdates, content, gateResult } = args;
  const tpl = EMAIL_TEMPLATES.postDemo;
  const ff = investor.factFind;

  // Gate: require at least Level 1 or Level 2 personalisation. Without
  // investor quotes / problem / outcome, we can't produce a post-demo
  // email that isn't generic slop.
  const exact = ff.exactPhrases?.[0]?.trim() || null;
  const problem = ff.practicalProblem?.trim() || null;
  const outcome = ff.desiredOutcome?.trim() || null;
  if (!exact && !problem && !outcome) {
    return {
      email: null,
      audit: null,
      flag: {
        type: "missing_data",
        message: "Post-demo email requires Level 1 (exactPhrases) or Level 2 (practicalProblem/desiredOutcome). None available.",
      },
    };
  }

  // Deterministic attachment selection (runs before LLM so the prompt
  // knows which doc the letter is carrying).
  const attachment = resolveAttachment(
    signalUpdates.map((u) => ({ code: u.code, newState: u.newState })),
    gateResult.pack1 === "eligible",
    content,
  );

  const personalisationSources: string[] = [];
  if (exact) personalisationSources.push("exactPhrases");
  if (problem) personalisationSources.push("practicalProblem");
  if (outcome) personalisationSources.push("desiredOutcome");
  if (ff.personalAngle) personalisationSources.push("personalAngle");

  // --- Build prompt ---
  const firstName = investor.name.split(" ")[0] || "there";

  const signalLines = signalUpdates.map((u) => `  ${u.code}: ${u.previousState} → ${u.newState}${u.evidence ? ` (${u.evidence.slice(0, 80)})` : ""}`);

  const prohibitedList = COMPLIANCE.rules.map((r) => `- "${r.prohibited.join('", "')}" (rule ${r.id}; use instead: "${r.correct}")`).join("\n");

  const systemPrompt = `
You are writing a post-demo follow-up email for the Unlock investor
intelligence platform. The sender is Tom, who runs the firm. The email
goes to an investor who has just completed a demo call.

VOICE: Measured, senior, considered. Direct but not pushy. Written like
a thoughtful partner, not a salesperson. Short sentences. No marketing
language. No exclamation marks. No emoji. No em-dashes in the body
(Tom uses hyphens or commas instead).

STRUCTURE:
1. Greeting line
2. Opening recap — anchor on the investor's own words if available
3. Status read — an honest, brief read of where the signals stand
4. Attachment paragraph — what you've attached and why it fits
5. Next step — Call 3 framing, lightly-held invitation
6. Sign-off + disclaimer line

LENGTH: Body under 250 words. Every sentence earns its place.

HARD RULES:
- Echo the investor's distinctive phrase verbatim where relevant. Do NOT
  paraphrase their exact phrase if you have it — quote it directly, in
  quote marks.
- Never claim returns, performance, or outcomes. This is EIS — capital
  at risk, always.
- Never say "guaranteed", "safe", "low-risk", "high-returns", or use any
  of the prohibited strings listed below.
- The disclaimer line "${DISCLAIMER}" MUST appear at the end on its own line.
- Sign-off is just "Tom" on its own line before the disclaimer.
- Output VALID JSON only. No markdown. No preamble. No trailing text.

PROHIBITED STRINGS (by rule):
${prohibitedList}

Return this exact JSON shape:
{
  "subject": "string, under 70 chars",
  "body": "full email text from greeting through disclaimer"
}
`.trim();

  const userMessage = `
Investor: ${firstName} (${investor.persona} persona, hot button: ${investor.hotButton ?? "none"})

Fact-find available:
${exact ? `- exactPhrase: "${exact}"` : "- exactPhrase: (none)"}
${problem ? `- practicalProblem: ${problem}` : "- practicalProblem: (none)"}
${outcome ? `- desiredOutcome: ${outcome}` : "- desiredOutcome: (none)"}
${ff.personalAngle ? `- personalAngle: ${ff.personalAngle}` : ""}
${ff.portfolioShape ? `- portfolioShape: ${ff.portfolioShape}` : ""}
${ff.decisionStakeholders ? `- decisionStakeholders: ${ff.decisionStakeholders}` : ""}

Signal movements this call:
${signalLines.length ? signalLines.join("\n") : "  (no significant movements)"}

Pack 1 gate status: ${gateResult.pack1}
Attachment selected: ${attachment.docName ?? "(none)"}${attachment.trigger ? ` — triggered by ${attachment.trigger}` : ""}${attachment.angle ? ` — angle: ${attachment.angle}` : ""}

Write the email. Output JSON only.
`.trim();

  const startedAt = Date.now();
  let message: any;
  try {
    message = await claudeWithTimeout(
      anthropic,
      {
        model: DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      },
      EMAIL_TIMEOUT_MS,
    );
  } catch (err: any) {
    if (err?.name === "ClaudeTimeoutError") {
      throw new ExtractionError(`Email generation timed out after ${EMAIL_TIMEOUT_MS}ms`, "timeout");
    }
    throw new ExtractionError(`Claude email API error: ${err?.message || String(err)}`, "api_error");
  }
  const latencyMs = Date.now() - startedAt;

  const blocks = message?.content || [];
  const textBlock = blocks.find((b: any) => b?.type === "text");
  const text: string = textBlock?.text ?? "";
  if (!text) throw new ExtractionError("Claude email returned no text", "empty_response");

  // Pull JSON object — same tolerant parser style as extractViaLLM
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new ExtractionError("No JSON in email response", "malformed_json", text);

  let parsed: any;
  try { parsed = JSON.parse(jsonText); }
  catch (err: any) { throw new ExtractionError(`Email JSON parse failed: ${err?.message}`, "malformed_json", jsonText); }

  if (typeof parsed?.subject !== "string" || typeof parsed?.body !== "string") {
    throw new ExtractionError("Email response missing subject or body strings", "validation_failed", jsonText);
  }

  // Compliance check stays deterministic — per directive, C9 is exact
  // string matching and must not be LLM-gated.
  const compliance = validateCompliance(parsed.body);

  const usage = message?.usage || {};
  const audit: ExtractionAudit = {
    model: DEFAULT_MODEL,
    latencyMs,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    extractionVersion: EMAIL_PROMPT_VERSION,
  };

  return {
    email: {
      templateId: tpl.id,
      subject: parsed.subject.slice(0, 200), // hard cap, belt-and-braces
      body: parsed.body,
      attachmentDocId: attachment.docId,
      attachmentDocName: attachment.docName,
      coverNoteAngle: attachment.angle,
      personalisationSources,
      complianceCheck: { passed: compliance.passed, violations: compliance.violations.map((v) => `[${v.ruleId}] ${v.found}`) },
      timing: tpl.timing,
    },
    flag: null,
    audit,
  };
}

/**
 * Public entry point — routes to the right generator by call type.
 * Cold call → EMAIL_1 template (no LLM).
 * Demo     → EMAIL_2 via LLM if personalisation available, otherwise flag.
 * Opportunity → no email (handled manually per spec).
 */
export async function generateEmailWithLLM(args: {
  investor: Investor;
  callType: CallType;
  content: ContentRecommendation | null;
  signalUpdates: SignalUpdate[];
  gateResult: GateResult;
}): Promise<GenerateEmailLLMResult> {
  if (args.callType === "cold_call") {
    return { email: generateEmail1Template(args.investor), flag: null, audit: null };
  }
  if (args.callType === "demo") {
    return generateEmail2WithLLM({
      investor: args.investor,
      signalUpdates: args.signalUpdates,
      content: args.content,
      gateResult: args.gateResult,
    });
  }
  return { email: null, flag: null, audit: null };
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return trimmed.slice(firstBrace, i + 1); }
  }
  return null;
}
