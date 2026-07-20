/**
 * Unit tests for the V5 diagnostic-trace module's builders.
 *
 * Covers the three entry points:
 *   - `buildMinimalV5DiagnosticTrace` — non-draft V5 paths (turn_executor,
 *     edit_graph, chip_click, system_event, frame_no_brief_guard)
 *   - `buildErrorV5DiagnosticTrace` — draft_graph timeout / SO-parse-fail
 *     path (brief test #5)
 *   - `emptyV5DiagnosticTrace` — fallback constructor
 *
 * The full draft_graph builder (`buildV5DiagnosticTrace`) is exercised end-
 * to-end by `draft-graph-dispatch-diagnostic-trace.test.ts`; this file
 * focuses on the lighter helpers.
 *
 * WIRING NOTE (observability lane): the cases here call the BUILDER directly.
 * They prove the builder's contract given its inputs — NOT that production
 * threads those inputs. The empty-`llm_calls` case below is the builder's
 * no-timings edge case, NOT the shape a real turn_executor turn emits: before
 * the fix, production DID emit `[]` because its only call site
 * (`route-v2 sendFinalised200`) omitted `turnTimings`, and a builder-only test
 * that asserted `[]` silently ratified that defect. The REAL production wiring
 * — a runTurnExecutor turn surfacing a non-empty `llm_calls[]` on the wire —
 * is proven and mutation-checked in
 * `orchestrator-v5/__tests__/turn-executor-diagnostic-llm-calls.test.ts` and
 * `orchestrator/__tests__/route-v2-diagnostic-trace-llm-calls.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildV5DiagnosticTrace,
  buildMinimalV5DiagnosticTrace,
  buildErrorV5DiagnosticTrace,
  emptyV5DiagnosticTrace,
} from '../v5-diagnostic-trace.js';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import type { CommitResult } from '../../commit.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-trace-1';

describe('buildMinimalV5DiagnosticTrace', () => {
  const originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;

  beforeEach(() => {
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag;
  });

  it('returns undefined when flag is off', async () => {
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    // Re-import to pick up the flag state via the lazy Proxy config.
    const mod = await import('../v5-diagnostic-trace.js');
    const trace = mod.buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
    });
    expect(trace).toBeUndefined();
  });

  it('returns a trace with total_duration_ms + correlation IDs when flag is on', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    // Re-import is unnecessary — config is a lazy proxy that reads
    // process.env per access. Direct call exercises the builder.
    const startedAt = Date.now() - 50;
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
    });
    expect(trace).toBeDefined();
    expect(trace!.exit_path).toBe('turn_executor');
    expect(trace!.benchmarking.total_duration_ms).toBeGreaterThanOrEqual(0);
    expect(trace!.correlation_ids.request_id).toBe(REQUEST_ID);
    expect(trace!.correlation_ids.scenario_id).toBe(SCENARIO_ID);
    expect(trace!.correlation_ids.turn_id).toBe(TURN_ID);
    expect(trace!.trace_version).toBe(1);
    // Builder EDGE CASE: called with no `turnTimings`, the builder has nothing
    // to record so `llm_calls` is empty. This is the builder's honest no-input
    // contract — NOT the turn_executor production shape (production threads
    // `turnTimings`; see the WIRING NOTE at the top of this file).
    expect(trace!.llm_calls).toEqual([]);
    expect(trace!.structured_output_config).toBeNull();
  });

  it('records the routing LLM call (real model/tokens/prompt identity) from V5TurnTimings — the shape production now emits', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const startedAt = Date.now() - 100;
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
      turnTimings: {
        routing_llm_ms: 800,
        context_pack_assembly_ms: 50,
        handler_execute_ms: 4200,
        commit_ms: 120,
        total_input_tokens: 5000,
        cache_read_input_tokens: 200,
        routing_model: 'claude-sonnet-4-6',
        routing_output_tokens: 321,
        routing_prompt_hash: 'sha256:routingdeadbeef',
        routing_prompt_version: 'v40',
      },
    });
    expect(trace!.benchmarking.substage_timings.route_classification_ms).toBe(800);
    expect(trace!.benchmarking.substage_timings.prompt_assembly_ms).toBe(50);
    expect(trace!.benchmarking.substage_timings.total_handler_duration_ms).toBe(4200);
    expect(trace!.benchmarking.substage_timings.persistence_ms).toBe(120);
    // Routing-call record carries REAL data (no more 'unknown' model / 0 output).
    expect(trace!.llm_calls.length).toBe(1);
    const call = trace!.llm_calls[0]!;
    expect(call.role).toBe('routing');
    expect(call.provider).toBe('anthropic');
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.input_tokens).toBe(5000);
    expect(call.output_tokens).toBe(321);
    expect(call.cache_read_tokens).toBe(200);
    expect(call.latency_ms).toBe(800);
    // Prompt identity + correlation prompt_hash threaded from the routing call.
    expect(trace!.prompt_identity.length).toBe(1);
    expect(trace!.prompt_identity[0]!.task_id).toBe('routing');
    expect(trace!.prompt_identity[0]!.hash).toBe('sha256:routingdeadbeef');
    expect(trace!.correlation_ids.prompt_hash).toBe('sha256:routingdeadbeef');
  });

  it('falls back to an honest model sentinel when the routing model is absent (never zero-fills a fabricated id)', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
      // Only latency + input tokens captured (e.g. recovery short-circuit).
      turnTimings: { routing_llm_ms: 12, total_input_tokens: 1000 },
    });
    expect(trace!.llm_calls.length).toBe(1);
    const call = trace!.llm_calls[0]!;
    expect(call.model).toBe('unknown');
    expect(call.output_tokens).toBe(0);
    // No prompt hash captured → no fabricated prompt identity, no correlation.
    expect(trace!.prompt_identity).toEqual([]);
    expect(trace!.correlation_ids.prompt_hash).toBeUndefined();
  });

  it('threads a coaching_delivery section onto the trace when provided (Scope C)', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 30,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
      coachingDelivery: {
        handler: 'post_analysis_advice_gate',
        composer: 'evidence_gap',
        copy_source: 'top_drivers',
        coaching_fields_used: ['leading_option', 'top_drivers'],
        phase3_block_context_available: false,
        fallback_analysis_used: true,
        deterministic: true,
      },
    });
    expect(trace!.coaching_delivery).toBeDefined();
    expect(trace!.coaching_delivery!.handler).toBe('post_analysis_advice_gate');
    expect(trace!.coaching_delivery!.composer).toBe('evidence_gap');
    expect(trace!.coaching_delivery!.copy_source).toBe('top_drivers');
    expect(trace!.coaching_delivery!.coaching_fields_used).toEqual(['leading_option', 'top_drivers']);
    expect(trace!.coaching_delivery!.phase3_block_context_available).toBe(false);
    expect(trace!.coaching_delivery!.fallback_analysis_used).toBe(true);
    expect(trace!.coaching_delivery!.deterministic).toBe(true);
  });

  it('omits coaching_delivery when not provided', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 30,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'turn_executor',
    });
    expect(trace!.coaching_delivery).toBeUndefined();
  });

  // ── S3-L6 / F-5: edit-lane LLM call recorded into llm_calls[] ─────────────
  it('records the edit-lane LLM call in llm_calls[] on an edit_graph exit (F-5 fix)', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'edit_graph',
      editLlmCall: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        input_tokens: 3100,
        output_tokens: 210,
        latency_ms: 1450,
        stop_reason: 'end_turn',
        repair_attempts: 1,
      },
    });
    expect(trace!.exit_path).toBe('edit_graph');
    // BEFORE the fix this was always [] — the edit dispatch never threaded a call.
    expect(trace!.llm_calls.length).toBe(1);
    const call = trace!.llm_calls[0]!;
    expect(call.role).toBe('edit_graph');
    expect(call.provider).toBe('anthropic');
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.input_tokens).toBe(3100);
    expect(call.output_tokens).toBe(210);
    expect(call.latency_ms).toBe(1450);
    expect(call.stop_reason).toBe('end_turn');
    // Cache split + thinking are not threaded through the edit result today.
    expect(call.cache_read_tokens).toBeNull();
    expect(call.cache_creation_tokens).toBeNull();
    expect(call.thinking_enabled).toBe(false);
    expect(call.error).toBeNull();
  });

  it('falls back to the honest model sentinel when the edit adapter did not expose a model', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'edit_graph',
      editLlmCall: {
        provider: 'anthropic',
        model: null,
        input_tokens: 0,
        output_tokens: 5,
        latency_ms: 900,
        stop_reason: null,
        repair_attempts: 0,
      },
    });
    expect(trace!.llm_calls.length).toBe(1);
    expect(trace!.llm_calls[0]!.model).toBe('unknown');
  });

  it('leaves llm_calls empty on a deterministic (no-LLM) edit exit — editLlmCall omitted', async () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildMinimalV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      exitPath: 'edit_graph',
      // No editLlmCall — the constraint-shortcut / deterministic value pre-route.
    });
    expect(trace!.exit_path).toBe('edit_graph');
    expect(trace!.llm_calls).toEqual([]);
  });
});

describe('buildErrorV5DiagnosticTrace', () => {
  const originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;

  beforeEach(() => {
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag;
  });

  it('returns undefined when flag is off', () => {
    const trace = buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new Error('test'),
    });
    expect(trace).toBeUndefined();
  });

  it('marks timed_out for LLMTimeoutError', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    class LLMTimeoutError extends Error {
      constructor() {
        super('llm timed out');
        this.name = 'LLMTimeoutError';
      }
    }
    const trace = buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new LLMTimeoutError(),
    });
    expect(trace!.exit_path).toBe('draft_graph_error');
    expect(trace!.retry?.timed_out).toBe(true);
    expect(trace!.retry?.error_type).toBe('LLMTimeoutError');
  });

  it('marks timed_out for AbortError', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    class AbortError extends Error {
      constructor() {
        super('aborted');
        this.name = 'AbortError';
      }
    }
    const trace = buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new AbortError(),
    });
    expect(trace!.retry?.timed_out).toBe(true);
    expect(trace!.retry?.error_type).toBe('AbortError');
  });

  it('records a non-timeout error with timed_out=false', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new TypeError('bad shape'),
    });
    expect(trace!.retry?.timed_out).toBe(false);
    expect(trace!.retry?.error_type).toBe('TypeError');
  });

  it('captures pipelineOutcome and partial timings when provided', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildErrorV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
      error: new Error('SO parse failed after timeout'),
      pipelineOutcome: {
        graph_drafted: false,
        graph_structurally_valid: false,
        deterministic_sweep_violations: 0,
        verification_status: 'skipped',
        validation_status: 'skipped',
        enrichment_status: 'skipped',
        // CoachingStatus union is 'complete' | 'partial' | 'failed_degraded' — no
        // 'skipped' member. 'failed_degraded' matches the timeout-error semantic
        // here (the SDK timed out before coaching could complete) without
        // weakening the test intent, which exercises retry/timing fields, not
        // coaching status.
        coaching_status: 'failed_degraded',
        warnings: [],
        rescue_score: 0,
        factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
        edge_strength_unique_count: 0,
        llm_repair: { triggered: true, outcome: 'timed_out', fallback_reason: 'sdk_timeout', attempts: 2 },
        repair_provenance: [],
      },
      draftGraphTimings: {
        parse_llm_ms: 30000,
        parse_ms: 30050,
      },
    });
    expect(trace!.pipeline_outcome?.llm_repair.attempts).toBe(2);
    expect(trace!.retry?.retry_count).toBe(2);
    expect(trace!.benchmarking.substage_timings.llm_call_ms).toBe(30000);
    expect(trace!.benchmarking.substage_timings.parse_ms).toBe(30050);
  });
});

describe('emptyV5DiagnosticTrace', () => {
  it('returns a structurally valid trace with empty collectors', () => {
    const trace = emptyV5DiagnosticTrace('chip_click', {
      request_id: REQUEST_ID,
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
    });
    expect(trace.exit_path).toBe('chip_click');
    expect(trace.benchmarking.total_duration_ms).toBe(0);
    expect(trace.llm_calls).toEqual([]);
    expect(trace.fallback_trace).toEqual([]);
    expect(trace.provider_resolution).toEqual([]);
    expect(trace.correlation_ids.request_id).toBe(REQUEST_ID);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Brief 3 / Gate 2 — feature-flag LIVENESS gate for `_diagnostic_trace`.
//
// The tests above cover the minimal / error / empty builders and assert SHAPE.
// They do NOT assert that the PRIMARY draft_graph builder
// (`buildV5DiagnosticTrace`) emits a NON-EMPTY, fully-populated trace when the
// flag is ON and a real draft turn produced LLM telemetry — the silent-drop
// failure mode this gate guards: flag ON but the emitted output is empty,
// null-only, or missing required core fields.
//
// Liveness contract proven here:
//   - flag OFF                    → undefined (output is genuinely gated)
//   - flag ON + telemetry present → defined trace, NON-EMPTY llm_calls[], and
//                                   all required core fields populated
//
// Deterministic: a pure builder call over an in-memory DraftGraphResult
// fixture — no LLM, no network, no Redis/Supabase — so it runs in the required
// `pnpm test:required` set and blocks merge on regression.
//
// Scope note: this proves the liveness-gate MECHANISM on ONE diagnostic
// surface. It does NOT close liveness for _context_summary, S1 / Decision Data
// Spine, coaching, freshness, or run-delta — those need equivalent flag-ON
// meaningful-output gates as they land.
// ───────────────────────────────────────────────────────────────────────────

const TOOL_TELEMETRY = {
  tool: 'draft_graph',
  model: 'claude-opus-4-7',
  provider: 'anthropic',
  input_tokens: 1234,
  output_tokens: 567,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 50,
  latency_ms: 4200,
  stop_reason: 'end_turn',
  thinking_enabled: false,
  structured_outputs_used: true,
  prompt_version: 'draft_graph@v196',
  prompt_hash: 'sha256:promptdeadbeef',
} as const;

function makeDraftResult(opts: Partial<DraftGraphResult> = {}): DraftGraphResult {
  return {
    blocks: [],
    assistantText: 'Drafted a decision graph.',
    latencyMs: 1234,
    strengthenItems: [],
    coachingSummary: null,
    coachingWideningLog: null,
    coachingBiasSignals: null,
    draftWarnings: [],
    graphOutput: null,
    ...opts,
  } as DraftGraphResult;
}

// buildV5DiagnosticTrace reads only draftResult + timing inputs; commitResult
// is part of the input type but unused by the builder, so a minimal stand-in
// satisfies the signature.
const COMMIT_RESULT = {
  response: {},
  performed: true,
  persisted_row_id: 'row-1',
  graphPersisted: true,
} as CommitResult;

describe('buildV5DiagnosticTrace — flag-on liveness (Gate 2)', () => {
  const originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;

  beforeEach(() => {
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag;
  });

  it('returns undefined when the flag is off (output is gated, not merely shaped)', () => {
    delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    const trace = buildV5DiagnosticTrace({
      startedAt: Date.now() - 100,
      draftResult: makeDraftResult({ toolLLMTelemetry: TOOL_TELEMETRY }),
      commitResult: COMMIT_RESULT,
      persistenceMs: 12,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
    });
    expect(trace).toBeUndefined();
  });

  it('flag on + draft telemetry present → LIVE trace: non-empty llm_calls[] + all required core fields', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const trace = buildV5DiagnosticTrace({
      startedAt: Date.now() - 80,
      draftResult: makeDraftResult({ toolLLMTelemetry: TOOL_TELEMETRY }),
      commitResult: COMMIT_RESULT,
      persistenceMs: 12,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
    });

    // Emitted at all.
    expect(trace).toBeDefined();

    // LIVENESS: the draft LLM call must be present, not silently dropped.
    expect(trace!.llm_calls.length).toBeGreaterThanOrEqual(1);
    const call = trace!.llm_calls[0]!;
    expect(call.role).toBe('draft_graph');
    expect(call.provider).toBe('anthropic');
    expect(call.model).toBe('claude-opus-4-7');
    expect(call.input_tokens).toBe(1234);
    expect(call.output_tokens).toBe(567);
    expect(call.latency_ms).toBe(4200);

    // Required correlation IDs — all populated (not empty).
    expect(trace!.correlation_ids.request_id).toBe(REQUEST_ID);
    expect(trace!.correlation_ids.scenario_id).toBe(SCENARIO_ID);
    expect(trace!.correlation_ids.turn_id).toBe(TURN_ID);
    expect(trace!.correlation_ids.prompt_hash).toBe('sha256:promptdeadbeef');

    // Required benchmarking + envelope identity.
    expect(trace!.benchmarking.total_duration_ms).toBeGreaterThanOrEqual(0);
    expect(trace!.exit_path).toBe('draft_graph');
    expect(trace!.trace_version).toBe(1);

    // Telemetry present ⇒ structured-output config + prompt identity recorded —
    // further proof the upstream signal was threaded, not discarded.
    expect(trace!.structured_output_config).not.toBeNull();
    expect(trace!.prompt_identity).not.toBeNull();
  });

  it('regression guard: with telemetry dropped, llm_calls collapses to empty — exactly what the liveness assertion forbids', () => {
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    // No toolLLMTelemetry → the builder has nothing to record. This documents
    // the silent-drop shape the liveness test catches if a real draft turn ever
    // stops threading telemetry while the flag is on. It also proves the
    // liveness assertion above is non-trivial: the builder genuinely CAN emit
    // an empty llm_calls[], and only fills it when the signal is threaded.
    const trace = buildV5DiagnosticTrace({
      startedAt: Date.now() - 80,
      draftResult: makeDraftResult(),
      commitResult: COMMIT_RESULT,
      persistenceMs: 12,
      scenarioId: SCENARIO_ID,
      turnId: TURN_ID,
      requestId: REQUEST_ID,
    });
    expect(trace).toBeDefined();
    expect(trace!.llm_calls).toEqual([]);
  });
});
