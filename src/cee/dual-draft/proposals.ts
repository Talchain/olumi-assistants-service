/**
 * V6 dual-model M2 enrichment-proposal contract.
 *
 * Ported from the offline bake-off platform's arm-C proposal schema:
 *   source:  tools/bakeoff-v6/src/merge/proposals.ts
 *   branch:  claude/bakeoff-v6-platform @ 5af022c87
 *            (byte-identical to 373479c36; sole intervening commit is docs-only)
 *   sha256:  e13e3956ce7723cd9bd7a67b6104497ce1caabc2dfaeb8ee0696363997405922
 *
 * The envelope is validated with zod here; node/edge payloads inside `delta`
 * stay `unknown` and are validated with the REAL repo NodeV3/EdgeV3 schemas in
 * the deterministic merge (Phase 3) — the graph contract is never re-created
 * locally. See the lane plan §8 (deterministic merge/reject design).
 */
import { z } from 'zod';

export const MUTATING_PROPOSAL_TYPES = [
  'added_option',
  'added_risk',
  'added_assumption',
  'added_causal_link',
] as const;

export const ARTIFACT_PROPOSAL_TYPES = [
  'added_evidence_gap',
  'uncertainty_flag',
  'clarification_proposal',
] as const;

export const PROPOSAL_TYPES = [...MUTATING_PROPOSAL_TYPES, ...ARTIFACT_PROPOSAL_TYPES] as const;

export const ProposalEnvelope = z.object({
  type: z.enum(PROPOSAL_TYPES),
  delta: z.object({
    node: z.unknown().nullable().optional(),
    edge: z.unknown().nullable().optional(),
    question: z.string().nullable().optional(),
  }),
  evidence_pointer: z.string().min(1, 'evidence_pointer is required and must be non-empty'),
  rationale: z.string().optional(),
});
export type ProposalEnvelopeT = z.infer<typeof ProposalEnvelope>;

export function isArtifactType(type: string): boolean {
  return (ARTIFACT_PROPOSAL_TYPES as readonly string[]).includes(type);
}

/**
 * Live-only cap (not in the bake-off source). The M2 output contract bounds the
 * proposal list to keep the review call cheap and the merge bounded; the
 * deterministic merge (Phase 3) rejects any proposal at index >= this cap with
 * reason 'proposal_cap_exceeded'. Kept beside the schema as contract data.
 */
export const PROPOSAL_CAP = 8;
