import { Router, type IRouter } from "express";
import { db, documentsTable, changelogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { propagateFromDocument } from "../../lib/propagation";
import { getTemplate, type DocumentTemplate } from "../../lib/templates/index";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import multer from "multer";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import {
  ListDocumentsQueryParams,
  GetDocumentParams,
  UpdateDocumentParams,
  UpdateDocumentBody,
  PropagateDocumentUpdateParams,
} from "@workspace/api-zod";

const PDF_STORAGE_DIR = join(process.cwd(), "documents", "pdfs");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

const router: IRouter = Router();

router.get("/documents", async (req, res): Promise<void> => {
  const params = ListDocumentsQueryParams.safeParse(req.query);
  const tier = params.success ? params.data.tier : undefined;
  const category = params.success ? params.data.category : undefined;
  const lifecycleStatus = params.success ? params.data.lifecycle_status : undefined;
  const reviewState = params.success ? params.data.review_state : undefined;

  const conditions = [];
  if (tier !== undefined) conditions.push(eq(documentsTable.tier, tier));
  if (category) conditions.push(eq(documentsTable.category, category));
  if (lifecycleStatus) conditions.push(eq(documentsTable.lifecycle_status, lifecycleStatus));
  if (reviewState) conditions.push(eq(documentsTable.review_state, reviewState));

  const docs = await db
    .select()
    .from(documentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json(docs.map(formatDoc));
});

router.get("/documents/propagation-status", async (_req, res): Promise<void> => {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.review_state, "REQUIRES_REVIEW"));

  res.json(docs.map(formatDoc));
});

const QUALITY_SCORE_CONTENT_LIMIT = 6000;
const QUALITY_DIMENSIONS = [
  "structural_completeness",
  "compliance_constant_accuracy",
  "strategic_alignment",
  "persona_fit",
  "prohibited_content_absence",
  "tone_compliance",
] as const;

