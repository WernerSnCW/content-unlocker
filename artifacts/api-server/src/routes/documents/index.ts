import { Router, type IRouter } from "express";
import { db, documentsTable, changelogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { propagateFromDocument } from "../../lib/propagation";
import {
  ListDocumentsQueryParams,
  GetDocumentParams,
  UpdateDocumentParams,
  UpdateDocumentBody,
  PropagateDocumentUpdateParams,
} from "@workspace/api-zod";

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
    gdoc_id: doc.gdoc_id || null,
    gdoc_url: doc.gdoc_url || null,
  };
}

export default router;
