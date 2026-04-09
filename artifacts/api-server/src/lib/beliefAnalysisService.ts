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

  // Fetch existing belief states for merge context
  const existingBeliefRows = await db.select().from(leadBeliefsTable)
    .where(eq(leadBeliefsTable.lead_id, leadId));
  const existingStateMap = new Map<string, { state: string; evidence: string | null }>();
  for (const lb of existingBeliefRows) {
    existingStateMap.set(lb.belief_id, { state: lb.state, evidence: lb.evidence });
  }

  let relevantBeliefs = allBeliefs;
  if (intelligence?.cluster) {
    const clusterIds = CLUSTER_ORDER[intelligence.cluster] || [];
    relevantBeliefs = allBeliefs.filter(b =>
      b.cluster === "universal" || b.cluster === intelligence.cluster ||
      b.cluster === "company_conviction" || b.cluster === "founding_round" ||
      clusterIds.includes(b.id)
    );
  }

  // Build belief list with existing states
  const beliefList = relevantBeliefs.map(b => {
    const existing = existingStateMap.get(b.id);
    const stateInfo = existing ? ` | Current state: ${existing.state}` : "";
    const evidenceInfo = existing?.evidence ? ` | Prior evidence: ${existing.evidence}` : "";
    return `ID: ${b.id} | Name: ${b.name} | Description: ${b.description || b.name}${stateInfo}${evidenceInfo}`;
  }).join("\n");

  // Build preservation context
  const establishedBeliefs = relevantBeliefs
    .filter(b => existingStateMap.get(b.id)?.state === "ESTABLISHED")
    .map(b => `${b.id}: ${b.name}`);

  let preservationContext = "";
  if (establishedBeliefs.length > 0) {
    preservationContext = `
PRESERVATION RULES — CRITICAL:
The following beliefs are currently ESTABLISHED from previous conversations:
${establishedBeliefs.join("\n")}

- ESTABLISHED beliefs MUST remain ESTABLISHED unless the investor EXPLICITLY contradicts or reverses their position in THIS transcript.
- If a belief is ESTABLISHED and the transcript simply does not mention it, return "__KEEP__" as the signal.
- Only downgrade an ESTABLISHED belief if the investor actively rejects it (e.g. "I've changed my mind about that" or "actually I don't think that's right").
- Beliefs can be UPGRADED (UNKNOWN -> PARTIAL -> ESTABLISHED) based on new evidence.
- For non-ESTABLISHED beliefs, analyse normally based on transcript signals.
`;
  }

  const message = await claudeWithTimeout(anthropic, {
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `You are analysing a sales call transcript to detect investor belief signals.

For each belief listed below, determine from the transcript whether the investor showed evidence of holding it, actively rejected it, or showed no signal.
${preservationContext}
BELIEFS TO ANALYSE:
${beliefList}

TRANSCRIPT:
${transcript}

Return a JSON array only — no other text. Each element:
{
  "belief_id": "[ID]",
  "signal": "ESTABLISHED | PARTIAL | ABSENT | BLOCKED | UNKNOWN | __KEEP__",
  "evidence_quote": "[exact quote max 2 sentences — omit field if no direct quote]",
  "confidence": "HIGH | MEDIUM | LOW"
}

Rules:
- Use "__KEEP__" for beliefs that are currently ESTABLISHED and have no new signal in this transcript.
- Do not infer. If no signal in the transcript and belief is not already ESTABLISHED: return UNKNOWN.
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
    const existingState = existingStateMap.get(r.belief_id);

    // __KEEP__ means preserve existing state — skip this belief entirely
    if (r.signal === "__KEEP__") {
      responseResults.push({
        belief_id: r.belief_id, belief_name: beliefName,
        signal: existingState?.state || "UNKNOWN",
        confidence: r.confidence, evidence_quote: existingState?.evidence || null,
        updated: false,
      });
      previewCount++;
      continue;
    }

    if (r.signal === "ESTABLISHED" && !r.evidence_quote) {
      r.signal = "PARTIAL";
    }

    // Protect ESTABLISHED beliefs from being downgraded without explicit HIGH confidence reversal
    if (existingState?.state === "ESTABLISHED" && r.signal !== "ESTABLISHED") {
      if (r.confidence !== "HIGH" || r.signal === "UNKNOWN") {
        // Not a strong enough signal to downgrade — preserve ESTABLISHED
        responseResults.push({
          belief_id: r.belief_id, belief_name: beliefName,
          signal: "ESTABLISHED",
          confidence: r.confidence, evidence_quote: existingState.evidence || null,
          updated: false,
        });
        previewCount++;
        continue;
      }
      // HIGH confidence contradiction — allow downgrade but log it
    }

    if ((r.confidence === "HIGH" || r.confidence === "MEDIUM") && r.signal !== "UNKNOWN") {
      const [existingRow] = await db.select().from(leadBeliefsTable)
        .where(and(eq(leadBeliefsTable.lead_id, leadId), eq(leadBeliefsTable.belief_id, r.belief_id)));

      if (existingRow) {
        if (r.signal !== existingRow.state) {
          await db.insert(beliefTransitionsTable).values({
            lead_id: leadId,
            belief_id: r.belief_id,
            from_state: existingRow.state,
            to_state: r.signal,
            triggered_by: "claude_analysis",
          });
        }
        await db.update(leadBeliefsTable).set({
          state: r.signal,
          evidence: r.evidence_quote || existingRow.evidence || null,
          evidence_source: "call_transcript",
          confidence: r.confidence,
          updated_by: "claude_analysis",
          last_updated: new Date(),
        }).where(eq(leadBeliefsTable.id, existingRow.id));
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