router.post("/documents/:id/quality-score", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!doc.content || doc.content.trim().length === 0) {
    res.status(400).json({ error: "Document has no content to score" });
    return;
  }

  const contentTruncated = doc.content.length > QUALITY_SCORE_CONTENT_LIMIT;
  let truncatedContent = doc.content;
  if (contentTruncated) {
    truncatedContent = doc.content.slice(0, QUALITY_SCORE_CONTENT_LIMIT) + "\n[CONTENT TRUNCATED AT 6000 CHARS]";
  }

  const personaRelevance = doc.persona_relevance as any;
  const personaString = Array.isArray(personaRelevance) && personaRelevance.length > 0
    ? personaRelevance.join(", ")
    : "General (no specific persona)";

  const promptString = `You are evaluating an investor-facing document for a UK fintech called Unlock.
Unlock provides portfolio intelligence and tax planning tools for UK HNW private
investors (£250K–£5M investable). It is NOT a fund, NOT a regulated adviser.
Its competitive advantage is structural independence — subscription-only, no
product conflicts, no AUM fee.

DOCUMENT TYPE: ${doc.type}
TARGET PERSONA: ${personaString}

DOCUMENT CONTENT:
${truncatedContent}

Evaluate this document across the following six dimensions. For each dimension,
provide:
- score: integer 0-10
- verdict: "PASS" (score 8-10), "ADVISORY" (score 5-7), or "FAIL" (score 0-4)
- findings: array of 1-3 strings, each maximum 20 words, citing specific evidence
  from the document

DIMENSION 1 — STRUCTURAL COMPLETENESS
Does the document contain the sections expected for its type? For investor
one-pagers (100): problem, platform modules, investment opportunity, why now.
For Pack 1 (120): executive summary, problem, platform, market, team, investment
case, tax benefits, how to invest, founding investor benefits.
For Pack 2/IIM (130): all Pack 1 sections plus business model, financial
projections, risk factors, regulatory, appendices.
For case studies (160): background, situation, EIS strategy, outcome table, why now.
For EIS/IHT planning docs (170/180): IHT calculation, BPR change impact,
pension IHT, EIS rolling programme, scenario modelling, death sequencing.
For email templates (230): subject line, opening, body, CTA, sign-off.
For other document types: assess whether logical required sections are present.

DIMENSION 2 — COMPLIANCE CONSTANT ACCURACY
Check these locked values (flag any that appear incorrectly):
- EIS income tax relief: must be 30% (not any other figure)
- SEIS income tax relief: must be 50%
- VCT income tax relief: must be 20% (not 30%)
- BPR cap: must be £2.5M per estate (with caveat "announced, subject to final
  enactment" if forward-looking)
- EIS loss relief (additional rate): up to 61.5p in the pound (or 38.5p per £)
- SEIS loss relief: up to 27.5p per £ (never 22p — that is prohibited)
- Minimum investment ticket: £40,000
- Pre-money valuation: £6.5M (if stated)
- Round name: "Growth Capital round" (never "Series A")
- Instrument: "Instant Investment" (never "ASA", "SAFE", "Advanced Subscription")
- Pension IHT change: April 2027 (with caveat "subject to final legislation")

DIMENSION 3 — STRATEGIC ALIGNMENT
Does the document reflect Play to Win and Storybrand SB7 framing?
- Investor is positioned as the hero, Unlock as the guide (not vice versa)
- Structural independence is the competitive advantage (subscription-only,
  no AUM fee, no product conflicts)
- UK regulatory depth (EIS/SEIS/CGT/IHT modelling) is cited as a moat
- Problem framing appears before product description
- The winning aspiration resonates: "complete picture before they act, not after"

DIMENSION 4 — PERSONA FIT
Does the document's language, pain points, and value proposition match the
target persona?
- Preserver: stress-testing, decumulation decisions, risk visibility, downside
  protection, no blind spots before committing
- Growth Seeker: EIS deal transparency, lot-level tracking, portfolio simulator,
  tax impact before committing, access on fair terms
- Legacy Builder: IHT exposure, BPR qualifying periods, rolling EIS programme,
  estate modelling, April 2027 pension IHT change
- If persona is general/unspecified: assess whether the document would resonate
  with a sophisticated UK HNW private investor

DIMENSION 5 — PROHIBITED CONTENT ABSENCE
Check for the presence of any of the following prohibited items:
- Platform pricing (£99/month, £249/month) in investor-facing documents
- "Series A" language
- "ASA", "SAFE", "Advanced Subscription Agreement"
- 22p per pound (prohibited figure — must never appear)
- 7.8x average EIS return (prohibited claim)
- Scoring or evaluation language for Unlock Access companies ("scored",
  "evaluated", "rated")
- BPR cap without caveat in forward-looking context
- Pension IHT without "subject to final legislation" caveat
- Manufacturing urgency (artificial scarcity claims)

DIMENSION 6 — TONE COMPLIANCE
Does the document use the approved Unlock tone?
- Institutional and intelligence-forward, never salesy
- "Investors in the know" framing — structural knowledge gap, not investor failure
- Integrity under pressure — genuine urgency only, not manufactured
- Plain English for complex concepts — no jargon without explanation
- The three problems Unlock solves are structural, not personal criticism of
  advisers or platforms
- Sign-off from Tom King directly (not "The Unlock Team") where applicable

Return ONLY a JSON object with this exact structure. No prose before or after.
No markdown code fences. No explanatory text.

{
  "dimensions": {
    "structural_completeness": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    },
    "compliance_constant_accuracy": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    },
    "strategic_alignment": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    },
    "persona_fit": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    },
    "prohibited_content_absence": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    },
    "tone_compliance": {
      "score": <integer 0-10>,
      "verdict": "<PASS|ADVISORY|FAIL>",
      "findings": ["<string max 20 words>", ...]
    }
  },
  "overall_score": <integer — average of six dimension scores, rounded>,
  "overall_verdict": "<PASS|ADVISORY|FAIL — worst dimension verdict>",
  "document_type": "${doc.type}",
  "persona_context": "${personaString}",
  "content_truncated": ${contentTruncated}
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: promptString }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Quality scoring failed — could not parse response" });
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(500).json({ error: "Quality scoring failed — could not parse response" });
      return;
    }

    if (!parsed.dimensions || typeof parsed.dimensions !== "object") {
      res.status(500).json({ error: "Quality scoring failed — malformed response" });
      return;
    }

    for (const dim of QUALITY_DIMENSIONS) {
      const d = parsed.dimensions[dim];
      if (!d || typeof d.score !== "number" || typeof d.verdict !== "string" || !Array.isArray(d.findings)) {
        res.status(500).json({ error: "Quality scoring failed — malformed response" });
        return;
      }
    }

    let totalScore = 0;
    let worstVerdict: "PASS" | "ADVISORY" | "FAIL" = "PASS";
    for (const dim of QUALITY_DIMENSIONS) {
      const d = parsed.dimensions[dim];
      totalScore += d.score;
      if (d.verdict === "FAIL") {
        worstVerdict = "FAIL";
      } else if (d.verdict === "ADVISORY" && worstVerdict !== "FAIL") {
        worstVerdict = "ADVISORY";
      }
    }

    const overallScore = Math.round(totalScore / QUALITY_DIMENSIONS.length);

    res.json({
      dimensions: parsed.dimensions,
      overall_score: overallScore,
      overall_verdict: worstVerdict,
      document_type: doc.type,
      persona_context: personaString,
      content_truncated: contentTruncated,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Quality scoring failed — " + (err.message || "unexpected error") });
  }
});

router.get("/documents/:id", async (req, res): Promise<void> => {
  const params = GetDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(formatDoc(doc));
});

router.post("/documents/:id/export-pdf", async (req, res): Promise<void> => {
  try {
    const docId = req.params.id;
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (!doc.content) {
      res.status(400).json({ error: "Document has no content to export" });
      return;
    }

    const templateOverride = req.body?.template as DocumentTemplate | undefined;
    const html = getTemplate(
      {
        id: doc.id,
        file_code: doc.file_code,
        name: doc.name,
        description: doc.description || undefined,
        content: doc.content,
        tier: doc.tier,
        category: doc.category,
        version: doc.version,
        last_reviewed: doc.last_reviewed || undefined,
      },
      templateOverride
    );

    const date = new Date().toISOString().split("T")[0];
    const safeName = doc.name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    const filename = `${safeName}_${date}.html`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(html);
  } catch (err: any) {
    res.status(500).json({ error: "Export failed", message: err.message });
  }
});

router.post("/documents/import-pdf", upload.single("file"), async (req, res): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No PDF file provided" });
      return;
    }

    const { name, tier, file_code, persona_relevance, stage_relevance, notes } = req.body;

    if (!name || !tier) {
      res.status(400).json({ error: "name and tier are required" });
      return;
    }

    const tierNum = parseInt(tier, 10);
    if (![1, 2, 3].includes(tierNum)) {
      res.status(400).json({ error: "tier must be 1, 2, or 3" });
      return;
    }

    let extractedText = "";
    try {
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(req.file.buffer) });
      const pdfDoc = await loadingTask.promise;
      const textParts: string[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item: any) => "str" in item)
          .map((item: any) => item.str)
          .join(" ");
        textParts.push(pageText);
      }
      extractedText = textParts.join("\n\n");
    } catch (parseErr: any) {
      extractedText = `[PDF text extraction failed: ${parseErr.message}]`;
    }

    if (!existsSync(PDF_STORAGE_DIR)) {
      await mkdir(PDF_STORAGE_DIR, { recursive: true });
    }

    const docId = file_code || `pdf_${randomUUID().substring(0, 8)}`;
    const safeOrigName = basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    const pdfFilename = `${docId}_${safeOrigName}`;
    const pdfPath = join(PDF_STORAGE_DIR, pdfFilename);
    const resolvedPath = join(PDF_STORAGE_DIR, basename(pdfFilename));
    if (!resolvedPath.startsWith(PDF_STORAGE_DIR)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }
    await writeFile(resolvedPath, req.file.buffer);

    let personaRelevanceArr: string[] = [];
    if (persona_relevance) {
      try {
        personaRelevanceArr = typeof persona_relevance === "string"
          ? JSON.parse(persona_relevance)
          : persona_relevance;
      } catch { personaRelevanceArr = []; }
    }

    let stageRelevanceArr: string[] = [];
    if (stage_relevance) {
      try {
        stageRelevanceArr = typeof stage_relevance === "string"
          ? JSON.parse(stage_relevance)
          : stage_relevance;
      } catch { stageRelevanceArr = []; }
    }

    const [newDoc] = await db
      .insert(documentsTable)
      .values({
        id: docId,
        file_code: file_code || docId,
        type: "imported_pdf",
        name,
        filename: req.file.originalname,
        tier: tierNum,
        category: "imported",
        lifecycle_status: "CURRENT",
        review_state: "REQUIRES_REVIEW",
        version: 1,
        last_reviewed: new Date().toISOString(),
        description: notes || `Imported from ${req.file.originalname}`,
        pipeline_stage_relevance: stageRelevanceArr,
        persona_relevance: personaRelevanceArr,
        content: extractedText,
        source_pdf_path: pdfPath,
        source_pdf_filename: req.file.originalname,
        source_pdf_imported_at: new Date().toISOString(),
      })
      .returning();

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "DOCUMENT_IMPORTED",
      document_id: docId,
      details: `PDF imported: ${req.file.originalname}. Text extracted: ${extractedText.length} characters.`,
      triggered_by: "agent",
    });

    res.status(201).json({
      document_id: newDoc.id,
      name: newDoc.name,
      content_length: extractedText.length,
      source_pdf_filename: safeOrigName,
      review_state: "REQUIRES_REVIEW",
      message: "PDF imported. Run QC before using in recommendations.",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Import failed", message: err.message });
  }
});

router.get("/documents/:id/source-pdf", async (req, res): Promise<void> => {
  try {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, req.params.id));
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const pdfPath = (doc as any).source_pdf_path;
    const pdfFilename = (doc as any).source_pdf_filename;

    if (!pdfPath) {
      res.status(404).json({ error: "No source PDF available for this document" });
      return;
    }

    const resolvedPdf = join(PDF_STORAGE_DIR, basename(pdfPath));
    if (!resolvedPdf.startsWith(PDF_STORAGE_DIR) || !existsSync(resolvedPdf)) {
      res.status(404).json({ error: "No source PDF available for this document" });
      return;
    }

    const pdfBuffer = await readFile(resolvedPdf);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename(pdfFilename || pdfPath).replace(/[^a-zA-Z0-9._-]/g, "_")}"`
    );
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to retrieve PDF", message: err.message });
  }
});

