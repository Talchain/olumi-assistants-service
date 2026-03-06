/**
 * Anthropic provider — wraps client.messages.create().
 *
 * Extracts text blocks from the content array; skips thinking blocks.
 * Returns LLMResult; never throws.
 */

import Anthropic from "@anthropic-ai/sdk";
import { requireEnvKey } from "./env.js";
import type { LLMProvider, LLMResult, ModelConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("claude");
}

export class AnthropicProvider implements LLMProvider {
  async chat(system: string, user: string, config: ModelConfig): Promise<LLMResult> {
    let apiKey: string;
    try {
      apiKey = requireEnvKey("ANTHROPIC_API_KEY");
    } catch (err) {
      return {
        ok: false,
        text: null,
        error: err instanceof Error ? err.message : String(err),
        provider: "anthropic",
        model: config.model,
        latency_ms: 0,
      };
    }

    const client = new Anthropic({ apiKey });
    const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const maxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = {
      model: config.model,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: maxTokens,
    };

    // Only pass model-specific params for Claude models
    if (isClaudeModel(config.model)) {
      if (config.thinking !== undefined) {
        params["thinking"] = config.thinking;
      }
      if (config.effort !== undefined) {
        params["effort"] = config.effort;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const response = await client.messages.create(params, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      const latency_ms = Date.now() - start;

      // Extract text blocks; skip thinking blocks
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );

      if (textBlocks.length === 0) {
        return {
          ok: false,
          text: null,
          error: "No text content in response",
          provider: "anthropic",
          model: config.model,
          latency_ms,
          input_tokens: response.usage?.input_tokens,
          output_tokens: response.usage?.output_tokens,
        };
      }

      const text = textBlocks.map((b) => b.text).join("").trim();

      return {
        ok: true,
        text,
        error: null,
        provider: "anthropic",
        model: config.model,
        latency_ms,
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      };
    } catch (err) {
      clearTimeout(timer);
      const latency_ms = Date.now() - start;
      return {
        ok: false,
        text: null,
        error: classifyAnthropicError(err),
        provider: "anthropic",
        model: config.model,
        latency_ms,
      };
    }
  }
}

function classifyAnthropicError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      err.name === "AbortError" ||
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("aborted")
    ) {
      return "timeout";
    }
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429) return `rate_limited: ${msg}`;
      if (err.status === 401 || err.status === 403) return `auth_failed: ${msg}`;
      if (err.status === 400) return `invalid_request: ${msg}`;
      if (err.status != null && err.status >= 500) return `server_error: ${msg}`;
    }
    return msg;
  }
  return String(err);
}
