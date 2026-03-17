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
  /**
   * OpenAI reasoning effort: none | low | medium | high | xhigh.
   * null means do not pass the reasoning parameter.
   */
  reasoning_effort?: string | null;
  /** Anthropic extended thinking config. Only passed for Claude models. */
  thinking?: { type: string };
  /** Anthropic effort level: low | medium | high | max. */
  effort?: string;
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
