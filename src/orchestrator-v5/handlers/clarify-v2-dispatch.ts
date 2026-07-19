/**
 * Clarify v2 — V5 route dispatch (ROADMAP 1.94 Option A replacement;
 * E0-B lane, 2026-07-16). DARK behind CEE_CLARIFY_V2_ENABLED (the route
 * wiring never imports this module when the flag is off — same lazy-import
 * containment pattern as the V6 dual-draft stage).
 *
 * The I/O half of the capability. Two claims, both deterministic (zero
 * LLM calls):
 *
 *  ROUND 1 (draft preflight) — the turn would dispatch `draft_graph`
 *  (brief-shape heuristic or explicit-generate). The rubric
 *  (`clarify-v2/rubric.ts`) assesses the effective brief; a thin brief
 *  gets up to 3 tap-able questions via the existing `clarify` turn class,
 *  a complete brief proceeds silently (return null → the route's draft
 *  dispatch runs untouched).
 *
 *  RESUME — a live `clarify_v2_round` pending action exists from a prior
 *  clarify turn and the user replied. Answers incorporate into the
 *  working brief via the NORMAL turn flow (chip tap or typed text — both
 *  arrive as ordinary message turns); the decision core then either asks
 *  a follow-up round or PROCEEDS, returning a `briefOverride` the route
 *  threads into the ordinary `dispatchDraftGraph`.
 *
 * Fail-open contract: every read/commit failure degrades to `null`
 * (= not engaged; the route continues exactly as with the flag off) with
 * a structured warn log. A clarification capability must never be able to
 * take the draft path down.
 *
 * Commit shape: ask-turns COMMIT (turn_class 'clarify', llm_calls_used 0)
 * so (a) the round state persists on `pending_actions`, (b) the working
 * brief seeds `scenarios.brief_text` (write-once RPC), and (c) the
 * conversation record carries the question turn. The egress-side response
 * this module returns ships through the route's `sendFinalised200`
 * chokepoint, so the universal looping-chip guard (#464) and the id-leak
 * scrub cover it BY CONSTRUCTION.
 */

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { isDraftShapedText } from '../../schemas/assist.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import {
  loadMostRecentPendingActionsStrict,
  loadPersistedScenarioStateStrict,
} from '../build-turn-context.js';
import {
  filterLivePendingActions,
  type PendingAction,
} from '../session/pending-action.js';
import { normaliseBriefText } from '../session/normalise-brief-text.js';
import { isClarifyDimension, type ClarifyDimension } from '../clarify-v2/rubric.js';
import {
  CLARIFY_V2_PROCEED_CHIP_ID,
  composeClarifyV2DeclineResponse,
  composeClarifyV2ReofferResponse,
  composeClarifyV2Response,
  decideClarifyV2Resume,
  decideClarifyV2Round1,
  type ClarifyV2Decision,
  type ClarifyV2RoundState,
} from '../clarify-v2/preflight.js';

/**
 * Wall-clock TTL for a clarify round. Longer than the 10-minute pending
 * default: a user reading three questions and thinking about their brief
 * is the expected case, not an abandonment signal. Turn TTL stays at the
 * commit carry-forward's default decrement (the pending is emitted with
 * count 2 — it survives exactly the answer turn it exists for).
 */
export const CLARIFY_V2_WALL_TTL_MS = 30 * 60 * 1000;
export const CLARIFY_V2_TURN_TTL = 2;

export interface TryClarifyV2Params {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  /** The route's own brief-shape heuristic verdict for this turn. */
  readonly draftShaped: boolean;
  /**
   * The server-assembled brief when this turn is an explicit-generate
   * draft (route C2 assembly); null otherwise.
   */
  readonly explicitGenerateBrief: string | null;
}

export type ClarifyV2Outcome =
  | {
      /** Reply with clarifying questions; the route must NOT draft. */
      readonly kind: 'respond';
      readonly response: OlumiResponse;
    }
  | {
      /** Proceed to the ordinary draft dispatch with this brief. */
      readonly kind: 'draft';
      readonly briefOverride: string;
    };

function latestLiveClarifyPending(
  pendings: readonly PendingAction[],
  nowMs: number,
): PendingAction | null {
  const live = filterLivePendingActions(pendings, nowMs).filter(
    (pa) => pa.action.kind === 'clarify_v2_round',
  );
  if (live.length === 0) return null;
  return [...live].sort(
    (a, b) => Date.parse(b.emitted_at_iso) - Date.parse(a.emitted_at_iso),
  )[0]!;
}

