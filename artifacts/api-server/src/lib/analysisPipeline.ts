import { db, leadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateIntelligence, type IntelligenceResult } from "./intelligenceService";
import { analyzeBeliefs, type BeliefAnalysisResult } from "./beliefAnalysisService";

export interface PipelineResult {
  leadId: string;
  transcriptSaved: boolean;
  intelligence: IntelligenceResult | null;
  beliefs: BeliefAnalysisResult | null;
  errors: string[];
}

/**
 * Runs the full post-transcript pipeline for a lead:
 * 1. Save transcript text to lead record
 * 2. Generate/update intelligence profile
 * 3. Analyze beliefs from transcript
 *
 * Each step is independent — if one fails, the others still run.
 */
export async function runPostTranscriptPipeline(
  leadId: string,
  transcriptText: string
): Promise<PipelineResult> {
  const result: PipelineResult = {
    leadId,
    transcriptSaved: false,
    intelligence: null,
    beliefs: null,
    errors: [],
  };

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

  return result;
}
