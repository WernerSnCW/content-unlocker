import { Router, type IRouter } from "express";
import { db, complianceConstantsTable, documentsTable, changelogTable } from "@workspace/db";
import { eq, and, desc, ilike } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  getConstants,
  getConstantByKey,
  invalidateCache,
  loadConstants,
  validateOverride,
  getFullCache,
} from "../../lib/complianceConstantsService";

const router: IRouter = Router();

router.get("/compliance-constants", async (_req, res): Promise<void> => {
  try {
    const data = getConstants();
    const cache = getFullCache();
    if (cache) {
      res.json({ constants: cache });
    } else {
      res.json({ constants: data.constants });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load compliance constants" });
  }
});

router.get("/compliance-constants/categories", async (_req, res): Promise<void> => {
  try {
    const cache = getFullCache();
    if (cache) {
      const categories = [...new Set(cache.map((c) => c.category))].sort();
      res.json({ categories });
    } else {
      const data = getConstants();
      const categories = [...new Set(data.constants.map((c: any) => c.category).filter(Boolean))].sort();
      res.json({ categories });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/compliance-constants/propose", async (req, res): Promise<void> => {
  try {
    const { key, newValue, reason, actor } = req.body;

    if (!key || !newValue) {
      res.status(400).json({ error: "key and newValue are required" });
      return;
    }

    const [currentRecord] = await db
      .select()
      .from(complianceConstantsTable)
      .where(and(eq(complianceConstantsTable.key, key), eq(complianceConstantsTable.status, "ACTIVE")));

    if (!currentRecord) {
      res.status(404).json({ error: `No ACTIVE constant found for key '${key}'` });
      return;
    }

    if (currentRecord.is_prohibited) {
      res.status(400).json({ error: "This constant is prohibited and cannot be overridden" });
      return;
    }

    const validation = validateOverride(key, newValue, currentRecord);
    if (!validation.valid) {
      if (validation.error === "Prohibited value") {
        res.status(400).json({ error: "Prohibited value", prohibited_value: newValue });
      } else {
        res.status(400).json({ error: validation.error });
      }
      return;
    }

    if (currentRecord.subject_to_qualifier && (!reason || !reason.trim())) {
      res.status(400).json({ error: "A reason is required for compliance constant overrides." });
      return;
    }

    const draftId = randomUUID();
    await db.insert(complianceConstantsTable).values({
      id: draftId,
      key: currentRecord.key,
      label: currentRecord.label,
      value: newValue,
      value_type: currentRecord.value_type,
      status: "DRAFT",
      is_prohibited: currentRecord.is_prohibited,
      prohibited_reason: currentRecord.prohibited_reason,
      subject_to_qualifier: currentRecord.subject_to_qualifier,
      qualifier_text: currentRecord.qualifier_text,
      category: currentRecord.category,
      notes: currentRecord.notes,
      override_reason: reason || null,
      actor: actor || null,
      source: "manual_ui",
    });

    res.json({
      draft_id: draftId,
      key: currentRecord.key,
      currentValue: currentRecord.value,
      proposedValue: newValue,
      reason: reason || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to propose override" });
  }
});

router.post("/compliance-constants/confirm", async (req, res): Promise<void> => {
  try {
    const { draft_id, confirmation_text } = req.body;

    if (!draft_id) {
      res.status(400).json({ error: "draft_id is required" });
      return;
    }

    if (!confirmation_text || confirmation_text.trim() === "") {
      res.status(400).json({ error: "confirmation_text is required and must be non-empty" });
      return;
    }

    if (confirmation_text.trim() !== "CONFIRM") {
      res.status(400).json({ error: "confirmation_text must be exactly 'CONFIRM'" });
      return;
    }

    const [draft] = await db
      .select()
      .from(complianceConstantsTable)
      .where(and(eq(complianceConstantsTable.id, draft_id), eq(complianceConstantsTable.status, "DRAFT")));

    if (!draft) {
      res.status(404).json({ error: "DRAFT record not found" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [currentActive] = await tx
        .select()
        .from(complianceConstantsTable)
        .where(and(eq(complianceConstantsTable.key, draft.key), eq(complianceConstantsTable.status, "ACTIVE")));

      if (!currentActive) {
        return { error: `No ACTIVE constant found for key '${draft.key}'`, status: 404 } as const;
      }

      const oldValue = currentActive.value;

      await tx
        .update(complianceConstantsTable)
        .set({
          status: "SUPERSEDED",
          superseded_by: draft.id,
        })
        .where(eq(complianceConstantsTable.id, currentActive.id));

      await tx
        .update(complianceConstantsTable)
        .set({
          status: "ACTIVE",
          activated_at: new Date(),
        })
        .where(eq(complianceConstantsTable.id, draft.id));

      let documentsFlagged = 0;
      if (oldValue && oldValue.trim().length > 0) {
        const affectedDocs = await tx
          .select({ id: documentsTable.id })
          .from(documentsTable)
          .where(ilike(documentsTable.content, `%${oldValue}%`));

        for (const doc of affectedDocs) {
          await tx
            .update(documentsTable)
            .set({ review_state: "REQUIRES_REVIEW" })
            .where(eq(documentsTable.id, doc.id));
        }
        documentsFlagged = affectedDocs.length;
      }

      await tx.insert(changelogTable).values({
        id: randomUUID(),
        action: "COMPLIANCE_CONSTANT_UPDATED",
        document_id: null,
        details: JSON.stringify({
          key: draft.key,
          old_value: oldValue,
          new_value: draft.value,
          reason: draft.override_reason,
          actor: draft.actor,
          source: draft.source,
        }),
        triggered_by: draft.actor || "system",
      });

      return {
        success: true as const,
        activated_id: draft.id,
        superseded_id: currentActive.id,
        documents_flagged: documentsFlagged,
      };
    });

    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    invalidateCache();
    await loadConstants();

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to confirm override" });
  }
});

router.get("/compliance-constants/key/:key", async (req, res): Promise<void> => {
  try {
    const { key } = req.params;
    const records = await db
      .select()
      .from(complianceConstantsTable)
      .where(eq(complianceConstantsTable.key, key))
      .orderBy(desc(complianceConstantsTable.activated_at));

    if (records.length === 0) {
      res.status(404).json({ error: `No records found for key '${key}'` });
      return;
    }

    res.json({ key, records });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/compliance-constants/:id", async (req, res): Promise<void> => {
  try {
    const { id } = req.params;
    const [record] = await db
      .select()
      .from(complianceConstantsTable)
      .where(eq(complianceConstantsTable.id, id));

    if (!record) {
      res.status(404).json({ error: "Constant not found" });
      return;
    }

    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