function roundStateFromPending(pa: PendingAction): ClarifyV2RoundState | null {
  const action = pa.action;
  if (action.kind !== 'clarify_v2_round') return null;
  // parsePendingAction already validated shape; the dimension filter here
  // is defence-in-depth that also narrows the string[] to the typed union.
  const asked: ClarifyDimension[] = action.asked_dimensions.filter(isClarifyDimension);
  return {
    brief: action.brief,
    asked,
    round: action.round,
    // 1.152 (A1/A4): absent on pre-1.152 rows → not reoffered.
    ...(action.reoffered === true ? { reoffered: true } : {}),
  };
}

function buildClarifyPending(
  state: ClarifyV2RoundState,
  payload: MessageTurnPayload,
  nowMs: number,
): PendingAction {
  return {
    id: `cv2_${payload.turn_id}`,
    scenario_id: payload.scenario_id,
    // The pending rides alongside the default-forward chip — the one chip
    // that is always present on a clarify response.
    chip_id: CLARIFY_V2_PROCEED_CHIP_ID,
    action: {
      kind: 'clarify_v2_round',
      brief: state.brief,
      asked_dimensions: state.asked,
      round: state.round,
      ...(state.reoffered === true ? { reoffered: true } : {}),
    },
    preconditions: {},
    expires_at_turn_count: CLARIFY_V2_TURN_TTL,
    expires_at_iso: new Date(nowMs + CLARIFY_V2_WALL_TTL_MS).toISOString(),
    emitted_at_iso: new Date(nowMs).toISOString(),
  };
}

interface ClarifyCommitOptions {
  /** This turn's own pendings ([] releases; the ask arms persist the round). */
  readonly pendingActions: readonly PendingAction[];
  /** The prior turn's pendings for the carry-forward (hold-wipe class). */
  readonly priorPendings: readonly PendingAction[];
  /**
   * Review fix A9 (1.152) — `scenarios.brief_text` is WRITE-ONCE at the
   * RPC (`WHERE brief_text IS NULL OR brief_text = ''`; see
   * supabase-store.ts append + migration 20260502120000): the FIRST write
   * is permanent and every later write silently no-ops. The old ask-time
   * seed therefore froze the PRE-ANSWER thin brief forever — the final
   * answered brief could never land. Seeding now happens only at the
   * flow's TERMINAL points:
   *   - PROCEED: no seed here at all — the route threads `briefOverride`
   *     into `dispatchDraftGraph`, whose commit already seeds
   *     `effectiveBrief = briefOverride ?? message` (draft-graph-
   *     dispatch.ts) — i.e. the FINAL answered brief, by construction.
   *   - DECLINE: this option seeds the WORKING brief (the decline arm's
   *     terminal state) so "draft it" later finds it via the C2
   *     assembly's persisted_brief source.
   * Ask commits pass nothing. Accepted residual (documented, not hidden):
   * a round abandoned by pure TTL lapse leaves brief_text unseeded for
   * that window — its only pre-draft reader, the C2 explicit-generate
   * assembly, then falls back to its recent_turn source (the round-1 user
   * message, brief-shaped by construction on the heuristic path);
   * decision_review reads brief_text only post-analysis, unreachable
   * before a draft exists.
   */
  readonly briefText?: string;
  /** Review fix A1 (1.152): retire the released round on decline. */
  readonly consumedPendingRefs?: readonly string[];
}

/**
 * Commit a clarify-flow turn (ask / re-offer / decline) through the
 * commit chokepoint. Returns the chokepoint's FINAL response, or null on
 * failure (callers degrade per-arm).
 */
async function commitClarifyTurn(
  response: OlumiResponse,
  payload: MessageTurnPayload,
  requestId: string,
  startedAtMs: number,
  options: ClarifyCommitOptions,
): Promise<OlumiResponse | null> {
  try {
    // Review fix A7 (17 Jul): the chokepoint may APPEND to the committed
    // response (F-HELD lapse notices, consent-priority caps). Return ITS
    // response so the wire carries exactly what was persisted — discarding
    // it made store and wire silently diverge on a consent surface.
    const result = await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'clarify',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      // Deterministic path — no LLM call is made anywhere in clarify v2.
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAtMs,
      handler_facts: [],
      ...(options.briefText !== undefined ? { briefText: options.briefText } : {}),
      pending_actions: options.pendingActions,
      // HOLD-WIPE class (same fix as draft-graph-dispatch, task_2e1b8c87):
      // thread the prior turn's pendings so this commit's carry-forward
      // runs over the REAL prior set instead of silently wiping it. The
      // explicit-generate continuation arm CAN carry live pre-graph holds
      // (e.g. a `proposed_concept` minted by a frame conversation); the
      // commit's carry-forward handles the lifecycle — supersession
      // retires the previous clarify round (same chip_id), wall/turn TTLs
      // decrement once, and lapses surface honestly. Non-mutating turn:
      // no graph_hash is threaded, so hash invalidation never fires here.
      priorPendingActions: options.priorPendings,
      ...(options.consumedPendingRefs !== undefined
        ? { consumedPendingRefs: options.consumedPendingRefs }
        : {}),
      coaching_state: null,
      userMessage: payload.message,
    });
    return result.response;
  } catch (err) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'clarify_v2 — clarify-turn commit failed; degrading (per-arm fallback; draft path never blocked)',
    );
    return null;
  }
}

