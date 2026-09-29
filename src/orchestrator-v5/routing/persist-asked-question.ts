/**
 * ⭐⭐ ROADMAP 2.1353 — EVERY EXIT THAT SOLICITS A REPLY PERSISTS THE QUESTION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT CLASS, and it is a class rather than an incident.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ROADMAP 2.1352 (CEE #1213) fixed one instance, witnessed live:
 *
 *   ASKED    "'Two Developers' has no effect value on Development throughput
 *             yet. Give me a number from 0 … to 1 — 0.6, say."
 *   REPLIED  "0.6"
 *   ANSWERED "I need to know which factor and which option it belongs to
 *             before setting anything."
 *
 * It had named the cell in its own question, one turn earlier. The mechanism
 * was that the intercept returned via `sendFinalised200` — an early return that
 * never reaches `commitDirectAnswer` — so NO TURN ROW WAS WRITTEN, and the next
 * turn's model received neither the question in its conversation history nor a
 * pending action naming the cell.
 *
 * That lane then ENUMERATED all 23 `sendFinalised200` exits instead of grepping
 * for the one it had been handed, and found its instance was ONE OF SIX. The
 * other five are 2.1353: two edit-clarify intercepts, the repair-value ask, the
 * option-effect ask, and — on a different mechanism — the chip-click recoverable
 * exit (which does reach a commit path, but gates it on a predicate that answers
 * a different question; see `chip-click-dispatch.ts`).
 *
 * ⚠ THE MACHINERY WAS NEVER MISSING. `clarify_v2` commits its ask properly, and
 * the A4 add-risk clarify persists its label. The Stage-4A intercepts inherited
 * the no-commit posture of the RECOVERY and DECLINE exits sitting beside them,
 * rather than the commit-with-a-referent posture of the clarify paths they
 * functionally are. The `pending_actions` migration's own "Why", written in MAY,
 * describes this exact defect — fixed once for the chip path, reintroduced by
 * intercepts that never commit at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SHARED FUNCTION AND NOT FOUR COPIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The FAIL-CLOSED POLICY below is subtle, ordered, and identical at every site;
 * the REFERENT is different at every site. Four hand-copied 60-line blocks would
 * be precisely the hand-maintained mirror this estate keeps paying for (CLAUDE.md
 * trap 12) — a later correction to the ordering would land in one of them and
 * read green in the other three. So the policy lives here once and each caller
 * derives its own referent and hands it in.
 *
 * ⚠ 2.1352's own emit site is deliberately NOT converted to this helper. It is
 * merged, reviewed and deployed code; rewriting it would enlarge this diff and
 * put a just-reviewed path back through review for no user-visible gain. That
 * leaves TWO spellings of one policy in the tree, which is a real (small) drift
 * risk and is recorded here rather than left for someone to discover: converging
 * it is a follow-on, and this file is the target shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FAIL-CLOSED ORDERING, stated as a priority rather than a rule
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   LOSING THE USER'S PROPOSAL  ≫  LOSING THE MEMORY  ≫  LOSING THE REFERENT.
 *
 * 1. **An unreadable OR LOSSILY-READABLE prior-pending state aborts the whole
 *    commit.** These are
 *    NON-CONSUMING turns, and `commit.ts`'s carry-forward is the only thing that
 *    keeps a still-live proposal alive: a commit that omitted the survivors would
 *    WIPE it. So a failed read means no commit at all, and the turn degrades to
 *    exactly today's behaviour — the user still gets their answer, they simply do
 *    not get the memory.
 *
 * 2. **A missing referent does NOT abort the commit — it only withholds the
 *    pending.** This is the one place this helper's policy differs from 2.1352's
 *    inline block, and the difference is deliberate. At 2.1352's site the cell is
 *    always derivable when the intercept fires, so the split never mattered; at
 *    the edit-clarify sites the referent is routinely UNAVAILABLE on the live
 *    wire (the offered targets come from `extensions.graphState`, and the UI
 *    sends a turn, not a graph). Refusing to commit for want of a referent would
 *    discard the entire repair on exactly the turns that carry the defect — and
 *    the durable `user_message` / `assistant_message` row is the larger half of
 *    the fix in any case, because it is what the model's conversation history
 *    actually reads.
 *
 * 3. **A commit failure is logged and swallowed.** Same reasoning as 2.1352: the
 *    answer still ships.
 *
 * ⚠ NO GRAPH IS WRITTEN AND NO `graph_hash` IS ADVERTISED. Every caller is a
 * non-mutating exit, so `metadata.graph` is omitted and `metadata.graph_hash` is
 * left undefined — which switches OFF carry-forward rule 4 (graph-hash
 * invalidation) for this commit. That is correct and load-bearing: this turn did
 * not change the graph, so it must not be the turn that invalidates somebody
 * else's live pending.
 *
 * ⚠ AND NOTE THE ONE UNAVOIDABLE SIDE EFFECT, because it is a real behaviour
 * change and not a no-op: committing a turn DECREMENTS `expires_at_turn_count`
 * on every carried pending (`computeSurvivingPriorPendingsDetailed`, rule 5).
 * These turns previously advanced no TTL at all. That is the CORRECT reading —
 * a turn genuinely happened — but it means a pending with one turn left now
 * lapses here rather than surviving invisibly, and the lapse notice fires
 * accordingly. Stated so the next lane reading a lapse on one of these turns
 * knows it is intended.
 *
 * ⚠ NO RESUMER IS ADDED BY THIS FILE, and none should be added casually. A wider
 * bare-numeric gate was tried and reverted at `route-v2.ts` before; the ruling is
 * refuse-by-shape, not by pending-liveness (CLAUDE.md trap 22f: four consecutive
 * rounds were lost on one such predicate, each fixing one direction and reopening
 * the other). Deterministic binding is a follow-on, and it can now be built
 * against recorded state instead of re-derived from prose.
 */

