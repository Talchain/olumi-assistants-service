/**
 * Track 3 — Slice 5: dual-model → typed-mutation adapter.
 *
 * Projects a dual-draft `ProposalEnvelope` (the T3 producer, src/cee/dual-draft)
 * into a raw `CandidateMutationEnvelope` for the referee. Per Paul #1's import
 * boundary this module does NOT import from `src/cee/` — it uses a LOCAL mirror of
 * the producer shape; structural compatibility with the real `ProposalEnvelopeT`
 * is proven at typecheck by the adapter test (type-level assignment).
 *
 * Two-sided seam (preserved): dual-model GENERATES/selects candidate structures;
 * typed mutation VALIDATES/applies; persistence/executor/claim-safety remain the
 * deterministic controller's. Neither reaches into the other's internals — the
 * envelope is the only contract.
 *
 * Lossless part = the exhaustive `never`-checked kind mapping (7 producer types →
 * CandidateKind). The producer's `delta.node`/`delta.edge` are `unknown` (validated
 * downstream by the real NodeV3/EdgeV3), so the payload projection here is
 * BEST-EFFORT — R1 (`parseEnvelope`) is the fail-closed gate: a delta that doesn't
 * satisfy the strict payload is REJECTED, never applied.
 */
import type { CandidateKind } from '../types.js';

/** Local mirror of the dual-draft `ProposalEnvelopeT` (NOT imported — zero src/cee coupling). */
export const DUAL_DRAFT_PROPOSAL_TYPES = [
  'added_option',
  'added_risk',
  'added_assumption',
  'added_causal_link',
  'added_evidence_gap',
  'uncertainty_flag',
  'clarification_proposal',
] as const;
export type DualDraftProposalType = (typeof DUAL_DRAFT_PROPOSAL_TYPES)[number];

export interface DualDraftProposal {
  readonly type: DualDraftProposalType;
  readonly delta: {
    readonly node?: unknown;
    readonly edge?: unknown;
    readonly question?: string | null;
  };
  readonly evidence_pointer: string;
  readonly rationale?: string;
}

/** Context the referee needs that the producer proposal does not carry. */
export interface AdapterContext {
  readonly candidate_id: string;
  readonly base_graph_hash: string;
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly model_id?: string;
}

/** Exhaustive, lossless 7→kind mapping (T4.0 §1). An unmapped type is a compile error. */
export function mapProposalType(type: DualDraftProposalType): CandidateKind {
  switch (type) {
    case 'added_option':
      return 'add_option';
    case 'added_risk':
    case 'added_assumption':
    case 'added_evidence_gap':
      return 'add_node';
    case 'added_causal_link':
      return 'add_edge';
    case 'uncertainty_flag':
      return 'flag_uncertainty';
    case 'clarification_proposal':
      return 'clarification';
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Best-effort payload projection per kind (R1 is the fail-closed validator). */
function projectPayload(proposal: DualDraftProposal, kind: CandidateKind): Record<string, unknown> {
  const node = asObject(proposal.delta.node);
  const edge = asObject(proposal.delta.edge);
  const question = str(proposal.delta.question) ?? '';
  switch (kind) {
    case 'add_option':
      return {
        option: {
          id: str(node.id) ?? '',
          label: str(node.label) ?? '',
          edges: [],
          ...(node.interventions ? { interventions: node.interventions } : {}),
        },
      };
    case 'add_node':
      return { node: { id: str(node.id) ?? '', kind: node.kind ?? 'risk', label: str(node.label) ?? '' } };
    case 'add_edge':
      return { edge: { from: str(edge.from) ?? '', to: str(edge.to) ?? '' } };
    case 'flag_uncertainty':
    case 'clarification':
      return { target_ref: str(node.id) ?? str(edge.from) ?? 'unspecified', question: question || 'Please clarify.' };
    default:
      return {};
  }
}

/**
 * Project a producer proposal + context → a RAW candidate envelope. Total (never
 * throws). The result is passed to `refereeMutation`/`parseEnvelope`, which applies
 * R1 fail-closed — the adapter never asserts validity itself.
 */
export function dualDraftToCandidateEnvelope(
  proposal: DualDraftProposal,
  ctx: AdapterContext,
): Record<string, unknown> {
  const kind = mapProposalType(proposal.type);
  return {
    envelope_version: 1,
    candidate_id: ctx.candidate_id,
    kind,
    base_graph_hash: ctx.base_graph_hash,
    payload: projectPayload(proposal, kind),
    provenance: {
      source: 'dual_model_m2',
      evidence_pointer: proposal.evidence_pointer,
      ...(proposal.rationale !== undefined ? { rationale: proposal.rationale } : {}),
      ...(ctx.model_id !== undefined ? { model_id: ctx.model_id } : {}),
    },
    identity: { scenario_id: ctx.scenario_id, turn_id: ctx.turn_id },
  };
}
