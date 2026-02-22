/**
 * Causal Claims Schema (Phase 2B)
 *
 * Zod schemas for the `causal_claims` array emitted by the LLM in
 * draft_graph_v17+. Claims represent the LLM's stated causal reasoning
 * (direct effects, mediations, absence of effects, confounders) and are
 * passed through to PLoT for semantic consistency checks.
 *
 * Claims are NOT modified by STRP or any repair pass — they represent what
 * the LLM stated, not what the pipeline produced.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Individual Claim Schemas (discriminated union on `type`)
// ---------------------------------------------------------------------------

export const DirectEffectClaimSchema = z.object({
  type: z.literal("direct_effect"),
  from: z.string(),
  to: z.string(),
  stated_strength: z.enum(["strong", "moderate", "weak"]),
});

export const MediationOnlyClaimSchema = z.object({
  type: z.literal("mediation_only"),
  from: z.string(),
  via: z.string(),
  to: z.string(),
});

export const NoDirectEffectClaimSchema = z.object({
  type: z.literal("no_direct_effect"),
  from: z.string(),
  to: z.string(),
});

export const UnmeasuredConfounderClaimSchema = z.object({
  type: z.literal("unmeasured_confounder"),
  between: z.array(z.string()).length(2),
  stated_source: z.string().optional(),
});

export const CausalClaimSchema = z.discriminatedUnion("type", [
  DirectEffectClaimSchema,
  MediationOnlyClaimSchema,
  NoDirectEffectClaimSchema,
  UnmeasuredConfounderClaimSchema,
]);

export type CausalClaim = z.infer<typeof CausalClaimSchema>;

// ---------------------------------------------------------------------------
// Array Schema
// ---------------------------------------------------------------------------

/** Max claims per response — excess truncated with warning. */
export const CAUSAL_CLAIMS_MAX = 20;

export const CausalClaimsArraySchema = z.array(CausalClaimSchema).max(CAUSAL_CLAIMS_MAX).optional();

export type CausalClaimsArray = z.infer<typeof CausalClaimsArraySchema>;

// ---------------------------------------------------------------------------
// Warning Codes
// ---------------------------------------------------------------------------

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
