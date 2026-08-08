/**
 * V5 pre-Sonnet dispatch for draft_graph turns.
 *
 * Triggered by route-v2.ts when a message-kind payload looks like a
 * first-time brief submission (stage=frame, no graphState, message length
 * meets DRAFT_GRAPH_MIN_BRIEF_LENGTH). Delegates to the V4 unified pipeline
 * via the shared handleDraftGraph handler — no schema changes, no new
 * handler registry entry. See the v5-handler-surface brief Task 2 for the
 * Paul-decision (draft_graph not in v0.7.0 ActionType, so Sonnet tool-use
 * routing cannot reach the unified pipeline through V5).
 *
 * Adapter checkpoint (per brief review): V4's DraftGraphResult.blocks is a
 * `TypedConversationBlock[]` that includes V4-internal `GraphPatchBlock`
 * variants (patch_type: 'full_draft'). v0.7.0's OlumiResponseSchema only
 * permitted narrow graph_patch blocks. v0.8.0 adds an optional top-level
 * `draft_graph` field to OlumiResponse carrying the full post-repair graph
 * inline so the UI can render immediately without a Supabase re-fetch.
 *
 * Decision: the adapter now includes `draft_graph` in the response when
 * graphOutput is available. The graph is also persisted atomically via
 * CommitMetadata.graph → append_turn_atomic → scenarios.graph for session
 * resume. The inline graph is the primary render path; Supabase is the
 * fallback for session resume. We still drop V4's GraphPatchBlock, the
 * STRUCTURED `strengthen_items` wire field / guidance chips, draft warnings,
 * and telemetry — those structured surfaces remain V4-only, not yet in the
 * V5+UI contract.
 *
 * NOTE (corrected 2026-06-14, landed 2026-07-19): the raw object-shaped
 * `strengthen_items` are NOT discarded on V5 — they are consumed by
 * `buildPostDraftNarrative` (imported at the top of this file, called in the
 * dispatch body below) to source the post-draft "assumption to check" bullet
 * and one additional "worth a look" line in `assistant_text`. The earlier
 * wording here ("we drop strengthen_items") referred only to the structured
 * wire field, and was read by a later audit as a total coaching loss. It is
 * not. Object-shaped items survive into the served narrative.
 *
 * V4 column audit (2026-04-22): V4's handleDraftGraph does not write to the
 * scenarios table directly — it returns graphOutput in its result and the
 * caller decides what to persist. The scenarios table has columns for framing,
 * brief, analysis_status, analysis, events, etc. but none of these are written
 * by the V4 draft_graph handler: framing is set by the intent-gate path,
 * analysis_status by the run_analysis handler, events by a separate event log.
 * Only scenarios.graph needs to be persisted here. Other columns are either
 * populated by their own handlers or are not relevant to the draft turn.
 * Re-audit if run_analysis returns "no graph found" after a V5 draft turn.
 *
 * commit_performed signal: always true on success (append_turn_atomic
 * fires with handler_id=null, handler_facts=[]). handler_facts is empty
 * because v0.7.0's HandlerFact union has no draft_graph variant — adding
 * one is a schema extension out of scope for this brief.
 *
 * stage_indicator advances to 'analyse' ONLY when graph persistence
 * succeeded (CommitResult.graphPersisted === true) — this is the client's
 * signal that a graph exists to fetch. On persistence failure the stage
 * stays at 'frame' so the client does not attempt a fetch against an empty
 * scenarios.graph column.
 */

