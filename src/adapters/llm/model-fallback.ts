/**
 * Anthropic model-fallback resolution — a LEAF module (imports config only) so
 * that consumers (anthropic.ts, extraction.ts) don't create heavy transitive
 * import edges into partially-mocked test graphs.
 *
 * ONE named constant so a provider retirement is a one-line fix — ROADMAP
 * 1.79: the retired claude-3-5-sonnet-20241022 / claude-3-haiku-20240307
 * fallbacks 404'd silently. Guarded by
 * tests/unit/anthropic-fallback-model.test.ts (registry-enabled; no retired-id
 * fallback literals in the adapters).
 */
import { config } from "../../config/index.js";

export const FALLBACK_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';

/** explicit → config.llm.model (LLM_MODEL) → FALLBACK_ANTHROPIC_MODEL. */
export function resolveAnthropicModel(explicit?: string): string {
  return explicit || config.llm.model || FALLBACK_ANTHROPIC_MODEL;
}
