// Phase 4.9 — Layer 1 LLM extraction call.
//
// One call per transcript. Claude Sonnet. Returns the structured
// LLMExtractionResult + audit info (tokens, latency, model) for
// persistence on engine_runs.
//
// Failure mode: no fallback to keyword scoring. Per Werner's directive
// (and the implementation directive), silent degradation to weaker
// intelligence is worse than a visible gap. If this fails, the caller
// marks the engine_run as failed and an admin can reprocess.

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { claudeWithTimeout } from "../../../lib/claudeTimeout";
import type { CallType, Investor } from "../types";
import { buildExtractionPrompt } from "./buildExtractionPrompt";
import type { LLMExtractionResult } from "./extractionSchema";
import { validateExtractionShape } from "./extractionSchema";

// Keeping the model consistent with the rest of the codebase's Claude
// callers. Overridable via env for experiments.
const DEFAULT_MODEL = process.env.ENGINE_EXTRACTION_MODEL || "claude-sonnet-4-6";

// Max output tokens. Extraction response is typically 2-4k; 8k gives
// headroom. Matches the pattern used elsewhere (beliefAnalysisService,
// acuScanner, intelligenceService).
const MAX_OUTPUT_TOKENS = 8192;

// Timeout — extraction can legitimately take 10-30s on long transcripts.
// Longer than the default claudeWithTimeout timeout just in case.
const EXTRACTION_TIMEOUT_MS = 120_000;

export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly reason: "timeout" | "api_error" | "malformed_json" | "validation_failed" | "empty_response",
    public readonly raw?: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export interface ExtractionAudit {
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  extractionVersion: string; // bumped when prompt/schema changes in a non-trivial way
}

export interface ExtractionSuccess {
  result: LLMExtractionResult;
  audit: ExtractionAudit;
}

const EXTRACTION_PROMPT_VERSION = "v1.0.0";

/**
 * Run Layer 1 extraction. Throws ExtractionError on any failure —
 * callers must catch and mark the engine_run as failed. Does NOT fall
 * back to keyword scoring.
 */
export async function extractViaLLM(args: {
  transcript: string;
  investor: Investor;
  callType: CallType;
}): Promise<ExtractionSuccess> {
  if (!args.transcript || args.transcript.trim().length === 0) {
    throw new ExtractionError("Empty transcript — nothing to extract", "empty_response");
  }

  const { system, userMessage } = buildExtractionPrompt(args);

  const startedAt = Date.now();
  let message: any;
  try {
    message = await claudeWithTimeout(
      anthropic,
      {
        model: DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: "user", content: userMessage }],
      } as any, // system with cache_control is valid per SDK types but requires casting depending on SDK version
      EXTRACTION_TIMEOUT_MS,
    );
  } catch (err: any) {
    if (err?.name === "ClaudeTimeoutError") {
      throw new ExtractionError(`Claude extraction timed out after ${EXTRACTION_TIMEOUT_MS}ms`, "timeout");
    }
    throw new ExtractionError(`Claude API error: ${err?.message || String(err)}`, "api_error");
  }
  const latencyMs = Date.now() - startedAt;

  // Pull the text block. Anthropic messages return an array of content
  // blocks; text extractions are type:"text".
  const blocks = message?.content || [];
  const textBlock = blocks.find((b: any) => b?.type === "text");
  const text: string = textBlock?.text ?? "";
  if (!text) {
    throw new ExtractionError("Claude returned no text content", "empty_response");
  }

  // Extract the JSON object. The prompt instructs "return ONLY the JSON
  // object" — but models occasionally wrap in markdown fences or add
  // trailing whitespace. Handle both.
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    throw new ExtractionError("No JSON object found in Claude response", "malformed_json", text);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err: any) {
    throw new ExtractionError(`JSON parse failed: ${err?.message}`, "malformed_json", jsonText);
  }

  const shapeError = validateExtractionShape(parsed);
  if (shapeError) {
    throw new ExtractionError(`Extraction shape invalid: ${shapeError}`, "validation_failed", jsonText);
  }

  const usage = message?.usage || {};
  const audit: ExtractionAudit = {
    model: DEFAULT_MODEL,
    latencyMs,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    extractionVersion: EXTRACTION_PROMPT_VERSION,
  };

  return { result: parsed as LLMExtractionResult, audit };
}

/**
 * Pull a JSON object out of arbitrary text. Handles:
 *   - Clean response: "{ ... }"
 *   - Markdown-fenced: "```json\n{ ... }\n```"
 *   - Leading/trailing commentary: "Here's the extraction:\n{ ... }"
 * Returns the JSON string, or null if none found.
 */
function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  // Fenced code block — pull content between ``` markers
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();
  // Top-level object match — grab first { ... } with balanced braces.
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return trimmed.slice(firstBrace, i + 1);
    }
  }
  return null;
}