import type { FastifyRequest } from 'fastify';

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { handleDraftGraph, type DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import { config } from '../../config/index.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { loadMostRecentPendingActions } from '../build-turn-context.js';
import {
  appendLapseNotice,
  emitHoldLapseTelemetry,
  threadHoldsThroughMutatingCommit,
} from './hold-thread-through.js';
import type { SuggestedAction } from '../compose/types.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { emitContextBudget } from '../context/context-budget-telemetry.js';
import {
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from '../context/freshness.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { normaliseBriefText } from '../session/normalise-brief-text.js';
import { SET_OPTION_VALUES_CHIP } from '../configure-option-chip-text.js';
import { checkDraftNarrationCounts } from './narration-count-guard.js';
import { buildPostDraftNarrative, buildModelReceiptSummary } from '../coaching/post-draft-narrative.js';
import { sanitiseCoachingProse } from '../compose/output-safety.js';
import { buildDraftBiasSignalBlocks } from './draft-bias-signal-blocks.js';
import {
  buildV5DiagnosticTrace,
  buildErrorV5DiagnosticTrace,
  type V5DiagnosticTrace,
} from '../diagnostics/v5-diagnostic-trace.js';

export interface DispatchDraftGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
  /**
   * ROADMAP 2.63 C2 — server-assembled decision brief for explicit-generate
   * turns (`generate_model` / `explicit_generate` wire flag). When set, the
   * pipeline drafts from THIS text instead of `payload.message`: the wire
   * message on a confirm-chip click is the chip's canned label, not the
   * brief. Redirects every brief consumer in this dispatcher (the unified
   * pipeline input, brief-text persistence, context-budget telemetry, the
   * V6 dual-draft enrichment brief) — but NOT the committed turn's
   * `user_message`, which stays the verbatim wire message so the
   * conversation record remains honest. Absent on the route's heuristic
   * (isDraftGraphShape) path, where behaviour is unchanged.
   */
  readonly briefOverride?: string;
  /**
   * ROADMAP 2.63 C3/C4 — pending-action refs (== chip_id) CONSUMED by this
   * draft: the `draft_graph` offer pending the route-level resume just
   * honoured. Threaded to `CommitMetadata.consumedPendingRefs` so the
   * carry-forward retires the offer with the draft — otherwise a live
   * "build/redraft the model" offer would survive the very draft it
   * produced and a later bare "yes" could re-trigger it (zombie re-offer).
   * Absent on the heuristic and flag paths (nothing to consume).
   */
  readonly consumedPendingRefs?: readonly string[];
  /**
   * Review-576 condition 2 — wall-clock baseline of the HTTP request
   * (route-v2's `routeStartedAt`). Threaded through `handleDraftGraph` to
   * the unified pipeline so the draft retry-affordability gate and the
   * Step-11 budget guard measure elapsed time from REQUEST start (covering
   * routing tool-use + context assembly), not from LLM start. Optional:
   * absent callers keep parse.ts's documented LLM-start fallback.
   */
  readonly requestStartMs?: number;
}

export interface DispatchDraftGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  /**
   * V5 finaliser contract: pre-computed readiness surfaced for the response
   * finaliser in route-v2.ts. Draft uses the rich pipeline payload from
   * `DraftGraphResult.analysisReady` (carries blockers, model_adjustments,
   * intervention_details, bias_findings — fields the structural fallback
   * does not produce). Undefined when the draft did not persist a graph;
   * the finaliser then emits no analysis_ready, which the UI treats as
   * "no fresh readiness this turn" rather than as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Post-repair graph used for label resolution by the central egress
   * sanitiser (sanitiseOlumiResponseForEgress). Null when the draft did
   * not produce a graph — sanitiser falls back to prefix-aware generic.
   */
  readonly graph: GraphV3T | null;
  /**
   * V5 state-trust freshness derivation. Draft is the first-turn brief
   * shape — there is no prior run_analysis fact yet. Expected to be
   * `none` in normal use; surfaced for telemetry / contract consistency
   * and to make the wire field present on every CEE dispatch path.
   */
  readonly freshness?: import('../context/freshness.js').FreshnessDerivation;
  /**
   * V5 diagnostic trace (additive observability) — populated when
   * `CEE_DIAGNOSTIC_TRACE_ENABLED=true`. Carries per-stage latency
   * breakdown, LLM call records, pipeline outcome, correlation IDs.
   * `undefined` when the flag is off. The route's egress wrapper
   * threads this onto the wire envelope via the strip-validate-reattach
   * pattern alongside the existing `_timings` block; OlumiResponseSchema
   * never sees it.
   */
  readonly diagnosticTrace?: V5DiagnosticTrace;
}

/**
 * Map V4 DraftGraphResult → OlumiResponse (v0.8.0 contract).
 *
 * Includes the FINAL post-repair graph in `draft_graph` when graphOutput is
 * present so the UI can render immediately without a Supabase re-fetch. The
 * graph is also persisted atomically via CommitMetadata.graph for session
 * resume — Supabase remains the fallback, not the primary path.
 *
 * assistant_text contract:
 *   - graphPersisted=true: use handler narration, falling back to FINAL
 *     node/edge count (post-repair) — graph is on canvas.
 *   - graphPersisted=false (commit threw, caught by caller): the route maps
 *     commitPerformed=false to HTTP 500 INTERNAL_ERROR with retryable=true.
 *     The response text here is never sent to the client; use the pipeline's
 *     own narration as a neutral fallback for server-side logging only.
 */
