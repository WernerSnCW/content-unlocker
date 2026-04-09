import { db, leadBeliefsTable, beliefRegistryTable, beliefTransitionsTable, leadIntelligenceTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "./claudeTimeout";

const CLUSTER_ORDER: Record<string, string[]> = {
  growth_seeker: ["G1", "G2", "G3"],
  preserver: ["P1", "P2", "P3"],
  legacy_builder: ["L1", "L2", "L3"],
};

export interface BeliefAnalysisResultItem {
  belief_id: string;
  belief_name: string;
  signal: string;
  confidence: string;
  evidence_quote: string | null;
  updated: boolean;
}

export interface BeliefAnalysisResult {
  results: BeliefAnalysisResultItem[];
  updated_count: number;
  preview_count: number;
}

export async function analyzeBeliefs(leadId: string, transcript: string): Promise<BeliefAnalysisResult> {
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
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in Claude response");
  results = JSON.parse(jsonMatch[0]);

  let updatedCount = 0;
  let previewCount = 0;
  const responseResults: BeliefAnalysisResultItem[] = [];

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
        belief_id: r.belief_id, belief_name: beliefName, signal: r.signal,
        confidence: r.confidence, evidence_quote: r.evidence_quote || null, updated: true,
      });
    } else {
      previewCount++;
      responseResults.push({
        belief_id: r.belief_id, belief_name: beliefName, signal: r.signal,
        confidence: r.confidence, evidence_quote: r.evidence_quote || null, updated: false,
      });
    }
  }

  return { results: responseResults, updated_count: updatedCount, preview_count: previewCount };
}
