/**
 * V5 diagnostic trace — additive observability surface attached to V5
 * responses when `CEE_DIAGNOSTIC_TRACE_ENABLED=true`.
 *
 * Why this exists
 * ---------------
 * The V5 dispatch path never called `attachDiagnosticTrace` (the V1/V2
 * envelope helper at `src/orchestrator/pipeline/pipeline.ts`), so debug
 * bundles for draft_graph turns returned null for every latency-relevant
 * field. This module is the V5-side equivalent: a wrap around the existing
 * `DiagnosticTraceCollector` that adds substage timings, correlation IDs,
 * retry metadata, environment fields, and the V4 pipeline outcome — the
 * full per-stage breakdown a single debug bundle export should reveal.
 *
 * Contract
 * --------
 * - Observability only. No behaviour change to graph generation, routing,
 *   persistence, or response copy. The trace lives in `_diagnostic_trace`
 *   on the wire body; the strict `OlumiResponseSchema` never sees it
 *   (the route-v2 egress wrapper strips before validation, re-attaches
 *   after).
 * - Flag-gated. With `config.features.diagnosticTraceEnabled === false`
 *   every builder short-circuits at entry: no allocations, no captures,
 *   no log volume. Wire body is unchanged.
 * - Redaction. The trace contains hashes and token / char counts only.
 *   No raw prompt text, no raw response text, no API keys. The brief
 *   tolerated "length-capped previews" but the strictest reading is to
 *   not surface previews at all in this branch; if a later iteration
 *   wants them, `truncateString` at `src/utils/redaction.ts:42` already
 *   exists.
 *
 * Two builders
 * ------------
 * - `buildV5DiagnosticTrace` — full breakdown for the draft_graph
 *   dispatch path. Translates V4's `toolLLMTelemetry`, `pipelineOutcome`,
 *   and `draftGraphTimings` (already extracted by `handleDraftGraph`
 *   into `DraftGraphResult` and discarded today) into the V5 envelope
 *   sections.
 * - `buildMinimalV5DiagnosticTrace` — total duration + correlation IDs
 *   + whatever `V5TurnTimings` already captured for the turn-executor
 *   path. No LLM call records, no pipeline outcome — just enough to
 *   answer "where did the time go" for non-draft turns.
 *
 * Builder for the error / timeout path (`buildErrorV5DiagnosticTrace`)
 * lives in the same module so `dispatchDraftGraph`'s catch block can
 * attach a partial trace on a thrown error; route-v2's catch branch then
 * threads it onto the BoundaryError wire envelope.
 */

