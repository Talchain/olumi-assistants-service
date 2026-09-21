/**
 * Provider abstraction types for the graph evaluator.
 *
 * All LLM providers implement LLMProvider and return LLMResult.
 * The evaluator never touches provider-specific SDKs directly — only
 * these types and the getProvider() factory.
 */

export interface ModelConfig {
  id: string;
  /** Provider identifier. Defaults to 'openai' if omitted in JSON. */
  provider: "openai" | "anthropic";
  model: string;
  /** Max output tokens. Required for Anthropic; optional for OpenAI. */
  max_tokens?: number;
  /** Request timeout in ms. Default: 60000. Applied identically across providers. */
  timeout_ms?: number;
  /** Arbitrary model params (e.g. temperature). */
  params?: Record<string, unknown>;
  /**
   * OpenAI reasoning effort: none | low | medium | high | xhigh.
   * null means do not pass the reasoning parameter.
   */
  reasoning_effort?: string | null;
  /** Anthropic extended thinking config. Only passed for Claude models. */
  thinking?: { type: string };
  /** Anthropic effort level: low | medium | high | max. */
  effort?: string;
  /**
   * Anthropic GA structured outputs, passed through verbatim to
   * `messages.create()`. Shape (mirrors the product at
   * `src/adapters/llm/anthropic.ts:960-975`):
   *   `{ format: { type: "json_schema", schema } }`
   * NOTE the Anthropic body takes NO `name` and NO `strict` — the SDK's
   * `JSONOutputFormat` is `{schema, type}` only. Sending the OpenAI shape here
   * is a 400.
   *
   * Typed `unknown` deliberately: this is a wire escape hatch, the provider
   * validates its own field names, and narrowing it here would make the
   * evaluator a second, drifting copy of the SDK's types.
   * When absent, the request body is byte-identical to the pre-passthrough one.
   */
  output_config?: unknown;
  /**
   * Raw response schema, for callers that want to carry the JSON Schema on the
   * config rather than pre-built provider bodies. Nothing in the providers reads
   * this — the runner builds `output_config` / `params.text` from it.
   */
  response_schema?: unknown;
}

export interface LLMResult {
  ok: boolean;
  /** Trimmed plain text output. null on failure. */
  text: string | null;
  /** Error description. null on success. */
  error: string | null;
  provider: string;
  model: string;
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
}

export interface LLMProvider {
  chat(system: string, user: string, config: ModelConfig): Promise<LLMResult>;
}
