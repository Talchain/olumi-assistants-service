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
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildMinimalV5DiagnosticTrace,
  buildErrorV5DiagnosticTrace,
  emptyV5DiagnosticTrace,
} from '../v5-diagnostic-trace.js';

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
    // No upstream telemetry → empty llm_calls + null structured_output_config
    expect(trace!.llm_calls).toEqual([]);
    expect(trace!.structured_output_config).toBeNull();
  });

  it('maps V5TurnTimings substages into benchmarking when provided', async () => {
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
      },
    });
    expect(trace!.benchmarking.substage_timings.route_classification_ms).toBe(800);
    expect(trace!.benchmarking.substage_timings.prompt_assembly_ms).toBe(50);
    expect(trace!.benchmarking.substage_timings.total_handler_duration_ms).toBe(4200);
    expect(trace!.benchmarking.substage_timings.persistence_ms).toBe(120);
    // Synthetic routing-call record uses the routing timings.
    expect(trace!.llm_calls.length).toBe(1);
    const call = trace!.llm_calls[0]!;
    expect(call.role).toBe('routing');
    expect(call.input_tokens).toBe(5000);
    expect(call.cache_read_tokens).toBe(200);
    expect(call.latency_ms).toBe(800);
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