export function draftResultToOlumiResponse(
  result: DraftGraphResult,
  payload: MessageTurnPayload,
  graphPersisted: boolean,
  requestId: string,
): OlumiResponse {
  // Derive node/edge counts from the FINAL graph (post-repair, post-validation)
  // to ensure the assistant_text matches what the UI will render.
  const finalNodeCount = result.graphOutput?.nodes?.length ?? 0;
  const finalEdgeCount = result.graphOutput?.edges?.length ?? 0;

  let assistantText: string;
  if (graphPersisted) {
    // Success path: ship the deterministic post-draft coaching narrative
    // built from the persisted graph and analysisReady payload. The
    // narrative is a five-sentence decision-coach summary — goal
    // confirmation, options summary, key trade-off, one assumption to
    // validate, run-analysis nudge — under 140 words and free of any
    // graph-shape language (no "nodes" / "edges" / counts as the lead).
    //
    // The handler narration (`result.assistantText`) is no longer surfaced
    // to users: it varied with the LLM, occasionally leaked graph-shape
    // wording, and could not be relied on to follow the strict copy rules.
    // We still invoke `checkDraftNarrationCounts` here purely for its
    // telemetry side-effect — ops dashboards keep observing Sonnet's
    // count-mismatch / wording drift even though the chosenText is now
    // discarded. The third arg `fallback` is unused on this path.
    if (result.assistantText !== null) {
      checkDraftNarrationCounts({
        narration: result.assistantText,
        finalNodeCount,
        finalEdgeCount,
        fallback: '',
        requestId,
      });
    }
    // Gated-hybrid composer: feed the LLM-authored coaching strings
    // (coachingSummary, strengthenItems, coachingBiasSignals) into the
    // builder alongside the graph + analysisReady. The builder enforces
    // a strict copy-quality gate on each candidate; the source it
    // ultimately used is surfaced via `narrative.telemetry` for ops
    // visibility (category/count only — no raw coaching text).
    const narrative = buildPostDraftNarrative({
      graph: result.graphOutput,
      analysisReady: result.analysisReady ?? null,
      strengthenItems: result.strengthenItems,
      coachingSummary: result.coachingSummary,
      coachingBiasSignals: result.coachingBiasSignals,
      // Canonical widening_log object (the legacy array field is dead on V5).
      // The builder surfaces only `brief_completeness` as advisory copy.
      wideningLog: result.coachingWideningLogObject ?? null,
      // ROADMAP 2.972 — the user's own words, so the builder can REFUSE the
      // "your brief was light on detail" advisory when the brief refutes it.
      // `payload.message` IS the brief on the ordinary draft turn; on the
      // explicit-generate path the real brief is assembled server-side
      // (`briefOverride`) and is not visible here, so the advisory keeps its
      // current behaviour there. Disclosed, and in the fail-safe direction.
      briefText: typeof payload.message === 'string' ? payload.message : null,
    });
    // Narrow-guard scrub of the composed narrative before it becomes
    // assistant_text. Two leak paths land here:
    //   (1) LLM-authored coaching strings the narrative embeds — either
    //       verbatim via the coachingSummary whole-response short-circuit
    //       (post-draft-narrative.ts §coachingSummary) or via excerpt
    //       selection from strengthenItems / coachingBiasSignals.
    //   (2) Graph-derived prose the deterministic sectioned builder
    //       composes — `collectLabels(nodes, 'risk')` etc. reads
    //       `graph.nodes[].label` directly and embeds it (e.g.
    //       `"the risk of risk_churn"` when a risk node has
    //       `label === id`).
    // The central egress sanitiser (`sanitiseUserFacingText` invoked by
    // `sanitiseOlumiResponseForEgress`) cannot close either path for
    // `label === id` cases: its `resolveLabel(graph, "risk_churn")`
    // returns `"risk_churn"` (the label, which IS the raw id) and
    // substitutes the leak with itself. `sanitiseCoachingProse` applies
    // a stricter rule scoped to coaching: real graph-ID hits with no
    // usable label fall back to the prefix-aware generic ("the
    // relevant risk"), never to the raw id. English compounds like
    // `risk_adjusted` / `goal_setting` / `out_of_scope` are preserved
    // (rule 3). The scrub is idempotent — running it again before the
    // central egress is a no-op.
    assistantText = sanitiseCoachingProse(narrative.text, result.graphOutput).text;
    emit(TelemetryEvents.V5PostDraftCoachingSourceSelected, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      ...narrative.telemetry,
    });
  } else {
    // Failure path: route discards this response and returns 500 INTERNAL_ERROR.
    // Use neutral narration; the client never sees this text.
    assistantText = result.assistantText ?? 'Drafted a decision graph.';
  }

  // Only advance to 'analyse' when persistence actually succeeded. If
  // graphPersisted is false the graph was not written to scenarios.graph and
  // the client must not try to fetch it — keep the current stage so the
  // frame stays visible and the operator can investigate the persistence log.
  const stageIndicator = graphPersisted ? 'analyse' : payload.stage;

  // Hard constraints extracted from the brief. These ride on `graphOutput` as
  // a SIBLING of nodes/edges (package.ts:406 emits them alongside `graph`;
  // transformResponseToV3 lifts them to the V3 root; draft-graph.ts:300's
  // `body.graph ?? body` then makes that root the graphOutput). Before
  // @talchain/schemas 0.18.0 the rebuild below dropped them, because
  // DraftGraphBlockSchema was `.strict()` over exactly four keys — so
  // threading the field WITHOUT the contract bump would have failed
  // validateEgress and replaced every draft response with the
  // EGRESS_CONTRACT_VIOLATION envelope. 0.18.0 declares it optional.
  //
  // Emitted ONLY when a non-empty array is actually present. An absent or
  // empty extraction omits the key entirely rather than emitting `[]`, so
  // no-constraint responses stay byte-identical to the pre-0.18.0 wire and
  // the contract's "consumers must treat absence and [] as equivalent" note
  // is never exercised by us.
  const rawGoalConstraints = (result.graphOutput as { goal_constraints?: unknown } | undefined)
    ?.goal_constraints;
  const goalConstraints =
    Array.isArray(rawGoalConstraints) && rawGoalConstraints.length > 0
      ? (rawGoalConstraints as unknown[])
      : undefined;

  // Include the FINAL graph inline so the UI can apply it directly without a
  // Supabase re-fetch. Only present when graphOutput is available and
  // persistence succeeded — on failure the client never sees this response.
  const draftGraphField =
    graphPersisted && result.graphOutput
      ? {
          nodes: (result.graphOutput.nodes ?? []) as unknown[],
          edges: (result.graphOutput.edges ?? []) as unknown[],
          node_count: finalNodeCount,
          edge_count: finalEdgeCount,
          ...(goalConstraints ? { goal_constraints: goalConstraints } : {}),
        }
      : undefined;

  // V5 finaliser contract: this composer must NOT set `analysis_ready`. The
  // dispatcher surfaces `result.analysisReady` on `DispatchDraftGraphResult`
  // (when graphPersisted), and the response-finaliser stamps it onto the
  // wire envelope after composition, before egress validation. The chip
  // gate below still reads the raw payload locally to choose the post-draft
  // chip — that's chip-suggestion logic, not envelope stamping.
  const analysisReadyField: AnalysisReadyPayload | undefined =
    graphPersisted && result.analysisReady
      ? (result.analysisReady as AnalysisReadyPayload)
      : undefined;

  // V5 review: post-draft_graph chips. The draft path produces its own
  // response envelope (not through the standard composers) so it needs its
  // own deterministic chip rule, matching the brief's chip mapping table:
  //   - graph persisted + analysis_ready === "ready" → executable Run analysis
  //   - graph persisted + analysis not ready → conversational setup prompt
  //   - draft failed to persist → no chips (the route returns 500 anyway)
  const suggestedActions = buildPostDraftChips({ graphPersisted, analysisReadyField });

  // Fix 4 (observability): forward the unified-pipeline's per-stage
  // timings onto the V5 wire under `_timings.draft_graph` so the replay
  // harness sees the draft-stage breakdown alongside the per-turn block
  // attached later by the turn-executor. Undefined here when the
  // unified-pipeline writer gated the field off (V5_TIMING_DEBUG=false).
  // The route-v2 egress wrapper strips/re-attaches `_timings` across the
  // strict OlumiResponseSchema validation seam.
  const timingsBlock = result.draftGraphTimings
    ? { draft_graph: result.draftGraphTimings }
    : undefined;

  // Bias-signal visibility (a1/bias-signal-blocks): project the draft LLM's
  // already-emitted `coachingBiasSignals` into UP TO 2 structured
  // `coaching_kind:'bias_signal'` blocks so DGAI #356's merged renderer can
  // surface them as bias cards. Additive — the prose-bullet path
  // (buildPostDraftNarrative above) is unchanged; these ride alongside it.
  // Only on the persisted path (a non-persisted draft has no canvas graph to
  // ground the target refs against, and the response is discarded anyway).
  // Entity-id leaks in title/body are scrubbed downstream by the central
  // egress chokepoint (sanitiseOlumiResponseForEgress → sanitiseBlock
  // 'coaching'), exactly as for every other coaching block.
  const blocks: OlumiResponse['blocks'] = graphPersisted
    ? buildDraftBiasSignalBlocks({
        biasSignals: result.coachingBiasSignals,
        graph: result.graphOutput,
        createdAt: new Date().toISOString(),
      })
    : [];

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks,
    suggested_actions: [...suggestedActions],
    insights: [],
    stage_indicator: stageIndicator,
    ...(draftGraphField && { draft_graph: draftGraphField }),
    ...(timingsBlock !== undefined && { _timings: timingsBlock }),
  } as OlumiResponse;
}

