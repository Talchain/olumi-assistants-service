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
  | 'proposal_base_moved';

export interface LapsedHold {
  readonly pending: PendingAction;
  readonly detail: HoldLapseDetail;
  /** Referee governing verdict when the GM assessment ran; null otherwise. */
  readonly governing: EditGmGoverningVerdict | null;
}

export interface HoldThreadThroughResult {
  /** Pendings to pass as `CommitMetadata.priorPendingActions`. */
  readonly threaded: readonly PendingAction[];
  /** Live consent holds genuinely invalidated by THIS mutation. */
  readonly lapsed: readonly LapsedHold[];
  /** Deterministic lapse sentence (first lapsed hold; F-HELD 2b precedent:
   *  one sentence even if several lapse at once). Null when none lapsed. */
  readonly notice: string | null;
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
            detail: 'held_batch_invalid_post_mutation',
            governing: assessment.governing,
          });
        }
        continue;
      }
    }
    // Generic apply proposal, payload-less GM hold (decline posture), or a
    // hash-pinned concept offer: the confirm/resume path is gated on the
    // emit-time hash by design, so the mutation genuinely invalidates it.
    lapsed.push({ pending: pa, detail: 'proposal_base_moved', governing: null });
  }
  const notice = lapsed.length > 0 ? buildHoldMutationLapseNotice(lapsed[0]!.pending) : null;
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
