/**
 * V6 Graph Management — Proposal & Validation Spine (ISOLATED SPIKE).
 *
 * In-memory proposal vocabulary. OFF-PATH: nothing in live V5 imports this
 * module. It constructs and classifies candidate graphs WITHOUT persistence,
 * to prove the future apply path can be safe. Plain TS types only — NOT a wire
 * boundary contract, so no Zod/OpenAPI schema.
 *
 * Pinned staging facts (origin/staging c382c9da) this spike encodes:
 *  - add_option is HELD-only: a new option cannot enter the canonical top-level
 *    options[] over the current D1 seam (candidate construction and the
 *    persist-base merge both preserve options[] from the base; the option
 *    intervention canonicaliser writes only to node.interventions). Future
 *    apply-wiring must extend the persist-merge to carry a new options[] entry.
 *  - rename_node can reach would_apply (label-only; analysis-hash-neutral).
 *  - EP2 (assessAnalysisReadiness) is the readiness parity target; the canonical
 *    analysis-state selector does not wrap it on this path.
 */
import type { ReadinessResult, Ep2State } from '../tools/handlers/analysis-ready-core.js';

export type ProposalKind = 'add_option' | 'rename_node';
export type ProposalVerdict = 'would_apply' | 'held' | 'clarify_required' | 'stale';

/**
 * Blocker code for the pinned add-option model-state gap. A new option is
 * representable as a graph node, but NOT in the canonical top-level options[]
 * model-state over the current D1 seam — that is a future apply-wiring
 * requirement, deliberately not worked around in this spike.
 */
export const OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE =
  'OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE' as const;

export interface ProposalBlocker {
  readonly code: string;
  readonly message: string;
}

interface ProposalBase {
  /** Analysis-affecting hash of the graph this proposal was validated against. */
  readonly base_graph_hash: string | null;
}

export interface RenameNodeProposal extends ProposalBase {
  readonly kind: 'rename_node';
  readonly node_id: string;
  readonly new_label: string;
}

export interface AddOptionEdgeSpec {
  readonly to_factor_id: string;
  readonly strength?: { readonly mean: number; readonly std: number };
  readonly effect_direction?: 'positive' | 'negative';
}

export interface AddOptionInterventionSpec {
  readonly value?: number;
  readonly raw_value?: number | string;
  readonly unit?: string;
  readonly cap?: number;
}

export interface AddOptionProposal extends ProposalBase {
  readonly kind: 'add_option';
  readonly option: {
    readonly id: string;
    readonly label: string;
    /** Decision node this option hangs off (adds a decision -> option edge so the
     *  candidate is reachable from the decision; required for a structurally
     *  analysable option). */
    readonly parent_decision_id?: string;
    readonly edges: readonly AddOptionEdgeSpec[];
    readonly interventions?: Readonly<Record<string, AddOptionInterventionSpec>>;
  };
}

export type Proposal = RenameNodeProposal | AddOptionProposal;

export interface BaseHashCheck {
  readonly expected: string | null;
  readonly actual: string | null;
  readonly match: boolean;
}

export interface ClassificationResult {
  readonly verdict: ProposalVerdict;
  readonly kind: ProposalKind;
  readonly base_hash_check: BaseHashCheck;
  /** In-memory candidate graph (NEVER persisted). Absent for a `stale` verdict. */
  readonly candidate?: Record<string, unknown>;
  /** Verbatim EP2 verdict on the candidate (when one was assessed). */
  readonly ep2?: ReadinessResult;
  readonly ep2_state?: Ep2State;
  readonly blocker?: ProposalBlocker;
}