import { randomUUID } from 'node:crypto';

import type { OlumiResponse } from '@talchain/schemas/boundary';

import { commitDirectAnswer } from '../commit.js';
import { loadMostRecentPendingActionsIntegrityStrict } from '../build-turn-context.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
  type PendingActionAction,
} from '../session/pending-action.js';
import { log } from '../../utils/telemetry.js';

export interface PersistAskedQuestionInput {
  /** The composed reply this turn is about to ship. */
  readonly response: OlumiResponse;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  /** The user's verbatim message — the `userMessage` write field. */
  readonly userMessage: string;
  /** Request hash for the turn row, computed by the caller from its ingress. */
  readonly requestHash: string;
  /** Wall time this turn started, for the row's `duration_ms`. */
  readonly startedAtMs: number;
  /**
   * A STABLE synthetic chip handle for the armed pending, or `null` to arm
   * none. Stable rather than random on purpose: key-level supersession in
   * `commit.ts`'s carry-forward then RETIRES a previous ask from the same site
   * instead of accumulating one slot per re-ask, and the column is capped at 3.
   */
  readonly pendingChipId: string | null;
  /**
   * The referent, already derived from the SAME source the composer used, or
   * `null` when this turn could not name one. `null` withholds the pending and
   * still commits the turn — see the ordering above.
   */
  readonly pendingAction: PendingActionAction | null;
  /**
   * The emit-time analysis-affecting graph hash, pinned into the pending's
   * preconditions, or `null` when no graph was available to hash. A referent
   * with no hash is not armed: a resume could never tell whether the cells it
   * names still exist, which is the state 2.1352 fails closed on.
   */
  readonly graphHash: string | null;
  /** Site name for the log lines — e.g. `'vague-edit clarify'`. */
  readonly siteLabel: string;
}

export interface PersistAskedQuestionResult {
  /**
   * The response to SHIP. The commit chokepoint may APPEND to the response it
   * was handed (a pending-lapse notice, for one), so callers must ship THIS
   * object rather than the one they passed in — otherwise the wire and the
   * persisted row disagree about what the user was told.
   */
  readonly response: OlumiResponse;
  /** True only when a turn row actually landed. Diagnostic; never a gate. */
  readonly committed: boolean;
  /** True only when a pending referent rode along with it. */
  readonly armedPending: boolean;
}

/**
 * Commit the turn on which the product asked a question, carrying the referent
 * a reply can bind to. Never throws: every failure degrades to the pre-2.1353
 * behaviour and is logged.
 */