router.patch("/documents/:id", async (req, res): Promise<void> => {
  const params = UpdateDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const isContentEdit = parsed.data.name !== undefined || parsed.data.description !== undefined || parsed.data.content !== undefined;
  const hasEditOverride = parsed.data.edit_override === true;

  if (isContentEdit && existing.tier === 1 && !hasEditOverride) {
    res.status(403).json({
      error: "TIER1_LOCKED",
      message: "Tier 1 foundational documents are locked. Content edits require explicit authorisation. Resend with edit_override: true to confirm.",
      tier: 1,
      document_id: params.data.id,
    });
    return;
  }

  const updates: any = {};
  if (parsed.data.lifecycle_status) {
    updates.lifecycle_status = parsed.data.lifecycle_status;
  }
  if (parsed.data.review_state) updates.review_state = parsed.data.review_state;
  if (parsed.data.version) updates.version = parsed.data.version;
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.persona_relevance !== undefined) updates.persona_relevance = parsed.data.persona_relevance;
  if (parsed.data.stage_relevance !== undefined) updates.pipeline_stage_relevance = parsed.data.stage_relevance;

  if (Object.keys(updates).length === 0) {
    res.json(formatDoc(existing));
    return;
  }

  const [doc] = await db
    .update(documentsTable)
    .set(updates)
    .where(eq(documentsTable.id, params.data.id))
    .returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "STATUS_CHANGED",
    document_id: params.data.id,
    details: `Document ${params.data.id} updated: ${JSON.stringify(parsed.data)}`,
    triggered_by: "agent",
  });

  res.json(formatDoc(doc));
});

