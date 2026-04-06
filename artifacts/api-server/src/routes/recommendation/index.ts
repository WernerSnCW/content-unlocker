import { Router, type IRouter } from "express";
import { db, leadsTable, documentsTable, changelogTable, videosTable, leadIntelligenceTable, leadBeliefsTable, beliefRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  AnalyzeTranscriptBody,
  RankDocumentsBody,
  ConfirmSendBody,
  GenerateEmailDraftBody,
} from "@workspace/api-zod";
import personaGuide from "../../data/content/520_GUIDE_Investor_Personas_19_V1_CURRENT.md";
import emailTemplates from "../../data/230_EMAILS_Pack1_Templates_V2_CURRENT.txt";
import { resolveArchetype, VALID_ARCHETYPES } from "../../../../../lib/personas";
import { generateBriefFromGap } from "../content/gaps";
import { shouldExclude, getWorthItWeight, getPersonaRoute, getStageRule, DOCUMENT_RULES } from "../../data/document-usage-matrix";
import { deriveMatrixFlags } from "../../lib/recommendation-context";
import multer from "multer";
import mammoth from "mammoth";

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];
const MAX_FILES = 20;
const MAX_FILE_SIZE = 500 * 1024;

const NOISE_WORDS = new Set(["call", "recording", "transcript", "aircall", "call-recording", "rec", "audio", "voicemail", "vm"]);
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{2}-\d{2}-\d{4}\b/g,
  /\b\d{2}\/\d{2}\/\d{4}\b/g,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*\d{1,2}(?:\s*,?\s*\d{4})?\b/gi,
  /\b\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:\s*\d{4})?\b/gi,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d{1,2}\b/gi,
];

const AIRCALL_LINE_RX = /^\[(\d{2}:\d{2}:\d{2})\]\s+([^:]+):\s*/;
const AGENT_KEYWORDS = ["agent", "rep", "caller", "sales", "unlock"];
const AGENT_NAMES = ["tom", "thomas", "claudia", "william"];

function isAircallFormat(content: string): boolean {
  const lines = content.split("\n");
  let matchCount = 0;
  for (const line of lines) {
    if (AIRCALL_LINE_RX.test(line.trim())) matchCount++;
    if (matchCount >= 3) return true;
  }
  return false;
}

function identifyAgentLabel(labels: string[], lines: string[]): string {
  for (const label of labels) {
    const lower = label.toLowerCase();
    if (AGENT_KEYWORDS.some((kw) => lower.includes(kw))) return label;
  }
  for (const label of labels) {
    const lower = label.toLowerCase().trim();
    if (AGENT_NAMES.includes(lower)) return label;
  }
  for (const line of lines) {
    const match = line.trim().match(AIRCALL_LINE_RX);
    if (match) return match[2].trim();
  }
  return labels[0];
}

function normaliseAircallTranscript(content: string): { content: string; agentLabel: string; investorLabel: string } {
  const lines = content.split("\n");
  const labelSet = new Set<string>();
  for (const line of lines) {
    const match = line.trim().match(AIRCALL_LINE_RX);
    if (match) labelSet.add(match[2].trim());
  }
  const labels = Array.from(labelSet);
  if (labels.length === 0) return { content, agentLabel: "Unknown", investorLabel: "Unknown" };

  const agentLabel = identifyAgentLabel(labels, lines);
  const investorLabels = labels.filter((l) => l !== agentLabel);
  const investorLabel = investorLabels.length > 0 ? investorLabels.join(" / ") : labels.length === 1 ? labels[0] : "Unknown";

  const normalised = lines.map((line) => {
    const match = line.trim().match(AIRCALL_LINE_RX);
    if (!match) return line;
    const speaker = match[2].trim();
    const replacement = speaker === agentLabel ? "Agent" : "Investor";
    return line.replace(`${match[2]}:`, `${replacement}:`);
  });

  const header = `[TRANSCRIPT FORMAT: Aircall]\n[INVESTOR SPEAKER: ${investorLabel}]\n[AGENT SPEAKER: ${agentLabel}]\n[SPEAKERS NORMALISED: true]\n---`;
  return { content: `${header}\n${normalised.join("\n")}`, agentLabel, investorLabel };
}

function extractInvestorName(filename: string): string | null {
  let name = filename.replace(/\.(txt|docx)$/i, "");
  name = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  for (const pattern of DATE_PATTERNS) {
    name = name.replace(pattern, " ");
  }
  name = name.replace(/\s+/g, " ").trim();
  const words = name.split(" ").filter((w) => !NOISE_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (words.length < 2 || words.length > 4) return null;
  if (words.some((w) => /\d/.test(w))) return null;
  const titleCased = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  if (titleCased.length < 3) return null;
  return titleCased;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 10,
    parts: MAX_FILES + 10,
  },
});

const router: IRouter = Router();

router.post("/recommendation/parse-transcripts", upload.array("files", MAX_FILES + 1), async (req: any, res): Promise<void> => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No files uploaded" });
    return;
  }
  if (files.length > MAX_FILES) {
    res.status(400).json({ error: `Maximum ${MAX_FILES} files allowed per batch. You uploaded ${files.length}.` });
    return;
  }

  const parsed: Array<{ filename: string; content: string; investor_name: string | null; error?: string }> = [];

  for (const file of files) {
    const investorName = extractInvestorName(file.originalname);

    if (file.size > MAX_FILE_SIZE) {
      parsed.push({ filename: file.originalname, content: "", investor_name: investorName, error: `File exceeds ${MAX_FILE_SIZE / 1024}KB size limit (${Math.round(file.size / 1024)}KB)` });
      continue;
    }

    const ext = file.originalname.toLowerCase().split(".").pop();

    let rawText = "";
    if (ext === "txt") {
      rawText = file.buffer.toString("utf-8").trim();
      if (!rawText) {
        parsed.push({ filename: file.originalname, content: "", investor_name: investorName, error: "File is empty" });
        continue;
      }
    } else if (ext === "docx") {
      try {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        rawText = result.value.trim();
        if (!rawText) {
          parsed.push({ filename: file.originalname, content: "", investor_name: investorName, error: "Document body is empty" });
          continue;
        }
      } catch {
        parsed.push({ filename: file.originalname, content: "", investor_name: investorName, error: "Failed to parse .docx file — file may be corrupt" });
        continue;
      }
    } else {
      parsed.push({ filename: file.originalname, content: "", investor_name: investorName, error: `Unsupported file format: .${ext}. Only .txt and .docx are supported.` });
      continue;
    }

    if (isAircallFormat(rawText)) {
      const normalised = normaliseAircallTranscript(rawText);
      parsed.push({ filename: file.originalname, content: normalised.content, investor_name: investorName });
    } else {
      parsed.push({ filename: file.originalname, content: rawText, investor_name: investorName });
    }
  }

  res.json({ parsed });
});

