import { Router, type IRouter } from "express";
import { db, acuTable, documentsTable, changelogTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

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
