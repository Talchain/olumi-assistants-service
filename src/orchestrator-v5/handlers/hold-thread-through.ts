/**
 * HOLD-WIPE fix (task_2e1b8c87) — thread live consent holds through
 * graph-mutating dispatch commits; honest lapse on genuine invalidation.
 *
 * The F-HELD round-2 KNOWN RESIDUAL: the commit carry-forward (TTL, lapse
 * notice, chip suppression — commit.ts) runs only on commits that thread
 * `priorPendingActions`, and only the TurnExecutor `commitTurn` wrapper
 * did. Edit- and draft-classified turns commit via `dispatchEditGraph` /
 * `dispatchDraftGraph` with NO priors, so a live hold (a proposal awaiting
 * the user's explicit consent) was silently DESTROYED by any unrelated
 * edit or draft commit.
 *
 * Consent-first doctrine at a graph-mutating commit (this module):
 *
 *  (a) THREAD — a hold that is still structurally valid against the
 *      post-mutation graph carries forward. GM holds (lane 34, executable
 *      payload) are VALIDATED, not assumed: the batch is re-refereed
 *      against the new graph (`assessHeldBatchAgainstGraph`) and, on pass,
 *      re-pinned to the new graph hash so the carry-forward's hash rule
 *      keeps it alive. Re-pinning is safe because the confirm-time resume
 *      re-referees the batch against the live graph (with the resume
 *      turn's real freshness) before any apply — a threaded hold can never
 *      execute unreviewed.
 *  (b) HONEST LAPSE — a hold genuinely invalidated by the mutation (its
 *      batch no longer referees cleanly; or its confirm path is hash-gated
 *      against the emit-time base, as for generic `apply_proposed_change`
 *      proposals and `proposed_concept` offers, which a moved graph
 *      invalidates by design) is EXCLUDED from the threaded priors and
 *      surfaced: a deterministic one-sentence notice naming what was held
 *      and why it lapsed (appended to the committed response so stored
 *      copy == wire copy) plus redacted `v5.pending_action.invalidated`
 *      telemetry. Never a silent wipe.
 *  (c) FULFILMENT, no notice (adversarial round-3 concern 1) — a hold whose
 *      change THIS turn's mutation itself delivered (the user's edit adds
 *      the very concept a `proposed_concept` offer proposed; the user
 *      applies a GM hold's batch by hand) is retired like a lapse (it is
 *      spent — carrying it forward would re-offer something already in the
 *      model) but the "has lapsed" sentence is SUPPRESSED: telling the user
 *      their held proposal lapsed on the very turn they fulfilled it is a
 *      false claim. Detection is conservative — the hold's target entities
 *      + operation kinds must be satisfied by this turn's APPLIED mutation
 *      (per-op comparison on the edit path; post-mutation end-state where
 *      the whole graph is the mutation, i.e. the draft path, or where the
 *      failing op class has a cheap end-state oracle: add/remove). Generic
 *      apply proposals keep their notice — their `inline_patch` speaks the
 *      handler vocabulary, not patch ops, so fulfilment cannot be compared
 *      without guessing; a redundant notice beats a wrongly-suppressed one.
 *      The retirement stays observable via the same frozen telemetry event
 *      with `detail: 'fulfilled_by_this_mutation'`.
 *
 * Non-confirmation-expecting pendings (run_analysis / what_would_flip
 * suggestion offers, set_factor_value / edit_graph_add_risk clarification
 * continuations) pass through UNCHANGED: their graph-hash invalidation on
 * a moved graph is the designed lifecycle, owned by the carry-forward in
 * commit.ts (same treatment as the TurnExecutor path).
 *
 * Pure decision core (`threadHoldsThroughMutatingCommit`) + a small emit
 * helper; the dispatchers append the notice and pass `threaded` as
 * `CommitMetadata.priorPendingActions`. TTL decrement stays owned by the
 * commit carry-forward (single decrement site preserved).
 */

import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import {
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  isPendingActionExpired,
  type PendingAction,
} from '../session/pending-action.js';
import { readGmHeldResume } from './gm-held-execute.js';
import {
  assessHeldBatchAgainstGraph,
  type EditGmGoverningVerdict,
} from './edit-graph-referee-gate.js';
import {
  parseEdgeTargetPath,
  type EditPatchOperationLike,
} from '../graph-management/adapters/edit-graph-producer.js';

