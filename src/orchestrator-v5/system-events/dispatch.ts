/**
 * V5 deterministic system-event dispatch.
 *
 * v0.7.0 introduced `kind: 'system_event'` on OrchestratorTurnPayload. System
 * events (patch_accepted, patch_dismissed, direct_graph_edit, chip_click,
 * undo, redo, selection_change) are deterministic Layer 0 operations — no
 * LLM routing, no handler dispatch. The route (route-v2.ts) intercepts them
 * BEFORE calling runTurnExecutor because:
 *   (1) system-event payloads have no `message` field, so TurnExecutor's
 *       ORIENT step (which needs a user message) cannot fire.
 *   (2) these events map to UI state changes the server records without
 *       LLM involvement.
 *
 * Persistence (Paul decision in planning round, matching V4 semantics):
 *   - patch_accepted, patch_dismissed, direct_graph_edit, chip_click
 *     → commit via commitDirectAnswer (append_turn_atomic).
 *   - undo, redo, selection_change → no commit; return commitPerformed:
 *     false with commitSkippedReason: 'client_only_event'. The route
 *     recognises this reason and still returns 200 — the skip is honest,
 *     not a fake success. See src/orchestrator/route-v2.ts for the
 *     skip-reason allowlist.
 *
 * Response envelope: empty assistant_text, no blocks, no actions — the UI
 * renders the state change visually. Mirrors the silent-acknowledgement
 * pattern in src/orchestrator/deterministic/system-event-handler.ts.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
  SystemEventKindLiteral,
} from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../schemas/cee-v3.js';
import { log } from '../../utils/telemetry.js';
import { loadPersistedGraphStrict, loadPriorFactsQuietly } from '../build-turn-context.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { applyFactorValueEdit } from './factor-value-edit.js';

export type SystemEventCommitSkipReason = 'client_only_event';

export interface DispatchSystemEventResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  readonly commitSkippedReason?: SystemEventCommitSkipReason;
  /**
   * V5 finaliser contract — system event readiness, by event kind:
   *
   *   undo / redo / selection_change / chip_click / patch_dismissed
   *     No server-side graph state to inspect. analysisReady stays
   *     undefined; the finaliser stamps no analysis_ready, and the UI's
   *     prior `ceeAnalysisReady` remains the truth (it was correct before
   *     the event).
   *
   *   patch_accepted / direct_graph_edit
   *     Graph-MUTATING in the client, but this dispatch produces only a
   *     silent acknowledgement and has no post-mutation graph snapshot in
   *     scope, so analysisReady stays undefined here too. The UI is
   *     responsible for invalidating `ceeAnalysisReady` locally on these
   *     events (per `invalidateAnalysisReady()` in DecisionGuideAI canvas
   *     store).
   *
   *   factor_value_edit
   *     Graph-mutating ON THE SERVER, and the one kind that populates this
   *     field. It carries the VALUE, so the dispatch can run the real
   *     `set_factor_value` mutation, commit the graph, and re-derive
   *     readiness from the COMMITTED bytes via `computeStructuralReadiness`
   *     — which is exactly the "future change" the paragraph above
   *     anticipated. Readiness is derived post-commit, never pre-, so it can
   *     never describe a graph that failed to land.
   *
   * Type is `AnalysisReadyPayload | undefined` (not literal `undefined`)
   * so future implementations can populate it without a type-shape change.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Graph for the central egress sanitiser.
   *
   * `null` for the acknowledgement kinds — their `assistant_text` is empty
   * and they carry no blocks, so the sanitiser has nothing to scrub.
   *
   * NON-NULL FOR `factor_value_edit`. That kind ships real prose ("Updated
   * Marketing budget from £40,000 to £50,000.") through
   * `sanitiseOlumiResponseForEgress`, whose entity-id leak scrub resolves ids
   * to labels AGAINST THIS GRAPH. Passing `null` does not SKIP the scrub — it
   * runs graph-free, and a graph-free scrub cannot tell an ambiguous
   * single-segment id (`goal_revenue`) from an English compound
   * (`goal_setting`), so it leaves those intact.
   *
   * ⚠ HONEST SCOPE OF THE EVIDENCE. That paragraph is REASONED FROM THE SCRUB'S
   * SOURCE, NOT PINNED BY A TEST HERE. A mutation check confirmed it: forcing
   * this field back to `null` leaves all 13 tests in
   * `route-v2-factor-value-edit.test.ts` GREEN. The reason is that the wire
   * `graph_hash` is now stamped explicitly from the commit's own persisted hash
   * (see `dispatchFactorValueEdit`), so the sanitiser no longer needs this
   * graph to derive it — which removed the coverage this field used to get for
   * free. The remaining justification is the id scrub, and this suite's
   * fixtures have clean labels, so they cannot discriminate it. Treat the
   * non-null as CORRECT-BUT-UNPINNED: if you are adding a leak-shaped fixture,
   * that is the test this field is missing.
   */
  readonly graph: GraphV3T | null;
}