import type { GraphV3T } from '../../orchestrator/types.js';
import type {
  DiagnosticTrace,
  LLMCallTrace,
} from '../../orchestrator/pipeline/diagnostic-trace.js';
import {
  DiagnosticTraceCollector,
  emptyDiagnosticTrace,
} from '../../orchestrator/pipeline/diagnostic-trace.js';
import type { PipelineOutcome } from '../../cee/unified-pipeline/types.js';
import type { DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import type { EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import type { CommitResult } from '../commit.js';
import type {
  V5TurnTimings,
  DraftGraphTimings,
  DraftGraphNumericTimingKey,
} from '../telemetry/turn-timings.js';
import { DRAFT_GRAPH_NUMERIC_TIMING_KEYS } from '../telemetry/turn-timings.js';
import { config } from '../../config/index.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { GIT_COMMIT_SHORT } from '../../version.js';

// ─── Trace shape — additive on top of DiagnosticTrace ─────────────────────

export interface V5BenchmarkingTimings {
  total_duration_ms: number;
  substage_timings: {
    route_classification_ms?: number;
    prompt_assembly_ms?: number;
    llm_call_ms?: number;
    parse_ms?: number;
    repair_ms?: number;
    validation_ms?: number;
    persistence_ms?: number;
    finalisation_ms?: number;
    total_handler_duration_ms?: number;
    // ── Full draft substage detail (CEE_DRAFT_SUBSTAGE_DETAIL, default OFF).
    // Absent entirely when the flag is off, so the historical payload is
    // byte-identical. See DRAFT_GRAPH_NUMERIC_TIMING_KEYS for why these
    // exist: without them the draft's non-LLM time is an unattributable
    // residual. Measured on staging 2026-07-18, these five sum to ~29 ms
    // against a ~62,500 ms LLM call — the point of emitting them is to make
    // that ratio VISIBLE rather than assumed.
    total_ms?: number;
    normalise_ms?: number;
    enrich_ms?: number;
    repair_llm_ms?: number;
    repair_deterministic_ms?: number;
    threshold_sweep_ms?: number;
    package_ms?: number;
    boundary_ms?: number;
  };
}

/**
 * Trace-surface names for the pipeline's numeric timing keys. Only the two
 * historically-renamed keys need an entry; everything else passes through
 * under its own name. Keyed by `DraftGraphNumericTimingKey` so a new
 * pipeline timing key cannot be added without TypeScript checking it here.
 */
const TRACE_KEY_RENAMES: Partial<Record<DraftGraphNumericTimingKey, string>> = {
  parse_llm_ms: 'llm_call_ms',
  validation_pipeline_ms: 'validation_ms',
};

export interface V5CorrelationIds {
  request_id: string;
  scenario_id: string;
  turn_id: string;
  response_hash?: string;
  graph_hash?: string;
  prompt_hash?: string;
}

export interface V5Retry {
  llm_attempt_count?: number;
  retry_count?: number;
  retry_reasons?: readonly string[];
  timed_out?: boolean;
  error_type?: string;
}

export interface V5Environment {
  build_sha?: string;
  service_instance_id?: string;
  environment?: string;
}

/**
 * Copy-source delivery diagnostics (Scope C). Additive, non-user-facing
 * record proving which structured coaching source reached the user surface on
 * a deterministic post-analysis turn. Structural only — no labels, no values,
 * no user prose. Populated today only on the `turn_executor` minimal-trace
 * path (the post-analysis advice gate); other exit paths leave it undefined.
 */
export interface V5CoachingDelivery {
  /** Surface/handler that produced the user-facing copy. */
  handler: string;
  /** Composer / advice class within the handler. */
  composer: string;
  /** Dominant structured source the copy drew from. */
  copy_source: string;
  /** Projected analysis fields available to the composer (structural only). */
  coaching_fields_used: readonly string[];
  /**
   * Whether phase3 block context (decision_review on the selected fact) was
   * available — by-design false when V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW
   * is off.
   */
  phase3_block_context_available: boolean;
  /** Whether the copy drew from the projected analysis fallback rather than
   *  the decision_review enrichment. */
  fallback_analysis_used: boolean;
  /** Whether the response was deterministic (no LLM call) or LLM-backed. */
  deterministic: boolean;
}

export interface V5DiagnosticTrace extends DiagnosticTrace {
  benchmarking: V5BenchmarkingTimings;
  correlation_ids: V5CorrelationIds;
  pipeline_outcome?: PipelineOutcome;
  retry?: V5Retry;
  environment?: V5Environment;
  /**
   * Indicates which V5 dispatch family produced this trace. Useful for
   * filtering across a debug bundle that spans multiple turns.
   */
  exit_path: V5DiagnosticExitPath;
  /**
   * Copy-source delivery diagnostics (Scope C, additive). Present only when a
   * deterministic coaching surface (the post-analysis advice gate) produced
   * the response and the flag is on; undefined otherwise.
   */
  coaching_delivery?: V5CoachingDelivery;
  /**
   * Schema version of the V5 trace envelope itself (NOT a prompt /
   * grammar version). Bumped on any breaking shape change. Exporters
   * read this to choose the right field projection.
   */
  trace_version: 1;
}

export type V5DiagnosticExitPath =
  | 'draft_graph'
  | 'turn_executor'
  | 'chip_click'
  | 'edit_graph'
  | 'system_event'
  | 'frame_no_brief_guard'
  // META-DECISION-DIAGNOSIS-2026-07-20 — round-1 process-meta intake
  // guard: a question TO the assistant about the process (the product's
  // own pre-analysis spark prompts, or a narrowly-matched typed variant)
  // on the empty-canvas frame state is ANSWERED deterministically instead
  // of being captured as a decision brief by the draft/clarify pipeline.
  // Zero LLM calls, no commit (scenario stays fresh so the user's next
  // real brief still drafts).
  | 'process_meta_intake'
  // ROADMAP 2.63 C2 — deterministic honest decline when an explicit
  // generate (generate_model/explicit_generate wire flag) arrives but no
  // usable brief exists anywhere (message, persisted brief_text, recent
  // user turns). Distinct from frame_no_brief_guard by design: the user
  // explicitly asked to generate, so the copy names what is missing.
  | 'explicit_generate_no_brief'
  // ROADMAP 2.63 C4 — deterministic decline-with-redraft-offer when an
  // explicit generate (or a stale build-offer consent) arrives on a
  // scenario that already has a graph (request graph_state or persisted).
  // The turn commits a `draft_graph` (redraft) pending + offer chip; the
  // consent turn resumes through the draft-offer pre-route and exits as
  // a normal `draft_graph`.
  | 'explicit_generate_graph_present'
  // Clarify v2 (E0-B, ROADMAP 1.94 Option A replacement) — flag-gated
  // (CEE_CLARIFY_V2_ENABLED) draft-preflight clarification response: the
  // deterministic brief rubric found the brief thin and the route replied
  // with up to 3 tap-able questions instead of dispatching the draft.
  // Zero LLM calls on this path.
  | 'clarify_v2'
  | 'draft_graph_error';

/**
 * Edit-lane LLM call attribution (S3-L6 / F-5). The edit_graph turn calls the
 * LLM once (plus repair attempts), but its exit path builds only the minimal
 * trace, whose `llm_calls[]` came exclusively from `V5TurnTimings` — a shape
 * the edit dispatch never captures. The result: `_diagnostic_trace.llm_calls`
 * was structurally `[]` on every edit turn that demonstrably called the LLM,
 * so diagnosing an edit meant reading Render logs. This carries the edit LLM
 * call's real, already-captured attribution (`EditGraphTraceDiagnostics` R7
 * accumulators + `EditGraphResult.latencyMs`) into the trace's `llm_calls[]`
 * — the same "record the real call" shape the draft (`toolLLMTelemetry`) and
 * turn_executor (`V5TurnTimings`) paths already emit.
 *
 * Present ONLY when the edit LLM actually ran: the edit dispatch builds this
 * from the diagnostics of a returned edit result, and omits it entirely on
 * deterministic (no-LLM) edit exits (constraint shortcut, deterministic
 * value pre-route), so a no-LLM edit still honestly reports `llm_calls: []`.
 * `input_tokens` is the R7 estimate (`input_tokens_est`) summed across repair
 * attempts; `latency_ms` is the handler's wall-clock (includes repair loop),
 * not a single provider round-trip. `model` is `null` only when the adapter
 * genuinely did not expose one (test doubles) — an honest sentinel, mapped to
 * `'unknown'` at record time (mirrors the routing-call convention).
 */
export interface EditGraphLlmCallTelemetry {
  readonly provider: string;
  readonly model: string | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly latency_ms: number;
  readonly stop_reason: string | null;
  readonly repair_attempts: number;
}

/**
 * S3-L6 / F-5 — map a returned edit result's already-captured R7 LLM
 * diagnostics into edit-lane call attribution, so an edit turn's
 * `_diagnostic_trace.llm_calls[]` carries the call it made (previously
 * structurally empty on every edit turn — diagnosis-hostile).
 *
 * Lives HERE (the trace assembly), not in `edit-graph.ts`: 19 dispatch test
 * suites `vi.mock` the whole `tools/edit-graph.js` module with a bare factory,
 * which would strand a new export there (trap-12 — a mock factory REPLACES the
 * module). This module is mocked by no test, and it already type-imports the
 * sibling `draft-graph.js` result shape — so it is the natural, mock-safe home.
 *
 * Returns `undefined` when the edit LLM did NOT run (deterministic exits:
 * constraint shortcut, deterministic value pre-route, and any partial result
 * with no diagnostics), so a no-LLM edit still reports `llm_calls: []` honestly
 * rather than a fabricated zero-token call. The "did it run" signal is the R7
 * accumulators: on an LLM path `model` is the adapter model and/or tokens are
 * summed; on a deterministic path `model` stays `null` and both sums are 0.
 *
 * `provider` is the resolved adapter name (the dispatch knows it; the R7
 * diagnostics do not carry it).
 */
export function extractEditLlmCallTelemetry(
  result: Pick<EditGraphResult, 'diagnostics' | 'latencyMs'>,
  provider: string,
): EditGraphLlmCallTelemetry | undefined {
  const diag = result.diagnostics;
  if (!diag) return undefined;
  const inputTokens = diag.input_tokens_est ?? 0;
  const outputTokens = diag.output_tokens ?? 0;
  const llmRan = diag.model != null || inputTokens > 0 || outputTokens > 0;
  if (!llmRan) return undefined;
  return {
    provider,
    model: diag.model ?? null,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: result.latencyMs,
    stop_reason: diag.stop_reason ?? null,
    repair_attempts: diag.repair_attempts ?? 0,
  };
}

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface BuildV5DiagnosticTraceInput {
  readonly startedAt: number;
  readonly draftResult: DraftGraphResult;
  readonly commitResult: CommitResult;
  readonly persistenceMs: number;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
}

export interface BuildMinimalV5DiagnosticTraceInput {
  readonly startedAt: number;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly exitPath: V5DiagnosticExitPath;
  readonly graph?: GraphV3T | null;
  readonly turnTimings?: V5TurnTimings;
  /** Copy-source delivery diagnostics (Scope C). Surfaced when the
   *  post-analysis advice gate produced the response. */
  readonly coachingDelivery?: V5CoachingDelivery;
  /**
   * Edit-lane LLM call attribution (S3-L6 / F-5). Present only when the
   * edit_graph turn actually invoked the LLM; recorded into `llm_calls[]`
   * with role `edit_graph`. Omitted on deterministic edit exits so a no-LLM
   * edit honestly reports `llm_calls: []`. See `EditGraphLlmCallTelemetry`.
   */
  readonly editLlmCall?: EditGraphLlmCallTelemetry;
}

export interface BuildErrorV5DiagnosticTraceInput {
  readonly startedAt: number;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly error: unknown;
  /** Optional partial telemetry surfaced by the error (e.g. pipeline body) */
  readonly toolLLMTelemetry?: DraftGraphResult['toolLLMTelemetry'];
  readonly pipelineOutcome?: PipelineOutcome;
  readonly draftGraphTimings?: DraftGraphTimings;
}

// ─── Builders ──────────────────────────────────────────────────────────────

/**
 * Full breakdown for the draft_graph dispatch path. Returns `undefined`
 * when `CEE_DIAGNOSTIC_TRACE_ENABLED` is off — short-circuit at entry so
 * the flag-off case allocates nothing and emits no log volume.
 */
export function buildV5DiagnosticTrace(
  input: BuildV5DiagnosticTraceInput,
): V5DiagnosticTrace | undefined {
  if (!config.features.diagnosticTraceEnabled) return undefined;

  const collector = new DiagnosticTraceCollector();
  populateCollectorFromDraftResult(collector, input.draftResult);

  const frozen = collector.freeze();
  const benchmarking = buildBenchmarkingForDraftGraph(input);
  const correlationIds: V5CorrelationIds = {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
    graph_hash: safeGraphHash(input.draftResult.graphOutput) ?? undefined,
    prompt_hash: input.draftResult.toolLLMTelemetry?.prompt_hash,
  };

  return assembleTrace({
    frozen,
    benchmarking,
    correlationIds,
    pipelineOutcome: input.draftResult.pipelineOutcome,
    retry: buildRetryFromPipelineOutcome(input.draftResult.pipelineOutcome),
    environment: buildEnvironment(),
    exitPath: 'draft_graph',
  });
}

/**
 * Minimal trace for non-draft dispatch paths. Populates total duration +
 * correlation IDs + whatever substage data the path already exposed via
 * `V5TurnTimings`. Useful for "where did the time go" on turn_executor /
 * chip_click / edit_graph / system_event without the per-LLM-call
 * detail draft_graph produces.
 */
export function buildMinimalV5DiagnosticTrace(
  input: BuildMinimalV5DiagnosticTraceInput,
): V5DiagnosticTrace | undefined {
  if (!config.features.diagnosticTraceEnabled) return undefined;

  const totalDurationMs = Math.max(0, Date.now() - input.startedAt);
  const tt = input.turnTimings;
  const benchmarking: V5BenchmarkingTimings = {
    total_duration_ms: totalDurationMs,
    substage_timings: {
      route_classification_ms: tt?.routing_llm_ms,
      prompt_assembly_ms: tt?.context_pack_assembly_ms,
      persistence_ms: tt?.commit_ms,
      total_handler_duration_ms: tt?.handler_execute_ms,
    },
  };

  const collector = new DiagnosticTraceCollector();
  if (tt) {
    populateCollectorFromTurnTimings(collector, tt);
  }
  // S3-L6 / F-5: record the edit-lane LLM call so an edit turn's trace carries
  // the call it demonstrably made (previously always `[]` on this path). The
  // edit dispatch supplies this ONLY when the LLM actually ran, so a
  // deterministic edit still freezes an empty `llm_calls[]` honestly.
  if (input.editLlmCall) {
    populateCollectorFromEditTelemetry(collector, input.editLlmCall);
  }
  const frozen = collector.freeze();

  const correlationIds: V5CorrelationIds = {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
    graph_hash: safeGraphHash(input.graph) ?? undefined,
    // Served routing prompt hash (when captured) — mirrors the draft_graph
    // builder's correlation prompt_hash so a bundle can join a turn_executor
    // turn to its prompt identity.
    ...(tt?.routing_prompt_hash ? { prompt_hash: tt.routing_prompt_hash } : {}),
  };

  return assembleTrace({
    frozen,
    benchmarking,
    correlationIds,
    environment: buildEnvironment(),
    exitPath: input.exitPath,
    coachingDelivery: input.coachingDelivery,
  });
}

/**
 * Partial trace for the draft_graph error / timeout path. The dispatcher
 * catch block attaches this to the thrown error so route-v2's BoundaryError
 * branch can thread it onto the wire 500 envelope.
 */
export function buildErrorV5DiagnosticTrace(
  input: BuildErrorV5DiagnosticTraceInput,
): V5DiagnosticTrace | undefined {
  if (!config.features.diagnosticTraceEnabled) return undefined;

  const totalDurationMs = Math.max(0, Date.now() - input.startedAt);
  const errorType = classifyErrorType(input.error);
  const timedOut = errorType === 'LLMTimeoutError' || errorType === 'AbortError';

  const collector = new DiagnosticTraceCollector();
  if (input.toolLLMTelemetry) {
    collector.recordLLMCall(toolLLMTelemetryToCallTrace(input.toolLLMTelemetry, errorType));
  }

  const benchmarking: V5BenchmarkingTimings = {
    total_duration_ms: totalDurationMs,
    substage_timings: {
      llm_call_ms: input.draftGraphTimings?.parse_llm_ms,
      parse_ms: input.draftGraphTimings?.parse_ms,
      repair_ms: input.draftGraphTimings?.repair_ms,
      validation_ms: input.draftGraphTimings?.validation_pipeline_ms,
    },
  };

  const correlationIds: V5CorrelationIds = {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
    prompt_hash: input.toolLLMTelemetry?.prompt_hash,
  };

  const retry: V5Retry = {
    timed_out: timedOut,
    error_type: errorType,
    retry_count: input.pipelineOutcome?.llm_repair?.attempts,
  };

  return assembleTrace({
    frozen: collector.freeze(),
    benchmarking,
    correlationIds,
    pipelineOutcome: input.pipelineOutcome,
    retry,
    environment: buildEnvironment(),
    exitPath: 'draft_graph_error',
  });
}

// ─── Internals ────────────────────────────────────────────────────────────

interface AssembleInput {
  readonly frozen: DiagnosticTrace;
  readonly benchmarking: V5BenchmarkingTimings;
  readonly correlationIds: V5CorrelationIds;
  readonly pipelineOutcome?: PipelineOutcome;
  readonly retry?: V5Retry;
  readonly environment?: V5Environment;
  readonly exitPath: V5DiagnosticExitPath;
  readonly coachingDelivery?: V5CoachingDelivery;
}

function assembleTrace(input: AssembleInput): V5DiagnosticTrace {
  return {
    // Base DiagnosticTrace fields
    llm_calls: input.frozen.llm_calls,
    prompt_identity: input.frozen.prompt_identity,
    zone2_assembly: input.frozen.zone2_assembly,
    tool_policy: input.frozen.tool_policy,
    provider_resolution: input.frozen.provider_resolution,
    structured_output_config: input.frozen.structured_output_config,
    streaming_metrics: input.frozen.streaming_metrics,
    fallback_trace: input.frozen.fallback_trace,
    // V5 superset
    benchmarking: input.benchmarking,
    correlation_ids: input.correlationIds,
    ...(input.pipelineOutcome ? { pipeline_outcome: input.pipelineOutcome } : {}),
    ...(input.retry ? { retry: input.retry } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
    ...(input.coachingDelivery ? { coaching_delivery: input.coachingDelivery } : {}),
    exit_path: input.exitPath,
    trace_version: 1,
  };
}

function populateCollectorFromDraftResult(
  collector: DiagnosticTraceCollector,
  draftResult: DraftGraphResult,
): void {
  const tel = draftResult.toolLLMTelemetry;
  if (!tel) return;
  collector.recordLLMCall({
    role: 'draft_graph',
    provider: tel.provider,
    model: tel.model,
    input_tokens: tel.input_tokens,
    output_tokens: tel.output_tokens,
    cache_read_tokens: tel.cache_read_input_tokens ?? null,
    cache_creation_tokens: tel.cache_creation_input_tokens ?? null,
    latency_ms: tel.latency_ms,
    stop_reason: tel.stop_reason ?? null,
    thinking_enabled: tel.thinking_enabled,
    error: null,
  });
  if (tel.prompt_hash) {
    collector.recordPromptIdentity({
      task_id: 'draft_graph',
      prompt_id: tel.prompt_version ?? 'unknown',
      version: tel.prompt_version ?? 'unknown',
      hash: tel.prompt_hash,
      source: 'pms',
      is_staging: config.server.nodeEnv !== 'production',
    });
  }
  collector.recordProviderResolution({
    task: 'draft_graph',
    env_default_provider: tel.provider,
    env_model_override: null,
    prompt_config_model: null,
    resolved_model: tel.model,
    resolved_provider: tel.provider,
    switch_reason: null,
  });
  collector.recordStructuredOutputConfig({
    enabled: tel.structured_outputs_used,
    api_shape: tel.structured_outputs_used ? 'tool_use' : 'prompt_only',
    schema_hash: null,
    beta_header_present: false,
  });
  // Fallback recording — V4's PipelineOutcome.llm_repair surfaces when
  // the SO-driven parse failed and a repair pass was attempted.
  const llmRepair = draftResult.pipelineOutcome?.llm_repair;
  if (llmRepair?.triggered) {
    collector.recordFallback({
      stage: 'parse',
      reason: llmRepair.fallback_reason ?? 'structured_output_parse_failure',
      original_error: null,
      fallback_action: 'llm_repair_pass',
      fallback_succeeded: llmRepair.outcome === 'accepted',
    });
  }
}

function populateCollectorFromTurnTimings(
  collector: DiagnosticTraceCollector,
  turnTimings: V5TurnTimings,
): void {
  // Routing-call record so the trace has a non-empty llm_calls[] for
  // turn_executor turns. All values are REAL data captured at the routing
  // site (turn-executor's `if (timingsEnabled)` block): wall-clock latency,
  // model, input/output tokens, cache split, and served-prompt identity.
  // `model` falls back to 'unknown' ONLY when the routing layer genuinely did
  // not expose it (test injectors / recovery) — an honest sentinel, not a
  // fabricated id. This is the routing/orient LLM call; the awaited
  // decision_review call (when it fired) is added as a SECOND entry below from
  // its own threaded model/token attribution.
  if (turnTimings.routing_llm_ms != null || turnTimings.total_input_tokens != null) {
    collector.recordLLMCall({
      role: 'routing',
      provider: 'anthropic',
      model: turnTimings.routing_model ?? 'unknown',
      input_tokens: turnTimings.total_input_tokens ?? 0,
      output_tokens: turnTimings.routing_output_tokens ?? 0,
      cache_read_tokens: turnTimings.cache_read_input_tokens ?? null,
      cache_creation_tokens: turnTimings.cache_creation_input_tokens ?? null,
      latency_ms: turnTimings.routing_llm_ms ?? 0,
      stop_reason: null,
      thinking_enabled: false,
      error: null,
    });
    if (turnTimings.routing_prompt_hash) {
      collector.recordPromptIdentity({
        task_id: 'routing',
        prompt_id: turnTimings.routing_prompt_version ?? 'unknown',
        version: turnTimings.routing_prompt_version ?? 'unknown',
        hash: turnTimings.routing_prompt_hash,
        source: 'pms',
        is_staging: config.server.nodeEnv !== 'production',
      });
    }
  }

  // Second llm_calls entry: the awaited decision_review enrichment call — the
  // dominant analysis-turn LLM cost (~14 s on staging). Present only when the
  // turn actually awaited a decision_review that RETURNED
  // (V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true), which is exactly when the
  // executor co-sets `decision_review_ms` with the threaded model/provider/token
  // usage — so every field below is REAL data, never fabricated for a call that
  // did not happen. `latency_ms` is the executor's wall-clock for the await
  // (includes adapter/parse/attach), not the LLM's self-reported figure. The
  // `?? ` fallbacks are type-narrowing only: the four fields are co-set, so they
  // are never actually reached when the entry is emitted.
  if (turnTimings.decision_review_ms != null) {
    collector.recordLLMCall({
      role: 'decision_review',
      provider: turnTimings.decision_review_provider ?? 'unknown',
      model: turnTimings.decision_review_model ?? 'unknown',
      input_tokens: turnTimings.decision_review_input_tokens ?? 0,
      output_tokens: turnTimings.decision_review_output_tokens ?? 0,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: turnTimings.decision_review_ms,
      stop_reason: null,
      thinking_enabled: false,
      error: null,
    });
  }
}

/**
 * S3-L6 / F-5 — record the edit-lane LLM call into `llm_calls[]`. Called only
 * when the edit dispatch confirmed the LLM ran (see `EditGraphLlmCallTelemetry`
 * and `extractEditLlmCallTelemetry`). Every value is REAL data already captured
 * at the edit site (R7 diagnostics + handler wall-clock); `model` falls back to
 * the `'unknown'` sentinel only when the adapter genuinely did not expose one
 * (test doubles), never a fabricated id. Cache-token split and thinking flag
 * are not threaded through the edit result today, so they are recorded as
 * `null`/`false` rather than guessed.
 */
function populateCollectorFromEditTelemetry(
  collector: DiagnosticTraceCollector,
  editLlmCall: EditGraphLlmCallTelemetry,
): void {
  collector.recordLLMCall({
    role: 'edit_graph',
    provider: editLlmCall.provider,
    model: editLlmCall.model ?? 'unknown',
    input_tokens: editLlmCall.input_tokens,
    output_tokens: editLlmCall.output_tokens,
    cache_read_tokens: null,
    cache_creation_tokens: null,
    latency_ms: editLlmCall.latency_ms,
    stop_reason: editLlmCall.stop_reason,
    thinking_enabled: false,
    error: null,
  });
}

function buildBenchmarkingForDraftGraph(
  input: BuildV5DiagnosticTraceInput,
): V5BenchmarkingTimings {
  const totalDurationMs = Math.max(0, Date.now() - input.startedAt);
  const dgt = input.draftResult.draftGraphTimings;

  // Flag OFF: the historical four-key subset, emitted exactly as before so
  // the wire payload is byte-identical. Deliberately NOT derived — this
  // branch is frozen legacy shape, and freezing it is what makes the
  // flag-off guarantee checkable.
  if (!config.features.draftSubstageDetail) {
    return {
      total_duration_ms: totalDurationMs,
      substage_timings: {
        llm_call_ms: dgt?.parse_llm_ms,
        parse_ms: dgt?.parse_ms,
        repair_ms: dgt?.repair_ms,
        validation_ms: dgt?.validation_pipeline_ms,
        persistence_ms: input.persistenceMs,
        total_handler_duration_ms: input.draftResult.latencyMs,
      },
    };
  }

  // Flag ON: DERIVE the substage set from the pipeline's own key list, so a
  // timing added to the pipeline cannot be silently dropped here. Undefined
  // values are omitted rather than emitted as `undefined` so a stage that
  // genuinely did not run is distinguishable from one that ran in 0 ms —
  // an honesty property, not a cosmetic one.
  const derived: Record<string, number> = {};
  for (const key of DRAFT_GRAPH_NUMERIC_TIMING_KEYS) {
    const value = dgt?.[key];
    if (typeof value !== 'number') continue;
    derived[TRACE_KEY_RENAMES[key] ?? key] = value;
  }

  return {
    total_duration_ms: totalDurationMs,
    substage_timings: {
      ...derived,
      persistence_ms: input.persistenceMs,
      total_handler_duration_ms: input.draftResult.latencyMs,
    },
  };
}

function buildRetryFromPipelineOutcome(
  pipelineOutcome: PipelineOutcome | undefined,
): V5Retry | undefined {
  if (!pipelineOutcome) return undefined;
  const llmRepair = pipelineOutcome.llm_repair;
  const retryCount = llmRepair?.attempts ?? 0;
  if (retryCount === 0) return undefined;
  return {
    retry_count: retryCount,
    retry_reasons: llmRepair?.fallback_reason ? [llmRepair.fallback_reason] : undefined,
    timed_out: false,
    llm_attempt_count: retryCount + 1,
  };
}

function buildEnvironment(): V5Environment {
  // service_instance_id intentionally omitted in Phase A — no `config`
  // surface exposes it today (RENDER_INSTANCE_ID is platform-injected at
  // runtime), and the lint rule forbids direct `process.env` access. Add
  // a `config.server.instanceId` field and re-enable here if a later
  // workstream needs per-pod correlation. `build_sha` already gives the
  // deploy-level correlation needed for the Phase A latency benchmarking
  // use case.
  return {
    build_sha: GIT_COMMIT_SHORT,
    environment: config.server.nodeEnv,
  };
}

function classifyErrorType(error: unknown): string {
  if (error instanceof Error) return error.name || 'Error';
  if (typeof error === 'string') return 'StringError';
  if (error && typeof error === 'object') {
    const constructor = (error as { constructor?: { name?: string } }).constructor;
    return constructor?.name ?? 'UnknownError';
  }
  return 'UnknownError';
}

function toolLLMTelemetryToCallTrace(
  tel: NonNullable<DraftGraphResult['toolLLMTelemetry']>,
  errorType: string,
): LLMCallTrace {
  return {
    role: 'draft_graph',
    provider: tel.provider,
    model: tel.model,
    input_tokens: tel.input_tokens,
    output_tokens: tel.output_tokens,
    cache_read_tokens: tel.cache_read_input_tokens ?? null,
    cache_creation_tokens: tel.cache_creation_input_tokens ?? null,
    latency_ms: tel.latency_ms,
    stop_reason: tel.stop_reason ?? null,
    thinking_enabled: tel.thinking_enabled,
    error: {
      status: 0,
      type: errorType,
      message: '',
    },
  };
}

function safeGraphHash(graph: GraphV3T | null | undefined): string | null {
  if (graph == null) return null;
  try {
    return (
      computeAnalysisAffectingGraphHash(graph as unknown as GraphStateIngress | undefined) ?? null
    );
  } catch {
    return null;
  }
}

// ─── Empty / null helpers for tests / fallbacks ───────────────────────────

export function emptyV5DiagnosticTrace(
  exitPath: V5DiagnosticExitPath,
  correlationIds: V5CorrelationIds,
): V5DiagnosticTrace {
  return {
    ...emptyDiagnosticTrace(),
    benchmarking: { total_duration_ms: 0, substage_timings: {} },
    correlation_ids: correlationIds,
    exit_path: exitPath,
    trace_version: 1,
  };
}
