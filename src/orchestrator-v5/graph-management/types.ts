/**
 * Track 3 — Graph Management Core: the `CandidateMutationEnvelope v1` wire
 * contract, verdict vocabulary, referee frame, and result types.
 *
 * ISOLATED CORE (off-path): nothing in live V5 imports this module. It restates
 * the T4.0 hand-off contract (Docs/t4/dual-model-typed-mutation-handoff-contract.md
 * §1–§3) as an executable, fail-closed Zod schema — one envelope = one reviewable
 * unit of change. `.strict()` everywhere: a model-invented field is REJECTED, never
 * silently dropped.
 *
 * Design deltas from the PR #300 spike (deliberate, per the plan + Paul's
 * corrections 2026-07-03):
 *  - a Zod WIRE envelope (10 kinds) + `rejected` verdict, vs #300's plain-TS
 *    `Proposal` (2 kinds, no `rejected`);
 *  - the stale gate consumes a frame-provided hash (`MutationFrame.currentGraphHash`)
 *    and NEVER re-derives it (anti-rederivation pin; Paul #1). Hence no import of
 *    any hash-derivation function anywhere in this module or the referee.
 */
import { z } from 'zod';
import type { MutationReasonCode } from './reason-codes.js';

// ============================================================================
// Kinds (v1 closed set — T4.0 §1)
// ============================================================================

export const CANDIDATE_KINDS = [
  'add_node',
  'add_edge',
  'update_node_field',
  'update_edge_field',
  'rename_node',
  'add_option',
  'remove_node',
  'remove_edge',
  'flag_uncertainty',
  'clarification',
] as const;

export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

// ============================================================================
// Verdicts (T4.0 §3) + the task's proposed/held/refused/applied mapping
// ============================================================================

/**
 * `would_apply` — safe to apply THIS turn against the frame's graph (the referee
 *   NEVER applies; application is the deferred handler path's exclusive right).
 * `held` — valid but not auto-appliable; MUST carry a blocker.
 * `stale` — generated against a graph that has since moved.
 * `rejected` — schema/integrity/safety failure (the task's "refused").
 * `clarify_required` — well-formed but non-mutating / ambiguous target.
 *
 * The task's lifecycle states map on: "proposed" = a submitted envelope (pre-verdict);
 * "applied" = post-apply state produced ONLY by the deferred wired handler path.
 */
export const MUTATION_VERDICTS = [
  'would_apply',
  'held',
  'stale',
  'rejected',
  'clarify_required',
] as const;

export type MutationVerdict = (typeof MUTATION_VERDICTS)[number];

/** Mechanical structural/tunable taxonomy (§6 doctrine PENDING → tunables stay held). */
export type MutationClass = 'structural' | 'tunable' | 'non_mutating';

export interface MutationBlocker {
  readonly code: MutationReasonCode;
  /** Human-readable, redacted (no raw payload values). */
  readonly readable: string;
}

// ============================================================================
// Per-kind payloads (all `.strict()` — model-invented fields REJECTED)
// ============================================================================

const NodeInput = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['goal', 'factor', 'outcome', 'decision', 'risk', 'action', 'option']),
    label: z.string().min(1),
  })
  .strict();

const EdgeInput = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

const AddOptionEdgeSpec = z
  .object({
    to_factor_id: z.string().min(1),
    strength: z.object({ mean: z.number(), std: z.number() }).strict().optional(),
    effect_direction: z.enum(['positive', 'negative']).optional(),
  })
  .strict();

const AddOptionInterventionSpec = z
  .object({
    value: z.number().optional(),
    raw_value: z.union([z.number(), z.string()]).optional(),
    unit: z.string().optional(),
    cap: z.number().optional(),
  })
  .strict();

/** Payload schema per kind. Kept minimal-but-strict; value-bearing pipeline-owned
 *  fields (sensitivity_score/elasticity/e-values/robustness) are excluded by
 *  construction and additionally screened by R4. */