router.post("/recommendation/analyze-batch", async (req, res): Promise<void> => {
  const { transcripts } = req.body;
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    res.status(400).json({ error: "transcripts array is required" });
    return;
  }
  if (transcripts.length > MAX_FILES) {
    res.status(400).json({ error: `Maximum ${MAX_FILES} transcripts allowed per batch` });
    return;
  }
  const MAX_CONTENT_LENGTH = 50000;
  for (const item of transcripts) {
    if (typeof item.content === "string" && item.content.length > MAX_CONTENT_LENGTH) {
      item.content = item.content.slice(0, MAX_CONTENT_LENGTH);
    }
  }

  const compactPersonaRef = personaGuide.slice(0, 6000);
  const results: Array<{
    filename: string;
    investor_name: string | null;
    status: "success" | "error";
    analysis?: any;
    error?: string;
  }> = [];

  for (const item of transcripts) {
    const investorName = item.investor_name || null;

    if (!item.content || !item.content.trim()) {
      results.push({ filename: item.filename || "unknown", investor_name: investorName, status: "error", error: "Empty transcript content" });
      continue;
    }
    const today = new Date().toISOString().split("T")[0];
    const metadataBlock = investorName
      ? `CALL METADATA\nInvestor: ${investorName}\nKnown stage: Unknown\nDate: ${today}\n---\n`
      : `CALL METADATA\nInvestor: Unknown\nKnown stage: Unknown\nDate: ${today}\n---\n`;
    const transcriptWithMeta = metadataBlock + item.content;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `TRANSCRIPT ANALYSIS INSTRUCTIONS

This transcript may be in Aircall format with timestamped speaker turns and normalised speaker labels.

If the transcript contains [TRANSCRIPT FORMAT: Aircall] in the header:
- "Investor" speaker turns are the ONLY source of persona signals, objection detection, readiness signals, and information gaps
- "Agent" speaker turns provide context about what was asked or demonstrated, but must NOT be used as signals of the investor's views, knowledge, or emotional state
- Do not treat the Agent's EIS explanations as investor familiarity
- Do not treat the Agent's objection handling as investor objections
- Do use the Agent's questions to understand which signals were probed during the call

If the transcript does NOT contain this header, analyse the full text as a single voice (free-form transcript).

Analyze this investor call transcript and return structured JSON.

TRANSCRIPT:
${transcriptWithMeta}

LEAD CONTEXT:
No prior history — first contact.

PERSONA REFERENCE (compact):
${compactPersonaRef}

PIPELINE STAGES (canonical — use exactly one): ${PIPELINE_STAGES.join(", ")}

PRIMARY ISSUE CATEGORIES (use exactly one):
- READY_TO_CLOSE — investor shows clear buying signals, no blocking objections
- OBJECTION_TO_RESOLVE — specific objection identified that blocks progress
- INFORMATION_GAP — investor lacks key information needed to decide
- NEEDS_NURTURING — not ready yet, requires longer-term engagement

You must return ONLY valid JSON matching this exact schema:
{
  "detected_persona": {
    "name": "<one of the 19 personas or 3 public archetypes: Growth Seeker, Preserver, Legacy Builder>",
    "confidence_score": <0.0-1.0>,
    "evidence": ["<signal from transcript>", ...]
  },
  "pipeline_stage": {
    "stage": "<EXACTLY one of: Outreach, Called, Demo Booked, Demo Complete, Decision>",
    "confidence_score": <0.0-1.0>,
    "rationale": "<why this stage>"
  },
  "readiness_score": <0.0-1.0>,
  "objections": [
    {
      "objection": "<what the investor objected to>",
      "severity": "<blocking | significant | minor>",
      "suggested_response": "<how to address it>"
    }
  ],
  "blocking_objections": ["<list only blocking-severity objections>"],
  "information_gaps": [
    {
      "gap": "<what information is missing>",
      "impact": "<how this gap affects the decision>",
      "suggested_document_type": "<type of document that would fill this gap>"
    }
  ],
  "primary_issue": "<EXACTLY one of: READY_TO_CLOSE, OBJECTION_TO_RESOLVE, INFORMATION_GAP, NEEDS_NURTURING>",
  "recommended_next_action": "<one specific, actionable sentence>",
  "questions_answered": {
    "Q1": <true/false — was the investor's goals/motivation discussed?>,
    "Q2": <true/false — was prior investment experience discussed?>,
    "Q3": <true/false — were hesitations or objections surfaced?>,
    "Q4": <true/false — were other decision-makers discussed?>
  },
  "transcript_summary": "<2-3 sentence summary>",
  "pipeline_stage_suggestion": "<suggested next stage or null>"
}

Return ONLY the JSON object, no markdown formatting, no code blocks.`,
          },
        ],
      });

      const block = message.content[0];
      const text = block.type === "text" ? block.text : "";
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const analysis = JSON.parse(cleaned);

      const persona = analysis.detected_persona || { name: "Unknown", confidence_score: 0, evidence: [] };
      const stage = analysis.pipeline_stage || { stage: "Called", confidence_score: 0, rationale: "" };

      if (!PIPELINE_STAGES.includes(stage.stage)) {
        stage.stage = "Called";
        stage.confidence_score = 0;
      }

      const validPrimaryIssues = ["READY_TO_CLOSE", "OBJECTION_TO_RESOLVE", "INFORMATION_GAP", "NEEDS_NURTURING"];
      const primaryIssue = validPrimaryIssues.includes(analysis.primary_issue) ? analysis.primary_issue : "NEEDS_NURTURING";

      const qa = analysis.questions_answered || { Q1: false, Q2: false, Q3: false, Q4: false };
      const questionsCovered = [qa.Q1, qa.Q2, qa.Q3, qa.Q4].filter(Boolean).length;
      const missingSignals: string[] = [];
      if (!qa.Q1) missingSignals.push("Investment goals and time horizon");
      if (!qa.Q2) missingSignals.push("Prior EIS/startup investing experience");
      if (!qa.Q3) missingSignals.push("Hesitations or deal-breakers");
      if (!qa.Q4) missingSignals.push("Other decision-makers involved");

      let confidenceImpact = "Full coverage — high confidence analysis";
      if (questionsCovered <= 2) confidenceImpact = "Low coverage — analysis confidence may be reduced";
      else if (questionsCovered === 3) confidenceImpact = "Good coverage — one signal area missing";

      const batchParsedObjections = (analysis.objections || []).map((o: any) => ({
        objection: o.objection || o,
        severity: o.severity || "minor",
        suggested_response: o.suggested_response || "",
      }));
      const batchParsedGaps = (analysis.information_gaps || []).map((g: any) => ({
        gap: g.gap || "",
        impact: g.impact || "",
        suggested_document_type: g.suggested_document_type || "",
      }));
      const batchSummary = analysis.transcript_summary || "";

      const batchMatrixContext = deriveMatrixFlags({
        transcript_summary: batchSummary,
        information_gaps: batchParsedGaps,
        blocking_objections: analysis.blocking_objections || [],
        objections: batchParsedObjections,
      });

      results.push({
        filename: item.filename,
        investor_name: investorName,
        status: "success",
        analysis: {
          persona: persona.name,
          persona_confidence: persona.confidence_score,
          stage: stage.stage,
          stage_confidence: stage.confidence_score,
          objections: batchParsedObjections,
          blocking_objections: analysis.blocking_objections || [],
          evidence: persona.evidence || [],
          readiness_score: typeof analysis.readiness_score === "number" ? analysis.readiness_score : 0.5,
          primary_issue: primaryIssue,
          recommended_next_action: analysis.recommended_next_action || "Follow up with relevant materials.",
          information_gaps: batchParsedGaps,
          questions_answered: qa,
          call_completeness: {
            questions_covered: questionsCovered,
            questions_total: 4,
            missing_signals: missingSignals,
            confidence_impact: confidenceImpact,
          },
          transcript_summary: batchSummary,
          pipeline_stage_suggestion: analysis.pipeline_stage_suggestion || null,
          matrix_context: batchMatrixContext,
        },
      });
    } catch (err: any) {
      results.push({
        filename: item.filename,
        investor_name: investorName,
        status: "error",
        error: err.message || "Analysis failed",
      });
    }
  }

  const allLeads = await db.select().from(leadsTable);
  const enrichedResults = results.map((r: any) => {
    if (r.investor_name && r.status === "success") {
      const qLower = r.investor_name.toLowerCase().trim();
      const qWords = qLower.split(/\s+/);
      const matches: Array<{ lead_id: string; name: string; company: string; pipeline_stage: string; detected_persona: string; confidence: number }> = [];

      for (const lead of allLeads) {
        const nameLower = lead.name.toLowerCase();
        const nameWords = nameLower.split(/\s+/);
        let confidence = 0;

        if (nameLower === qLower) {
          confidence = 1.0;
        } else if (qWords.every((w: string) => nameWords.includes(w))) {
          confidence = 0.85;
        } else if (qWords.length > 0 && nameWords.length > 0 && nameWords[nameWords.length - 1] === qWords[qWords.length - 1]) {
          confidence = 0.4;
        } else if (qWords.length > 0 && nameWords.length > 0 && nameWords[0] === qWords[0]) {
          confidence = 0.5;
        }

        if (confidence >= 0.4) {
          matches.push({
            lead_id: lead.id, name: lead.name, company: lead.company || "",
            pipeline_stage: lead.pipeline_stage, detected_persona: lead.detected_persona || "", confidence,
          });
        }
      }

      matches.sort((a, b) => b.confidence - a.confidence);
      const topMatches = matches.slice(0, 3);

      if (topMatches.length > 0 && topMatches[0].confidence >= 0.85) {
        r.lead_match = { matches: topMatches, status: "matched" };
      } else if (topMatches.length > 0) {
        r.lead_match = { matches: topMatches, status: "partial" };
      } else {
        r.lead_match = { matches: [], status: "none" };
      }
    }
    return r;
  });

  res.json({ results: enrichedResults });
});

