import { Router, type IRouter } from "express";
import { db, documentsTable, changelogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { propagateFromDocument } from "../../lib/propagation";
import { getTemplate, type DocumentTemplate } from "../../lib/templates/index";
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
  limits: { fileSize: 10 * 1024 * 1024 },
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