const PAYLOAD_BY_KIND = {
  add_node: z.object({ node: NodeInput }).strict(),
  add_edge: z.object({ edge: EdgeInput }).strict(),
  update_node_field: z
    .object({
      node_id: z.string().min(1),
      field: z.string().min(1),
      from: z.unknown(),
      to: z.unknown(),
    })
    .strict(),
  update_edge_field: z
    .object({
      from_node: z.string().min(1),
      to_node: z.string().min(1),
      field: z.string().min(1),
      from: z.unknown(),
      to: z.unknown(),
    })
    .strict(),
  rename_node: z
    .object({
      node_id: z.string().min(1),
      from_label: z.string().optional(),
      to_label: z.string().min(1),
    })
    .strict(),
  add_option: z
    .object({
      option: z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          parent_decision_id: z.string().min(1).optional(),
          edges: z.array(AddOptionEdgeSpec),
          interventions: z.record(z.string(), AddOptionInterventionSpec).optional(),
        })
        .strict(),
    })
    .strict(),
  remove_node: z.object({ node_id: z.string().min(1), reason: z.string().min(1) }).strict(),
  remove_edge: z
    .object({
      from_node: z.string().min(1),
      to_node: z.string().min(1),
      reason: z.string().min(1),
    })
    .strict(),
  flag_uncertainty: z
    .object({ target_ref: z.string().min(1), question: z.string().min(1) })
    .strict(),
  clarification: z
    .object({ target_ref: z.string().min(1), question: z.string().min(1) })
    .strict(),
} as const;

// ============================================================================
// Provenance / identity (T4.0 §1)
// ============================================================================

const Provenance = z
  .object({
    source: z.enum(['dual_model_m2', 'edit_graph_llm', 'flip_proposal', 'user_direct']),
    evidence_pointer: z.string().min(1),
    rationale: z.string().optional(),
    model_id: z.string().optional(),
  })
  .strict();

const Identity = z
  .object({ scenario_id: z.string().min(1), turn_id: z.string().min(1) })
  .strict();

// ============================================================================
// The envelope (discriminated union on `kind`, each branch `.strict()`)
// ============================================================================

function envelopeBranch<K extends CandidateKind>(kind: K) {
  return z
    .object({
      envelope_version: z.literal(1),
      candidate_id: z.string().uuid(),
      kind: z.literal(kind),
      // base_graph_hash: null/absent/empty FORBIDDEN (stale gate is non-optional).
      base_graph_hash: z.string().min(1),
      payload: PAYLOAD_BY_KIND[kind],
      provenance: Provenance,
      identity: Identity,
    })
    .strict();
}

export const CandidateMutationEnvelopeV1 = z.discriminatedUnion('kind', [
  envelopeBranch('add_node'),
  envelopeBranch('add_edge'),
  envelopeBranch('update_node_field'),
  envelopeBranch('update_edge_field'),
  envelopeBranch('rename_node'),
  envelopeBranch('add_option'),
  envelopeBranch('remove_node'),
  envelopeBranch('remove_edge'),
  envelopeBranch('flag_uncertainty'),
  envelopeBranch('clarification'),
]);

export type CandidateMutationEnvelope = z.infer<typeof CandidateMutationEnvelopeV1>;

// ============================================================================
// Frame (already-resolved authorities — consumed, NEVER re-derived; Paul #1)
// ============================================================================

/** Freshness verdict vocabulary mirrored locally so the referee stays decoupled
 *  from the live freshness module. Values match `deriveAnalysisFreshness` EXACTLY
 *  (`'fresh' | 'stale' | 'unknown' | 'none'` — it never emits `'unconfirmed'`,
 *  which is a downstream Tier-0 wire remap). The frame gate trusts only `'fresh'`
 *  and `'none'`; every other value fails closed to `stale`, so an unexpected value
 *  is still handled safely. */
export type FrameFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

/**
 * The frame carries the analysis-affecting graph hash, freshness verdict, and
 * (diagnostic) canonical-analysis-state readiness — all resolved UPSTREAM. The
 * referee reads them; it never computes them. `graphReadable:false` means the
 * upstream could not resolve/hash the current graph → fail closed.
 */
export interface MutationFrame {
  readonly currentGraphHash: string | null;
  readonly graphReadable: boolean;
  readonly freshness: FrameFreshness;
  /** CAS structural-readiness passthrough for diagnostics/handoff (does not gate here). */
  readonly canonicalReady?: boolean;
}

// ============================================================================
// Referee result
// ============================================================================

export interface RefereeVerdict {
  readonly verdict: MutationVerdict;
  /** null when R1 rejected before a valid kind was established. */
  readonly kind: CandidateKind | null;
  /** null when the raw candidate_id was unreadable. */
  readonly candidate_id: string | null;
  /** Structural/tunable/non-mutating label (mechanical taxonomy). null on R1 reject. */
  readonly mutation_class: MutationClass | null;
  /** True iff the envelope's base_graph_hash equals the frame's current hash. */
  readonly base_hash_match: boolean;
  readonly blocker?: MutationBlocker;
  /** In-memory candidate graph (NEVER persisted). Present only when one was built. */
  readonly candidate?: Record<string, unknown>;
}