export interface HoldThreadThroughInput {
  /** The prior turn's pendings (`most_recent_pending_actions`, unfiltered). */
  readonly priorPendingActions: readonly PendingAction[];
  /** The graph this commit persists (post-mutation authority); null when the
   *  turn writes no graph. */
  readonly graphAfterCommit: unknown;
  /** Like-for-like analysis-affecting hash of `graphAfterCommit`. Null when
   *  the turn writes no graph OR the hash could not be derived — both thread
   *  every prior through unchanged (fail toward preservation; the commit
   *  carry-forward's both-hashes-known rule is equally inert then). */
  readonly graphHashAfterCommit: string | null;
  /** This turn's APPLIED patch operations (edit path). Null/omitted when the
   *  mutation has no per-operation record — the draft path, where the whole
   *  NEW graph IS the mutation and fulfilment detection falls back to the
   *  post-mutation end state. Fulfilment input only; never re-applied. */
  readonly appliedOperations?: readonly EditPatchOperationLike[] | null;
  readonly nowMs: number;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
}

export type HoldLapseDetail =
  /** GM hold whose executable batch failed the post-mutation re-referee. */
  | 'held_batch_invalid_post_mutation'
  /** Hash-gated proposal (generic apply / concept offer) whose emit-time
   *  base moved — its confirm path would refuse it by design. */
  | 'proposal_base_moved'
  /** THIS turn's mutation itself delivered the held change (module doc (c)):
   *  the hold retires spent, telemetry records it, the "has lapsed" notice
   *  is suppressed — it would be a false claim on the fulfilling turn. */
  | 'fulfilled_by_this_mutation';

export interface LapsedHold {
  readonly pending: PendingAction;
  readonly detail: HoldLapseDetail;
  /** Referee governing verdict when the GM assessment ran; null otherwise. */
  readonly governing: EditGmGoverningVerdict | null;
}

export interface HoldThreadThroughResult {
  /** Pendings to pass as `CommitMetadata.priorPendingActions`. */
  readonly threaded: readonly PendingAction[];
  /** Live consent holds retired by THIS mutation (genuinely invalidated OR
   *  fulfilled by it — see `detail`). */
  readonly lapsed: readonly LapsedHold[];
  /** Deterministic lapse sentence (first NON-fulfilled lapsed hold; F-HELD
   *  2b precedent: one sentence even if several lapse at once). Null when
   *  none lapsed, or when every lapse was fulfilment (module doc (c)). */
  readonly notice: string | null;
}

// ---------------------------------------------------------------------------
// Fulfilment detection (module doc (c)) — conservative, pure, total.
// ---------------------------------------------------------------------------

/** Trim + collapse whitespace + lowercase; null for non-strings/blank. */
function normLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const norm = v.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm.length > 0 ? norm : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function graphList(graph: unknown, key: 'nodes' | 'edges'): readonly Record<string, unknown>[] {
  const list = asRecord(graph)[key];
  if (!Array.isArray(list)) return [];
  return list.map(asRecord);
}

function graphHasNodeId(graph: unknown, id: string): boolean {
  return graphList(graph, 'nodes').some((n) => n.id === id);
}

function graphHasNodeLabelled(graph: unknown, targetLabel: string): boolean {
  return graphList(graph, 'nodes').some((n) => {
    const label = normLabel(n.label);
    return label !== null && (label === targetLabel || label.includes(targetLabel));
  });
}

/**
 * True when THIS turn's mutation delivered the offered concept. Edit path
 * (per-op record available): ONLY an applied `add_node` carrying the concept
 * counts — a label that merely pre-exists elsewhere in the graph must not
 * suppress the notice. Draft path (no per-op record): the whole NEW graph IS
 * the mutation, so presence of the concept in it is exactly "this turn's
 * mutation contains it".
 */
function conceptFulfilledByThisMutation(
  concept: string,
  appliedOps: readonly EditPatchOperationLike[] | null,
  graphAfterCommit: unknown,
): boolean {
  const target = normLabel(concept);
  if (target === null) return false;
  if (appliedOps !== null) {
    return appliedOps.some((op) => {
      if (op.op !== 'add_node') return false;
      const label = normLabel(asRecord(op.value).label);
      return label !== null && (label === target || label.includes(target));
    });
  }
  return graphHasNodeLabelled(graphAfterCommit, target);
}

/**
 * "Same operation kind + same target" comparison between a HELD op and an
 * APPLIED op (the reviewer's fulfilment formula). `add_node` also matches on
 * the label — the user's own add mints a different node id than the hold did.
 */
