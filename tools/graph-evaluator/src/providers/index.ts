/**
 * Provider factory — routes model configs to the correct LLM provider.
 *
 * Usage:
 *   const provider = getProvider(modelConfig);
 *   const result = await provider.chat(system, user, modelConfig);
 */

import { OpenAIProvider } from "./openai-provider.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import type { LLMProvider, ModelConfig } from "./types.js";

export { OpenAIProvider } from "./openai-provider.js";
export { AnthropicProvider } from "./anthropic-provider.js";
export type { LLMProvider, LLMResult, ModelConfig as ProviderModelConfig } from "./types.js";

export function getProvider(config: ModelConfig): LLMProvider {
  if (config.provider === "anthropic") return new AnthropicProvider();
  return new OpenAIProvider();
}