function buildPostDraftChips(params: {
  readonly graphPersisted: boolean;
  readonly analysisReadyField: DraftGraphResult['analysisReady'] | undefined;
}): readonly SuggestedAction[] {
  if (!params.graphPersisted) return [];
  const readyStatus =
    typeof params.analysisReadyField === 'object' && params.analysisReadyField !== null
      ? (params.analysisReadyField as { status?: unknown }).status
      : undefined;
  if (readyStatus === 'ready') {
    // Three-chip post-draft coaching pattern: a primary action chip
    // (Run analysis, the only handler-dispatchable entry) followed by
    // two conversational chips. Conversational chips carry a `message`
    // but no `action_type` — clicking sends the message back through
    // the V5 turn-executor as a normal user message, where Sonnet
    // routes it to `explain_from_structure` (model review) or a
    // clarification turn (assumptions). No new ActionType is added.
    return [
      {
        id: 'chip_action_run_analysis',
        label: 'Run analysis',
        message: 'Run analysis.',
        action_type: 'run_analysis',
      },
      {
        id: 'chip_prompt_review_model',
        label: 'Review model',
        message: 'Walk me through the model so I can review it before running the analysis.',
      },
      {
        id: 'chip_prompt_assumptions',
        label: 'What assumptions matter most?',
        message: 'Which assumptions in this model matter most to check before I run the analysis?',
      },
    ];
  }
  // ROADMAP 2.308 / S2(b) — derived from `configure-option-chip-text.ts`, the
  // single source both the configure gate and every configure chip build from.
  // The literal that used to sit here ("Help me set up the options …") was
  // NO_MATCH at the gate AND blocked by EDIT_GRAPH_NEGATIVE_REGEX's "set up",
  // so the product's own readiness chip could not reach the one chat path that
  // writes option interventions.
  return [{ ...SET_OPTION_VALUES_CHIP }];
}