router.post("/recommendation/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeTranscriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { transcript, lead_id } = parsed.data;
  const questions_answered = req.body.questions_answered as { Q1?: boolean; Q2?: boolean; Q3?: boolean; Q4?: boolean } | undefined;

  let sendHistorySummary = "No prior history — first contact.";
  if (lead_id) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead_id));
    if (lead) {
      const sendLog = (lead.send_log as any[]) || [];
      if (sendLog.length > 0) {
        sendHistorySummary = `Returning lead. ${sendLog.length} previous sends. Last contact: ${lead.last_contact}. Documents previously sent: ${sendLog.flatMap((s: any) => s.documents_sent).join(", ")}. Current stage: ${lead.pipeline_stage}.`;
      }
    }
  }

  let intelligenceContext = "No intelligence profile available for this lead.";
  let beliefContext = "No belief states recorded for this lead.";

  if (lead_id) {
    const intelligenceRows = await db.select().from(leadIntelligenceTable)
      .where(eq(leadIntelligenceTable.lead_id, lead_id)).limit(1);
    const intelligence = intelligenceRows[0] || null;

    const beliefRows = await db.select({
      belief_id: leadBeliefsTable.belief_id,
      state: leadBeliefsTable.state,
      belief_name: beliefRegistryTable.name,
    }).from(leadBeliefsTable)
      .leftJoin(beliefRegistryTable, eq(leadBeliefsTable.belief_id, beliefRegistryTable.id))
      .where(eq(leadBeliefsTable.lead_id, lead_id));

    if (intelligence) {
      intelligenceContext = `
INVESTOR INTELLIGENCE PROFILE:
- Cluster: ${intelligence.cluster || 'unknown'}
- Qualification: ${intelligence.qualification_status}
- Hot button: ${intelligence.hot_button || 'not identified'}
- Already done EIS: ${intelligence.already_done_eis ?? 'unknown'}
- IFA involved: ${intelligence.ifa_involved ?? 'unknown'}
- Readiness: ${intelligence.readiness_status || 'unknown'}
- Primary blocker: ${intelligence.primary_blocker || 'none identified'}
- Profile summary: ${intelligence.profile_summary || 'not available'}
`;
    }

    if (beliefRows.length > 0) {
      beliefContext = `
BELIEF STATES (what this investor currently understands):
${beliefRows.map(b => `- ${b.belief_name} (${b.belief_id}): ${b.state}`).join('\n')}
`;
    }
  }

  const compactPersonaRef = personaGuide.slice(0, 6000);

  const questionsContext = questions_answered
    ? `\nCALL CHECKLIST STATUS:\n- Q1 (Goals/motivation): ${questions_answered.Q1 ? "COVERED" : "NOT COVERED"}\n- Q2 (Prior experience): ${questions_answered.Q2 ? "COVERED" : "NOT COVERED"}\n- Q3 (Hesitations/objections): ${questions_answered.Q3 ? "COVERED" : "NOT COVERED"}\n- Q4 (Other decision makers): ${questions_answered.Q4 ? "COVERED" : "NOT COVERED"}\n`
    : "\nCALL CHECKLIST STATUS: Not provided — infer from the transcript which of these four areas were addressed:\n- Q1: Investment goals and time horizon\n- Q2: Prior EIS/startup investing experience\n- Q3: Hesitations or deal-breakers\n- Q4: Other decision-makers involved\n";

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `TRANSCRIPT ANALYSIS INSTRUCTIONS

This transcript may be in Aircall format with timestamped speaker turns and normalised speaker labels.

If the transcript contains [TRANSCRIPT FORMAT: Aircall] in the header:
- "Investor" speaker turns are the ONLY source of persona signals, objection detection, readiness signals, and information gaps
- "Agent" speaker turns provide context about what was asked or demonstrated, but must NOT be used as signals of the investor's views, knowledge, or emotional state
- Do not treat the Agent's EIS explanations as investor familiarity
- Do not treat the Agent's objection handling as investor objections
- Do use the Agent's questions to understand which signals were probed during the call

If the transcript does NOT contain this header, analyse the full text as a single voice (free-form transcript).

Analyze this investor call transcript and return structured JSON.

TRANSCRIPT:
${transcript}

LEAD CONTEXT:
${sendHistorySummary}
${intelligenceContext}
${beliefContext}
${questionsContext}
PERSONA REFERENCE (compact):
${compactPersonaRef}

PIPELINE STAGES (canonical — use exactly one): ${PIPELINE_STAGES.join(", ")}

PRIMARY ISSUE CATEGORIES (use exactly one):
- READY_TO_CLOSE — investor shows clear buying signals, no blocking objections
- OBJECTION_TO_RESOLVE — specific objection identified that blocks progress
- INFORMATION_GAP — investor lacks key information needed to decide
- NEEDS_NURTURING — not ready yet, requires longer-term engagement

You must return ONLY valid JSON matching this exact schema:
{
  "detected_persona": {
    "name": "<one of the 19 personas or 3 public archetypes: Growth Seeker, Preserver, Legacy Builder>",
    "confidence_score": <0.0-1.0>,
    "evidence": ["<signal from transcript>", ...]
  },
  "pipeline_stage": {
    "stage": "<EXACTLY one of: Outreach, Called, Demo Booked, Demo Complete, Decision>",
    "confidence_score": <0.0-1.0>,
    "rationale": "<why this stage>"
  },
  "readiness_score": <0.0-1.0>,
  "objections": [
    {
      "objection": "<what the investor objected to>",
      "severity": "<blocking | significant | minor>",
      "suggested_response": "<how to address it>"
    }
  ],
  "blocking_objections": ["<list only blocking-severity objections>"],
  "information_gaps": [
    {
      "gap": "<what information is missing>",
      "impact": "<how this gap affects the decision>",
      "suggested_document_type": "<type of document that would fill this gap>"
    }
  ],
  "primary_issue": "<EXACTLY one of: READY_TO_CLOSE, OBJECTION_TO_RESOLVE, INFORMATION_GAP, NEEDS_NURTURING>",
  "recommended_next_action": "<one specific, actionable sentence>",
  "questions_answered": {
    "Q1": <true/false — was the investor's goals/motivation discussed?>,
    "Q2": <true/false — was prior investment experience discussed?>,
    "Q3": <true/false — were hesitations or objections surfaced?>,
    "Q4": <true/false — were other decision-makers discussed?>
  },
  "transcript_summary": "<2-3 sentence summary>",
  "pipeline_stage_suggestion": "<suggested next stage or null>"
}

Return ONLY the JSON object, no markdown formatting, no code blocks.`,
        },
      ],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    let analysis;
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      req.log.error({ text }, "Failed to parse Claude analysis response");
      res.status(500).json({ error: "Failed to parse AI analysis response" });
      return;
    }

    const stage = analysis.pipeline_stage || { stage: "Called", confidence_score: 0, rationale: "" };
    if (!PIPELINE_STAGES.includes(stage.stage)) {
      stage.stage = "Called";
      stage.confidence_score = 0;
    }

    const validPrimaryIssues = ["READY_TO_CLOSE", "OBJECTION_TO_RESOLVE", "INFORMATION_GAP", "NEEDS_NURTURING"];
    const primaryIssue = validPrimaryIssues.includes(analysis.primary_issue) ? analysis.primary_issue : "NEEDS_NURTURING";

    const qa = analysis.questions_answered || (questions_answered ? {
      Q1: !!questions_answered.Q1,
      Q2: !!questions_answered.Q2,
      Q3: !!questions_answered.Q3,
      Q4: !!questions_answered.Q4,
    } : { Q1: false, Q2: false, Q3: false, Q4: false });

    const questionsCovered = [qa.Q1, qa.Q2, qa.Q3, qa.Q4].filter(Boolean).length;
    const missingSignals: string[] = [];
    if (!qa.Q1) missingSignals.push("Investment goals and time horizon");
    if (!qa.Q2) missingSignals.push("Prior EIS/startup investing experience");
    if (!qa.Q3) missingSignals.push("Hesitations or deal-breakers");
    if (!qa.Q4) missingSignals.push("Other decision-makers involved");

    let confidenceImpact = "Full coverage — high confidence analysis";
    if (questionsCovered <= 2) confidenceImpact = "Low coverage — analysis confidence may be reduced";
    else if (questionsCovered === 3) confidenceImpact = "Good coverage — one signal area missing";

    const parsedObjections = (analysis.objections || []).map((o: any) => ({
      objection: o.objection || "",
      severity: o.severity || "minor",
      suggested_response: o.suggested_response || "",
    }));
    const parsedGaps = (analysis.information_gaps || []).map((g: any) => ({
      gap: g.gap || "",
      impact: g.impact || "",
      suggested_document_type: g.suggested_document_type || "",
    }));
    const transcriptSummary = analysis.transcript_summary || "";

    const matrixContext = deriveMatrixFlags({
      transcript_summary: transcriptSummary,
      information_gaps: parsedGaps,
      blocking_objections: analysis.blocking_objections || [],
      objections: parsedObjections,
    });

    res.json({
      detected_persona: analysis.detected_persona || { name: "Unknown", confidence_score: 0, evidence: [] },
      pipeline_stage: stage,
      readiness_score: typeof analysis.readiness_score === "number" ? analysis.readiness_score : 0.5,
      objections: parsedObjections,
      blocking_objections: analysis.blocking_objections || [],
      information_gaps: parsedGaps,
      primary_issue: primaryIssue,
      recommended_next_action: analysis.recommended_next_action || "Follow up with relevant materials.",
      questions_answered: qa,
      call_completeness: {
        questions_covered: questionsCovered,
        questions_total: 4,
        missing_signals: missingSignals,
        confidence_impact: confidenceImpact,
      },
      transcript_summary: transcriptSummary,
      pipeline_stage_suggestion: analysis.pipeline_stage_suggestion || null,
      matrix_context: matrixContext,
    });
  } catch (err: any) {
    req.log.error({ err }, "Claude API call failed");
    res.status(500).json({ error: "AI analysis failed. Please try again." });
  }
});

