/**
 * Track 3 — Slice 4: held-verdict → PendingAction projection + idempotency.
 *
 * A held mutation must surface as a PendingAction-shaped artefact (never vanish —
 * the no-silent-outcome rule). Track 3 provides a PURE projector shaped onto the
 * EXISTING `apply_proposed_change` PendingActionAction variant, WITHOUT importing
 * `session/pending-action.ts` (a Track 2 collision file, Paul). Structural
 * compatibility with the real `PendingActionAction` union is proven at typecheck
 * by the projection test (type-level assignment) — a compile error if T2's shape
 * drifts. ACTUAL emission is the DEFERRED integration slice (Track 2 dependency):
 * this module only defines the contract, so `inline_patch` carries a redacted
 * deferred descriptor, not a real executable patch.
 *
 * Recovery posture (T4.0 §4): forward-only, no rollback store. `candidate_id` +
 * `base_graph_hash` make an applied change attributable; a re-presented already-
 * applied `candidate_id` resolves to PROPOSAL_ALREADY_APPLIED (idempotency).
 */
import { PROPOSAL_ALREADY_APPLIED } from './reason-codes.js';
import type { CandidateMutationEnvelope, MutationBlocker, RefereeVerdict } from './types.js';

/**
 * Local mirror of the `apply_proposed_change` (standard) PendingActionAction
 * variant. Assignable to the real union (proven at typecheck) — NOT imported at
 * runtime, keeping production zero-coupled to the Track 2 file.
 */
export interface HeldMutationPendingAction {
  readonly kind: 'apply_proposed_change';
  readonly proposal_ref: string;
  readonly inline_patch: Readonly<Record<string, unknown>>;
  readonly public_label: string;
  readonly public_message: string;
}

/**
 * Project a HELD verdict onto the pending-confirmation shape. Returns null for any
 * non-held verdict (would_apply / stale / rejected / clarify_required are not
 * pending confirmations). Copy is redacted and uses §3b-conservative held wording
 * — no "applied/updated/safe" language, no scientific claims, no raw values.
 */
export function projectHeldToPendingAction(v: RefereeVerdict): HeldMutationPendingAction | null {
  if (v.verdict !== 'held' || v.candidate_id === null) return null;
  return {
    kind: 'apply_proposed_change',
    proposal_ref: v.candidate_id,
    // Redacted deferred descriptor — the real executable patch is filled by the
    // integration slice (Track 2 dependency), never here.
    inline_patch: {
      handler_id: 'graph_management_deferred',
      candidate_kind: v.kind,
      mutation_class: v.mutation_class,
      blocker_code: v.blocker?.code ?? null,
      apply_wiring: 'deferred',
    },
    public_label: 'Review a proposed change',
    public_message: 'I can hold this change — applying it needs your confirmation.',
  };
}

/** A read-only view of candidate_ids already applied (supplied by the caller). */
export interface AppliedLedger {
  has(candidateId: string): boolean;
}

/** Build an AppliedLedger from any iterable of candidate_ids (test/deferred-wiring helper). */
export function appliedLedgerOf(ids: Iterable<string>): AppliedLedger {
  const s = new Set(ids);
  return { has: (id) => s.has(id) };
}

/**
 * Idempotency check: a re-presented already-applied `candidate_id` resolves to
 * PROPOSAL_ALREADY_APPLIED (no double mutation). Returns null when the candidate
 * has not been applied.
 */
export function idempotencyBlocker(candidateId: string, ledger: AppliedLedger): MutationBlocker | null {
  return ledger.has(candidateId)
    ? {
        code: PROPOSAL_ALREADY_APPLIED,
        readable: 'This candidate has already been applied; re-presenting it is a no-op.',
      }
    : null;
}

// ---------------------------------------------------------------------------
// §6.7 supersession — a newer candidate targeting the same entity supersedes
// the older held one. MODULE-LOCAL and PURE: no persistence, no store reads.
// The live wiring realises supersession by keying the held pending's public
// handle on `mutationTargetKey`, so the commit-time carry-forward's existing
// same-key supersession rule ("newer wins") retires the older held offer.
// ---------------------------------------------------------------------------

/**
 * Stable target key for a PARSED candidate envelope — the entity the mutation
 * touches. Two candidates with the same key compete for the same entity, so
 * only the newest may stay held (no stacked, contradictory holds).
 * Content-free: ids only, never labels/values.
 */
export function mutationTargetKey(env: CandidateMutationEnvelope): string {
  switch (env.kind) {
    case 'add_node':
      return `node:${env.payload.node.id}`;
    case 'rename_node':
    case 'update_node_field':
    case 'remove_node':
      return `node:${env.payload.node_id}`;
    case 'add_option':
      return `node:${env.payload.option.id}`;
    case 'add_edge':
      return `edge:${env.payload.edge.from}->${env.payload.edge.to}`;
    case 'update_edge_field':
    case 'remove_edge':
      return `edge:${env.payload.from_node}->${env.payload.to_node}`;
    case 'flag_uncertainty':
    case 'clarification':
      return `ref:${env.payload.target_ref}`;
    default: {
      const _never: never = env;
      return _never;
    }
  }
}

/**
 * §6.7 predicate: does `newer` supersede `older` in the held set?
 * True iff both target the same entity (same {@link mutationTargetKey}) and
 * the newer envelope is a DIFFERENT candidate (a re-presented identical
 * candidate_id is the idempotency path, not supersession).
 */
export function supersedesHeldCandidate(
  older: CandidateMutationEnvelope,
  newer: CandidateMutationEnvelope,
): boolean {
  return (
    older.candidate_id !== newer.candidate_id &&
    mutationTargetKey(older) === mutationTargetKey(newer)
  );
}

/**
 * Collapse a held-candidate list (oldest → newest order) to the surviving
 * set: for each target key only the NEWEST candidate remains. Order of the
 * survivors follows the input order of their final occurrence. Pure.
 */
export function collapseSupersededHeld(
  held: readonly CandidateMutationEnvelope[],
): readonly CandidateMutationEnvelope[] {
  const latestByKey = new Map<string, CandidateMutationEnvelope>();
  for (const env of held) {
    latestByKey.set(mutationTargetKey(env), env);
  }
  return [...latestByKey.values()];
}
