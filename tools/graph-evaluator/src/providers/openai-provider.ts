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

    const params: Record<string, unknown> = {
      model: config.model,
      instructions: system,
      input: user,
    };

    // Reasoning effort — only pass when explicitly set (not null/undefined)
    if (config.reasoning_effort != null) {
      params["reasoning"] = { effort: config.reasoning_effort };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      return {
        ok: true,
        text: text.trim(),
        error: null,
        provider: "openai",
        model: config.model,
        latency_ms,
        input_tokens: usageData.input_tokens ?? usageData.prompt_tokens ?? 0,
        output_tokens: usageData.output_tokens ?? usageData.completion_tokens ?? 0,
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
