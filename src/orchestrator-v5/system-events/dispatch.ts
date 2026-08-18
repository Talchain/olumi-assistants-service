/**
 * V5 deterministic system-event dispatch.
 *
 * v0.7.0 introduced `kind: 'system_event'` on OrchestratorTurnPayload. System
 * events are deterministic Layer 0 operations — no LLM routing. The route
 * (route-v2.ts) intercepts them BEFORE calling runTurnExecutor because:
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
 *   - factor_value_edit, edge_strength_edit → run the existing canonical D1
 *     handler, then atomically persist graph + fact with a trusted-base CAS.
 *
 * Response envelope: acknowledgement kinds retain their prior silent response;
 * value-carrying writers return the canonical handler receipt.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
  SystemEventKindLiteral,
} from '@talchain/schemas/boundary';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { config } from '../../config/index.js';
import { log } from '../../utils/telemetry.js';
import {
  GraphStaleWriteError,
  loadMostRecentPendingActionsIntegrityStrict,
  loadPersistedGraphStrict,
  loadPriorFactsQuietly,
  loadPriorFactsWithReadState,
} from '../build-turn-context.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { computeExpectedGraphCasHashes } from '../context/graph-cas-conflict.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from '../context/freshness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { buildAppliedGraphWireField } from '../compose/applied-graph-emit.js';
import {
  applyEdgeStrengthEdit,
  isExactCommittedEdgeReadback,
  isProvenanceOnlyEdgeConfirmation,
  type EdgeStrengthEditAuthorityConflict,
} from './edge-strength-edit.js';
import { applyFactorValueEdit } from './factor-value-edit.js';
import { applyStructuralDelete } from './structural-delete.js';

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
   *   factor_value_edit / edge_strength_edit
   *     Graph-mutating ON THE SERVER. Each carries the VALUE, so dispatch can
   *     run the corresponding canonical D1 mutation, commit the graph, and re-derive
   *     readiness from the COMMITTED bytes via the canonical graph adapter
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
   * `null` for acknowledgement kinds and refusals without a usable graph.
   *
   * NON-NULL FOR successful value-carrying writers. They ship real prose
   * ("Updated Marketing budget from £40,000 to £50,000.") through
   * `sanitiseOlumiResponseForEgress`, whose entity-id leak scrub resolves ids
   * to labels AGAINST THIS GRAPH. Passing `null` does not SKIP the scrub — it
   * runs graph-free, and a graph-free scrub cannot tell an ambiguous
   * single-segment id (`goal_revenue`) from an English compound
   * (`goal_setting`), so it leaves those intact.
   *
   * ⚠ THIS IS NOW PINNED, AND FOR A WHILE IT WAS NOT. Stamping the wire
   * `graph_hash` explicitly from the commit's own persisted hash (see
   * `dispatchFactorValueEdit`) removed the coverage this field used to get for
   * free — a mutation check then showed `graph: null` leaving the whole suite
   * green. The gap was disclosed rather than papered over, and is now closed by
   * a fixture that discriminates the scrub itself:
   * `route-v2-factor-value-edit.test.ts` → "resolves a leak-shaped label via the
   * graph". It uses a SINGLE-SEGMENT suffix under an ambiguous prefix
   * (`goal_revenue`, not `fac_*`/`opt_*`), which `isLikelyEntityId` leaves
   * untouched without a graph and rewrites to the node's label with one. Set
   * this field to `null` and that test REDs.
   */
  readonly graph: GraphV3T | null;
  /**
   * Canonical analysis currency against the graph this turn actually wrote.
   * Present on the edge writer only after a successful atomic commit; omitted
   * on the reader floor so its deployed response remains byte-compatible.
   */
  readonly freshness?: FreshnessDerivation;
  /**
   * Recoverable canonical-state divergence. The route maps this outcome to
   * HTTP 409 + GRAPH_DIVERGED; generic integrity/infra failures omit it and
   * remain retryable 500. No graph or turn write lands for this outcome.
   */
  readonly graphConflict?: {
    readonly recovery_action: 'refresh_and_reconfirm';
    readonly conflict_category: string;
    readonly expected_base_graph_hash: string | null;
    readonly edge?: EdgeStrengthEditAuthorityConflict['edge'];
  };
}

export interface DispatchSystemEventParams {
  readonly payload: SystemEventTurnPayload;
  readonly requestId: string;
}