function appliedOpMatchesHeldOp(
  held: EditPatchOperationLike,
  applied: EditPatchOperationLike,
): boolean {
  if (applied.op !== held.op) return false;
  switch (held.op) {
    case 'add_node': {
      if (applied.path === held.path) return true;
      const heldLabel = normLabel(asRecord(held.value).label);
      return heldLabel !== null && heldLabel === normLabel(asRecord(applied.value).label);
    }
    case 'remove_node':
    case 'update_node':
      return applied.path === held.path;
    case 'add_edge': {
      const hv = asRecord(held.value);
      const av = asRecord(applied.value);
      return (
        typeof hv.from === 'string' && hv.from.length > 0 && hv.from === av.from &&
        typeof hv.to === 'string' && hv.to.length > 0 && hv.to === av.to
      );
    }
    case 'remove_edge':
    case 'update_edge': {
      const ht = parseEdgeTargetPath(held.path);
      const at = parseEdgeTargetPath(applied.path);
      return ht !== null && at !== null && ht.from === at.from && ht.to === at.to;
    }
    default:
      return false;
  }
}

/**
 * End-state oracle for ONE held op against the post-mutation graph — the
 * "already-applied / no-op class" the re-referee's failure encodes
 * (ENTITY_ID_COLLISION on an add, ENTITY_NOT_FOUND on a remove), checked
 * directly on the graph instead of via blocker codes so a coincidental code
 * (e.g. an id collision with an UNRELATED node) cannot suppress the notice
 * on its own for removes, and adds also accept a label match. Field updates
 * have no cheap end-state oracle (the target value lives behind per-field
 * semantics) — applied-op matching is their only fulfilment signal.
 */
function heldOpEndStateSatisfied(
  held: EditPatchOperationLike,
  graphAfterCommit: unknown,
): boolean {
  switch (held.op) {
    case 'add_node': {
      if (graphHasNodeId(graphAfterCommit, held.path)) return true;
      const label = normLabel(asRecord(held.value).label);
      return label !== null && graphHasNodeLabelled(graphAfterCommit, label);
    }
    case 'remove_node':
      return !graphHasNodeId(graphAfterCommit, held.path);
    case 'remove_edge': {
      const t = parseEdgeTargetPath(held.path);
      return (
        t !== null &&
        !graphList(graphAfterCommit, 'edges').some((e) => e.from === t.from && e.to === t.to)
      );
    }
    default:
      return false;
  }
}

/** Whole-batch fulfilment: EVERY held op satisfied (a partially-delivered
 *  hold still deserves the honest notice — part of it is NOT in). */
function heldBatchFulfilledByThisMutation(
  heldOps: readonly EditPatchOperationLike[],
  appliedOps: readonly EditPatchOperationLike[] | null,
  graphAfterCommit: unknown,
): boolean {
  if (heldOps.length === 0) return false;
  return heldOps.every(
    (held) =>
      (appliedOps !== null && appliedOps.some((a) => appliedOpMatchesHeldOp(held, a))) ||
      heldOpEndStateSatisfied(held, graphAfterCommit),
  );
}

/**
 * Pure decision core — see the module doc for the doctrine. Total: never
 * throws (the GM assessment fails closed to invalid inside the gate module).
 */
