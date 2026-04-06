import { Router, type IRouter } from "express";
import { db, leadBeliefsTable, beliefRegistryTable, beliefTransitionsTable, changelogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const VALID_STATES = ["UNKNOWN", "ABSENT", "PARTIAL", "ESTABLISHED", "BLOCKED"];
const VALID_RELEVANCE = ["high", "standard", "low", "not_applicable"];

const router: IRouter = Router();

router.get("/leads/:leadId/beliefs", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const beliefs = await db
      .select({
        id: leadBeliefsTable.id,
        lead_id: leadBeliefsTable.lead_id,
        belief_id: leadBeliefsTable.belief_id,
        state: leadBeliefsTable.state,
        investor_relevance: leadBeliefsTable.investor_relevance,
        relevance_rationale: leadBeliefsTable.relevance_rationale,
        established_date: leadBeliefsTable.established_date,
        evidence: leadBeliefsTable.evidence,
        evidence_source: leadBeliefsTable.evidence_source,
        confidence: leadBeliefsTable.confidence,
        last_updated: leadBeliefsTable.last_updated,
        updated_by: leadBeliefsTable.updated_by,
        name: beliefRegistryTable.name,
        cluster: beliefRegistryTable.cluster,
        cluster_display_name: beliefRegistryTable.cluster_display_name,
        cluster_tagline: beliefRegistryTable.cluster_tagline,
        is_hard_gate: beliefRegistryTable.is_hard_gate,
        policy_status: beliefRegistryTable.policy_status,
        primary_document_id: beliefRegistryTable.primary_document_id,
      })
      .from(leadBeliefsTable)
      .leftJoin(beliefRegistryTable, eq(leadBeliefsTable.belief_id, beliefRegistryTable.id))
      .where(eq(leadBeliefsTable.lead_id, leadId));

    res.json({ beliefs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch lead beliefs" });
  }
});

router.patch("/leads/:leadId/beliefs/:beliefId", async (req, res): Promise<void> => {
  const { leadId, beliefId } = req.params;
  const { state, investor_relevance, evidence, evidence_source, confidence, relevance_rationale } = req.body;

  if (state !== undefined && !VALID_STATES.includes(state)) {
    res.status(400).json({ error: "Invalid state" });
    return;
  }

  if (investor_relevance !== undefined && !VALID_RELEVANCE.includes(investor_relevance)) {
    res.status(400).json({ error: "Invalid investor_relevance" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(leadBeliefsTable)
      .where(and(eq(leadBeliefsTable.lead_id, leadId), eq(leadBeliefsTable.belief_id, beliefId)));

    let beliefRow;

    if (existing) {
      if (state !== undefined && state !== existing.state) {
        await db.insert(beliefTransitionsTable).values({
          lead_id: leadId,
          belief_id: beliefId,
          from_state: existing.state,
          to_state: state,
          triggered_by: "manual",
        });
      }

      const updates: any = { last_updated: new Date() };
      if (state !== undefined) updates.state = state;
      if (investor_relevance !== undefined) updates.investor_relevance = investor_relevance;
      if (evidence !== undefined) updates.evidence = evidence;
      if (evidence_source !== undefined) updates.evidence_source = evidence_source;
      if (confidence !== undefined) updates.confidence = confidence;
      if (relevance_rationale !== undefined) updates.relevance_rationale = relevance_rationale;

      const [updated] = await db
        .update(leadBeliefsTable)
        .set(updates)
        .where(eq(leadBeliefsTable.id, existing.id))
        .returning();

      beliefRow = updated;
    } else {
      const [created] = await db
        .insert(leadBeliefsTable)
        .values({
          lead_id: leadId,
          belief_id: beliefId,
          state: state || "UNKNOWN",
          investor_relevance: investor_relevance || "standard",
          evidence: evidence || null,
          evidence_source: evidence_source || null,
          confidence: confidence || null,
          relevance_rationale: relevance_rationale || null,
        })
        .returning();

      beliefRow = created;
    }

    const [registry] = await db
      .select({
        name: beliefRegistryTable.name,
        cluster: beliefRegistryTable.cluster,
        cluster_display_name: beliefRegistryTable.cluster_display_name,
        cluster_tagline: beliefRegistryTable.cluster_tagline,
        is_hard_gate: beliefRegistryTable.is_hard_gate,
        policy_status: beliefRegistryTable.policy_status,
        primary_document_id: beliefRegistryTable.primary_document_id,
      })
      .from(beliefRegistryTable)
      .where(eq(beliefRegistryTable.id, beliefId));

    await db.insert(changelogTable).values({
      id: randomUUID(),
      action: "BELIEF_STATE_UPDATED",
      lead_id: leadId,
      details: `Belief ${beliefId} updated to ${beliefRow.state}`,
      triggered_by: "operator",
    });

    res.json({ ...beliefRow, ...registry });
  } catch (err) {
    res.status(500).json({ error: "Failed to update belief" });
  }
});

export default router;
