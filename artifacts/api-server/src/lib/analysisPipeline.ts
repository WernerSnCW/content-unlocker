import { db, leadsTable, leadBeliefsTable, leadConversationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateIntelligence, type IntelligenceResult } from "./intelligenceService";
import { analyzeBeliefs, type BeliefAnalysisResult } from "./beliefAnalysisService";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "./claudeTimeout";

export interface PipelineResult {
  leadId: string;
  transcriptSaved: boolean;
  intelligence: IntelligenceResult | null;
  beliefs: BeliefAnalysisResult | null;
  conversationId: string | null;
  summary: string | null;
  errors: string[];
}

/**
 * Runs the full post-transcript pipeline for a lead:
 * 1. Snapshot beliefs_before
 * 2. Save transcript text to lead record
 * 3. Generate/update intelligence profile
 * 4. Analyze beliefs from transcript
 * 5. Generate conversation summary
 * 6. Save conversation record with before/after snapshots
 *
 * Each step is independent — if one fails, the others still run.
 */
export async function runPostTranscriptPipeline(
  leadId: string,
  transcriptText: string,
  source: string = "manual"
): Promise<PipelineResult> {
  const result: PipelineResult = {
    leadId,
    transcriptSaved: false,
    intelligence: null,
    beliefs: null,
    conversationId: null,
    summary: null,
    errors: [],
  };

  // Step 0: Snapshot beliefs before analysis
  let beliefsBefore: Record<string, string> = {};
  try {
    const beforeRows = await db.select({
      belief_id: leadBeliefsTable.belief_id,
      state: leadBeliefsTable.state,
    }).from(leadBeliefsTable).where(eq(leadBeliefsTable.lead_id, leadId));
    for (const row of beforeRows) {
      beliefsBefore[row.belief_id] = row.state;
    }
  } catch (err: any) {
    result.errors.push(`Beliefs snapshot failed: ${err.message}`);
  }

  // Step 1: Save transcript to lead
  try {
    await db.update(leadsTable)
      .set({ transcript_text: transcriptText })
      .where(eq(leadsTable.id, leadId));
    result.transcriptSaved = true;
  } catch (err: any) {
    result.errors.push(`Transcript save failed: ${err.message}`);
  }

  // Step 2: Generate intelligence profile
  try {
    result.intelligence = await generateIntelligence(leadId);
  } catch (err: any) {
    result.errors.push(`Intelligence generation failed: ${err.message}`);
  }

  // Step 3: Analyze beliefs
  try {
    result.beliefs = await analyzeBeliefs(leadId, transcriptText);
  } catch (err: any) {
    result.errors.push(`Belief analysis failed: ${err.message}`);
  }

  // Step 4: Generate conversation summary
  try {
    // Fetch previous summaries for context
    const previousConversations = await db.select({
      summary: leadConversationsTable.summary,
      conversation_date: leadConversationsTable.conversation_date,
    }).from(leadConversationsTable)
      .where(eq(leadConversationsTable.lead_id, leadId))
      .orderBy(desc(leadConversationsTable.conversation_date))
      .limit(5);

    let previousContext = "";
    if (previousConversations.length > 0) {
      previousContext = `\nPREVIOUS CONVERSATION SUMMARIES (most recent first):\n${previousConversations
        .filter(c => c.summary)
        .map((c, i) => `${i + 1}. [${c.conversation_date?.toISOString().split("T")[0] || "unknown date"}]: ${c.summary}`)
        .join("\n")}\n`;
    }

    const summaryMessage = await claudeWithTimeout(anthropic, {
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Generate a concise 3-5 sentence summary of this investor conversation. Focus on:
- What was discussed and any decisions or commitments made
- Key signals about the investor's readiness, concerns, or next steps
- What changed compared to previous conversations (if any)
${previousContext}
TRANSCRIPT:
${transcriptText.slice(0, 8000)}

Return ONLY the summary text, no JSON, no formatting, no labels.`,
      }],
    });

    const summaryBlock = summaryMessage.content[0];
    result.summary = summaryBlock.type === "text" ? summaryBlock.text.trim() : null;
  } catch (err: any) {
    result.errors.push(`Summary generation failed: ${err.message}`);
  }

  // Step 5: Snapshot beliefs after and save conversation record
  try {
    let beliefsAfter: Record<string, string> = {};
    const afterRows = await db.select({
      belief_id: leadBeliefsTable.belief_id,
      state: leadBeliefsTable.state,
    }).from(leadBeliefsTable).where(eq(leadBeliefsTable.lead_id, leadId));
    for (const row of afterRows) {
      beliefsAfter[row.belief_id] = row.state;
    }

    // Calculate intelligence delta
    const intelligenceDelta: Record<string, any> = {};
    if (result.intelligence) {
      intelligenceDelta.isNew = result.intelligence.isNew;
      intelligenceDelta.profileUpdated = true;
    }

    // Calculate belief changes
    const beliefChanges: Record<string, { from: string; to: string }> = {};
    for (const [beliefId, afterState] of Object.entries(beliefsAfter)) {
      const beforeState = beliefsBefore[beliefId] || "UNKNOWN";
      if (beforeState !== afterState) {
        beliefChanges[beliefId] = { from: beforeState, to: afterState };
      }
    }
    if (Object.keys(beliefChanges).length > 0) {
      intelligenceDelta.beliefChanges = beliefChanges;
    }

    const [conversation] = await db.insert(leadConversationsTable).values({
      lead_id: leadId,
      source,
      transcript_text: transcriptText,
      summary: result.summary,
      beliefs_before: beliefsBefore,
      beliefs_after: beliefsAfter,
      intelligence_delta: intelligenceDelta,
      processed_at: new Date(),
      conversation_date: new Date(),
    }).returning();

    result.conversationId = conversation.id;
  } catch (err: any) {
    result.errors.push(`Conversation record save failed: ${err.message}`);
  }

  return result;
}
