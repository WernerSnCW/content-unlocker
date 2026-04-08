import type Anthropic from "@anthropic-ai/sdk";

const DEFAULT_TIMEOUT_MS = 90_000;

export class ClaudeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Claude API call timed out after ${timeoutMs}ms`);
    this.name = "ClaudeTimeoutError";
  }
}

export async function claudeWithTimeout(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Anthropic.Message> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.messages.create(params, {
      signal: controller.signal,
    });
    return response;
  } catch (err: any) {
    if (err?.name === "AbortError" || controller.signal.aborted) {
      throw new ClaudeTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
