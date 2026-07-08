/**
 * DRY-RUN M1 validity gate — mirrors the live adapter's acceptance gate verbatim.
 *
 * The v8 draft grammar (src/cee/draft/anthropic-graph-schema.ts, #367) emits an
 * LLM-boundary shape: factor fields nested under node.data.*, and coaching /
 * causal_claims / topology_plan as JSON-ENCODED STRINGS. The live adapter
 * de-stringifies and normalises this BEFORE the LLM-boundary Zod check
 * (AnthropicDraftResponse = LLMDraftResponse), and only much later transforms it
 * to the V3 shape for the CEEGraphResponseV3 egress gate. Validating raw grammar
 * output directly against CEEGraphResponseV3 (as validateCandidate historically
 * did) is a shape mismatch that marks well-formed drafts invalid.
 *
 * For the dry run — whose declared scope is "parser + parse validity only", i.e.
 * "did M1 emit a well-formed draft" — this replicates the adapter's own
 * acceptance gate exactly (src/adapters/llm/anthropic.ts:799-816):
 *     normaliseDraftResponse -> ensureControllableFactorBaselines -> LLMDraftResponse.safeParse
 * The full V1->V3 transform, the deterministic scorer, and V3-egress validity are
 * scored-round work and a rubric decision (see Docs/m2-benchmark), NOT built here.
 *
 * normaliseDraftResponse is unconditional and a no-op on already-object shapes
 * (the mock and prompt-only outputs), so this stays green in --mock mode.
 */
import {
  normaliseDraftResponse,
  ensureControllableFactorBaselines,
} from "../../../../src/adapters/llm/normalisation.ts";
import { LLMDraftResponse } from "../../../../src/adapters/llm/shared-schemas.ts";

export interface BoundaryValidation {
  valid: boolean;
  errors: string[];
  /** The de-stringified, baseline-defaulted draft (LLM-boundary shape). */
  normalised: unknown;
}

const MAX_ERRORS = 12;

export function validateDraftAtBoundary(raw: unknown): BoundaryValidation {
  let normalised: unknown = raw;
  try {
    const n = normaliseDraftResponse(raw);
    const { response } = ensureControllableFactorBaselines(n);
    normalised = response;
  } catch (err) {
    return {
      valid: false,
      errors: [`normalisation threw: ${(err as Error).message}`],
      normalised: raw,
    };
  }
  const parse = LLMDraftResponse.safeParse(normalised);
  if (parse.success) return { valid: true, errors: [], normalised };
  const errors = parse.error.issues
    .slice(0, MAX_ERRORS)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  if (parse.error.issues.length > MAX_ERRORS) {
    errors.push(`… ${parse.error.issues.length - MAX_ERRORS} more issues`);
  }
  return { valid: false, errors, normalised };
}
