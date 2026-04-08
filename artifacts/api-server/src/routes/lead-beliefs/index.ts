import { Router, type IRouter } from "express";
import { db, leadBeliefsTable, beliefRegistryTable, beliefTransitionsTable, changelogTable, leadIntelligenceTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "../../lib/claudeTimeout";

const VALID_STATES = ["UNKNOWN", "ABSENT", "PARTIAL", "ESTABLISHED", "BLOCKED"];
const VALID_RELEVANCE = ["high", "standard", "low", "not_applicable"];

const CLUSTER_ORDER: Record<string, string[]> = {
  growth_seeker: ["G1", "G2", "G3"],
  preserver: ["P1", "P2", "P3"],
  legacy_builder: ["L1", "L2", "L3"],
};

const router: IRouter = Router();

router.get("/leads/:leadId/beliefs/next", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const allBeliefs = await db.select().from(beliefRegistryTable).orderBy(asc(beliefRegistryTable.id));
    const leadBeliefRows = await db.select().from(leadBeliefsTable).where(eq(leadBeliefsTable.lead_id, leadId));
    const intelligenceRows = await db.select().from(leadIntelligenceTable).where(eq(leadIntelligenceTable.lead_id, leadId));
    const intelligence = intelligenceRows[0] || null;

    const stateMap = new Map<string, { state: string; investor_relevance: string | null }>();
    for (const lb of leadBeliefRows) {
      stateMap.set(lb.belief_id, { state: lb.state, investor_relevance: lb.investor_relevance });
    }

    const activeBeliefs = allBeliefs.filter(b => b.policy_status === "active");

    const isGap = (beliefId: string): boolean => {
      const entry = stateMap.get(beliefId);
      if (entry && entry.investor_relevance === "not_applicable") return false;
      const state = entry?.state || "UNKNOWN";
      return state === "UNKNOWN" || state === "ABSENT";
    };

    const universalIds = ["U1", "U2", "U3", "U4"];
    const clusterIds = intelligence?.cluster ? (CLUSTER_ORDER[intelligence.cluster] || []) : [];
    const companyIds = ["C1", "C2", "C3", "C4", "C5", "C6"];
    const foundingIds = ["F0", "F1", "F2", "F3"];

    const priorityOrder = [...universalIds, ...clusterIds, ...companyIds, ...foundingIds];

    let nextBelief = null;
    for (const id of priorityOrder) {
      const belief = activeBeliefs.find(b => b.id === id);
      if (belief && isGap(id)) {
        nextBelief = belief;
        break;
      }
    }

    const currentState = nextBelief ? (stateMap.get(nextBelief.id)?.state || "UNKNOWN") : null;

    res.json({
      next_belief: nextBelief,
      current_state: currentState,
      recommended_document_id: nextBelief?.primary_document_id || null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch next belief" });
  }
});

router.post("/leads/:leadId/beliefs/analyze", async (req, res): Promise<void> => {
  const { leadId } = req.params;
  const { transcript } = req.body;

  if (!transcript || typeof transcript !== "string" || transcript.trim() === "") {
    res.status(400).json({ error: "transcript is required" });
    return;
  }

  try {
    const allBeliefs = await db.select().from(beliefRegistryTable).where(eq(beliefRegistryTable.policy_status, "active"));
    const intelligenceRows = await db.select().from(leadIntelligenceTable).where(eq(leadIntelligenceTable.lead_id, leadId));
    const intelligence = intelligenceRows[0] || null;

    let relevantBeliefs = allBeliefs;
    if (intelligence?.cluster) {
      const clusterIds = CLUSTER_ORDER[intelligence.cluster] || [];
      relevantBeliefs = allBeliefs.filter(b =>
        b.cluster === "universal" || b.cluster === intelligence.cluster ||
        b.cluster === "company_conviction" || b.cluster === "founding_round" ||
        clusterIds.includes(b.id)
      );
    }

    const beliefList = relevantBeliefs.map(b =>
      `ID: ${b.id} | Name: ${b.name} | Description: ${b.description || b.name}`
    ).join("\n");

    const message = await claudeWithTimeout(anthropic, {
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{
        role: "user",
        content: `You are analysing a sales call transcript to detect investor belief signals.

For each belief listed below, determine from the transcript whether the investor showed evidence of holding it, actively rejected it, or showed no signal.

BELIEFS TO ANALYSE:
${beliefList}

TRANSCRIPT:
${transcript}

Return a JSON array only — no other text. Each element:
{
  "belief_id": "[ID]",
  "signal": "ESTABLISHED | PARTIAL | ABSENT | BLOCKED | UNKNOWN",
  "evidence_quote": "[exact quote max 2 sentences — omit field if no direct quote]",
  "confidence": "HIGH | MEDIUM | LOW"
}

Rules:
- Do not infer. If no signal in the transcript: return UNKNOWN.
- A question about a topic does NOT establish the belief — it suggests ABSENT or PARTIAL.
- Engagement with a topic is PARTIAL. Explicit statement of understanding is ESTABLISHED.
- An objection that cannot change with information is BLOCKED (dispositional).
- An objection that could change with the right information is ABSENT (correctable).
- Return exactly one object per belief in the input list.`,
      }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

    let results;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found");
      results = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(500).json({ error: "Failed to parse Claude response" });
      return;
    }

    let updatedCount = 0;
    let previewCount = 0;
    const responseResults = [];

    for (const r of results) {
      const belief = relevantBeliefs.find(b => b.id === r.belief_id);
      const beliefName = belief?.name || r.belief_id;

      if (r.signal === "ESTABLISHED" && !r.evidence_quote) {
        r.signal = "PARTIAL";
      }

      if ((r.confidence === "HIGH" || r.confidence === "MEDIUM") && r.signal !== "UNKNOWN") {
        const [existing] = await db.select().from(leadBeliefsTable)
          .where(and(eq(leadBeliefsTable.lead_id, leadId), eq(leadBeliefsTable.belief_id, r.belief_id)));

        if (existing) {
          if (r.signal !== existing.state) {
            await db.insert(beliefTransitionsTable).values({
              lead_id: leadId,
              belief_id: r.belief_id,
              from_state: existing.state,
              to_state: r.signal,
              triggered_by: "claude_analysis",
            });
          }
          await db.update(leadBeliefsTable).set({
            state: r.signal,
            evidence: r.evidence_quote || null,
            evidence_source: "call_transcript",
            confidence: r.confidence,
            updated_by: "claude_analysis",
            last_updated: new Date(),
          }).where(eq(leadBeliefsTable.id, existing.id));
        } else {
          await db.insert(leadBeliefsTable).values({
            lead_id: leadId,
            belief_id: r.belief_id,
            state: r.signal,
            evidence: r.evidence_quote || null,
            evidence_source: "call_transcript",
            confidence: r.confidence,
            updated_by: "claude_analysis",
          });
        }

        updatedCount++;
        responseResults.push({
          belief_id: r.belief_id,
          belief_name: beliefName,
          signal: r.signal,
          confidence: r.confidence,
          evidence_quote: r.evidence_quote || null,
          updated: true,
        });
      } else {
        previewCount++;
        responseResults.push({
          belief_id: r.belief_id,
          belief_name: beliefName,
          signal: r.signal,
          confidence: r.confidence,
          evidence_quote: r.evidence_quote || null,
          updated: false,
        });
      }
    }

    res.json({
      results: responseResults,
      updated_count: updatedCount,
      preview_count: previewCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to analyze beliefs" });
  }
});

router.get("/leads/:leadId/beliefs/gates", async (req, res): Promise<void> => {
  const { leadId } = req.params;

  try {
    const leadBeliefRows = await db.select().from(leadBeliefsTable).where(eq(leadBeliefsTable.lead_id, leadId));
    const stateMap = new Map<string, string>();
    for (const lb of leadBeliefRows) {
      stateMap.set(lb.belief_id, lb.state);
    }

    const u4State = stateMap.get("U4") || "UNKNOWN";
    const f0State = stateMap.get("F0") || "UNKNOWN";
    const f1State = stateMap.get("F1") || "UNKNOWN";
    const f2State = stateMap.get("F2") || "UNKNOWN";

    const u4Established = u4State === "ESTABLISHED";
    const f0Established = f0State === "ESTABLISHED";
    const f1Established = f1State === "ESTABLISHED";
    const f2Established = f2State === "ESTABLISHED";

    let investmentAskOpen = f0Established && f1Established && f2Established;
    let investmentAskReason: string;
    if (investmentAskOpen) {
      investmentAskReason = "F0, F1, F2 established";
    } else if (!f0Established) {
      investmentAskReason = "F0 not yet established";
    } else {
      investmentAskReason = "F0 established but F1 or F2 not yet established";
    }

    res.json({
      gates: {
        can_ask_risk_appetite_question: {
          open: u4Established,
          reason: u4Established ? "U4 established" : "U4 not yet established",
        },
        can_recommend_pack_1: {
          open: f0Established,
          reason: f0Established ? "F0 established" : "F0 not yet established",
        },
        can_recommend_pack_2: {
          open: f0Established,
          reason: f0Established ? "F0 established" : "F0 not yet established",
        },
        can_make_investment_ask: {
          open: investmentAskOpen,
          reason: investmentAskReason,
        },
      },
      belief_states: {
        U4: u4State,
        F0: f0State,
        F1: f1State,
        F2: f2State,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch gate status" });
  }
});

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

router.get("/leads/:leadId/beliefs/transitions", async (req, res): Promise<void> => {
  try {
    const { leadId } = req.params;
    const rows = await db.select()
      .from(beliefTransitionsTable)
      .where(eq(beliefTransitionsTable.lead_id, leadId))
      .orderBy(asc(beliefTransitionsTable.created_at));

    res.json({ transitions: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch transitions" });
  }
});

export default router;