function getGateUnlocked(beliefId: string): string | null {
  const gateMap: Record<string, string> = {
    'U4': 'can_ask_risk_appetite_question',
    'F0': 'can_recommend_pack_1, can_recommend_pack_2, can_make_investment_ask',
    'F1': 'can_make_investment_ask (partial)',
    'F2': 'can_make_investment_ask (partial)',
  };
  return gateMap[beliefId] || null;
}

router.post("/recommendation/rank", async (req, res): Promise<void> => {
  const parsed = RankDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    lead_id,
    detected_persona,
    pipeline_stage,
    transcript_summary,
    objections,
    eis_familiar = false,
    iht_confirmed = false,
    adviser_mentioned = false,
  } = parsed.data;

  let sentDocIds: string[] = [];
  if (lead_id) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead_id));
    if (lead) {
      sentDocIds = ((lead.send_log as any[]) || []).flatMap((s: any) => s.documents_sent || []);
    }
  }

  let beliefStateMap: Record<string, string> = {};
  let leadIntelligence: typeof leadIntelligenceTable.$inferSelect | null = null;

  if (lead_id) {
    const beliefRows = await db.select({
      belief_id: leadBeliefsTable.belief_id,
      state: leadBeliefsTable.state,
    }).from(leadBeliefsTable).where(eq(leadBeliefsTable.lead_id, lead_id));

    beliefStateMap = Object.fromEntries(beliefRows.map(b => [b.belief_id, b.state]));

    const intelRows = await db.select().from(leadIntelligenceTable)
      .where(eq(leadIntelligenceTable.lead_id, lead_id)).limit(1);
    leadIntelligence = intelRows[0] || null;
  }

  let effective_eis_familiar = eis_familiar;
  let effective_adviser_mentioned = adviser_mentioned;

  if (leadIntelligence) {
    if (leadIntelligence.already_done_eis !== null && leadIntelligence.already_done_eis !== undefined) {
      effective_eis_familiar = leadIntelligence.already_done_eis;
    }
    if (leadIntelligence.ifa_involved !== null && leadIntelligence.ifa_involved !== undefined) {
      effective_adviser_mentioned = leadIntelligence.ifa_involved;
    }
  }

  const allDocs = await db.select().from(documentsTable);

  const alreadySent = allDocs
    .filter((d) => sentDocIds.includes(d.id))
    .map((d) => {
      const sendEntry = lead_id
        ? ((allDocs as any).__sendLog || []).find((s: any) => s.documents_sent?.includes(d.id))
        : null;
      return {
        document_id: d.id,
        file_code: d.file_code,
        name: d.name,
        date_sent: sendEntry?.date || "unknown",
      };
    });

  if (lead_id) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead_id));
    if (lead) {
      const sendLog = (lead.send_log as any[]) || [];
      for (const as of alreadySent) {
        for (const entry of sendLog) {
          if ((entry.documents_sent || []).includes(as.document_id)) {
            as.date_sent = entry.date;
            break;
          }
        }
      }
    }
  }

  const resolvedArchetype = resolveArchetype(detected_persona);
  if (!resolvedArchetype) {
    req.log.warn({ detected_persona }, "Unrecognised persona — skipping persona filter. Add this persona to lib/personas.ts.");
  }

  const matchesPersona = (d: typeof allDocs[0]) => {
    if (!resolvedArchetype) return true;
    return (d.persona_relevance as string[])?.includes(resolvedArchetype);
  };

  const blockedDocs = allDocs
    .filter(
      (d) =>
        d.review_state === "REQUIRES_REVIEW" &&
        (d.pipeline_stage_relevance as string[])?.includes(pipeline_stage) &&
        matchesPersona(d)
    )
    .map((d) => ({
      document_id: d.id,
      file_code: d.file_code,
      name: d.name,
      reason: `Document requires review before it can be recommended`,
    }));

  const sentShortCodes = allDocs
    .filter((d) => sentDocIds.includes(d.id))
    .map((d) => d.id);

  const preEligible = allDocs.filter(
    (d) =>
      d.lifecycle_status === "CURRENT" &&
      d.review_state === "CLEAN" &&
      (d.pipeline_stage_relevance as string[])?.includes(pipeline_stage) &&
      matchesPersona(d) &&
      !sentDocIds.includes(d.id)
  );

  const sortedPreEligible = [...preEligible].sort((a, b) => {
    const wa = getWorthItWeight(a.id);
    const wb = getWorthItWeight(b.id);
    return wb - wa;
  });

  const excludedDocs: { document_id: string; file_code: string; name: string; reason: string }[] = [];
  const matrixResultCodes: string[] = [];

  const eligible = sortedPreEligible.filter((d) => {
    const shortCode = d.id;
    const result = shouldExclude(shortCode, {
      archetype: resolvedArchetype || "",
      stage: pipeline_stage,
      alreadySent: sentShortCodes,
      currentResults: matrixResultCodes,
      eisFamiliar: effective_eis_familiar,
      ihtConfirmed: iht_confirmed,
      adviserMentioned: effective_adviser_mentioned,
    });
    if (result.excluded) {
      excludedDocs.push({
        document_id: d.id,
        file_code: d.file_code,
        name: d.name,
        reason: result.reason || "Excluded by usage matrix rules",
      });
      return false;
    }
    matrixResultCodes.push(shortCode);
    return true;
  });

  const F0_established = beliefStateMap['F0'] === 'ESTABLISHED';
  const U4_established = beliefStateMap['U4'] === 'ESTABLISHED';

  let eligible_gated = eligible;

  if (lead_id) {
    const FOUNDING_ROUND_FILE_CODES = ['120', '130'];
    const gateExcluded: Array<{ document_id: string; file_code: string; name: string; reason: string }> = [];

    eligible_gated = eligible.filter(doc => {
      if (FOUNDING_ROUND_FILE_CODES.some(code => doc.file_code.startsWith(code)) && !F0_established) {
        gateExcluded.push({
          document_id: doc.id,
          file_code: doc.file_code,
          name: doc.name,
          reason: 'Gate: F0 (Structurally Essential) not yet established',
        });
        return false;
      }
      return true;
    });

    excludedDocs.push(...gateExcluded);
  }

  const U4_flag = !U4_established && lead_id
    ? 'Note: U4 (EIS Risk Is Manageable) not yet established — avoid risk-appetite questions on this call'
    : null;

  if (eligible_gated.length === 0) {
    const gapReasons: string[] = [];
    const totalForStage = allDocs.filter((d) => (d.pipeline_stage_relevance as string[])?.includes(pipeline_stage));
    const totalForPersona = allDocs.filter((d) => matchesPersona(d));
    const totalCurrent = allDocs.filter((d) => d.lifecycle_status === "CURRENT" && d.review_state === "CLEAN");

    if (totalForStage.length === 0) {
      gapReasons.push(`No documents tagged for pipeline stage "${pipeline_stage}"`);
    }
    if (totalForPersona.length === 0 && resolvedArchetype) {
      gapReasons.push(`No documents tagged for archetype "${resolvedArchetype}" (persona: ${detected_persona})`);
    }
    if (blockedDocs.length > 0) {
      gapReasons.push(`${blockedDocs.length} document(s) require review before recommendation`);
    }
    if (sentDocIds.length > 0) {
      const eligibleBeforeExclusion = totalCurrent.filter(
        (d) => (d.pipeline_stage_relevance as string[])?.includes(pipeline_stage) && matchesPersona(d)
      );
      if (eligibleBeforeExclusion.length > 0 && eligibleBeforeExclusion.every((d) => sentDocIds.includes(d.id))) {
        gapReasons.push(`All ${eligibleBeforeExclusion.length} matching document(s) already sent to this lead`);
      }
    }

    const recommendation_gap = {
      gap_detected: true,
      gap_reasons: gapReasons.length > 0 ? gapReasons : ["No eligible documents found for this combination of stage and persona"],
      persona: detected_persona,
      archetype: resolvedArchetype,
      pipeline_stage,
      content_needed: [
        ...(totalForStage.length === 0 ? [`Documents for "${pipeline_stage}" stage`] : []),
        ...(totalForPersona.length === 0 && resolvedArchetype ? [`Documents for "${resolvedArchetype}" archetype`] : []),
      ],
      blocked_count: blockedDocs.length,
      already_sent_count: sentDocIds.length,
    };

    const recommendedVideos = await getRecommendedVideos(resolvedArchetype, pipeline_stage);
    res.json({
      ranked_documents: [],
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      excluded_documents: excludedDocs,
      recommendation_gap,
      recommended_videos: recommendedVideos,
      all_sent_message:
        "All appropriate documents for this stage and persona have already been sent to this investor. Consider advancing to the next pipeline stage.",
    });
    return;
  }

  const candidateList = eligible_gated.slice(0, 8).map((d) => ({
    id: d.id,
    file_code: d.file_code,
    name: d.name,
    description: d.description,
    tier: d.tier,
    worth_it: getWorthItWeight(d.id),
    pipeline_stage_relevance: d.pipeline_stage_relevance,
    persona_relevance: d.persona_relevance,
  }));

  const personaRoute = resolvedArchetype ? getPersonaRoute(resolvedArchetype) : undefined;
  const stageRule = getStageRule(pipeline_stage);

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Rank these eligible documents for an investor meeting.