function emitDecisionTelemetry(
  decision: ClarifyV2Decision,
  payload: MessageTurnPayload,
  requestId: string,
  resumed: boolean,
): void {
  if (decision.kind === 'ask') {
    emit(TelemetryEvents.V5ClarifyV2QuestionsEmitted, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      round: decision.state.round,
      phase: decision.phase,
      question_count: decision.questions.length,
      dimensions: decision.questions.map((q) => q.dimension),
    });
  } else if (decision.kind === 'proceed') {
    emit(TelemetryEvents.V5ClarifyV2Proceeded, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      reason: decision.reason,
      resumed,
    });
  } else {
    // 1.152 (A1/A4): decline + re-offer share one deflection event —
    // `action` says what happened (release vs reoffer), `cue` says why
    // (decline cue / question reply / bare ack). Fired AFTER a successful
    // commit only, same A8 discipline as the ask event.
    emit(TelemetryEvents.V5ClarifyV2Deflected, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      action: decision.kind === 'decline' ? 'release' : 'reoffer',
      cue: decision.cue,
      round: decision.kind === 'reoffer' ? decision.state.round : null,
    });
  }
}

/**
 * The single route entry point. Returns:
 *   - `{kind:'respond'}` — send this clarify response (via sendFinalised200);
 *   - `{kind:'draft'}`   — dispatch the ordinary draft with `briefOverride`;
 *   - `null`             — not engaged; the route proceeds exactly as if
 *                          the flag were off.
 */