export async function persistAskedQuestion(
  input: PersistAskedQuestionInput,
): Promise<PersistAskedQuestionResult> {
  const unchanged: PersistAskedQuestionResult = {
    response: input.response,
    committed: false,
    armedPending: false,
  };

  // STEP 1 — the prior pendings, read FIRST and separately, because a failure
  // here must abort the commit rather than proceed without them. See the
  // ordering note in the file header: losing the user's live proposal is the
  // one outcome worse than losing this question.
  //
  // ⚠ ROUND 2 — THE LOSSLESS VARIANT, NOT THE TOLERANT-PARSE ONE. The claim
  // "a failed read means no commit at all" was true only over the THROW half of
  // this read's domain. `loadMostRecentPendingActionsStrict` propagates a
  // TRANSPORT failure but still returns the SURVIVORS of a partially-corrupt
  // row (`supabase-store.ts` :2305-2347 drop unparseable / cross-scenario
  // entries, emit `PendingActionsReadDegraded`, and return what is left) — so a
  // truncated list would be committed as the newest authoritative row and the
  // dropped entries would be gone with no abort and no notice. This caller
  // BECOMES the newest turn, which is precisely the case
  // `loadMostRecentPendingActionsIntegrityStrict` is documented for
  // (`build-turn-context.ts` :1533-1554): it passes `{ validation: 'strict' }`
  // so a lossy parse throws and lands in the fail-closed branch below.
  let priorPendings: readonly PendingAction[];
  try {
    priorPendings = await loadMostRecentPendingActionsIntegrityStrict(
      input.scenarioId,
      input.requestId,
    );
  } catch (err) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        site: input.siteLabel,
        err: describeError(err),
      },
      'V5 asked-question persistence — prior-pending read failed; not committing, because a commit without carry-forward would wipe live proposals',
    );
    return unchanged;
  }

  // STEP 2 — the referent, if this site could name one AND the graph could be
  // hashed. Either absence withholds the PENDING only; the commit proceeds.
  const canArm =
    input.pendingAction !== null && input.pendingChipId !== null && input.graphHash !== null;
  let pendings: readonly PendingAction[] = [];
  if (canArm) {
    const askedAtIso = new Date().toISOString();
    pendings = [
      {
        id: randomUUID(),
        scenario_id: input.scenarioId,
        chip_id: input.pendingChipId as string,
        action: input.pendingAction as PendingActionAction,
        preconditions: { graph_hash: input.graphHash as string },
        expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
        expires_at_iso: new Date(
          Date.parse(askedAtIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
        ).toISOString(),
        emitted_at_iso: askedAtIso,
      },
    ];
  } else {
    log.info(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        site: input.siteLabel,
        referent_resolved: input.pendingAction !== null,
        graph_hash_available: input.graphHash !== null,
      },
      'V5 asked-question persistence — no referent or no graph hash; committing the turn without a pending (fail-closed on the referent only)',
    );
  }

  // STEP 3 — the commit. An explicit (possibly empty) `pending_actions` list is
  // passed on purpose: leaving it `undefined` makes the chokepoint DERIVE
  // pendings from this turn's chips. It would derive none today — every chip on
  // these paths is a text-prompt chip with no `action_type`, which
  // `mapChipKind` filters out — but relying on that would make this site's
  // persistence depend on a chip-shape decision made in a composer.
  try {
    const committed = await commitDirectAnswer(input.response, {
      scenario_id: input.scenarioId,
      turn_id: input.turnId,
      turn_class: 'clarify',
      handler_id: null,
      request_hash: input.requestHash,
      // Deterministic intercept — no LLM call is made on any of these paths.
      llm_calls_used: 0,
      duration_ms: Date.now() - input.startedAtMs,
      handler_facts: [],
      pending_actions: pendings,
      priorPendingActions: priorPendings,
      // These paths never build a turn context, so they derive no coaching
      // state. The most-recent read filters non-null, so a null here never
      // resets the prior snapshot.
      coaching_state: null,
      userMessage: input.userMessage,
    });
    return {
      response: committed.response,
      committed: true,
      armedPending: pendings.length > 0,
    };
  } catch (err) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        site: input.siteLabel,
        err: describeError(err),
      },
      'V5 asked-question persistence — commit failed; the answer still ships but the question is not remembered',
    );
    return unchanged;
  }
}

function describeError(err: unknown): { name?: string; message: string } {
  return err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) };
}
