// C13. generateEmail (V3)
// Produces a complete email draft (EMAIL_1 demo confirmation, or EMAIL_2
// post-demo) with subject, body, attachment, cover-note angle, and a
// compliance check of the body.
//
// EMAIL_2 requires Level 1 or Level 2 personalisation data (exactPhrases,
// practicalProblem, desiredOutcome). Returns null with missing_data flag
// otherwise.
import { EMAIL_TEMPLATES } from "../config";
import type {
  CallType,
  ContentRecommendation,
  EmailOutput,
  EngineFlag,
  GateResult,
  Investor,
  SignalUpdate,
} from "../types";
import { validateCompliance } from "./validateCompliance";

const DISCLAIMER = "Capital at risk. This is an introduction, not financial advice.";

export interface GenerateEmailResult {
  email: EmailOutput | null;
  flag: EngineFlag | null;
}

export function generateEmail(
  investor: Investor,
  callType: CallType,
  content: ContentRecommendation | null,
  signalUpdates: SignalUpdate[],
  gateResult: GateResult,
): GenerateEmailResult {
  if (callType === "cold_call") {
    return { email: generateEmail1(investor), flag: null };
  }
  if (callType === "demo") {
    return generateEmail2(investor, content, signalUpdates, gateResult);
  }
  // Opportunity call — Call 3 follow-up is manual / variant per spec.
  return { email: null, flag: null };
}

// ============ EMAIL_1 — Demo Confirmation ============

function generateEmail1(investor: Investor): EmailOutput {
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
    subject: tpl.subject.replace("[DAY]", "[DAY]").replace("[TIME]", "[TIME]"),
    body,
    attachmentDocId: tpl.attachment?.docId ?? null,
    attachmentDocName: tpl.attachment?.docName ?? null,
    coverNoteAngle: null,
    personalisationSources: ["name"],
    complianceCheck: { passed: compliance.passed, violations: compliance.violations.map((v) => `[${v.ruleId}] ${v.found}`) },
    timing: tpl.timing,
  };
}

// ============ EMAIL_2 — Post-Demo ============

function resolveCoverNoteAngle(
  signals: { code: string; newState: string }[],
  pack1Eligible: boolean,
): { docId: number | null; docName: string | null; angle: string | null; trigger: string | null } {
  if (pack1Eligible) {
    const match = EMAIL_TEMPLATES.attachmentRoutingTable.find((r) => r.belief === "PACK1_GATE");
    if (match) return { docId: match.docId, docName: "Pack 1 — Founding Investor Brief", angle: match.angle, trigger: "PACK1_GATE" };
  }
  // Walk routing table in priority order; return first match
  for (const route of EMAIL_TEMPLATES.attachmentRoutingTable) {
    if (route.belief === "PACK1_GATE") continue;
    const signal = signals.find((s) => s.code === route.belief && s.newState === route.state);
    if (signal) {
      return { docId: route.docId, docName: signalDocName(route.docId), angle: route.angle, trigger: route.belief };
    }
  }
  return { docId: null, docName: null, angle: null, trigger: null };
}

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

function generateEmail2(
  investor: Investor,
  content: ContentRecommendation | null,
  signalUpdates: SignalUpdate[],
  gateResult: GateResult,
): GenerateEmailResult {
  const tpl = EMAIL_TEMPLATES.postDemo;
  const ff = investor.factFind;
  const firstName = investor.name.split(" ")[0] || "there";

  // Level 1 = exact phrases. Level 2 = practical_problem / desired_outcome.
  const exact = ff.exactPhrases?.[0]?.trim() || null;
  const problem = ff.practicalProblem?.trim() || null;
  const outcome = ff.desiredOutcome?.trim() || null;

  if (!exact && !problem && !outcome) {
    return {
      email: null,
      flag: {
        type: "missing_data",
        message: "Post-demo email requires Level 1 (exactPhrases) or Level 2 (practicalProblem/desiredOutcome) data. None available.",
      },
    };
  }

  const personalisationSources: string[] = [];
  if (exact) personalisationSources.push("exactPhrases");
  if (problem) personalisationSources.push("practicalProblem");
  if (outcome) personalisationSources.push("desiredOutcome");

  // Resolve attachment from routing table. Use content recommendation if it matches; otherwise pick from table.
  const pack1Eligible = gateResult.pack1 === "eligible";
  const routing = resolveCoverNoteAngle(signalUpdates, pack1Eligible);
  let attachmentDocId = routing.docId ?? content?.docId ?? null;
  let attachmentDocName = routing.docName ?? content?.docName ?? null;

  // Recap opening — use highest-value personalisation available
  const opening = exact
    ? `You said: "${exact}". That stuck.`
    : problem
      ? `Thinking about what you described — ${problem}.`
      : `Thinking about what you're looking for — ${outcome}.`;

  // Recap body
  const recap = [
    exact ? `We covered why EIS specifically, the platform demo, and started mapping it onto your situation.` : `We covered the statutory mechanics, demo'd the platform, and started sketching what it could look like for you.`,
    problem ? `The core of it: ${problem}.` : null,
  ].filter(Boolean).join(" ");

  // Status paragraph — honest read of where signals stand
  const interestingGreens = signalUpdates.filter((u) => u.newState === "green").map((u) => u.code).slice(0, 3);
  const ambers = signalUpdates.filter((u) => u.newState === "amber").map((u) => u.code).slice(0, 3);
  const status = (interestingGreens.length || ambers.length)
    ? `Where you are: ${interestingGreens.length ? `${interestingGreens.join(", ")} feel solid. ` : ""}${ambers.length ? `A couple of things still worth reading more on (${ambers.join(", ")}).` : ""}`
    : `Where you are: plenty of ground still to cover before a decision.`;

  // Attachment paragraph
  const attachmentLine = attachmentDocName
    ? `I've attached ${attachmentDocName}. ${routing.angle ?? "Relevant to where we got to."}`
    : `No attachment this time — let me know if there's something specific you'd find useful.`;

  // Next step
  const nextStep = outcome
    ? `If you want to go further — Call 3 is where we look specifically at whether it makes sense to back this, including the founding-round mechanics and what commitment would look like.`
    : `If you want to go further — Call 3 gets into the founding-round specifics and what actually committing would look like.`;

  const body = [
    `Hi ${firstName},`,
    ``,
    opening,
    ``,
    recap,
    ``,
    status,
    ``,
    nextStep,
    ``,
    attachmentLine,
    ``,
    `Let me know what you think — not whether you want to proceed, just what you think.`,
    ``,
    `Happy to speak [DAY_1] at [TIME_1] or [DAY_2] at [TIME_2].`,
    ``,
    `Tom`,
    ``,
    DISCLAIMER,
  ].join("\n");

  const compliance = validateCompliance(body);

  return {
    email: {
      templateId: tpl.id,
      subject: tpl.subject,
      body,
      attachmentDocId,
      attachmentDocName,
      coverNoteAngle: routing.angle,
      personalisationSources,
      complianceCheck: { passed: compliance.passed, violations: compliance.violations.map((v) => `[${v.ruleId}] ${v.found}`) },
      timing: tpl.timing,
    },
    flag: null,
  };
}