export async function tryClarifyV2Turn(
  params: TryClarifyV2Params,
): Promise<ClarifyV2Outcome | null> {
  const { payload, requestId } = params;
  const startedAtMs = Date.now();

  // ── RESUME: a live clarify round claims the reply ────────────────────
  // Review fix A6 (17 Jul, HOLD-WIPE class): STRICT read — the non-strict
  // loader degrades to [] on a store failure, and threading that fabricated
  // empty list into the commit's carry-forward would silently wipe live
  // holds. On failure we cannot prove the prior set, so we do NOT claim the
  // turn (falls through to normal routing, holds untouched).
  let pendings: readonly PendingAction[];
  try {
    pendings = await loadMostRecentPendingActionsStrict(payload.scenario_id, requestId);
  } catch (err) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? err.message : String(err),
      },
      'clarify_v2 — pendings read failed; not claiming the turn (hold-wipe guard)',
    );
    return null;
  }
  const livePending = latestLiveClarifyPending(pendings, startedAtMs);
  if (livePending !== null) {
    const state = roundStateFromPending(livePending);
    if (state !== null) {
      // Post-draft safety: never claim a reply once a graph exists (the
      // clarify flow is strictly pre-draft). STRICT read — on failure we
      // cannot prove there is no graph, so we do NOT claim the turn.
      try {
        const persisted = await loadPersistedScenarioStateStrict(payload.scenario_id);
        if (persisted.graph != null) return null;
      } catch (err) {
        log.warn(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            err: err instanceof Error ? err.message : String(err),
          },
          'clarify_v2 — persisted-state read failed on resume; not claiming the turn',
        );
        return null;
      }

      const decision = decideClarifyV2Resume({
        state,
        message: payload.message,
        messageIsDraftShaped: isDraftShapedText(payload.message),
        explicitGenerateBrief: params.explicitGenerateBrief,
      });
      if (decision.kind === 'proceed') {
        emitDecisionTelemetry(decision, payload, requestId, true);
        return { kind: 'draft', briefOverride: decision.brief };
      }
      if (decision.kind === 'decline') {
        // Review fix A1 (1.152): release the round honestly. The commit
        // retires the clarify pending (consumedPendingRefs — supersession
        // cannot fire here because this turn persists no clarify pending),
        // carries unrelated holds, and seeds the WORKING brief into the
        // write-once brief_text column (the decline arm's terminal state,
        // A9) so a later "draft it" finds it. Commit failure → null: the
        // turn falls to normal routing (the LLM answers a "not now"
        // conversationally); the live pending then dies by TTL.
        // 1.152(i) FIX 3: normalise ONCE (the double call was a benign but
        // pointless twin — same input, same pure function, two evaluations).
        const declinedBriefText = normaliseBriefText(decision.brief).value;
        const finalResponse = await commitClarifyTurn(
          composeClarifyV2DeclineResponse(),
          payload,
          requestId,
          startedAtMs,
          {
            pendingActions: [],
            priorPendings: pendings,
            consumedPendingRefs: [livePending.chip_id],
            ...(declinedBriefText !== undefined
              ? { briefText: declinedBriefText }
              : {}),
          },
        );
        if (finalResponse === null) return null;
        emitDecisionTelemetry(decision, payload, requestId, true);
        return { kind: 'respond', response: finalResponse };
      }
      if (decision.kind === 'reoffer') {
        // Review fixes A1/A4 (1.152): re-present the default-forward
        // choice once per round. The re-persisted pending (same chip_id →
        // supersession, no zombie twin) marks the re-offer spent; brief /
        // asked / round are untouched, and NO brief_text seeds here (A9 —
        // ask-class commit). Commit failure → null: falling to normal
        // routing lets the LLM handle the user's question/ack; the prior
        // pending was not consumed, so the round stays live.
        const finalResponse = await commitClarifyTurn(
          composeClarifyV2ReofferResponse(decision.cue),
          payload,
          requestId,
          startedAtMs,
          {
            pendingActions: [buildClarifyPending(decision.state, payload, startedAtMs)],
            priorPendings: pendings,
          },
        );
        if (finalResponse === null) return null;
        emitDecisionTelemetry(decision, payload, requestId, true);
        return { kind: 'respond', response: finalResponse };
      }
      const response = composeClarifyV2Response(decision.questions, decision.phase);
      const finalResponse = await commitClarifyTurn(
        response,
        payload,
        requestId,
        startedAtMs,
        {
          pendingActions: [buildClarifyPending(decision.state, payload, startedAtMs)],
          priorPendings: pendings,
        },
      );
      // Commit failure on RESUME degrades to proceed-with-what-we-have
      // rather than null: the reply was an answer to OUR question; letting
      // it fall through to generic routing would strand it. Review fix A8:
      // the questions-emitted telemetry now fires AFTER a successful commit
      // only — a failed commit no longer reports a clarify round that never
      // persisted (the silent-draft fallback was invisible in telemetry).
      if (finalResponse === null) {
        return { kind: 'draft', briefOverride: decision.state.brief };
      }
      emitDecisionTelemetry(decision, payload, requestId, true);
      return { kind: 'respond', response: finalResponse };
    }
  }

  // ── ROUND 1: draft preflight ─────────────────────────────────────────
  const effectiveBrief = params.explicitGenerateBrief ?? payload.message;
  if (!params.draftShaped && params.explicitGenerateBrief === null) {
    return null;
  }
  // An explicit-generate turn (Generate action / generate_model) is an
  // explicit instruction to draft — clarify never fires over it (dead-end
  // class). The pure decision core respects it and PROCEEDS; here that
  // means returning null so the route's own explicit-generate draft
  // dispatch runs bit-identically to the flag-off path (its briefOverride
  // is already `explicitGenerateBrief.brief`).
  const decision = decideClarifyV2Round1(
    effectiveBrief,
    params.explicitGenerateBrief !== null,
  );
  if (decision.kind === 'proceed') {
    // Complete brief: proceed SILENTLY — return null so the route's draft
    // dispatch runs bit-identically to the flag-off path.
    emitDecisionTelemetry(decision, payload, requestId, false);
    return null;
  }
  const response = composeClarifyV2Response(decision.questions, decision.phase);
  const finalResponse = await commitClarifyTurn(
    response,
    payload,
    requestId,
    startedAtMs,
    {
      // Review fix A9 (1.152): NO briefText here — see ClarifyCommitOptions.
      pendingActions: [buildClarifyPending(decision.state, payload, startedAtMs)],
      priorPendings: pendings,
    },
  );
  // Round-1 commit failure → silent draft (unchanged). Review fix A8: the
  // questions-emitted telemetry fires only AFTER a successful commit, so a
  // failed commit no longer reports a clarify round that never persisted.
  if (finalResponse === null) return null;
  emitDecisionTelemetry(decision, payload, requestId, false);
  // Review fix A7: respond with the chokepoint's FINAL response (it may have
  // appended F-HELD lapse notices) — wire and store must not diverge.
  return { kind: 'respond', response: finalResponse };
}