export interface DispatchSystemEventParams {
  readonly payload: SystemEventTurnPayload;
  readonly requestId: string;
}

// Events that produce no server state change. Skipping commit for these
// matches V4's deterministic handler behaviour — undo/redo are realised in
// the client's graph history, not in Supabase turn state. Typed against
// `SystemEventKindLiteral` so adding a new kind to the schema without
// updating this list is a compile-time error (not a silent runtime miss).
//
// selection_change is client-only ACKED as a holding position — R5 will
// likely route it into ephemeral turn context (never a committed turn);
// revisit the dispatch branch, not this guard, when R5 lands.
const CLIENT_ONLY_EVENT_KINDS: ReadonlySet<SystemEventKindLiteral> = new Set<SystemEventKindLiteral>([
  'undo',
  'redo',
  'selection_change',
]);

function buildAcknowledgementResponse(
  payload: SystemEventTurnPayload,
): OlumiResponse {
  // Silent acknowledgement. V4's handleSystemEvent follows the same
  // convention — UI-visible confirmation is rendered by the UI's own
  // patch/history components, not by a message bubble.
  return {
    response_version: 2,
    assistant_text: '',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: payload.stage,
  };
}

export async function dispatchSystemEvent(
  params: DispatchSystemEventParams,
): Promise<DispatchSystemEventResult> {
  const { payload, requestId } = params;
  const startedAt = Date.now();
  const response = buildAcknowledgementResponse(payload);

  if (CLIENT_ONLY_EVENT_KINDS.has(payload.event.kind)) {
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      'V5 system event — client-only, skipping commit',
    );
    return {
      response,
      commitPerformed: false,
      commitSkippedReason: 'client_only_event',
      graph: null,
    };
  }

  // ── the one VALUE-CARRYING kind ──────────────────────────────────────────
  // Everything above and below this block is unchanged for every other kind:
  // a value-less event still gets the byte-identical silent acknowledgement it
  // got before. That is the reader-first compatibility guarantee — a CEE on
  // this version behaves exactly as before for every client that has not yet
  // learned to send `factor_value_edit`.
  if (payload.event.kind === 'factor_value_edit') {
    return await dispatchFactorValueEdit(payload, payload.event, requestId, startedAt);
  }

  try {
    await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: [],
      // V5 Stage 2B-1b: system-event turns have no user turn / coaching context
      // (no buildTurnContext) — persist NULL explicitly. The most-recent read
      // filters non-null, so this never resets a prior coaching snapshot.
      coaching_state: null,
    });
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      'V5 system event committed',
    );
    return { response, commitPerformed: true, graph: null };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 system event commit failed',
    );
    return { response, commitPerformed: false, graph: null };
  }
}

/**
 * `factor_value_edit` — run the real mutation, commit it, and stamp readiness.
 *
 * The shape mirrors the turn-executor's own write chokepoint, and the ORDER is
 * the part that matters:
 *
 *   1. load the persisted graph STRICTLY (throws on a degraded read — never
 *      guess at a base, because guessing is how you clobber a server model);
 *   2. run the existing validator + handler (no mutation code lives here);
 *   3. commit the merged graph with a CAS expected-base;
 *   4. ONLY THEN derive readiness, from the graph that actually landed.
 *
 * Step 4 after step 3 is deliberate: deriving readiness pre-commit once shipped
 * a post-mutation hash paired with pre-mutation interventions.
 */
