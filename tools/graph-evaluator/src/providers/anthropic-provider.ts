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
// 16384 provides headroom for complex graphs with coaching + causal claims (can exceed 4096)
const DEFAULT_MAX_TOKENS = 16384;

function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("claude");
}

/**
 * Build the `messages.create()` body from a {@link ModelConfig}.
 *
 * ⚠ WHY THIS IS A SEPARATE, EXPORTED, PURE FUNCTION — the same reasoning as
 * `buildResponsesParams` in the OpenAI provider (E1, 2026-07-31). An assertion
 * about WHAT WE SEND can only be honest if it does not need a network call. The
 * `output_config` passthrough below exists so Arm A′ can run the rich v0 schema
 * on Claude as GA structured outputs; without a pure builder, the only way to
 * check the body was actually built would be to spend a model call on it.
 *
 * CONTRACT: when `config.output_config` is undefined the returned body is
 * byte-identical to the pre-passthrough one. Both directions are asserted in
 * `tests/model-gen/anthropic-output-config.test.ts`; deleting either half of the
 * `if` turns one of them RED.
 */
export function buildMessagesParams(
  system: string,
  user: string,
  config: ModelConfig,
): Anthropic.MessageCreateParamsNonStreaming {
  const maxTokens = config.max_tokens ?? DEFAULT_MAX_TOKENS;
  const temperature = config.params?.temperature as number | undefined;

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model,
    system,
    messages: [{ role: "user", content: user }],
    max_tokens: maxTokens,
    ...(temperature != null ? { temperature } : {}),
  };

  // Only pass thinking config for Claude models
  if (isClaudeModel(config.model) && config.thinking !== undefined) {
    (params as Record<string, unknown>)["thinking"] = config.thinking;
  }

  // GA structured outputs. Passed through VERBATIM and only when the caller set
  // it: a model that does not accept `output_config` must keep its old body.
  // Not gated on model id here — the evaluator's job is to MEASURE which models
  // accept the v0 schema, and a local allowlist would answer that question from
  // memory instead of from the API. A rejection is a finding, not a bug to hide.
  if (config.output_config !== undefined) {
    (params as Record<string, unknown>)["output_config"] = config.output_config;
  }

  return params;
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

    const params = buildMessagesParams(system, user, config);

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