router.post("/documents/:id/propagate", async (req, res): Promise<void> => {
  const params = PropagateDocumentUpdateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sourceDoc] = await db.select().from(documentsTable).where(eq(documentsTable.id, params.data.id));
  if (!sourceDoc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const result = await propagateFromDocument(params.data.id, params.data.id);

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "DOCUMENT_UPDATED",
    document_id: params.data.id,
    details: `Document ${params.data.id} updated. ${result.flagged_document_ids.length} downstream documents flagged for review.`,
    triggered_by: "agent",
  });

  res.json({
    updated_document_id: params.data.id,
    flagged_documents: result.flagged_document_ids,
    changelog_entries: result.changelog_entry_ids,
  });
});

function formatDoc(doc: any) {
  return {
    id: doc.id,
    file_code: doc.file_code,
    type: doc.type,
    name: doc.name,
    filename: doc.filename,
    tier: doc.tier,
    category: doc.category,
    lifecycle_status: doc.lifecycle_status,
    review_state: doc.review_state,
    version: doc.version,
    last_reviewed: doc.last_reviewed,
    description: doc.description,
    pipeline_stage_relevance: doc.pipeline_stage_relevance || [],
    persona_relevance: doc.persona_relevance || [],
    upstream_dependencies: doc.upstream_dependencies || [],
    downstream_dependents: doc.downstream_dependents || [],
    is_generated: doc.is_generated,
    generation_brief_id: doc.generation_brief_id,
    generation_attempt: doc.generation_attempt,
    qc_report_id: doc.qc_report_id,
    source_trace: doc.source_trace || [],
    content: doc.content,
    qc_history: doc.qc_history || [],
    gdoc_id: doc.gdoc_id || null,
    gdoc_url: doc.gdoc_url || null,
    has_source_pdf: !!doc.source_pdf_path,
    source_pdf_filename: doc.source_pdf_filename || null,
    source_pdf_imported_at: doc.source_pdf_imported_at || null,
  };
}

export default router;
