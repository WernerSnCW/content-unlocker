import { Router, type IRouter } from "express";
import { db, acuTable, documentsTable, changelogTable, acuCandidatesTable, acuContradictionsTable, acuScanLogTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { scanDocument, scanAllDocuments } from "../../lib/acuScanner";
import { detectContradictions } from "../../lib/acuContradictionDetector";

const router: IRouter = Router();

const VALID_TYPES = ["fact", "framing", "reference", "explanation", "qualifier", "prohibited"];
const VALID_STATUSES = ["DRAFT", "APPROVED", "LOCKED", "LEGAL_PENDING", "NAMING_PENDING", "SUPERSEDED"];
const NON_INJECTABLE_STATUSES = ["LEGAL_PENDING", "NAMING_PENDING", "SUPERSEDED", "DRAFT"];

router.get("/acu", async (req, res): Promise<void> => {
  const { status, type } = req.query;
  let rows = await db.select().from(acuTable);

  if (status && typeof status === "string") {
    rows = rows.filter(r => r.status === status);
  }
  if (type && typeof type === "string") {
    rows = rows.filter(r => r.type === type);
  }

  res.json(rows);
});

router.get("/acu/prohibited", async (_req, res): Promise<void> => {
  const rows = await db.select().from(acuTable)
    .where(and(eq(acuTable.type, "prohibited"), eq(acuTable.status, "LOCKED")));
  res.json(rows);
});

router.get("/acu/injectable", async (_req, res): Promise<void> => {
  const rows = await db.select().from(acuTable)
    .where(eq(acuTable.status, "LOCKED"));
  const injectable = rows.filter(r => r.type !== "prohibited");
  res.json(injectable);
});

router.get("/acu/backlog", async (req, res): Promise<void> => {
  const { importance, type: typeFilter, status: statusFilter } = req.query;

  let rows = await db.select().from(acuCandidatesTable);

  if (statusFilter && typeof statusFilter === "string") {
    rows = rows.filter(r => r.status === statusFilter);
  } else {
    rows = rows.filter(r => r.status === "PENDING_REVIEW");
  }

  if (importance && typeof importance === "string") {
    rows = rows.filter(r => r.importance_level === parseInt(importance));
  }

  if (typeFilter && typeof typeFilter === "string") {
    rows = rows.filter(r => r.type === typeFilter);
  }

  rows.sort((a, b) => {
    const levelA = a.importance_level || 4;
    const levelB = b.importance_level || 4;
    if (levelA !== levelB) return levelA - levelB;
    const docsA = (a.appears_in_documents as string[])?.length || 0;
    const docsB = (b.appears_in_documents as string[])?.length || 0;
    return docsB - docsA;
  });

  const summary = {
    total: rows.length,
    by_importance: {
      foundational: rows.filter(r => r.importance_level === 1).length,
      structural: rows.filter(r => r.importance_level === 2).length,
      supporting: rows.filter(r => r.importance_level === 3).length,
      contextual: rows.filter(r => r.importance_level === 4).length,
    },
    by_type: {
      fact: rows.filter(r => r.type === "fact").length,
      framing: rows.filter(r => r.type === "framing").length,
      reference: rows.filter(r => r.type === "reference").length,
      qualifier: rows.filter(r => r.type === "qualifier").length,
    },
  };

  res.json({ summary, candidates: rows });
});

router.get("/acu/backlog/contradictions", async (_req, res): Promise<void> => {
  const contradictions = await db.select().from(acuContradictionsTable);
  const unresolved = contradictions.filter(c => c.status === "UNRESOLVED");
  const resolved = contradictions.filter(c => c.status === "RESOLVED");

  unresolved.sort((a, b) => {
    const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (severityOrder[a.severity || "LOW"] ?? 3) - (severityOrder[b.severity || "LOW"] ?? 3);
  });

  res.json({
    total: contradictions.length,
    unresolved: unresolved.length,
    resolved: resolved.length,
    contradictions: [...unresolved, ...resolved],
  });
});

router.get("/acu/coverage", async (_req, res): Promise<void> => {
  const beliefs = [
    "U1", "U2", "U3", "U4",
    "G1", "G2", "G3",
    "P1", "P2", "P3",
    "L1", "L2", "L3",
    "F0", "F1", "F2", "F3",
  ];

  const lockedACUs = await db.select().from(acuTable).where(eq(acuTable.status, "LOCKED"));
  const candidates = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.status, "PENDING_REVIEW"));
  const contradictions = await db.select().from(acuContradictionsTable)
    .where(eq(acuContradictionsTable.status, "UNRESOLVED"));

  const coverage = beliefs.map(belief => {
    const relatedACUs = lockedACUs.filter(u =>
      u.content.includes(belief) ||
      u.id.toLowerCase().includes(belief.toLowerCase()) ||
      ((u.notes || "").includes(belief))
    );
    const relatedCandidates = candidates.filter(c =>
      c.content.includes(belief) ||
      c.id.toLowerCase().includes(belief.toLowerCase())
    );
    const relatedContradictions = contradictions.filter(c =>
      (c.unit_a_content || "").includes(belief) ||
      (c.unit_b_content || "").includes(belief)
    );

    let status: string;
    if (relatedContradictions.length > 0) status = "CONFLICT";
    else if (relatedACUs.length > 0) status = "COVERED";
    else if (relatedCandidates.length > 0) status = "CANDIDATE";
    else status = "GAP";

    return {
      belief,
      status,
      locked_acus: relatedACUs.length,
      candidates: relatedCandidates.length,
      contradictions: relatedContradictions.length,
      acu_ids: relatedACUs.map(u => u.id),
    };
  });

  res.json({
    total_beliefs: beliefs.length,
    covered: coverage.filter(c => c.status === "COVERED").length,
    gaps: coverage.filter(c => c.status === "GAP").length,
    conflicts: coverage.filter(c => c.status === "CONFLICT").length,
    with_candidates: coverage.filter(c => c.status === "CANDIDATE").length,
    coverage,
  });
});