/**
 * How each system-event kind is handled. TOTAL BY CONSTRUCTION.
 *
 * ⚠ THIS REPLACES A CLAIM THAT WAS FALSE FOR AS LONG AS IT EXISTED. The list
 * below used to be a `ReadonlySet<SystemEventKindLiteral>` carrying the comment
 * "adding a new kind to the schema without updating this list is a compile-time
 * error (not a silent runtime miss)". **A `Set` of a union type is not exhaustive
 * — a Set with three members satisfies `ReadonlySet<X>` no matter how many
 * members `X` has.** Nothing went red. That is precisely how `factor_value_edit`
 * would have arrived: silently, falling through to the generic acknowledgement,
 * which is the P0 this change exists to fix — one kind later.
 *
 * A `Record` keyed by the union IS exhaustive: TypeScript requires every member.
 * So re-vendoring a schemas release that adds a kind now fails `pnpm typecheck`
 * until someone states what the new kind does. That is the loud signal the old
 * comment promised and did not deliver.
 *
 * Belt and braces, because a compile-time guard can be defeated by a cast or by
 * a consumer on a stale pin: `system-event-kind-exhaustiveness.test.ts` DERIVES
 * the kind set from `SystemEventKind.options` — the schema's own vocabulary —
 * and asserts set-equality with this map's keys. Derived, not mirrored.
 */
export type SystemEventHandling =
  /** No server state change at all — no commit, `client_only_event` skip reason. */
  | 'client_only'
  /** Silent acknowledgement, committed as a turn row. No graph write. */
  | 'ack_and_commit'
  /**
   * Known additive wire event whose writer is deliberately not deployed yet.
   * Commit an explicit typed refusal, never a graph/fact/new-pending mutation.
   */
  | 'reader_only_refusal'
  /**
   * Silent acknowledgement committed WITH a typed handler fact — the event
   * carries a human judgement the server must PERSIST, never a graph write
   * (P4 transport, 2026-08-05: carry the signal; whether it feeds compute is
   * a separate explicit design decision). Turn shape follows the edit_graph /
   * DL-7 PR B precedent: `turn_class: 'direct_answer'`, `handler_id: null`,
   * facts on the turn row — the prior-facts loader reads facts from ALL prior
   * turns, so these are downstream-visible.
   */
  | 'fact_and_commit'
  /** Runs a real mutation and writes `scenarios.graph`. */
  | 'mutating';

export const SYSTEM_EVENT_HANDLING: Readonly<Record<SystemEventKindLiteral, SystemEventHandling>> = {
  patch_accepted: 'ack_and_commit',
  patch_dismissed: 'ack_and_commit',
  direct_graph_edit: 'ack_and_commit',
  factor_value_edit: 'mutating',
  chip_click: 'ack_and_commit',
  undo: 'client_only',
  redo: 'client_only',
  selection_change: 'client_only',
  // Reclassified 2026-08-05 (was 'ack_and_commit' — which committed an EMPTY
  // ack and DISCARDED the rating after hashing it into request_hash; the UI
  // has emitted the typed event since 0.22.0 and the server threw it away).
  feedback: 'fact_and_commit',
  // 0.34.0 — the two judgement kinds that previously terminated in the
  // browser (no wire shape existed at all).
  edge_adjudication: 'fact_and_commit',
  prior_range_edit: 'fact_and_commit',
  // 0.42.0 Train C — canonical writer. Reverting THIS writer commit lands on
  // Train B's deployed explicit no-write refusal and its integrity-strict
  // pending carry-forward; reader and writer rollback remain independent.
  edge_strength_edit: 'mutating',
  // 0.48.0 — THE P0 L-22 WRITER. `'ack_and_commit'` here is the defect itself:
  // it commits a turn row and writes NO graph, so the next turn reloads a graph
  // that still holds the deleted option and re-adds it. A delete that does not
  // reach `scenarios.graph` is not a delete.
  structural_delete: 'mutating',
};

// DERIVED from the map above — not a second list to keep in step. undo/redo are
// realised in the client's graph history, not in Supabase turn state.
//
// selection_change is client-only ACKED as a holding position — R5 will
// likely route it into ephemeral turn context (never a committed turn);
// revisit the dispatch branch, not this guard, when R5 lands.
const CLIENT_ONLY_EVENT_KINDS: ReadonlySet<SystemEventKindLiteral> = new Set<SystemEventKindLiteral>(
  (Object.keys(SYSTEM_EVENT_HANDLING) as SystemEventKindLiteral[]).filter(
    (k) => SYSTEM_EVENT_HANDLING[k] === 'client_only',
  ),
);



/**
 * Build the typed judgement receipt for a `fact_and_commit` event kind.
 *
 * Returns `null` for kinds that are not fact-bearing (the caller then treats
 * the event as a plain ack — which cannot happen for a kind the handling map
 * declares 'fact_and_commit'; the null arm exists so this function is total).
 *
 * ⚠ R-004 (feedback): the fact records `comment_present`, NEVER the comment
 * text — the user's free text may contain PII and a fact row is long-lived
 * and widely read. The contract's `FeedbackResultSchema` is `.strict()`, so a
 * future `comment` field is a deliberate reviewed widening, not a quiet leak.
 *
 * Provenance on the adjudication/prior facts is stamped HERE, server-side
 * (`user_set`) — the wire deliberately carries no provenance field (the event
 * kind is the provenance claim; a client constant would add nothing the
 * server could trust).
 */
