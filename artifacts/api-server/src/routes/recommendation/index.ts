import { Router, type IRouter } from "express";
import { db, leadsTable, documentsTable, changelogTable } from "@workspace/db";
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

const PIPELINE_STAGES = ["Outreach", "Called", "Demo Booked", "Demo Complete", "Decision"];

const router: IRouter = Router();

router.post("/recommendation/analyze", async (req, res): Promise<void> => {
  const parsed = AnalyzeTranscriptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { transcript, lead_id } = parsed.data;

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

  const compactPersonaRef = personaGuide.slice(0, 6000);

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `Analyze this investor call transcript and return structured JSON.

TRANSCRIPT:
${transcript}

LEAD CONTEXT:
${sendHistorySummary}

PERSONA REFERENCE (compact):
${compactPersonaRef}

PIPELINE STAGES: ${PIPELINE_STAGES.join(", ")}

You must return ONLY valid JSON matching this exact schema:
{
  "detected_persona": {
    "name": "<one of the 19 personas or 3 public archetypes: Growth Seeker, Preserver, Legacy Builder>",
    "confidence_score": <0.0-1.0>,
    "evidence": ["<signal from transcript>", ...]
  },
  "pipeline_stage": {
    "stage": "<one of: Outreach, Called, Demo Booked, Demo Complete, Decision>",
    "confidence_score": <0.0-1.0>,
    "rationale": "<why this stage>"
  },
  "objections": [
    {
      "objection": "<what the investor objected to>",
      "suggested_response": "<how to address it>"
    }
  ],
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

    res.json({
      detected_persona: analysis.detected_persona || { name: "Unknown", confidence_score: 0, evidence: [] },
      pipeline_stage: analysis.pipeline_stage || { stage: "Called", confidence_score: 0, rationale: "" },
      objections: analysis.objections || [],
      transcript_summary: analysis.transcript_summary || "",
      pipeline_stage_suggestion: analysis.pipeline_stage_suggestion || null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Claude API call failed");
    res.status(500).json({ error: "AI analysis failed. Please try again." });
  }
});

router.post("/recommendation/rank", async (req, res): Promise<void> => {
  const parsed = RankDocumentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { lead_id, detected_persona, pipeline_stage, transcript_summary, objections } = parsed.data;

  let sentDocIds: string[] = [];
  if (lead_id) {
    const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, lead_id));
    if (lead) {
      sentDocIds = ((lead.send_log as any[]) || []).flatMap((s: any) => s.documents_sent || []);
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

  const eligible = allDocs.filter(
    (d) =>
      d.lifecycle_status === "CURRENT" &&
      d.review_state === "CLEAN" &&
      (d.pipeline_stage_relevance as string[])?.includes(pipeline_stage) &&
      matchesPersona(d) &&
      !sentDocIds.includes(d.id)
  );

  if (eligible.length === 0) {
    res.json({
      ranked_documents: [],
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      all_sent_message:
        "All appropriate documents for this stage and persona have already been sent to this investor. Consider advancing to the next pipeline stage.",
    });
    return;
  }

  const candidateList = eligible.slice(0, 8).map((d) => ({
    id: d.id,
    file_code: d.file_code,
    name: d.name,
    description: d.description,
    tier: d.tier,
    pipeline_stage_relevance: d.pipeline_stage_relevance,
    persona_relevance: d.persona_relevance,
  }));

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

ELIGIBLE DOCUMENTS (already filtered — rank only these):
${JSON.stringify(candidateList, null, 2)}

Return ONLY valid JSON matching this schema:
{
  "ranked_documents": [
    {
      "document_id": "<id>",
      "priority": <1-based>,
      "rationale": "<one sentence why this document is relevant>"
    }
  ]
}

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
      const doc = eligible.find((d) => d.id === r.document_id);
      return {
        document_id: r.document_id,
        file_code: doc?.file_code || "",
        name: doc?.name || "",
        description: doc?.description || "",
        tier: doc?.tier || 3,
        priority: r.priority,
        rationale: r.rationale,
      };
    });

    res.json({
      ranked_documents: rankedWithDetails,
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      all_sent_message: null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Claude ranking call failed");
    const fallbackRanked = eligible.slice(0, 8).map((d, i) => ({
      document_id: d.id,
      file_code: d.file_code,
      name: d.name,
      description: d.description,
      tier: d.tier,
      priority: i + 1,
      rationale: d.description,
    }));

    res.json({
      ranked_documents: fallbackRanked,
      already_sent: alreadySent,
      blocked_documents: blockedDocs,
      all_sent_message: null,
    });
  }
});

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

  const updates: any = {
    send_log: sendLog,
    last_contact: now,
    detected_persona,
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

export default router;
