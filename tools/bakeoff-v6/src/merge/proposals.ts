/**
 * M2 enrichment-proposal contract (arm C).
 *
 * Shape mirrors the proposal-quality-judge scaffold's proposal vocabulary
 * (7 types, delta.node/delta.edge/delta.question, evidence_pointer).
 * The envelope is validated with the tool's own zod; node/edge payloads are
 * validated with the REAL repo NodeV3/EdgeV3 schemas in the merger — the
 * contract is never re-created locally.
 */
import { z } from "zod";

export const MUTATING_PROPOSAL_TYPES = [
  "added_option",
  "added_risk",
  "added_assumption",
  "added_causal_link",
] as const;

export const ARTIFACT_PROPOSAL_TYPES = [
  "added_evidence_gap",
  "uncertainty_flag",
  "clarification_proposal",
] as const;

export const PROPOSAL_TYPES = [...MUTATING_PROPOSAL_TYPES, ...ARTIFACT_PROPOSAL_TYPES] as const;

export const ProposalEnvelope = z.object({
  type: z.enum(PROPOSAL_TYPES),
  delta: z.object({
    node: z.unknown().nullable().optional(),
    edge: z.unknown().nullable().optional(),
    question: z.string().nullable().optional(),
  }),
  evidence_pointer: z.string().min(1, "evidence_pointer is required and must be non-empty"),
  rationale: z.string().optional(),
});
export type ProposalEnvelopeT = z.infer<typeof ProposalEnvelope>;

export function isArtifactType(type: string): boolean {
  return (ARTIFACT_PROPOSAL_TYPES as readonly string[]).includes(type);
}