export function buildJudgementFact(
  event: SystemEventTurnPayload['event'],
): HandlerFact | null {
  switch (event.kind) {
    case 'feedback':
      return {
        fact_type: 'feedback',
        fact_version: 1,
        noop: false,
        result: {
          target_id: event.target.id,
          target_kind: event.target.kind,
          rating: event.rating,
          comment_present: event.comment !== undefined && event.comment.length > 0,
        },
      };
    case 'edge_adjudication':
      return {
        fact_type: 'edge_adjudication',
        fact_version: 1,
        noop: false,
        result: {
          from: event.from,
          to: event.to,
          edge_id: event.edge_id ?? null,
          verdict: event.verdict,
          resolved_strength_mean: event.resolved_strength_mean ?? null,
          provenance: 'user_set',
        },
      };
    case 'prior_range_edit':
      return {
        fact_type: 'prior_range_edit',
        fact_version: 1,
        noop: false,
        result: {
          target_id: event.target_id,
          range_min: event.range_min,
          range_max: event.range_max,
          distribution: event.distribution ?? null,
          provenance: 'user_set',
        },
      };
    default:
      return null;
  }
}

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

/**
 * Reader-first response for the 0.42 `edge_strength_edit` wire member.
 *
 * The new discriminator must be understood before any producer emits it, but
 * understanding is not permission to mutate. This response is intentionally
 * explicit and non-retryable: the request parsed, this deployment has no
 * writer for it, and the model was not changed. The stable reason lets a
 * client distinguish this rollout floor from a malformed payload (B1/422).
 */
