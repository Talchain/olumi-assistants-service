/**
 * ⭐ S-D — THE ONE LIFECYCLE: a held proposal stays held until it is approved or declined; it is never silently
 * expired (design §5; Paul 7 Oct; D-08).
 *
 * MEASURED (D-08, prod scenario 6582edbc; Codex-confirmed on the design): the Agent row carried a product hold by the
 * conventional survival rule, which counts ROWS — a turn whose inner row carries the hold and whose answer row carries
 * it again spends two of its four turns — and read only the survivors, so the lapse that rule reports was never said.
 * Approving another held change then moved the model and the hash rule dropped every other hold, also unsaid (that
 * writer now threads holds through, `turn-executor.ts` GM held resume).
 *
 * Run once per Agent answer row, over the LATEST row's holds (the store's authority — never resurrected from an older
 * read, so a hold another request approved or declined meanwhile stays gone):
 *   1. approved by this request, or declined (typed decline / the Agent's withdraw) → gone, silent (the user did it);
 *   2. already in the model → gone, silent (applied elsewhere: fulfilment);
 *   3. past its stored lifetime → lapsed, SAID;
 *   4. the model moved → re-refereed by HOLD-WIPE's own rule (`threadHoldsThroughMutatingCommit`: the GM resume read,
 *      the add-factor recheck, the referee): sound → re-pinned; not → lapsed, SAID;
 *   5. carried with a refreshed lifetime ({@link HELD_PROPOSAL_TURN_BUDGET} rows, {@link PROPOSAL_IDLE_TTL_MS} idle).
 * And a hold this turn FOUND that is no longer on the latest row, for none of the reasons in 1–2, is SAID as no
 * longer waiting — never put back (Codex P1 on the design: resurrecting it could undo another request's decline).
 *
 * Why a long life is safe on this lane: a held proposal is approvable ONLY by its exact card (`confirmHeld`), never by
 * a bare "yes"; the conventional bare-confirm sees an extended hold only within its original consent window
 * (`deterministic-short-confirm.ts`); and every confirm re-checks the pin and re-referees the batch.
 */
import { GM_HELD_UNTIL_DECIDED_KEY } from '../../handlers/edit-graph-referee-gate.js';
import { threadHoldsThroughMutatingCommit } from '../../handlers/hold-thread-through.js';
import { isPendingActionExpired, type PendingAction } from '../../session/pending-action.js';
import { heldOperationsOf, isProductHold } from './record.js';
import type { HeldLapseReason } from './reply.js';

/** The idle backstop: a held proposal nobody has touched for a day lapses — said, never silent. */
export const PROPOSAL_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * The rows a held proposal survives between two Agent answers (canvas edits commit rows too, and each spends one).
 * Refreshed on every Agent answer row; the conventional bare-confirm never reads it as consent time (see above).
 */
export const HELD_PROPOSAL_TURN_BUDGET = 24;

export interface HeldLapse { readonly hold: PendingAction; readonly reason: HeldLapseReason }

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every node and every link the batch adds is already in the model (it was applied, here or elsewhere). */
export function fulfilledIn(hold: PendingAction, graph: unknown): boolean {
  if (!isRec(graph)) return false;
  const nodes = Array.isArray(graph['nodes']) ? (graph['nodes'] as unknown[]).filter(isRec) : [];
  const edges = Array.isArray(graph['edges']) ? (graph['edges'] as unknown[]).filter(isRec) : [];
  const adds = heldOperationsOf(hold).filter((o) => o.op === 'add_node' || o.op === 'add_edge');
  if (adds.length === 0) return false;
  return adds.every((o) => {
    if (o.op === 'add_node') return nodes.some((n) => n['id'] === o.path);
    const [from, to] = o.path.split('::');
    return edges.some((e) => e['from'] === from && e['to'] === to);
  });
}

/** The same hold with a fresh lifetime. The pin is never touched here (only a re-referee re-pins). */
export function refreshedHold(hold: PendingAction, nowMs: number): PendingAction {
  const action = hold.action as Extract<PendingAction['action'], { kind: 'apply_proposed_change' }>;
  return {
    ...hold,
    // Marked, so the conventional bare-confirm keeps consent at the original window (`GM_HELD_UNTIL_DECIDED_KEY`).
    action: { ...action, inline_patch: { ...action.inline_patch, [GM_HELD_UNTIL_DECIDED_KEY]: true } },
    expires_at_turn_count: HELD_PROPOSAL_TURN_BUDGET,
    expires_at_iso: new Date(nowMs + PROPOSAL_IDLE_TTL_MS).toISOString(),
  };
}

export interface ReconcileInput {
  /** The product holds as this turn FOUND them (read before any inner row). Used only to SAY what went. */
  readonly atStart: readonly PendingAction[];
  /** The pendings on the LATEST row, read at the END of this turn: the authority. */
  readonly latest: readonly PendingAction[];
  /** Held proposals this request's own door applied. */
  readonly approved: ReadonlySet<string>;
  /** Held proposals the user declined (typed decline) or the Agent withdrew on their words, this turn. */
  readonly declined: ReadonlySet<string>;
  readonly graph: unknown;
  readonly graphHash: string | undefined;
  readonly scenarioId: string;
  readonly requestId: string;
  readonly nowMs: number;
}

/** The product holds this answer row carries (latest-row order), and the ones that went without the user (to be said). */
export function reconcileHeldProposals(input: ReconcileInput): { carried: PendingAction[]; lapsed: HeldLapse[] } {
  const lapsed: HeldLapse[] = [];
  const latestHolds = input.latest.filter((pa) => isProductHold(pa) && pa.scenario_id === input.scenarioId);
  const live: PendingAction[] = [];
  for (const hold of latestHolds) {
    if (input.approved.has(hold.chip_id) || input.declined.has(hold.chip_id)) continue;
    if (fulfilledIn(hold, input.graph)) continue;
    if (isPendingActionExpired(hold, input.nowMs)) { lapsed.push({ hold, reason: 'idle' }); continue; }
    live.push(hold);
  }
  // An unknown model judges nothing: carried as it stands (fail toward preservation, the thread-through's own rule).
  const thread = input.graphHash === undefined
    ? { threaded: live, lapsed: [] as const }
    : threadHoldsThroughMutatingCommit({ priorPendingActions: live, graphAfterCommit: input.graph, graphHashAfterCommit: input.graphHash,
      appliedOperations: null, nowMs: input.nowMs, scenarioId: input.scenarioId, turnId: input.requestId, requestId: input.requestId });
  for (const l of thread.lapsed) {
    if (l.detail !== 'fulfilled_by_this_mutation') lapsed.push({ hold: l.pending, reason: 'model_changed' });
  }
  const onLatest = new Set(latestHolds.map((h) => h.chip_id));
  for (const hold of input.atStart) {
    if (!isProductHold(hold) || hold.scenario_id !== input.scenarioId || onLatest.has(hold.chip_id)) continue;
    if (input.approved.has(hold.chip_id) || input.declined.has(hold.chip_id) || fulfilledIn(hold, input.graph)) continue;
    lapsed.push({ hold, reason: 'gone' });
  }
  return { carried: thread.threaded.map((h) => refreshedHold(h, input.nowMs)), lapsed };
}