async function dispatchFactorValueEdit(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  try {
    persistedGraph = await loadPersistedGraphStrict(payload.scenario_id);
  } catch (err) {
    // Fail CLOSED. A degraded read gives no trusted merge base, so writing
    // anything risks clobbering a model we cannot see. Surface it as a failed
    // commit; the route maps that to a typed 500 rather than a false success.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 factor_value_edit — persisted-graph read failed; refusing the write (fail closed)',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const priorFacts = await loadPriorFactsQuietly(payload.scenario_id, requestId);

  const result = await applyFactorValueEdit({
    payload,
    event,
    requestId,
    persistedGraph,
    priorFacts,
  });

  // ── the refusal path ─────────────────────────────────────────────────────
  // An above-cap value, an unknown target, an inconsistent scale: all land
  // here. The turn IS committed (the transcript should record that the user
  // tried and was refused) but NO graph is written, so `scenarios.graph` is
  // untouched and `graph_hash` does not move. Never a silent clamp, never a 500.
  if (result.kind === 'refused') {
    try {
      await commitDirectAnswer(result.response, {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 0,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 factor_value_edit — refusal commit failed',
      );
      return { response: result.response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 factor_value_edit refused — committed honestly, no graph written',
    );
    return { response: result.response, commitPerformed: true, graph: null };
  }

  // ── the mutation path ────────────────────────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  try {
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // A handler ran and produced facts. Claiming `direct_answer` with a
      // populated `handler_facts` would misreport the turn to every consumer
      // that keys off turn_class.
      turn_class: 'handler',
      handler_id: 'set_factor_value',
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. `commitDirectAnswer` writes
      // scenarios.graph atomically with the turn row when — and only when —
      // this key is present, and RECOMPUTES the authoritative graph_hash from
      // the persisted bytes. Omitting it is precisely the old behaviour whose
      // symptom was a hash that never moved.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      ...(cas.expectedGraphIdentityHash !== null
        ? { expectedGraphIdentityHash: cas.expectedGraphIdentityHash }
        : {}),
      ...(cas.expectedGraphAnalysisHash !== null
        ? { expectedGraphAnalysisHash: cas.expectedGraphAnalysisHash }
        : {}),
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        target_id: event.target_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 factor_value_edit — mutation commit failed',
    );
    // commitPerformed:false with no recognised skip reason ⇒ the route returns
    // a typed 500. Correct: nothing landed, and saying otherwise would tell the
    // UI to show a change that does not exist.
    return { response: result.response, commitPerformed: false, graph: null };
  }

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      target_id: event.target_id,
    },
    'V5 factor_value_edit committed — graph written, hash recomputed',
  );

  // ⚠ ADVERTISE THE PERSISTED HASH, NOT ONE WE COMPUTED OURSELVES.
  //
  // `commitDirectAnswer` runs `projectGraphForPersistence` on the way to the
  // store (it repairs the graph, normalises option-intervention contracts and
  // reconciles top-level options), so the bytes that land are NOT the bytes we
  // handed it. Letting the egress sanitiser hash OUR copy advertises a hash the
  // next turn will never read back — the UI would compare its
  // `computed_against_hash` against a value that never existed and conclude
  // "stale" (or "fresh") on a fiction. That is the same class of defect as the
  // frozen hash this change exists to fix, so it is not a nicety.
  //
  // `persistedAnalysisGraphHash` is documented as "the only hash a caller may
  // advertise for this turn" (commit.ts:347-352). The sanitiser's
  // `response.graph_hash ?? compute(opts.graph)` precedence exists for exactly
  // this "authoritative upstream setter" case, so setting it here wins.
  //
  // Caught by `route-v2-factor-value-edit.test.ts` — the wire hash and the hash
  // of the graph the store received disagreed until this was threaded.
  const response: OlumiResponse =
    persistedAnalysisGraphHash !== null
      ? { ...result.response, graph_hash: persistedAnalysisGraphHash }
      : result.response;

  return {
    response,
    commitPerformed: true,
    // Post-commit, from the graph that landed.
    analysisReady: computeStructuralReadiness(result.graph),
    // Still the full graph: the egress id-leak scrub resolves ids to labels
    // against it, independently of the hash above.
    graph: result.graph,
  };
}
