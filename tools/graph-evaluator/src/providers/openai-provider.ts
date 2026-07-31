/**
 * OpenAI provider — wraps the Responses API call from runner.ts.
 *
 * Uses `client.responses.create()` with reasoning support.
 * Returns LLMResult; never throws.
 */

import OpenAI from "openai";
import { requireEnvKey } from "./env.js";
import type { LLMProvider, LLMResult, ModelConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Build the Responses-API request body from a {@link ModelConfig}.
 *
 * ⚠ WHY THIS IS A SEPARATE, EXPORTED, PURE FUNCTION (E1, 2026-07-31).
 * `ModelConfig` has declared `params?: Record<string, unknown>` — commented
 * *"Arbitrary model params (e.g. temperature)"* — since it was written, and the
 * sibling Anthropic provider honours it (`anthropic-provider.ts:40`). THIS
 * provider silently ignored it, so the OpenAI arm of every bake-off ran at the
 * provider default while the config said otherwise, and nothing could tell.
 * That is a declared capability that never executed: a caller could pin
 * `temperature: 0`, see no error, and get an unpinned run.
 *
 * Extracting the body-builder makes the behaviour testable WITHOUT a network
 * call, which is the only way an assertion about "what we send" can be honest.
 *
 * `config.params` is passed through as-is (it is the caller's escape hatch, and
 * the Responses API validates its own field names) but it is applied FIRST, so
 * it can never overwrite the three identity fields below.
 */
export function buildResponsesParams(
  system: string,
  user: string,
  config: ModelConfig,
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...(config.params ?? {}),
    model: config.model,
    instructions: system,
    input: user,
  };

  // `max_tokens` is the cross-provider field name in ModelConfig; the Responses
  // API calls the same thing `max_output_tokens`. Mapped rather than passed
  // through, so a config that pins an output budget actually pins one.
  if (config.max_tokens != null && params["max_output_tokens"] === undefined) {
    params["max_output_tokens"] = config.max_tokens;
  }

  // Reasoning effort — only pass when explicitly set (not null/undefined)
  if (config.reasoning_effort != null) {
    params["reasoning"] = { effort: config.reasoning_effort };
  }

  return params;
}

export class OpenAIProvider implements LLMProvider {
  async chat(system: string, user: string, config: ModelConfig): Promise<LLMResult> {
    let apiKey: string;
    try {
      apiKey = requireEnvKey("OPENAI_API_KEY");
    } catch (err) {
      return {
        ok: false,
        text: null,
        error: err instanceof Error ? err.message : String(err),
        provider: "openai",
        model: config.model,
        latency_ms: 0,
      };
    }

    const client = new OpenAI({ apiKey });
    const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;

    const params = buildResponsesParams(system, user, config);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
       
      const response = await (client.responses as any).create(params, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      const latency_ms = Date.now() - start;

      // Extract text from output
      const text: string =
        response.output_text ??
        response.output
          ?.filter((o: { type: string }) => o.type === "message")
          ?.flatMap((o: { content: Array<{ type: string; text: string }> }) =>
            o.content
              ?.filter((c) => c.type === "output_text" || c.type === "text")
              ?.map((c) => c.text) ?? []
          )
          ?.join("") ??
        "";

      const usageData = response.usage ?? {};
      // Reasoning tokens are reported in output_tokens_details for o-series models
      const reasoningTokens =
        usageData.output_tokens_details?.reasoning_tokens ??
        usageData.completion_tokens_details?.reasoning_tokens ??
        0;
      return {
        ok: true,
        text: text.trim(),
        error: null,
        provider: "openai",
        model: config.model,
        latency_ms,
        input_tokens: usageData.input_tokens ?? usageData.prompt_tokens ?? 0,
        output_tokens: usageData.output_tokens ?? usageData.completion_tokens ?? 0,
        reasoning_tokens: reasoningTokens > 0 ? reasoningTokens : undefined,
      };
    } catch (err) {
      clearTimeout(timer);
      const latency_ms = Date.now() - start;
      return {
        ok: false,
        text: null,
        error: classifyOpenAIError(err),
        provider: "openai",
        model: config.model,
        latency_ms,
      };
    }
  }
}

function classifyOpenAIError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      err.name === "AbortError" ||
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("aborted")
    ) {
      return "timeout";
    }
    if (err instanceof OpenAI.APIError) {
      if (err.status === 429) return `rate_limited: ${msg}`;
      if (err.status === 401 || err.status === 403) return `auth_failed: ${msg}`;
      if (err.status === 400) return `invalid_request: ${msg}`;
      if (err.status != null && err.status >= 500) return `server_error: ${msg}`;
    }
    return msg;
  }
  return String(err);
}