function buildEdgeStrengthEditReaderRefusal(
  payload: SystemEventTurnPayload,
): OlumiResponse {
  return {
    response_version: 2,
    assistant_text:
      "I can't apply this link-strength change in this version, so I haven't changed the model.",
    blocks: [
      {
        type: 'error',
        error_code: 'FEATURE_NOT_ENABLED',
        severity: 'warn',
        details: {
          reason: 'edge_strength_edit_reader_only',
          retryable: false,
        },
      },
    ],
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
  const declaredHandling = SYSTEM_EVENT_HANDLING[payload.event.kind];
  // Writer activation is the existing atomic-RPC config, not a second flag.
  // Under off/shadow we deliberately execute Train B's deployed reader floor:
  // typed FEATURE_NOT_ENABLED, strict newest-pending carry, no graph read/fact/
  // writer effect. Enabling the emitter is therefore insufficient on its own;
  // the service must be objectively running the RPC in enforce mode.
  const handling =
    payload.event.kind === 'edge_strength_edit' &&
    declaredHandling === 'mutating' &&
    config.features.graphCas.rpcEnforce !== true
      ? 'reader_only_refusal'
      : declaredHandling;
  const response =
    handling === 'reader_only_refusal'
      ? buildEdgeStrengthEditReaderRefusal(payload)
      : buildAcknowledgementResponse(payload);

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

  // ── VALUE-CARRYING writers ────────────────────────────────────────────────
  // Value-less events retain their byte-identical acknowledgement. Each
  // writer below owns only its structured adapter + commit transaction; the
  // canonical D1 handlers remain the sole graph mutators.
  if (
    handling === 'mutating' &&
    payload.event.kind === 'factor_value_edit'
  ) {
    return await dispatchFactorValueEdit(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'edge_strength_edit'
  ) {
    return await dispatchEdgeStrengthEdit(payload, payload.event, requestId, startedAt);
  }
  if (
    handling === 'mutating' &&
    payload.event.kind === 'structural_delete'
  ) {
    return await dispatchStructuralDelete(payload, payload.event, requestId, startedAt);
  }

  // ── fact_and_commit: the judgement PERSISTS, or the turn fails loud ──────
  // Built + contract-validated BEFORE the commit. Fail-closed: a fact that
  // does not parse against the contract is a code bug, and committing the ack
  // WITHOUT it would silently reproduce the empty-ack defect this exists to
  // close — so the commit is refused (route maps that to a typed 500, the
  // client retries) rather than quietly degraded.
  let judgementFacts: readonly HandlerFact[] = [];
  if (handling === 'fact_and_commit') {
    const fact = buildJudgementFact(payload.event);
    const check = fact === null ? null : HandlerFactSchema.safeParse(fact);
    if (fact === null || check === null || !check.success) {
      log.error(
        {
          request_id: requestId,
          event_kind: payload.event.kind,
          scenario_id: payload.scenario_id,
          parse_error: check?.success === false ? check.error.message : 'no fact built',
        },
        'V5 system event — judgement fact failed its own contract; refusing the commit (fail closed)',
      );
      return { response, commitPerformed: false, graph: null };
    }
    judgementFacts = [check.data];
  }

  // A reader-only refusal is a committed assistant turn. Pending-action
  // authority is deliberately "most recent turn only", so committing an empty
  // row without threading the prior set would make a legitimate offer
  // unreachable even though this refusal neither consumed nor superseded it.
  // Read STRICTLY: on degradation we cannot prove preservation, so fail the
  // commit closed and leave the previous row authoritative. The canonical
  // commit carry-forward owns normal TTL/expiry/hash rules; this seam neither
  // reimplements them nor treats the prior entries as newly-created actions.
  let readerPriorPendingActions:
    | Awaited<ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>>
    | undefined;
  if (handling === 'reader_only_refusal') {
    try {
      readerPriorPendingActions = await loadMostRecentPendingActionsIntegrityStrict(
        payload.scenario_id,
        requestId,
      );
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: payload.event.kind,
          scenario_id: payload.scenario_id,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 system event compatibility refusal — pending read failed; refusing commit to preserve prior state',
      );
      return { response, commitPerformed: false, graph: null };
    }
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
      handler_facts: judgementFacts,
      // The compatibility reader is a hard no-new-action floor. Supplying this
      // explicitly prevents refusal copy/chips from deriving a resumable
      // pending at commit time; priorPendingActions below is a distinct input
      // owned by the canonical carry-forward lifecycle.
      ...(handling === 'reader_only_refusal' ? { pending_actions: [] } : {}),
      ...(handling === 'reader_only_refusal'
        ? { priorPendingActions: readerPriorPendingActions }
        : {}),
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
      handling === 'reader_only_refusal'
        ? 'V5 system event refused by compatibility reader — no graph/fact write or new pending action'
        : 'V5 system event committed',
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
 * `edge_strength_edit` — strict persisted-edge writer with atomic CAS.
 *
 * The 0.42 event is only intent. Authority stays server-side: read the graph
 * and newest pending row losslessly, let the adapter resolve and validate the
 * exact persisted edge through `adjust_edge_strength`, then hand the merged
 * graph to the existing atomic commit chokepoint. No branch below writes a
 * graph directly or carries pending JSONB around the canonical lifecycle.
 */
async function dispatchEdgeStrengthEdit(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'edge_strength_edit' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let priorFactsRead: Awaited<ReturnType<typeof loadPriorFactsWithReadState>>;
  try {
    // Both reads are authoritative and required before ANY newest-turn append.
    // The integrity-strict pending read rejects a non-array, any invalid entry,
    // or a scenario mismatch. On either failure the prior row remains newest
    // and therefore authoritative: no refusal transcript is appended.
    [persistedGraph, priorPendingActions, priorFactsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(
        payload.scenario_id,
        requestId,
      ),
      loadPriorFactsWithReadState(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: Awaited<ReturnType<typeof applyEdgeStrengthEdit>>;
  try {
    result = await applyEdgeStrengthEdit({
      payload,
      event,
      requestId,
      persistedGraph,
    });
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — canonical adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  // Honest domain refusal: record the attempt, but write no graph/fact/new
  // pending. The exact valid newest pending set is fed into canonical
  // carry-forward, which alone owns TTL, wall expiry and graph-hash survival.
  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    // Missing/duplicate/stale endpoint authority is not a normal domain
    // refusal and must never masquerade as 200 success. Append nothing: the
    // strict prior pending row remains newest and untouched. The route turns
    // this descriptor into 409 GRAPH_DIVERGED with exact edge reconciliation
    // details. Other honest refusals still record a transcript below.
    if (result.authorityConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.authorityConflict.recovery_action,
          conflict_category: result.authorityConflict.conflict_category,
          expected_base_graph_hash: null,
          edge: result.authorityConflict.edge,
        },
      };
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
        pending_actions: [],
        priorPendingActions: priorPendingActions,
        ...(currentAnalysisHash !== null
          ? { graph_hash: currentAnalysisHash }
          : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 edge_strength_edit — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    return {
      response,
      commitPerformed: true,
      graph: contentGraph,
    };
  }

  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  let committedResponse: OlumiResponse = result.response;
  try {
    // The trusted expected base includes both edge mean and direction in its
    // analysis projection and every persisted field in its identity projection.
    // append_turn_atomic_v4/v3 checks the identity under the DB row lock when
    // the deployed CAS RPC is enforcing, closing the read→write race.
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'handler',
      handler_id: 'adjust_edge_strength',
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions: priorPendingActions,
      contentGraph: result.mutatedGraph,
      ...(cas.expectedGraphIdentityHash !== null
        ? { expectedGraphIdentityHash: cas.expectedGraphIdentityHash }
        : {}),
      ...(cas.expectedGraphAnalysisHash !== null
        ? { expectedGraphAnalysisHash: cas.expectedGraphAnalysisHash }
        : {}),
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 edge_strength_edit — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          expected_base_graph_hash: err.expected_base_graph_hash ?? null,
        },
      };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 edge_strength_edit — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const exactTargetReadback = isExactCommittedEdgeReadback({
    projected: result.graph,
    committed: persistedGraphBytes,
    from: event.from,
    to: event.to,
  });
  const confirmationStillProvenanceOnly =
    event.intent !== 'confirm_current' ||
    isProvenanceOnlyEdgeConfirmation({
      before: result.baseGraph,
      after: persistedGraphBytes,
      from: event.from,
      to: event.to,
    });
  // A successful append without a trustworthy graph receipt is an ambiguous
  // transport outcome, never a 200 mutation success. Fail the route closed so
  // the UI keeps its write barrier and reconciles; do not fabricate readback
  // from the adapter's pre-commit copy.
  if (
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !exactTargetReadback ||
    !confirmationStillProvenanceOnly
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        exact_target_readback: exactTargetReadback,
        confirmation_provenance_only: confirmationStillProvenanceOnly,
      },
      'V5 edge_strength_edit — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;
  // The exact graph this commit projected and handed to the atomic store is
  // the UI's authoritative readback. It is load-bearing for confirm_current:
  // graph_patch honestly stays `noop` for the unchanged scientific tuple,
  // while this receipt proves provenance was durably stamped.
  const response: OlumiResponse = {
    ...committedResponse,
    ...(persistedAnalysisGraphHash !== null
      ? { graph_hash: persistedAnalysisGraphHash }
      : {}),
    draft_graph: buildAppliedGraphWireField(committedParse.data),
  };
  // Fact history is observational only: it never authorises or blocks the
  // write. A healthy empty read means canonical `none`; a degraded read must
  // not fabricate that conclusion and therefore emits honest `unknown`.
  const freshness: FreshnessDerivation =
    priorFactsRead.status === 'ok'
      ? deriveAnalysisFreshness(
          priorFactsRead.facts,
          persistedAnalysisGraphHash,
        )
      : {
          freshness: 'unknown',
          reason: 'derivation_failed',
          selected_fact_index: null,
          graph_hash_at_run: null,
          current_graph_hash: persistedAnalysisGraphHash,
          computed_at: null,
        };
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.edge_strength_edit',
    },
    {
      prior_fact_count: priorFactsRead.facts.length,
      prior_fact_read_status: priorFactsRead.status,
      current_turn_fact_count: result.handlerFacts.length,
      intent: event.intent,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      intent: event.intent,
    },
    'V5 edge_strength_edit committed — canonical graph/fact written atomically',
  );
  return {
    response,
    commitPerformed: true,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
}

/**
 * `structural_delete` — persist a removal, atomically, or change nothing.
 *
 * Same shape as the two writers above, and the ORDER is the part that matters:
 *
 *   1. load the persisted graph STRICTLY — the trusted base is the SERVER's own
 *      read, never request-supplied structure (`session/store.ts`: a CAS fed
 *      from the incoming graph validates the write against itself and always
 *      "matches"). For a DELETE this is sharper than for an edit: without an
 *      independent view the server has nothing to refuse a stale removal with;
 *   2. resolve + apply through the canonical PatchOperation train (no mutation
 *      code lives here, and none lives in the adapter either);
 *   3. commit ONCE, with the atomic CAS expected-base threaded — one graph, one
 *      transaction. A partial apply would leave DANGLING EDGES, which is worse
 *      than no apply: the model becomes incoherent rather than merely unchanged;
 *   4. verify the committed bytes actually lost what the user removed;
 *   5. ONLY THEN derive readiness, from the graph that landed.
 *
 * ⚠ WHY THIS WRITER IS NOT GATED ON `config.features.graphCas.rpcEnforce`,
 * unlike `edge_strength_edit` — a deliberate, reversible divergence, disclosed
 * rather than quietly taken.
 *
 * `edge_strength_edit`'s gate is a ROLLOUT device, not a safety property: its own
 * comment describes Train B's "deployed reader floor" for a wire member "whose
 * writer is deliberately not deployed yet". `CEE_V5_GRAPH_CAS_RPC` defaults to
 * `'shadow'` and config records `'enforce'` as "a later explicit step", so
 * gating on it would ship this P0 fix DARK — a user's delete would return
 * FEATURE_NOT_ENABLED and the option would still come back, which is the defect
 * unchanged. The estate's standing rulings forbid exactly that ("ship
 * capabilities ON; rollback = code revert"; no new env gates).
 *
 * ⚠ THE HONEST SAFETY POSTURE — do NOT restate this as "two gates make the write
 * safe". An earlier draft did, and it claimed more than the mechanisms deliver.
 * `CEE_V5_GRAPH_CAS_RPC` defaults to `shadow` (the UPDATE stays UNCONDITIONAL —
 * the CAS is stamped, not enforced) and `CEE_V5_GRAPH_CAS_MODE` defaults to
 * `off`, so NEITHER the adapter's `base_graph_hash` gate nor the receipt check
 * closes the read→write window. The base hash is checked at T0 and the write
 * happens later; nothing in that pair is atomic.
 *
 * What largely closes the window is a DIFFERENT mechanism: the TURN FENCE
 * (`session/turn-fence.ts`), which refuses a graph write from a superseded turn
 * — post-migration inside the append transaction under a FOR UPDATE on the
 * turn's own fence row, and fail-closed when the fence RPC is unavailable.
 *
 * State the posture exactly as: **base checked at T0, writes ordered by the turn
 * fence, CAS stamped-not-enforced** — adequate for single-user acceptance. What
 * IS true about the flag is narrower and still worth having: both the stale gate
 * and the receipt check run UNCONDITIONALLY, so no shadow-mode path reaches the
 * write with an unchecked base hash, and the atomic CAS hashes are threaded so
 * moving the deployment to `enforce` upgrades this writer with no code change —
 * the same posture as `factor_value_edit`, the sibling mutating writer that has
 * never been gated on it. A safety claim stronger than its mechanism is how the
 * next lane gets hurt.
 */
async function dispatchStructuralDelete(
  payload: SystemEventTurnPayload,
  event: Extract<SystemEventTurnPayload['event'], { kind: 'structural_delete' }>,
  requestId: string,
  startedAt: number,
): Promise<DispatchSystemEventResult> {
  let persistedGraph: unknown;
  let priorPendingActions: Awaited<
    ReturnType<typeof loadMostRecentPendingActionsIntegrityStrict>
  >;
  let priorFactsRead: Awaited<ReturnType<typeof loadPriorFactsWithReadState>>;
  try {
    // All three reads are authoritative and required before ANY newest-turn
    // append. On failure the prior row stays newest and authoritative: no
    // transcript is appended, because a degraded read gives no trusted base and
    // guessing at one is how a server model gets clobbered.
    [persistedGraph, priorPendingActions, priorFactsRead] = await Promise.all([
      loadPersistedGraphStrict(payload.scenario_id),
      loadMostRecentPendingActionsIntegrityStrict(payload.scenario_id, requestId),
      loadPriorFactsWithReadState(payload.scenario_id, requestId),
    ]);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — authoritative graph/pending read failed; refusing any append',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  let result: ReturnType<typeof applyStructuralDelete>;
  try {
    result = applyStructuralDelete({ payload, event, requestId, persistedGraph });
  } catch (err) {
    // A malformed-but-present persisted graph lands here (corruption, not
    // absence). Retryable 500 with no append; the corrupt row stays
    // authoritative rather than being healed forward under a delete.
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — adapter failed before commit',
    );
    return {
      response: buildAcknowledgementResponse(payload),
      commitPerformed: false,
      graph: null,
    };
  }

  const persistedParse = GraphV3.safeParse(persistedGraph);
  const contentGraph = persistedParse.success ? persistedParse.data : null;
  const currentAnalysisHash = persistedParse.success
    ? computeAnalysisAffectingGraphHash(
        persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
      )
    : null;

  if (result.kind === 'refused') {
    const response: OlumiResponse =
      currentAnalysisHash !== null
        ? { ...result.response, graph_hash: currentAnalysisHash }
        : result.response;
    // A stale base hash is canonical-state divergence, not a domain refusal, and
    // must never masquerade as a 200. Append NOTHING: the route turns this
    // descriptor into 409 GRAPH_DIVERGED carrying the hash the server holds, so
    // the client's refresh is a bounded action rather than a guess.
    if (result.baseHashConflict !== undefined) {
      return {
        response,
        commitPerformed: false,
        graph: contentGraph,
        graphConflict: {
          recovery_action: result.baseHashConflict.recovery_action,
          conflict_category: result.baseHashConflict.conflict_category,
          expected_base_graph_hash: result.baseHashConflict.expected_base_graph_hash,
        },
      };
    }
    // Every other refusal IS recorded: the transcript should say the user tried
    // to delete and was refused, with no graph write and no new pending. The
    // exact valid newest pending set is fed to canonical carry-forward, which
    // alone owns TTL, wall expiry and graph-hash survival.
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
        pending_actions: [],
        priorPendingActions,
        ...(currentAnalysisHash !== null ? { graph_hash: currentAnalysisHash } : {}),
        ...(contentGraph !== null ? { contentGraph } : {}),
        coaching_state: null,
      });
    } catch (err) {
      log.error(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          refusal_reason: result.reason,
          err:
            err instanceof Error
              ? { name: err.name, message: err.message }
              : { message: String(err) },
        },
        'V5 structural_delete — refusal commit failed',
      );
      return { response, commitPerformed: false, graph: null };
    }
    log.info(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        refusal_reason: result.reason,
      },
      'V5 structural_delete refused — committed honestly, no graph written',
    );
    return { response, commitPerformed: true, graph: contentGraph };
  }

  // ── the mutation path: ONE atomic commit ─────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
  let graphPersisted = false;
  let committedResponse: OlumiResponse = result.response;
  try {
    // The trusted expected base is the SERVER-READ graph, hashed both ways:
    // identity for the in-transaction CAS (append_turn_atomic_v4/v3 compares it
    // under the row lock when enforcing, closing the read→write race) and
    // analysis for the cosmetic-vs-substantive downgrade.
    const cas = computeExpectedGraphCasHashes(result.baseGraph);
    const commitResult = await commitDirectAnswer(result.response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      // ⚠ `direct_answer` + `handler_id: null` IS the estate's ruling for an
      // `edit_graph` receipt, not a shortcut — and it differs from the two
      // writers above, which claim `turn_class: 'handler'` because their
      // handler ids (`set_factor_value`, `adjust_edge_strength`) ARE members of
      // the contract's `V5ActionType`. `edit_graph` is not, so stamping it here
      // would need a schemas widening. `edit-graph-dispatch.ts:3673-3682` records
      // the War Room correction verbatim: turn_class stays `direct_answer`, the
      // RPC accepts non-empty `handler_facts` alongside it (verified via SQL
      // inspection), and the FACT-level `fact_type === 'edit_graph'` is the
      // canonical discriminator every downstream consumer already keys off
      // (recent_changes projector, state-query guard, prior_facts readers).
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: result.handlerFacts,
      // THE LINE THE WHOLE CHANGE IS ABOUT. `commitDirectAnswer` writes
      // scenarios.graph atomically with the turn row when — and only when —
      // this key is present. Omitting it is precisely the defect: a turn row
      // that says a deletion happened over a graph that never lost the node.
      graph: result.mutatedGraph,
      baseGraphForInvariants: result.baseGraph,
      pending_actions: [],
      priorPendingActions,
      contentGraph: result.mutatedGraph,
      ...(cas.expectedGraphIdentityHash !== null
        ? { expectedGraphIdentityHash: cas.expectedGraphIdentityHash }
        : {}),
      ...(cas.expectedGraphAnalysisHash !== null
        ? { expectedGraphAnalysisHash: cas.expectedGraphAnalysisHash }
        : {}),
      coaching_state: null,
    });
    persistedAnalysisGraphHash = commitResult.persistedAnalysisGraphHash;
    persistedGraphBytes = commitResult.persistedGraph;
    graphPersisted = commitResult.graphPersisted;
    committedResponse = commitResult.response;
  } catch (err) {
    if (err instanceof GraphStaleWriteError) {
      log.warn(
        {
          request_id: requestId,
          event_kind: event.kind,
          scenario_id: payload.scenario_id,
          conflict_category: err.conflict_category,
        },
        'V5 structural_delete — atomic graph CAS conflict; refresh and reconfirm',
      );
      return {
        response: result.response,
        commitPerformed: false,
        graph: null,
        graphConflict: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: err.conflict_category,
          expected_base_graph_hash: err.expected_base_graph_hash ?? null,
        },
      };
    }
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 structural_delete — atomic mutation commit failed',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }

  // ── the post-commit receipt check ────────────────────────────────────────
  // A successful append without a trustworthy receipt is an ambiguous transport
  // outcome, never a 200 mutation success. For a DELETE the claim to verify is
  // ABSENCE: every id the user removed must be gone.
  //
  // ⚠⚠ WHAT THIS ACTUALLY CHECKS — READ BEFORE RELYING ON IT. An earlier version
  // of this comment called it "the bytes the store actually holds" and told the
  // next lane never to fabricate it "from the adapter's pre-commit copy". THAT
  // WAS A STRONGER CLAIM THAN THE CODE DELIVERS, which is exactly the defect
  // class this estate calls an honest label overwritten by a false one.
  //
  // `commitResult.persistedGraph` is `graphForStore`, and `commit.ts:372-373`
  // says so in terms: *"Do NOT treat it as a general read-back: it is this
  // commit's own input after projection, not a re-read."* So this compares the
  // adapter's projected graph against the commit chokepoint's own SECOND
  // projection of it. It is a non-idempotent-projection check, NOT a database
  // read-back.
  //
  // That is still worth having — `projectGraphForPersistence` repairs,
  // normalises and reconciles, and `reconcileTopLevelOptionsFromNodes` is
  // precisely a pass that can re-add option entries — so a projection that
  // reintroduced a removed id would be caught here. What it CANNOT see is the
  // store persisting something different from what it was handed. A real
  // read-back would need a post-commit SELECT this seam does not perform.
  // (This is the demonstrated reason the M12 mutant survives: with no second,
  // independent source of bytes, the comparison has nothing to disagree with.)
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const committedNodeIds = committedParse.success
    ? new Set(committedParse.data.nodes.map((n) => n.id))
    : new Set<string>();
  const committedEdgePairs = committedParse.success
    ? new Set(committedParse.data.edges.map((e) => `${e.from}::${e.to}`))
    : new Set<string>();
  const removalsLanded =
    committedParse.success &&
    result.removedNodeIds.every((id) => !committedNodeIds.has(id)) &&
    result.removedEdgePairs.every((pair) => !committedEdgePairs.has(pair));
  if (
    graphPersisted !== true ||
    persistedAnalysisGraphHash === null ||
    !committedParse.success ||
    !removalsLanded
  ) {
    log.error(
      {
        request_id: requestId,
        event_kind: event.kind,
        scenario_id: payload.scenario_id,
        graph_persisted: graphPersisted,
        has_analysis_hash: persistedAnalysisGraphHash !== null,
        graph_parse_ok: committedParse.success,
        removals_landed: removalsLanded,
      },
      'V5 structural_delete — committed graph receipt invalid; withholding success',
    );
    return { response: result.response, commitPerformed: false, graph: null };
  }
  const graphForReadiness = committedParse.data;

  // The authoritative receipt the UI binds to. `draft_graph` is the UI's ONLY
  // inline-graph ingestion path (`applied-graph-emit.ts`), and a removal is
  // expressed there as ABSENCE from the applied graph — which is why the
  // `graph_patch` block is not the right carrier for this event even setting
  // aside that its `operation` enum cannot name a delete.
  const response: OlumiResponse = {
    ...committedResponse,
    graph_hash: persistedAnalysisGraphHash,
    draft_graph: buildAppliedGraphWireField(graphForReadiness),
  };

  // Fact history is observational only: it never authorises or blocks the write.
  // A healthy empty read means canonical `none`; a degraded read must not
  // fabricate that conclusion and therefore emits honest `unknown`.
  const freshness: FreshnessDerivation =
    priorFactsRead.status === 'ok'
      ? deriveAnalysisFreshness(priorFactsRead.facts, persistedAnalysisGraphHash)
      : {
          freshness: 'unknown',
          reason: 'derivation_failed',
          selected_fact_index: null,
          graph_hash_at_run: null,
          current_graph_hash: persistedAnalysisGraphHash,
          computed_at: null,
        };
  emitFreshnessTelemetry(
    freshness,
    {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'system_event.structural_delete',
    },
    {
      prior_fact_count: priorFactsRead.facts.length,
      prior_fact_read_status: priorFactsRead.status,
      removed_node_count: result.removedNodeIds.length,
      removed_edge_count: result.removedEdgePairs.length,
    },
  );

  log.info(
    {
      request_id: requestId,
      event_kind: event.kind,
      scenario_id: payload.scenario_id,
      removed_node_count: result.removedNodeIds.length,
      removed_edge_count: result.removedEdgePairs.length,
    },
    'V5 structural_delete committed — canonical graph/fact written atomically, removals verified in the persisted bytes',
  );
  return {
    response,
    commitPerformed: true,
    // Readiness from the bytes that LANDED, never the pre-mutation graph:
    // deleting an option can legitimately move the model to not-analysable, and
    // that verdict must describe the model the user now has.
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    freshness,
    graph: graphForReadiness,
  };
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
        // The consented "extend the scale" chip's backing pending. Supplied
        // EXPLICITLY (not left to commit.ts's chip-derivation default) because
        // this pending carries structured `{value, unit, cap}` that no chip can
        // encode — deriving it from the chip set would lose the cap, which is the
        // whole point of the consent. Omitted entirely when empty so the normal
        // derivation still runs for every other refusal.
        ...(result.pendingActions.length > 0
          ? { pending_actions: result.pendingActions }
          : {}),
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
        rescale_pendings_persisted: result.pendingActions.length,
      },
      'V5 factor_value_edit refused — committed honestly, no graph written',
    );
    return { response: result.response, commitPerformed: true, graph: null };
  }

  // ── the mutation path ────────────────────────────────────────────────────
  let persistedAnalysisGraphHash: string | null = null;
  let persistedGraphBytes: unknown = null;
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
    persistedGraphBytes = commitResult.persistedGraph;
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

  // Readiness from the bytes that LANDED, not from our pre-projection copy.
  //
  // This is not pedantry. The canonical graph adapter reads each option node's
  // merged `interventions`, and `projectGraphForPersistence` runs
  // `normaliseOptionInterventionContract` over exactly that field on the way to
  // the store. Deriving readiness from the un-projected graph can therefore
  // publish a readiness verdict for a graph that was never stored — the same
  // "advertised state != persisted state" class as the hash defect above.
  // Falls back to the merged graph only if the projected bytes fail to re-parse,
  // which would itself mean the store holds something we cannot model.
  const committedParse = GraphV3.safeParse(persistedGraphBytes);
  const graphForReadiness = committedParse.success ? committedParse.data : result.graph;

  return {
    response,
    commitPerformed: true,
    analysisReady: buildCanonicalAnalysisReadyFromGraph(graphForReadiness),
    // Still the full graph: the egress id-leak scrub resolves ids to labels
    // against it, independently of the hash above.
    graph: graphForReadiness,
  };
}