export async function dispatchDraftGraph(
  params: DispatchDraftGraphParams,
): Promise<DispatchDraftGraphResult> {
  const { payload, requestId, request } = params;
  const startedAt = Date.now();

  // C2 — the brief the pipeline drafts from. `payload.message` except on
  // the explicit-generate path, where route-v2 assembled the real brief
  // server-side (see DispatchDraftGraphParams.briefOverride).
  const effectiveBrief = params.briefOverride ?? payload.message;

  let draftResult: DraftGraphResult;
  try {
    draftResult = await handleDraftGraph(
      effectiveBrief,
      request,
      payload.turn_id,
      params.requestStartMs !== undefined ? { requestStartMs: params.requestStartMs } : undefined,
    );
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph dispatch — unified pipeline threw',
    );
    // V5 diagnostic trace — error path. Builder short-circuits when the
    // flag is off (returns undefined). Pipeline telemetry attached on the
    // error by `handleDraftGraph` (toolLLMTelemetry, pipelineDetails) is
    // best-effort: it may be absent on early failures and present on late
    // ones (e.g. SO parse fail after the LLM call landed). The trace is
    // attached to the thrown error so route-v2's catch block can thread it
    // onto the 500 BoundaryError wire envelope. This surface meets brief
    // test #5 (timeout → `timed_out: true`, `retry_count` reflects attempts).
    const errToolTel = (err as { toolLLMTelemetry?: DraftGraphResult['toolLLMTelemetry'] })
      .toolLLMTelemetry;
    const diagnosticTraceOnError = buildErrorV5DiagnosticTrace({
      startedAt,
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      requestId,
      error: err,
      toolLLMTelemetry: errToolTel,
    });
    if (diagnosticTraceOnError !== undefined && err && typeof err === 'object') {
      (err as { diagnosticTrace?: V5DiagnosticTrace }).diagnosticTrace = diagnosticTraceOnError;
    }
    // Throw upward — route-v2.ts can decide the wire-level mapping. Keeping
    // the branch honest: success path returns normally; failure surfaces
    // as a thrown error that the route converts to a 500 BoundaryError.
    throw err;
  }

  try {
    // Context v2 S0 (ROADMAP 1.73, 03 §2): draft is INSTRUMENTED but NOT
    // re-budgeted (the 58,564-char draft prompt is ROADMAP 1.75's scope).
    // The draft LLM call happens inside the unified pipeline; its usage
    // surfaces post-hoc via toolLLMTelemetry (prompt/completion tokens —
    // cache token fields are not carried on that trace, so they report
    // null). Emitted only when an LLM call actually landed.
    if (draftResult.toolLLMTelemetry) {
      emitContextBudget({
        call_site: 'draft_graph',
        model: draftResult.toolLLMTelemetry.model || null,
        prompt_version: draftResult.toolLLMTelemetry.prompt_version ?? null,
        prompt_hash: draftResult.toolLLMTelemetry.prompt_hash ?? null,
        request_id: requestId,
        scenario_id: payload.scenario_id,
        section_chars: { brief: effectiveBrief.length },
        total_chars: effectiveBrief.length,
        truncations: [],
        summary_lag_turns: null,
        ui_narrowed: null,
        usage: {
          input_tokens: draftResult.toolLLMTelemetry.input_tokens,
          output_tokens: draftResult.toolLLMTelemetry.output_tokens,
        },
      });
    }

    // M2 LLM calls made by the dual-draft stage this turn (0 or 1). Counted
    // whenever M2 actually reached the model — even if the merge applied
    // nothing, timed out, or errored — NOT gated on whether a merge landed.
    // Drives llm_calls_used accounting.
    let m2LlmCallsUsed = 0;

    // ── V6 dual-model draft enrichment (flag-gated, default OFF) ───────────
    // When CEE_V6_DUAL_DRAFT_ENABLED is on, an M2 review pass proposes
    // GraphV3-valid additions that deterministic code merges or rejects before
    // this turn commits. The stage is producer-agnostic: it accepts any valid
    // GraphV3 draft and returns either an enriched graph or the untouched M1
    // graph — it never throws and never downgrades analysis-readiness. Lazy-
    // imported so the flag-OFF path never loads the module (byte-identity
    // contamination guard: cee/dual-draft/__tests__/dispatch-flag-off.test.ts).
    // Swapping the merged graph into draftResult here — before commit (p_graph),
    // the inline draft_graph field, the node/edge counts, and the analysis-
    // affecting hash below — keeps the whole turn coherent under one atomic
    // commit. Phase 0/1 ships a no-op enricher; the M2 path lands in later
    // phases behind the same flag.
    if (config.features.v6DualDraftEnabled && draftResult.graphOutput !== null) {
      try {
        const { enrichDraftGraph, m2LlmCallMade } = await import('../../cee/dual-draft/index.js');
        const outcome = await enrichDraftGraph({
          graph: draftResult.graphOutput,
          brief: effectiveBrief,
          analysisReady: draftResult.analysisReady ?? null,
          requestId,
          scenarioId: payload.scenario_id,
          turnId: payload.turn_id,
          pipelineElapsedMs: draftResult.latencyMs,
        });
        // Accounting is call-based, not merge-based: a "called-but-merged-
        // nothing" / timed-out / errored M2 still spent a call. The exhaustive
        // helper (co-located with the reason taxonomy) classifies the outcome.
        if (m2LlmCallMade(outcome.reason)) {
          m2LlmCallsUsed = 1;
        }
        if (outcome.enriched) {
          // assistantText is nulled alongside the graph swap: the M1 handler
          // narration describes the PRE-merge graph, and the narration-count
          // guard would otherwise compare it against merged counts — firing a
          // spurious count-mismatch telemetry event on every enriched turn
          // and polluting the standing Sonnet-drift ops signal. Nulling skips
          // that guard (it is telemetry-only; the user-facing narrative is
          // built deterministically from the final graph either way).
          draftResult = { ...draftResult, graphOutput: outcome.graph, assistantText: null };
        }
      } catch (enrichErr) {
        // Enrichment must never break the M1 draft. enrichDraftGraph is
        // contracted not to throw; this catch is a belt-and-braces backstop
        // that degrades to the M1 graph on any unexpected failure.
        log.warn(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            err:
              enrichErr instanceof Error
                ? { name: enrichErr.name, message: enrichErr.message }
                : { message: String(enrichErr) },
          },
          'V6 dual-draft enrichment threw — degrading to M1 draft',
        );
      }
    }

    // llm_calls_used: the unified pipeline's draft stage makes at least one
    // LLM call (see src/cee/unified-pipeline/stages/parse.ts). V4's
    // DraftGraphResult exposes this via `toolLLMTelemetry` but not as a
    // simple integer count. Using 1 as an honest minimum rather than 0
    // (zero would misrepresent the turn as a no-LLM deterministic event).
    //
    // graph: when graphOutput is present, it is passed to append_turn_atomic
    // as p_graph and persisted atomically with the turn insert. If the RPC
    // throws (StateCommitFailedError), both graph and turn roll back together
    // and the catch below returns commitPerformed=false.
    // V5 Phase 1 brief persistence: persist payload.message as
    // scenarios.brief_text on the first SUCCESSFUL draft turn. The RPC
    // enforces first-write-wins via `WHERE brief_text IS NULL OR
    // brief_text = ''`, so subsequent repair / edit / regeneration
    // draft_graph turns also pass through this dispatch path safely —
    // the second write is a no-op at the DB layer.
    //
    // Persist the normalised brief on EVERY draft turn, regardless of
    // whether draftResult.graphOutput is present. The RPC's first-write-
    // wins predicate (`WHERE brief_text IS NULL OR brief_text = ''`)
    // protects against stomping; a graphless draft writing the brief
    // first does NOT lock the user out, because a later draft with the
    // real brief value will hit the same predicate-protected RPC and
    // the write is a no-op only if the values match (the prior fear of
    // "real brief silently dropped" was overstated — the user's actual
    // brief lands either on the first attempt or on the retry, whichever
    // succeeds first).
    //
    // The previous guard (only persist when graphOutput != null) caused
    // the V5 Phase 3A failure mode: on chip-click run_analysis turns the
    // decision_review enricher loads scenarios.brief_text and skips with
    // `no_brief` when null, silently dropping the entire decision_review
    // block emission. See PR #178 root-cause investigation.
    //
    // Normalisation: enforces the same length / whitespace invariants
    // as the DB CHECK constraint, with truncation rather than failure
    // on over-length inputs. Whitespace-only payloads collapse to
    // undefined → RPC param NULL → no write.
    // C2 — persist the EFFECTIVE brief (the assembled one on explicit-
    // generate turns): brief_text is what downstream enrichers (decision_
    // review) and future draft turns read as "the user's brief", and the
    // first-write-wins RPC predicate still protects an already-seeded value.
    const briefNorm = normaliseBriefText(effectiveBrief);
    if (briefNorm.truncated) {
      emit(TelemetryEvents.V5BriefTextNormalised, {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        original_length: briefNorm.originalLength,
        truncated_length: briefNorm.value?.length ?? 0,
        reason: 'over_8000_chars',
      });
    }
    const briefTextForCommit = briefNorm.value;

    // ── HOLD-WIPE fix (task_2e1b8c87): thread holds through this commit ──
    // Closes the F-HELD round-2 KNOWN RESIDUAL for the draft path: this
    // commit previously threaded NO priorPendingActions, so ANY draft turn
    // silently wiped a live consent hold. Read the prior turn's pendings
    // (single-row read; [] on a genuinely-first turn, degrades to [] on
    // failure with store-layer telemetry — NOTE this is NOT the forbidden
    // `readRecent` turn-chain read the freshness invariant below pins) and
    // validate holds against the NEW draft graph: threaded re-pinned when
    // the held batch still referees cleanly, honest lapse (notice +
    // redacted telemetry) when the wholesale redraft invalidated it.
    const priorPendingActions = await loadMostRecentPendingActions(
      payload.scenario_id,
      requestId,
    );
    const postDraftGraphHash = ((): string | null => {
      try {
        return computeAnalysisAffectingGraphHash(
          draftResult.graphOutput as GraphStateIngress | null | undefined,
        );
      } catch {
        return null;
      }
    })();
    const holdThread = threadHoldsThroughMutatingCommit({
      priorPendingActions,
      graphAfterCommit: draftResult.graphOutput ?? null,
      graphHashAfterCommit: draftResult.graphOutput != null ? postDraftGraphHash : null,
      // No per-operation record on a draft — the whole NEW graph IS the
      // mutation. Fulfilment detection (round-3 concern 1) falls back to
      // the post-draft end state: a concept the redraft itself delivered
      // retires without the false "has lapsed" sentence.
      appliedOperations: null,
      nowMs: Date.now(),
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      requestId,
    });
    emitHoldLapseTelemetry(holdThread.lapsed, {
      requestId,
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      site: 'draft_graph_dispatch',
    });

    // Capture persistence_ms for the diagnostic trace's substage timings.
    // Cheap: two Date.now() calls regardless of flag state — the timing is
    // only surfaced when the trace is built (flag-on); flag-off path
    // discards the value at the build site without allocating the trace.
    const commitStartedAt = Date.now();
    const commitResult = await commitDirectAnswer(
      // Provisional response — the real response is built below once we know
      // graphPersisted. This value is recorded in the turn row but is NOT
      // sent to the client (the caller uses the response we return).
      // HOLD-WIPE fix: the lapse notice IS committed on the provisional
      // response (assistant_text below) so the durable copy carries it; the
      // committed text is re-attached to the real wire response after the
      // build (stored copy ⊆ wire copy — the draft narrative itself is
      // reconstructable from the persisted graph, per the note below).
      //
      // V5 Conversation Context Reliability: the draft turn's assistant
      // narrative is built AFTER this commit (it needs graphPersisted, and
      // building it has a telemetry side-effect — V5PostDraftCoachingSource
      // Selected — that must only fire once persistence has SUCCEEDED; see the
      // "does NOT emit … when graph persistence fails" regression test). We
      // therefore do NOT capture assistant_message on the draft turn (it stays
      // null); the draft narrative is reconstructable from the persisted graph,
      // which IS projected into the next turn's ContextPack. We DO capture the
      // user brief (userMessage) — it is graphPersisted-independent and
      // side-effect-free. Capturing the draft narrative without a second write
      // or breaking the telemetry-after-persistence invariant is a follow-up.
      { response_version: 2, assistant_text: holdThread.notice ?? '', blocks: [], suggested_actions: [], insights: [], stage_indicator: payload.stage },
      {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        // 1 = the unified pipeline's draft-stage call (honest minimum). +1
        // whenever the V6 dual-draft M2 review actually reached the model this
        // turn (call-based, not merge-based — a call that merged nothing /
        // timed out / errored still counts). m2LlmCallsUsed is 0 for the
        // no-call inert paths (sentinel, headroom, model-resolution gate).
        llm_calls_used: 1 + m2LlmCallsUsed,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        // A3 graph CAS observe-mode: the draft path is DELIBERATELY
        // uninstrumented — no expectedGraphIdentityHash / expectedGraph
        // AnalysisHash are threaded (undefined). This path performs no
        // server-side persisted-graph read (it never runs buildTurnContext),
        // and manufacturing an expected base from request input would violate
        // the trusted-base rule (graph-cas-conflict.ts). The CAS hook
        // therefore categorises draft writes as `first_write` on fresh
        // scenarios and `no_expected`/`not_instrumented` on redrafts — that
        // IS the coverage metric for this path, not a gap to "fix" by
        // trusting the request.
        graph: draftResult.graphOutput ?? undefined,
        briefText: briefTextForCommit,
        // HOLD-WIPE fix: thread the (validated) prior pendings so the commit
        // carry-forward runs on this path; graph_hash is the NEW draft's
        // analysis-affecting hash (only when a graph is actually written).
        priorPendingActions: holdThread.threaded,
        // ROADMAP 2.63 C3/C4 — retire the honoured draft-offer pending
        // atomically with the draft it produced (see the param doc).
        ...(params.consumedPendingRefs !== undefined
          ? { consumedPendingRefs: params.consumedPendingRefs }
          : {}),
        ...(draftResult.graphOutput != null && postDraftGraphHash !== null
          ? { graph_hash: postDraftGraphHash }
          : {}),
        // V5 Stage 2B-1b: the route-v2 draft path never runs buildTurnContext,
        // so no coaching_state is derived for this turn — persist NULL explicitly.
        coaching_state: null,
        // V5 Conversation Context Reliability: persist the user's brief.
        userMessage: payload.message,
      },
    );
    const persistenceMs = Date.now() - commitStartedAt;

    let response = draftResultToOlumiResponse(draftResult, payload, commitResult.graphPersisted, requestId);
    // HOLD-WIPE fix — the committed provisional response carried the lapse
    // notice (and the commit seam may have appended its own turn-TTL lapse
    // notice, F-HELD 2b). The REAL wire response is built above, so
    // re-attach the committed text here — the honest sentence must ship,
    // never be stored-only. A bare `{}` commit result (test-double shape)
    // has no assistant_text and appends nothing.
    const committedText = commitResult.response?.assistant_text;
    if (typeof committedText === 'string' && committedText.trim().length > 0) {
      response = {
        ...response,
        assistant_text: appendLapseNotice(response.assistant_text, committedText.trim()),
      };
    }
    // V5 finaliser contract: surface the rich pipeline payload on the
    // dispatch result so route-v2.ts can stamp it via finaliseV5Response.
    // Only surface when the graph actually persisted — a non-persisted
    // draft has no canvas state for the UI to apply readiness against.
    const baseAnalysisReady: AnalysisReadyPayload | undefined =
      commitResult.graphPersisted && draftResult.analysisReady
        ? (draftResult.analysisReady as AnalysisReadyPayload)
        : undefined;

    // F1 (PR A): attach a short, sanitised, pre-analysis "assumption to
    // check" line to analysis_ready as the additive, passthrough-safe
    // `coaching_summary`. It reuses the post-draft narrative's gated
    // assumption tier (so the structured receipt insight matches the chat
    // narrative) and is null when only the generic fallback applies — the
    // receipt should not surface a weak insight. The central egress sanitiser
    // (sanitiseOlumiResponseForEgress) does NOT walk analysis_ready, so the
    // prose is scrubbed here with the same sanitiseCoachingProse guard the
    // assistant_text narrative uses. DGAI reads this to populate the
    // already-built ModelReceiptBlock (PR B); nothing renders it today.
    const receiptSummaryRaw = baseAnalysisReady
      ? buildModelReceiptSummary({
          graph: draftResult.graphOutput,
          analysisReady: draftResult.analysisReady ?? null,
          strengthenItems: draftResult.strengthenItems,
          coachingBiasSignals: draftResult.coachingBiasSignals,
        })
      : null;
    const receiptSummary =
      receiptSummaryRaw !== null
        ? sanitiseCoachingProse(receiptSummaryRaw, draftResult.graphOutput).text.trim()
        : '';
    const analysisReady: AnalysisReadyPayload | undefined =
      baseAnalysisReady && receiptSummary.length > 0
        ? { ...baseAnalysisReady, coaching_summary: receiptSummary }
        : baseAnalysisReady;

    // V5 state-trust: derive freshness WITHOUT a session-store read.
    // Draft is the first-turn brief shape — the dispatcher invariant
    // pinned by route-v2-draft-graph-persistence.test.ts forbids
    // readRecent here.
    //
    // Wire freshness is `none` — the canonical "no successful
    // run_analysis fact" verdict. That's the honest user-facing state:
    // a brand new session has no prior analysis. UI handles `none`
    // exactly the same as it handles "no fact found via lookup", so
    // the wire stays consistent with non-shortcut dispatch paths.
    //
    // A separate telemetry-only event (`first_turn_assumed`) records
    // the operator-facing assumption that we did not read the chain
    // to verify it was empty. Replay scenarios (where a "first-turn"
    // shape lands on a session with prior facts) surface as a divergence
    // between the wire `none` and any later turn's actual `freshness`
    // verdict — operators have a grep target.
    // HOLD-WIPE fix: reuse the pre-commit hash of the SAME graph object
    // (pure function, identical input) instead of re-deriving it here.
    const currentGraphHash = postDraftGraphHash;
    const freshness: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: null,
    };
    emitFreshnessTelemetry(
      freshness,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'draft_graph',
      },
      {
        prior_fact_count: 0,
        current_turn_fact_count: 0,
      },
    );
    emit(TelemetryEvents.AnalysisFreshnessFirstTurnAssumed, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'draft_graph',
      reason: 'dispatcher_invariant_forbids_readRecent',
    });

    // V5 diagnostic trace — additive observability. Builder short-circuits
    // when CEE_DIAGNOSTIC_TRACE_ENABLED is off (returns undefined; no
    // allocations). Otherwise produces the full per-stage breakdown from
    // V4's existing telemetry (toolLLMTelemetry, pipelineOutcome,
    // draftGraphTimings) plus the captured persistence_ms. The route's
    // egress wrapper threads this onto the wire via the strip-validate-
    // reattach pattern.
    const diagnosticTrace = buildV5DiagnosticTrace({
      startedAt,
      draftResult,
      commitResult,
      persistenceMs,
      scenarioId: payload.scenario_id,
      turnId: payload.turn_id,
      requestId,
    });

    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: draftResult.latencyMs,
        graph_persisted: commitResult.graphPersisted,
        analysis_ready_present: analysisReady != null,
        analysis_ready_status: analysisReady?.status ?? null,
      },
      'V5 draft_graph dispatch committed',
    );
    return {
      response,
      commitPerformed: true,
      analysisReady,
      graph: draftResult.graphOutput,
      freshness,
      ...(diagnosticTrace !== undefined ? { diagnosticTrace } : {}),
    };
  } catch (err) {
    // Route maps commitPerformed=false → HTTP 500 INTERNAL_ERROR (retryable: true).
    // Client sees the generic retry prompt; the response built below is server-side only.
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        graph_produced: draftResult.graphOutput !== null,
        node_count: draftResult.graphOutput?.nodes?.length ?? 0,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph dispatch — commit failed; route returns 500 INTERNAL_ERROR',
    );
    const response = draftResultToOlumiResponse(draftResult, payload, false, requestId);
    return { response, commitPerformed: false, graph: draftResult.graphOutput };
  }
}
