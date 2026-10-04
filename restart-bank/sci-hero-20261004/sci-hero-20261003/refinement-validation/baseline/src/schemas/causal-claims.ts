/**
 * Causal Claims — re-export shim (v0.11.0 schema amendment).
 *
 * As of `@talchain/schemas` 0.11.0 the canonical `CausalClaim` discriminated
 * union, `CausalClaimSchema`, `CausalClaimsArraySchema`, and `StrengthBand`
 * live in the shared schemas package. This module re-exports them so existing
 * import sites in CEE compile unchanged. CEE-side warning codes and the max-
 * claims constant remain co-located here — they are validation concerns, not
 * contract shape.
 *
 * **New code**: prefer `import { CausalClaimSchema } from "@talchain/schemas"`.
 *
 * Note: the v0.11.0 contract is 4-band (`very_strong | strong | moderate |
 * slight`); the prior CEE-local shape was 3-band (`strong | moderate | weak`).
 * Existing fixtures or LLM responses carrying `weak` will fail this Zod
 * validation downstream — they should be migrated, or repaired by a future
 * normaliser, not passed through.
 */

export {
  CausalClaimSchema,
  CausalClaimsArraySchema,
  DirectEffectClaimSchema,
  MediationOnlyClaimSchema,
  NoDirectEffectClaimSchema,
  UnmeasuredConfounderClaimSchema,
  StrengthBand,
} from "@talchain/schemas";
export type {
  CausalClaim,
  CausalClaimsArray,
} from "@talchain/schemas";

/** Max claims per response — excess truncated with warning. CEE-side cap. */
export const CAUSAL_CLAIMS_MAX = 20;

/** CEE-side validation warning codes for causal claims. */
export const CAUSAL_CLAIMS_WARNING_CODES = {
  /** causal_claims present but not an array */
  MALFORMED: "CAUSAL_CLAIMS_MALFORMED",
  /** One or more claims failed Zod parse (aggregated) */
  DROPPED: "CAUSAL_CLAIM_DROPPED",
  /** One or more claims reference non-existent node IDs (aggregated) */
  INVALID_REF: "CAUSAL_CLAIM_INVALID_REF",
  /** Claims array exceeded max, truncated */
  TRUNCATED: "CAUSAL_CLAIMS_TRUNCATED",
} as const;