export function threadHoldsThroughMutatingCommit(
  input: HoldThreadThroughInput,
): HoldThreadThroughResult {
  const priors = input.priorPendingActions;
  const newHash = input.graphHashAfterCommit;
  if (priors.length === 0 || newHash === null) {
    return { threaded: priors, lapsed: [], notice: null };
  }
  const appliedOps = input.appliedOperations ?? null;
  const threaded: PendingAction[] = [];
  const lapsed: LapsedHold[] = [];
  for (const pa of priors) {
    const pin = pa.preconditions.graph_hash;
    // Unpinned, or pinned to the very graph this commit persists (an edit
    // that does not move the analysis-affecting hash): nothing invalidated.
    if (typeof pin !== 'string' || pin.length === 0 || pin === newHash) {
      threaded.push(pa);
      continue;
    }
    // Already dead by wall/turn TTL: thread untouched — expiry bookkeeping
    // (and its own honest outcomes) belong to the commit carry-forward.
    if (isPendingActionExpired(pa, input.nowMs)) {
      threaded.push(pa);
      continue;
    }
    // Not a consent hold: the carry-forward's hash rule owns invalidation
    // (designed suggestion/clarification lifecycle, TurnExecutor parity).
    if (!CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind)) {
      threaded.push(pa);
      continue;
    }
    if (pa.action.kind === 'apply_proposed_change') {
      const read = readGmHeldResume(pa);
      if (read.kind === 'ok') {
        // GM hold with an executable batch: VALIDATE against the new graph.
        const assessment = assessHeldBatchAgainstGraph({
          operations: read.operations,
          currentGraph: input.graphAfterCommit,
          currentGraphHash: newHash,
          scenarioId: input.scenarioId,
          turnId: input.turnId,
          requestId: input.requestId,
        });
        if (assessment.valid) {
          threaded.push({
            ...pa,
            preconditions: { ...pa.preconditions, graph_hash: newHash },
          });
        } else {
          lapsed.push({
            pending: pa,
            // Module doc (c): a batch THIS turn's mutation already delivered
            // retires as fulfilment (notice suppressed), not as a lapse the
            // user must re-consent to. The governing verdict stays reported
            // honestly either way.
            detail: heldBatchFulfilledByThisMutation(
              read.operations,
              appliedOps,
              input.graphAfterCommit,
            )
              ? 'fulfilled_by_this_mutation'
              : 'held_batch_invalid_post_mutation',
            governing: assessment.governing,
          });
        }
        continue;
      }
    }
    // Generic apply proposal, payload-less GM hold (decline posture), or a
    // hash-pinned concept offer: the confirm/resume path is gated on the
    // emit-time hash by design, so the mutation genuinely invalidates it.
    // Module doc (c): a concept offer this turn's mutation itself delivered
    // retires as fulfilment. Generic apply proposals / payload-less GM holds
    // deliberately keep the notice — no comparable op record exists.
    const fulfilled =
      pa.action.kind === 'proposed_concept' &&
      conceptFulfilledByThisMutation(pa.action.concept, appliedOps, input.graphAfterCommit);
    lapsed.push({
      pending: pa,
      detail: fulfilled ? 'fulfilled_by_this_mutation' : 'proposal_base_moved',
      governing: null,
    });
  }
  // One sentence, first NON-fulfilled lapse (F-HELD 2b precedent); all-
  // fulfilled retirements are notice-less by design (module doc (c)).
  const noticeworthy = lapsed.find((l) => l.detail !== 'fulfilled_by_this_mutation');
  const notice =
    noticeworthy !== undefined ? buildHoldMutationLapseNotice(noticeworthy.pending) : null;
  return { threaded, lapsed, notice };
}

/**
 * Deterministic one-sentence lapse notice for a hold invalidated by THIS
 * commit's graph mutation. Mirrors `buildHeldLapseNotice` (commit.ts,
 * F-HELD 2b) in shape and register — comma, not an em dash (the string is
 * appended near the egress seams and must satisfy house style directly) —
 * and additionally names WHY the hold lapsed, per the consent doctrine
 * ("expire it honestly: what was held and why"). Copy is swept against
 * `findSuccessClaimHit` / `findForbiddenPhraseHit` in
 * hold-thread-through.test.ts.
 */
export function buildHoldMutationLapseNotice(pa: PendingAction): string {
  const a = pa.action;
  if (a.kind === 'proposed_concept') {
    return `The suggestion to add '${a.concept}' has lapsed because the model changed, say the word if you still want it.`;
  }
  const label =
    a.kind === 'apply_proposed_change' &&
    typeof a.public_label === 'string' &&
    a.public_label.trim().length > 0
      ? a.public_label.trim()
      : null;
  return label !== null
    ? `The held change '${label}' has lapsed because the model changed, say the word if you still want it.`
    : 'A held change has lapsed because the model changed, say the word if you still want it.';
}

/**
 * Append a lapse notice to (possibly empty) assistant text — same joining
 * convention as the commit-seam TTL notice (blank line separator; the
 * notice IS the text when the base is blank).
 */
export function appendLapseNotice(
  baseText: string | null | undefined,
  notice: string,
): string {
  const base = typeof baseText === 'string' ? baseText : '';
  return base.trim().length > 0 ? `${base}\n\n${notice}` : notice;
}

/**
 * Redacted telemetry for every hold lapsed by a mutating commit — the
 * EXISTING frozen event name `v5.pending_action.invalidated` with its
 * documented reason vocabulary (`graph_hash_changed`,
 * session/pending-action.ts); `detail` + `site` attribute the new seam.
 * Counts/enums/ids only — never labels, messages or patch content.
 */
export function emitHoldLapseTelemetry(
  lapsed: readonly LapsedHold[],
  ctx: {
    readonly requestId: string;
    readonly scenarioId: string;
    readonly turnId: string;
    readonly site: 'edit_graph_dispatch' | 'draft_graph_dispatch';
  },
): void {
  for (const l of lapsed) {
    emit(TelemetryEvents.PendingActionInvalidated, {
      request_id: ctx.requestId,
      scenario_id: ctx.scenarioId,
      turn_id: ctx.turnId,
      reason: 'graph_hash_changed',
      detail: l.detail,
      kind: l.pending.action.kind,
      site: ctx.site,
      ...(l.governing !== null ? { governing: l.governing } : {}),
    });
  }
}
