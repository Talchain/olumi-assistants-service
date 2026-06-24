/**
 * V6 Graph Management — Proposal & Validation Spine (ISOLATED SPIKE).
 *
 * In-memory proposal vocabulary. OFF-PATH: nothing in live V5 imports this
 * module. It constructs and classifies candidate graphs WITHOUT persistence,
 * to prove the future apply path can be safe. Plain TS types only — NOT a wire
 * boundary contract, so no Zod/OpenAPI schema.
 *
 * Pinned staging facts (origin/staging c382c9da) this spike encodes:
 *  - add_option is HELD-only. NOT because the option is unrepresentable: the new
 *    option survives as a graph NODE through candidate construction and the
 *    persist-base merge, and run-analysis derives its PLoT options from option
 *    NODES (computeStructuralReadiness), so the node IS analysable. It is held
 *    because applying creates a TOP-LEVEL options[] / context divergence:
 *    run-analysis reads node-derived options, while the context-pack assembler
 *    prefers top-level options[] (kept base-only by the persist-base merge), so
 *    consumers disagree about the option set. Resolving the canonical
 *    node <-> options[] contract is the apply-wiring spike's job; this spike
 *    refuses to apply divergent state.
 *  - rename_node can reach would_apply (label-only; analysis-hash-neutral).
 *  - EP2 (assessAnalysisReadiness) is the readiness parity target; the canonical
 *    analysis-state selector does not wrap it on this path.
 */
import type { ReadinessResult, Ep2State } from '../tools/handlers/analysis-ready-core.js';

export type ProposalKind = 'add_option' | 'rename_node';
export type ProposalVerdict = 'would_apply' | 'held' | 'clarify_required' | 'stale';

/**
 * Held reason for add_option: applying would diverge the top-level options[]
 * from the node-derived option set. The new option survives as a node
 * (analysable by run-analysis, which reads option nodes), but the top-level
 * options[] — preferred by the context-pack assembler — is kept base-only by the
 * persist-base merge. Auto-applying that split state is unsafe; the canonical
 * node <-> options[] contract is deferred to the apply-wiring spike.
 */
export const OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE =
  'OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE' as const;

/** Held reason: the proposed option id already exists as a node in the graph. */
export const OPTION_ID_COLLISION = 'OPTION_ID_COLLISION' as const;

/** Held reason: the current graph could not be read as a graph (no nodes array). */
export const CURRENT_GRAPH_UNREADABLE = 'CURRENT_GRAPH_UNREADABLE' as const;

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