CONTEXT:
- Detected persona: ${detected_persona}
- Pipeline stage: ${pipeline_stage}
- Transcript summary: ${transcript_summary}
- Objections raised: ${(objections || []).join("; ") || "None"}
${personaRoute ? `\nPERSONA ROUTING (${resolvedArchetype}):
- Core sequence: ${personaRoute.core_sequence.join(" → ")}
- Key insight: ${personaRoute.key_insight}
- Supplementary triggers: ${personaRoute.supplementary_triggers}` : ""}
${stageRule ? `\nSTAGE OBJECTIVE (${pipeline_stage}):
- Objective: ${stageRule.objective}
- Timing: ${stageRule.timing}` : ""}

WORTH-IT RATINGS (use as base weight — 3=★★★ highest leverage, 2=★★, 1=★):
Documents rated 3 should be preferred unless context strongly favours a lower-rated doc.

ELIGIBLE DOCUMENTS (already filtered — rank only these):
${JSON.stringify(candidateList, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "ranked_documents": [
    {
      "document_id": "<id>",
      "priority": <1-based>,
      "rationale": "<one sentence why this document is relevant>",
      "relevance_score": <number between 0.0 and 1.0>
    }
  ]
}

For each document in your ranking, return exactly these fields:
- document_id: string (the document's ID)
- priority: number (1 = highest priority)
- rationale: string (one sentence explaining why this document fits this investor at this stage)
- relevance_score: number between 0.0 and 1.0 (how relevant this document is to the investor's current situation — 1.0 = perfect fit, 0.5 = moderate fit, 0.1 = weak fit)

A relevance_score below 0.4 means the document is a poor fit and should be used with caution. Return relevance_score honestly — do not inflate it.

Rank by relevance to the transcript context and objections. Return ONLY the JSON.`,
        },
      ],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    let ranking;
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      ranking = JSON.parse(cleaned);
    } catch {
      ranking = {
        ranked_documents: candidateList.map((d, i) => ({
          document_id: d.id,
          priority: i + 1,
          rationale: d.description,
        })),
      };
    }

    const rankedWithDetails = (ranking.ranked_documents || []).map((r: any) => {
      const doc = eligible_gated.find((d) => d.id === r.document_id);
      const normRank = r.rank !== undefined ? r.rank : (r.ranking !== undefined ? r.ranking : null);
      const normScore = r.relevance_score !== undefined ? r.relevance_score : (r.score !== undefined ? r.score : null);
      const worthIt = doc ? getWorthItWeight(doc.id) : 2;
      return {
        document_id: r.document_id,
        file_code: doc?.file_code || "",
        name: doc?.name || "",
        description: doc?.description || "",
        tier: doc?.tier || 3,
        priority: r.priority,
        rank: normRank,
        relevance_score: normScore,
        worth_it: worthIt,
        rationale: r.rationale,
      };
    });

    const rankedWithBelief = await Promise.all(rankedWithDetails.map(async (doc: any) => {
      const docRows = await db.select({ belief_targets: documentsTable.belief_targets })
        .from(documentsTable)
        .where(eq(documentsTable.id, doc.document_id))
        .limit(1);

      const beliefTargets = (docRows[0]?.belief_targets as Array<{belief_id: string, state_from: string, state_to: string}> | null) || [];

      const matchingTarget = beliefTargets.find(bt =>
        (beliefStateMap[bt.belief_id] || 'UNKNOWN') === bt.state_from
      );

      return {
        ...doc,
        belief_targeted: matchingTarget?.belief_id || null,
        current_state: matchingTarget ? (beliefStateMap[matchingTarget.belief_id] || 'UNKNOWN') : null,
        state_after_send: matchingTarget?.state_to || null,
        gate_it_unlocks: matchingTarget ? getGateUnlocked(matchingTarget.belief_id) : null,
      };
    }));

    const LOW_RELEVANCE_THRESHOLD = 0.4;
    const scoredResults = rankedWithBelief.filter((r: any) => r.relevance_score !== null && r.relevance_score !== undefined);
    const allLowRelevance = scoredResults.length > 0 && scoredResults.every((r: any) => r.relevance_score < LOW_RELEVANCE_THRESHOLD);

    const recommendedVideos2 = await getRecommendedVideos(resolvedArchetype, pipeline_stage);
    const response: any = {
      ranked_documents: rankedWithBelief,
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      excluded_documents: excludedDocs,
      recommended_videos: recommendedVideos2,
      all_sent_message: null,
      ...(lead_id ? {
        u4_advisory: U4_flag,
        gate_summary: {
          F0_established,
          U4_established,
          founding_round_docs_gated: !F0_established,
        },
      } : {}),
    };

    if (allLowRelevance) {
      const resolvedArchetype = detected_persona ? {
        "Wealth Preserver": "Preserver", "Tax Optimizer": "Growth Seeker",
        "Legacy Planner": "Legacy Builder", "Growth Investor": "Growth Seeker",
        "Cautious Explorer": "Preserver", "Impact Investor": "Legacy Builder",
      }[detected_persona] || detected_persona : null;

      response.recommendation_gap = {
        gap_detected: true,
        gap_reasons: ["All recommended documents have low relevance scores — existing content may not adequately address this investor's specific situation"],
        persona: detected_persona,
        archetype: resolvedArchetype,
        pipeline_stage,
        content_needed: [`Higher-relevance content for "${detected_persona}" investors at "${pipeline_stage}" stage`],
        blocked_count: blockedDocs.length,
        already_sent_count: alreadySent.length,
      };
    }

    res.json(response);
  } catch (err: any) {
    req.log.error({ err }, "Claude ranking call failed");
    const fallbackRankedRaw = eligible_gated.slice(0, 8).map((d, i) => ({
      document_id: d.id,
      file_code: d.file_code,
      name: d.name,
      description: d.description,
      tier: d.tier,
      priority: i + 1,
      rank: i + 1,
      relevance_score: null,
      rationale: d.description,
    }));

    const fallbackRanked = await Promise.all(fallbackRankedRaw.map(async (doc) => {
      const docRows = await db.select({ belief_targets: documentsTable.belief_targets })
        .from(documentsTable)
        .where(eq(documentsTable.id, doc.document_id))
        .limit(1);

      const beliefTargets = (docRows[0]?.belief_targets as Array<{belief_id: string, state_from: string, state_to: string}> | null) || [];

      const matchingTarget = beliefTargets.find(bt =>
        (beliefStateMap[bt.belief_id] || 'UNKNOWN') === bt.state_from
      );

      return {
        ...doc,
        belief_targeted: matchingTarget?.belief_id || null,
        current_state: matchingTarget ? (beliefStateMap[matchingTarget.belief_id] || 'UNKNOWN') : null,
        state_after_send: matchingTarget?.state_to || null,
        gate_it_unlocks: matchingTarget ? getGateUnlocked(matchingTarget.belief_id) : null,
      };
    }));

    const recommendedVideosFallback = await getRecommendedVideos(resolvedArchetype, pipeline_stage);
    res.json({
      ranked_documents: fallbackRanked,
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      excluded_documents: excludedDocs,
      recommended_videos: recommendedVideosFallback,
      all_sent_message: null,
      ...(lead_id ? {
        u4_advisory: U4_flag,
        gate_summary: {
          F0_established,
          U4_established,
          founding_round_docs_gated: !F0_established,
        },
      } : {}),
    });
  }
});

async function getRecommendedVideos(archetype: string | null, stage: string) {
  try {
    const allVideos = await db.select().from(videosTable);
    const currentVideos = allVideos.filter(v => v.lifecycle_status === "CURRENT");
    if (currentVideos.length === 0) return [];

    return currentVideos
      .filter(v => {
        const personaMatch = archetype ? (v.persona_relevance as string[])?.includes(archetype) : false;
        const stageMatch = (v.stage_relevance as string[])?.includes(stage);
        return personaMatch || stageMatch;
      })
      .map(v => {
        const personaMatch = !archetype ? false : (v.persona_relevance as string[])?.includes(archetype);
        const stageMatch = (v.stage_relevance as string[])?.includes(stage);
        let reason = "";
        if (personaMatch && stageMatch) reason = `Matches ${archetype} archetype and ${stage} stage`;
        else if (personaMatch) reason = `Matches ${archetype} archetype`;
        else if (stageMatch) reason = `Relevant at ${stage} stage`;
        return {
          video_id: v.id,
          title: v.title,
          description: v.description,
          duration_seconds: v.duration_seconds,
          send_method: v.send_method,
          relevance_reason: reason,
          persona_match: personaMatch,
          stage_match: stageMatch,
        };
      });
  } catch {
    return [];
  }
}

router.post("/recommendation/confirm-send", async (req, res): Promise<void> => {
  const parsed = ConfirmSendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    lead_id,
    document_ids,
    transcript_summary,
    detected_persona,
    pipeline_stage,
    analysis_confidence,
    stage_suggestion,
    email_sent,
    already_sent_exclusions,
    blocked_documents_seen,
  } = parsed.data;

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead_id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const sendId = `send_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString().split("T")[0];

  const sendEntry = {
    send_id: sendId,
    date: now,
    documents_sent: document_ids,
    pipeline_stage_at_send: pipeline_stage,
    transcript_summary,
    analysis_confidence,
    already_sent_exclusions: already_sent_exclusions || [],
    blocked_documents_seen: blocked_documents_seen || [],
    stage_suggestion: stage_suggestion || null,
    email_sent,
    status: "confirmed",
  };

  const sendLog = [...((lead.send_log as any[]) || []), sendEntry];

  const personaConfidence = typeof analysis_confidence?.persona === "number" ? analysis_confidence.persona : null;
  const stageConfidence = typeof analysis_confidence?.stage === "number" ? analysis_confidence.stage : null;

  const updates: any = {
    send_log: sendLog,
    last_contact: now,
    detected_persona,
    persona_confidence: personaConfidence,
    stage_confidence: stageConfidence,
  };

  if (stage_suggestion && stage_suggestion !== lead.pipeline_stage) {
    updates.pipeline_stage = stage_suggestion;
    const stageHistory = [...((lead.stage_history as any[]) || []), {
      stage: stage_suggestion,
      date: now,
      logged_by: "system",
    }];
    updates.stage_history = stageHistory;
  }

  await db.update(leadsTable).set(updates).where(eq(leadsTable.id, lead_id));

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "SEND_LOGGED",
    lead_id,
    details: `Sent ${document_ids.length} document(s) to ${lead.name}: ${document_ids.join(", ")}`,
    triggered_by: "agent",
  });

  res.json(sendEntry);
});

