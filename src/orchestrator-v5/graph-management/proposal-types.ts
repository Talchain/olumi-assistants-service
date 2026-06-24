/**
 * V6 Graph Management — Proposal & Validation Spine (ISOLATED SPIKE).
 *
 * In-memory proposal vocabulary. OFF-PATH: nothing in live V5 imports this
 * module. It constructs and classifies candidate graphs WITHOUT persistence,
 * to prove the future apply path can be safe. Plain TS types only — NOT a wire
 * boundary contract, so no Zod/OpenAPI schema.
 *
 * Pinned staging facts (origin/staging c382c9da) this spike encodes:
 *  - add_option NEVER reaches would_apply. It is `held` — or `stale` if its
 *    base_graph_hash no longer matches the current graph (the INV-1 stale gate
 *    applies to EVERY kind; a stale proposal is rejected, not applied). The new
 *    option survives as a graph NODE and is analysable by run-analysis (which
 *    reads option NODES), so it is NOT unrepresentable. The held REASON is
 *    accurate to the graph: OPTION_ID_COLLISION (id already a node);
 *    OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE (a top-level options[] ARRAY is present,
 *    so the merge keeps it base-only while the new option enters the node-derived
 *    set the context-pack assembler diverges from); otherwise
 *    ADD_OPTION_APPLY_UNWIRED (no options[] array; the apply path / canonical
 *    node <-> options[] contract is unbuilt). The apply-wiring spike owns these.
 *  - rename_node can reach would_apply (label-only; analysis-hash-neutral).
 *  - EP2 (assessAnalysisReadiness) is the readiness parity target; the canonical
 *    analysis-state selector does not wrap it on this path.
 */
import type { ReadinessResult, Ep2State } from '../tools/handlers/analysis-ready-core.js';

export type ProposalKind = 'add_option' | 'rename_node';
export type ProposalVerdict = 'would_apply' | 'held' | 'clarify_required' | 'stale';

/**
 * Held reason for add_option WHEN the graph carries a top-level options[]:
 * applying would diverge that array (kept base-only by the persist-base merge,
 * and preferred by the context-pack assembler) from the node-derived option set
 * that run-analysis reads. Reserved for graphs that actually have a top-level
 * options[] — otherwise there is no split (see ADD_OPTION_APPLY_UNWIRED).
 */
export const OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE =
  'OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE' as const;

/**
 * Held reason for add_option when the graph has NO top-level options[] ARRAY
 * (absent, or a malformed non-array value). This spike does not build the apply
 * path — the canonical node <-> options[] persist contract is unresolved — so the
 * option is simply not yet wired for apply. No divergence is claimed.
 */
export const ADD_OPTION_APPLY_UNWIRED = 'ADD_OPTION_APPLY_UNWIRED' as const;

/** Held reason: the proposed option id already exists as a node in the graph. */
export const OPTION_ID_COLLISION = 'OPTION_ID_COLLISION' as const;

/** Held reason: the current graph could not be read or hashed (not graph-like, or an unhashable analysis value). */
export const CURRENT_GRAPH_UNREADABLE = 'CURRENT_GRAPH_UNREADABLE' as const;

/**
 * Held reason: classification failed unexpectedly (e.g. a Proxy / throwing getter
 * on the input, or a malformed proposal). Fail-CLOSED — any uncaught error in the
 * body resolves to this held verdict so classifyProposal never throws.
 */
export const CLASSIFY_FAILED = 'CLASSIFY_FAILED' as const;

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
  /**
   * False when the current graph could not be hashed — either not graph-like, or
   * hashing threw (e.g. an unhashable analysis value). MUST be treated as
   * unreadable (held), NEVER as a matching `null` hash (which is the legitimate
   * hash of an empty graph). Guards against a fail-open stale gate.
   */
  readonly readable: boolean;
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
