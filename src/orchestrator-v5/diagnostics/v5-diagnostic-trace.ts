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
import type { CommitResult } from '../commit.js';
import type {
  V5TurnTimings,
  DraftGraphTimings,
} from '../telemetry/turn-timings.js';
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
  };
}

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
  | 'draft_graph_error';

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
  const frozen = collector.freeze();

  const correlationIds: V5CorrelationIds = {
    request_id: input.requestId,
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
    graph_hash: safeGraphHash(input.graph) ?? undefined,
  };

  return assembleTrace({
    frozen,
    benchmarking,
    correlationIds,
    environment: buildEnvironment(),
    exitPath: input.exitPath,
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
  // Synthetic routing-call record so the trace has a non-empty
  // llm_calls[] for turn_executor turns. Provider / model details are
  // not directly on V5TurnTimings; we fall back to "unknown" rather
  // than guess. Token counts come from the routing call.
  if (turnTimings.routing_llm_ms != null || turnTimings.total_input_tokens != null) {
    collector.recordLLMCall({
      role: 'routing',
      provider: 'anthropic',
      model: 'unknown',
      input_tokens: turnTimings.total_input_tokens ?? 0,
      output_tokens: 0,
      cache_read_tokens: turnTimings.cache_read_input_tokens ?? null,
      cache_creation_tokens: turnTimings.cache_creation_input_tokens ?? null,
      latency_ms: turnTimings.routing_llm_ms ?? 0,
      stop_reason: null,
      thinking_enabled: false,
      error: null,
    });
  }
}

function buildBenchmarkingForDraftGraph(
  input: BuildV5DiagnosticTraceInput,
): V5BenchmarkingTimings {
  const totalDurationMs = Math.max(0, Date.now() - input.startedAt);
  const dgt = input.draftResult.draftGraphTimings;
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
