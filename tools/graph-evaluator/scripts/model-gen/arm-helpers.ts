/**
 * Pure helpers for the arm runner.
 *
 * WHY THEY ARE NOT IN `run-arms.ts`: that file calls `main()` at module scope,
 * so importing it from a test would run the CLI — and a helper that can only be
 * exercised by spending a model call is a helper nothing checks. These three
 * decide what we SEND, what we CHARGE and what counts as grounded; all three are
 * assertable offline.
 */

import type { ModelConfig } from "../../src/types.js";
import type { LLMResult, ModelConfig as ProviderModelConfig } from "../../src/providers/types.js";
import type { RichDecisionModel, ValidationFailure, ValidationResult } from "../../src/rich-model.js";

export const SCHEMA_NAME = "rich_decision_model";

export interface PricedConfig extends ModelConfig {
  /** Explicitly false while the rate is a placeholder. Absent = treat as known. */
  pricing_verified?: boolean;
}

/**
 * Cost for one call, or null when we do not actually know the rate.
 *
 * NEVER 0 for an unknown rate. A 0 in a cost column reads as "free" and gets
 * compared against real numbers; a null cannot be averaged by accident.
 */
export function estimateCost(config: PricedConfig, result: LLMResult): number | null {
  const pricing = config.pricing;
  if (pricing == null) return null;
  if (config.pricing_verified === false) return null;
  if (pricing.source.trim().toLowerCase().startsWith("unknown")) return null;
  const input = result.input_tokens ?? 0;
  const output = result.output_tokens ?? 0;
  return (input / 1_000_000) * pricing.input_per_1m + (output / 1_000_000) * pricing.output_per_1m;
}

/**
 * Attach the strict v0 grammar to a COPY of the model config.
 *
 * The providers are NOT symmetric and the difference is a 400:
 *   OpenAI    params.text.format = {type, name, strict, schema}   (Responses API)
 *   Anthropic output_config.format = {type, schema}               (no name, no strict)
 */
export function withRichSchema(
  config: ModelConfig,
  schema: Record<string, unknown>,
): ProviderModelConfig {
  const copy = JSON.parse(JSON.stringify(config)) as ProviderModelConfig;
  if (config.provider === "anthropic") {
    copy.output_config = { format: { type: "json_schema", schema } };
    return copy;
  }
  copy.params = {
    ...(copy.params ?? {}),
    text: { format: { type: "json_schema", name: SCHEMA_NAME, strict: true, schema } },
  };
  return copy;
}

/**
 * Any `dsk_refs` entry outside the allowlist supplied to the prompt is a
 * grounding failure and counts against the arm.
 *
 * With `--dsk off` the allowlist is EMPTY, so any citation at all fails — which
 * is the correct reading: the widener was given no ids and cannot have one.
 */
export function checkDskGrounding(
  model: RichDecisionModel,
  allowlist: readonly string[],
): ValidationResult {
  const allowed = new Set(allowlist);
  const failures: ValidationFailure[] = [];
  const sources: Array<[string, string[]]> = [
    ...model.factors.map((f): [string, string[]] => [f.id, f.dsk_refs]),
    ...model.outcomes.map((o): [string, string[]] => [o.id, o.dsk_refs]),
    ...model.causal_links.map((l): [string, string[]] => [l.id, l.dsk_refs]),
    ...model.notes.map((n, i): [string, string[]] => [n.about_id ?? `note[${i}]`, n.dsk_refs]),
  ];
  for (const [itemId, refs] of sources) {
    for (const ref of refs) {
      if (!allowed.has(ref)) {
        failures.push({
          gate: "DSK1_ref_not_in_allowlist",
          item_id: itemId,
          detail: `cites '${ref}', which was not in the ${allowlist.length}-id allowlist supplied to the prompt`,
        });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}