router.post("/recommendation/email-draft", async (req, res): Promise<void> => {
  const parsed = GenerateEmailDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { lead_name, detected_persona, pipeline_stage, document_names, transcript_summary } = parsed.data;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Generate a covering email for an investor document send.

CONTEXT:
- Investor name: ${lead_name}
- Detected persona: ${detected_persona}
- Pipeline stage: ${pipeline_stage}
- Documents being sent: ${document_names.join(", ")}
- Call summary: ${transcript_summary}

EMAIL TEMPLATES REFERENCE:
${emailTemplates.slice(0, 4000)}

RULES:
- Use the appropriate template style for the pipeline stage
- Personalize with the investor's name and call context
- Keep it SHORT (3-4 paragraphs, 50-100 words each)
- Use Unlock terminology: "Founding investor", "Instant Investment" (not ASA), "EIS/SEIS relief"
- Product tagline: "Clarity, without complexity"
- Never publish discount tier percentages

Return ONLY valid JSON:
{
  "subject": "<email subject line>",
  "body": "<full email body>",
  "template_used": "<which template style was used>"
}

Return ONLY the JSON.`,
        },
      ],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    let draft;
    try {
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      draft = JSON.parse(cleaned);
    } catch {
      draft = {
        subject: `Follow-up: ${document_names[0] || "Documents"}`,
        body: text,
        template_used: "AI-generated",
      };
    }

    res.json(draft);
  } catch (err: any) {
    req.log.error({ err }, "Email draft generation failed");
    res.status(500).json({ error: "Email draft generation failed. Please try again." });
  }
});

router.post("/recommendation/gap-brief", async (req, res): Promise<void> => {
  try {
    const { archetype, stage, persona, transcript_summary } = req.body;

    if (!archetype || !stage) {
      res.status(400).json({ error: "archetype and stage are required" });
      return;
    }

    const gap = {
      archetype,
      stage,
      persona: persona || archetype,
      gap_type: "recommendation_failure",
      reason: `Recommendation engine found no suitable content for "${persona || archetype}" at "${stage}" stage`,
    };

    const result = await generateBriefFromGap(gap, transcript_summary || undefined);
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "Gap brief generation failed");
    res.status(500).json({ error: "Gap brief generation failed" });
  }
});

export default router;