router.get("/acu/scan-log", async (_req, res): Promise<void> => {
  const logs = await db.select().from(acuScanLogTable);
  logs.sort((a, b) => (b.scan_date || "").localeCompare(a.scan_date || ""));
  res.json(logs);
});

router.post("/acu/scan", async (_req, res): Promise<void> => {
  try {
    const result = await scanAllDocuments();
    const contradictionResult = await detectContradictions();

    if (result.scan_id) {
      await db.update(acuScanLogTable)
        .set({ contradictions_found: contradictionResult.contradictions_found })
        .where(eq(acuScanLogTable.id, result.scan_id));
    }

    res.json({
      ...result,
      contradictions_found: contradictionResult.contradictions_found,
      new_contradictions: contradictionResult.new_contradictions,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/acu/scan/:document_id", async (req, res): Promise<void> => {
  try {
    const result = await scanDocument(req.params.document_id);

    for (const cand of result.candidates) {
      const [existing] = await db.select().from(acuCandidatesTable)
        .where(eq(acuCandidatesTable.id, cand.candidate_id));

      if (!existing) {
        await db.insert(acuCandidatesTable).values({
          id: cand.candidate_id,
          type: cand.type,
          content: cand.content,
          importance_level: cand.importance_level,
          importance_label: cand.importance_label,
          importance_rationale: cand.importance_rationale,
          source_document_id: req.params.document_id,
          source_context: cand.source_context,
          appears_in_documents: [req.params.document_id],
          existing_acu_id: cand.already_locked_as,
          status: cand.status,
          scan_date: result.scan_date,
        });
      }
    }

    res.json(result);
  } catch (e: any) {
    if (e.message?.includes("not found")) {
      res.status(404).json({ error: e.message });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

router.post("/acu", async (req, res): Promise<void> => {
  const { id, type, content, source, notes, expression_variants, documents_referencing, cascade_on_change } = req.body;

  if (!id || !type || !content) {
    res.status(400).json({ error: "id, type, and content are required" });
    return;
  }

  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` });
    return;
  }

  const [existing] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (existing) {
    res.status(409).json({ error: `ACU with id '${id}' already exists` });
    return;
  }

  const [created] = await db.insert(acuTable).values({
    id,
    type,
    content,
    status: "DRAFT",
    source: source || null,
    notes: notes || null,
    expression_variants: expression_variants || [],
    documents_referencing: documents_referencing || [],
    cascade_on_change: cascade_on_change !== undefined ? cascade_on_change : true,
    version: 1,
  }).returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_CREATED",
    document_id: id,
    details: `ACU created: ${id} (${type})`,
    triggered_by: "system",
  });

  res.status(201).json(created);
});

router.patch("/acu/backlog/:id/approve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { lock_immediately, approved_by } = req.body;

  const [candidate] = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  const acuId = `acu_${candidate.content.toLowerCase().replace(/[^a-z0-9]+/g, "_").substring(0, 40)}`;

  const [existingACU] = await db.select().from(acuTable).where(eq(acuTable.id, acuId));
  const finalId = existingACU ? `${acuId}_${Date.now().toString(36)}` : acuId;

  const [created] = await db.insert(acuTable).values({
    id: finalId,
    type: candidate.type,
    content: candidate.content,
    status: lock_immediately ? "LOCKED" : "APPROVED",
    source: `Scanned from document ${candidate.source_document_id}`,
    notes: candidate.importance_rationale,
    expression_variants: [],
    documents_referencing: candidate.appears_in_documents || [],
    cascade_on_change: true,
    version: 1,
    approved_by: approved_by || "tom_king",
    approved_date: new Date().toISOString().split("T")[0],
  }).returning();

  await db.update(acuCandidatesTable)
    .set({
      status: "APPROVED",
      reviewed_by: approved_by || "tom_king",
      review_date: new Date().toISOString(),
      review_action: lock_immediately ? "APPROVE_LOCK" : "APPROVE",
    })
    .where(eq(acuCandidatesTable.id, id));

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_CREATED_FROM_SCAN",
    document_id: finalId,
    details: `ACU ${finalId} created from candidate ${id} (scanned from ${candidate.source_document_id})`,
    triggered_by: approved_by || "tom_king",
  });

  res.json({ candidate_id: id, acu_id: finalId, acu: created });
});

router.patch("/acu/backlog/:id/reject", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { rejected_by, reason } = req.body;

  const [candidate] = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  await db.update(acuCandidatesTable)
    .set({
      status: "REJECTED",
      reviewed_by: rejected_by || "tom_king",
      review_date: new Date().toISOString(),
      review_action: "REJECT",
      notes: reason || candidate.notes,
    })
    .where(eq(acuCandidatesTable.id, id));

  res.json({ message: `Candidate ${id} rejected` });
});

router.patch("/acu/backlog/:id/defer", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [candidate] = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  await db.update(acuCandidatesTable)
    .set({
      status: "DEFERRED",
      review_action: "DEFER",
      review_date: new Date().toISOString(),
      importance_level: 5,
    })
    .where(eq(acuCandidatesTable.id, id));

  res.json({ message: `Candidate ${id} deferred` });
});

router.patch("/acu/backlog/:id/duplicate", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { existing_acu_id } = req.body;

  const [candidate] = await db.select().from(acuCandidatesTable)
    .where(eq(acuCandidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Candidate not found" });
    return;
  }

  await db.update(acuCandidatesTable)
    .set({
      status: "DUPLICATE",
      existing_acu_id: existing_acu_id || candidate.existing_acu_id,
      review_action: "MARK_DUPLICATE",
      review_date: new Date().toISOString(),
    })
    .where(eq(acuCandidatesTable.id, id));

  res.json({ message: `Candidate ${id} marked as duplicate of ${existing_acu_id}` });
});

router.patch("/acu/contradictions/:id/resolve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { resolution, resolved_by } = req.body;

  const [contradiction] = await db.select().from(acuContradictionsTable)
    .where(eq(acuContradictionsTable.id, id));
  if (!contradiction) {
    res.status(404).json({ error: "Contradiction not found" });
    return;
  }

  await db.update(acuContradictionsTable)
    .set({
      status: "RESOLVED",
      resolution: resolution || "Manually resolved",
      resolved_by: resolved_by || "tom_king",
      resolved_date: new Date().toISOString(),
    })
    .where(eq(acuContradictionsTable.id, id));

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "CONTRADICTION_RESOLVED",
    document_id: id,
    details: `Contradiction ${id} resolved: ${resolution || "manually"}`,
    triggered_by: resolved_by || "tom_king",
  });

  res.json({ message: `Contradiction ${id} resolved` });
});

router.get("/acu/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [unit] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "ACU not found" });
    return;
  }

  const allVersions = await db.select().from(acuTable)
    .where(eq(acuTable.id, id));

  const baseId = id.replace(/_v\d+$/, "");
  const relatedVersions = await db.select().from(acuTable);
  const versionHistory = relatedVersions
    .filter(r => r.id === baseId || r.id.startsWith(baseId + "_v"))
    .sort((a, b) => a.version - b.version);

  res.json({ unit, version_history: versionHistory });
});

router.patch("/acu/:id/approve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { approved_by } = req.body;

  const [unit] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "ACU not found" });
    return;
  }

  if (unit.status !== "DRAFT") {
    res.status(400).json({ error: `Cannot approve: current status is ${unit.status}. Only DRAFT units can be approved.` });
    return;
  }

  if (!unit.source) {
    res.status(400).json({ error: "Cannot approve: source field must be populated before approval." });
    return;
  }

  const [updated] = await db.update(acuTable)
    .set({
      status: "APPROVED",
      approved_by: approved_by || "tom_king",
      approved_date: new Date().toISOString().split("T")[0],
    })
    .where(eq(acuTable.id, id))
    .returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_APPROVED",
    document_id: id,
    details: `ACU approved: ${id} by ${approved_by || "tom_king"}`,
    triggered_by: approved_by || "tom_king",
  });

  res.json(updated);
});

router.patch("/acu/:id/lock", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [unit] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "ACU not found" });
    return;
  }

  if (unit.status !== "APPROVED") {
    res.status(400).json({ error: `Cannot lock: current status is ${unit.status}. Only APPROVED units can be locked.` });
    return;
  }

  const [updated] = await db.update(acuTable)
    .set({ status: "LOCKED" })
    .where(eq(acuTable.id, id))
    .returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_LOCKED",
    document_id: id,
    details: `ACU locked: ${id}. Content is now immutable. ${((unit.documents_referencing as any[]) || []).length} documents reference this unit.`,
    triggered_by: "system",
  });

  res.json(updated);
});

router.post("/acu/:id/version", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { content, source, notes } = req.body;

  const [unit] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "ACU not found" });
    return;
  }

  const newVersion = unit.version + 1;
  const newId = `${id.replace(/_v\d+$/, "")}_v${newVersion}`;

  const [created] = await db.insert(acuTable).values({
    id: newId,
    type: unit.type,
    content: content || unit.content,
    status: "DRAFT",
    source: source || unit.source,
    notes: notes || unit.notes,
    expression_variants: unit.expression_variants,
    documents_referencing: unit.documents_referencing,
    cascade_on_change: unit.cascade_on_change,
    version: newVersion,
  }).returning();

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_NEW_VERSION",
    document_id: newId,
    details: `New version created from ${id}: v${newVersion}`,
    triggered_by: "system",
  });

  res.status(201).json(created);
});

router.patch("/acu/:id/cascade", async (req, res): Promise<void> => {
  const { id } = req.params;

  const [unit] = await db.select().from(acuTable).where(eq(acuTable.id, id));
  if (!unit) {
    res.status(404).json({ error: "ACU not found" });
    return;
  }

  const docIds = (unit.documents_referencing as string[]) || [];
  if (docIds.length === 0) {
    res.json({ message: "No documents reference this ACU", affected: 0 });
    return;
  }

  let affected = 0;
  for (const docId of docIds) {
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
    if (doc) {
      await db.update(documentsTable)
        .set({ review_state: "REQUIRES_REVIEW" })
        .where(eq(documentsTable.id, docId));
      affected++;
    }
  }

  await db.insert(changelogTable).values({
    id: randomUUID(),
    action: "ACU_CASCADE_TRIGGERED",
    document_id: id,
    details: `Cascade from ACU ${id}: ${affected} documents flagged for review`,
    triggered_by: "system",
  });

  res.json({ message: `Cascade complete: ${affected} documents flagged for review`, affected, document_ids: docIds });
});

export default router;
