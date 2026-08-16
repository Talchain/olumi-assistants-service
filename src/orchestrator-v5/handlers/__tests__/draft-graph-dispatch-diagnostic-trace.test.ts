/**
 * Diagnostic-trace tests for `dispatchDraftGraph`.
 *
 * Covers brief tests T1–T6:
 *   T1 — flag on → trace populated with non-null fields
 *   T2 — flag off → no trace, user-facing response unchanged
 *   T3 — token counts on `llm_calls[]` match the upstream telemetry
 *   T4 — SO-used branch sets structured_output_config.enabled; fallback-
 *        fired branch records a fallback_trace entry
 *   T5 — simulated timeout → trace attached on thrown error with
 *        retry.timed_out and error_type populated
 *   T6 — redaction holds: no brief text, no API key prefix, hashes
 *        present, prompt_identity[0].hash is non-empty
 *
 * Mocks the same upstream as the existing draft-graph-dispatch suite
 * (handleDraftGraph, commitDirectAnswer, telemetry emit). The
 * diagnostic-trace module is NOT mocked — we exercise the real builder.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';

vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return {
    ...actual,
    emit: vi.fn(),
  };
});

import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { handleDraftGraph } from '../../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { canonicalCommitResultFixture } from './canonical-commit-result-fixture.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID     = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID  = 'req-diagnostic-1';

const BRIEF_TEXT = 'Should we launch the product now or delay six months?';
const API_KEY_PREFIX = 'sk-ant-';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message: BRIEF_TEXT,
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const MINIMAL_GRAPH = {
  nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

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
    graphOutput: MINIMAL_GRAPH as unknown as DraftGraphResult['graphOutput'],
    ...opts,
  } as DraftGraphResult;
}

function makeCommitResult(graphPersisted: boolean) {
  return canonicalCommitResultFixture(graphPersisted ? MINIMAL_GRAPH : null, {
    persistedRowId: 'row-1',
  });
}

const STUB_REQUEST = {} as FastifyRequest;

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

const PIPELINE_OUTCOME = {
  graph_drafted: true,
  graph_structurally_valid: true,
  deterministic_sweep_violations: 0,
  verification_status: 'passed' as const,
  validation_status: 'passed' as const,
  enrichment_status: 'complete' as const,
  coaching_status: 'complete' as const,
  warnings: [],
  rescue_score: 0,
  factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
  edge_strength_unique_count: 1,
  llm_repair: { triggered: false, outcome: 'skipped' as const, fallback_reason: null, attempts: 0 },
  repair_provenance: [],
};

const DRAFT_TIMINGS = {
  total_ms: 4200,
  parse_ms: 3800,
  parse_llm_ms: 3500,
  repair_ms: 0,
  validation_pipeline_ms: 100,
};

describe('dispatchDraftGraph — diagnostic trace', () => {
  const originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
      .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof commitDirectAnswer>>);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag;
  });

  describe('T1 — flag on → trace populated', () => {
    it('builds a V5DiagnosticTrace with non-null benchmarking + correlation IDs + llm_calls', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(
          makeDraftResult({
            toolLLMTelemetry: TOOL_TELEMETRY,
            pipelineOutcome: PIPELINE_OUTCOME,
            draftGraphTimings: DRAFT_TIMINGS,
          }) as Awaited<ReturnType<typeof handleDraftGraph>>,
        );

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: REQUEST_ID,
        request: STUB_REQUEST,
      });

      expect(result.diagnosticTrace).toBeDefined();
      const trace = result.diagnosticTrace!;
      expect(trace.trace_version).toBe(1);
      expect(trace.exit_path).toBe('draft_graph');
      expect(trace.benchmarking.total_duration_ms).toBeGreaterThanOrEqual(0);
      expect(trace.benchmarking.substage_timings.parse_ms).toBe(3800);
      expect(trace.benchmarking.substage_timings.llm_call_ms).toBe(3500);
      expect(trace.benchmarking.substage_timings.total_handler_duration_ms).toBe(1234);
      expect(trace.correlation_ids.request_id).toBe(REQUEST_ID);
      expect(trace.correlation_ids.scenario_id).toBe(SCENARIO_ID);
      expect(trace.correlation_ids.turn_id).toBe(TURN_ID);
      expect(trace.llm_calls.length).toBe(1);
      expect(trace.pipeline_outcome).toBeDefined();
    });
  });

  describe('T2 — flag off → no trace, response unchanged', () => {
    it('returns diagnosticTrace=undefined and identical response body modulo trace', async () => {
      // First run: flag on
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      vi.resetModules();
      const flagOn = await (async () => {
        const { dispatchDraftGraph: dispatchOn } = await import('../draft-graph-dispatch.js');
        const { handleDraftGraph: hOn } = await import('../../../orchestrator/tools/draft-graph.js');
        const { commitDirectAnswer: cOn } = await import('../../commit.js');
        (cOn as MockedFunction<typeof cOn>)
          .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof cOn>>);
        (hOn as MockedFunction<typeof hOn>)
          .mockResolvedValue(
            makeDraftResult({
              toolLLMTelemetry: TOOL_TELEMETRY,
              pipelineOutcome: PIPELINE_OUTCOME,
              draftGraphTimings: DRAFT_TIMINGS,
            }) as Awaited<ReturnType<typeof hOn>>,
          );
        return dispatchOn({
          payload: makePayload(),
          requestId: REQUEST_ID,
          request: STUB_REQUEST,
        });
      })();

      // Second run: flag off
      delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
      vi.resetModules();
      const flagOff = await (async () => {
        const { dispatchDraftGraph: dispatchOff } = await import('../draft-graph-dispatch.js');
        const { handleDraftGraph: hOff } = await import('../../../orchestrator/tools/draft-graph.js');
        const { commitDirectAnswer: cOff } = await import('../../commit.js');
        (cOff as MockedFunction<typeof cOff>)
          .mockResolvedValue(makeCommitResult(true) as Awaited<ReturnType<typeof cOff>>);
        (hOff as MockedFunction<typeof hOff>)
          .mockResolvedValue(
            makeDraftResult({
              toolLLMTelemetry: TOOL_TELEMETRY,
              pipelineOutcome: PIPELINE_OUTCOME,
              draftGraphTimings: DRAFT_TIMINGS,
            }) as Awaited<ReturnType<typeof hOff>>,
          );
        return dispatchOff({
          payload: makePayload(),
          requestId: REQUEST_ID,
          request: STUB_REQUEST,
        });
      })();

      expect(flagOn.diagnosticTrace).toBeDefined();
      expect(flagOff.diagnosticTrace).toBeUndefined();
      // The user-facing response body fields that the UI consumes are
      // identical with vs without the diagnostic trace. The whole-body
      // deep-equal would fail on timestamps / wall-clock-dependent fields
      // (assistant_text is built deterministically here so it stays
      // equal); explicit asserts on the UI-relevant surface keep the
      // contract honest without overconstraining.
      expect(flagOff.response.assistant_text).toBe(flagOn.response.assistant_text);
      expect(flagOff.response.stage_indicator).toBe(flagOn.response.stage_indicator);
      expect(flagOff.response.suggested_actions).toEqual(flagOn.response.suggested_actions);
      expect(flagOff.commitPerformed).toBe(flagOn.commitPerformed);
    });
  });

  describe('T3 — llm_calls token counts match upstream telemetry', () => {
    it('records input_tokens=1234, output_tokens=567 verbatim', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(
          makeDraftResult({
            toolLLMTelemetry: TOOL_TELEMETRY,
            pipelineOutcome: PIPELINE_OUTCOME,
            draftGraphTimings: DRAFT_TIMINGS,
          }) as Awaited<ReturnType<typeof handleDraftGraph>>,
        );

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: REQUEST_ID,
        request: STUB_REQUEST,
      });

      const call = result.diagnosticTrace!.llm_calls[0]!;
      expect(call.input_tokens).toBe(1234);
      expect(call.output_tokens).toBe(567);
      expect(call.cache_read_tokens).toBe(100);
      expect(call.cache_creation_tokens).toBe(50);
      expect(call.latency_ms).toBe(4200);
      expect(call.stop_reason).toBe('end_turn');
      expect(call.model).toBe('claude-opus-4-7');
      expect(call.provider).toBe('anthropic');
    });
  });

  describe('T4 — structured-output vs fallback branches', () => {
    it('structured_output_config.enabled is true when SO was used and no fallback fired', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(
          makeDraftResult({
            toolLLMTelemetry: TOOL_TELEMETRY,
            pipelineOutcome: PIPELINE_OUTCOME,
            draftGraphTimings: DRAFT_TIMINGS,
          }) as Awaited<ReturnType<typeof handleDraftGraph>>,
        );
      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: REQUEST_ID,
        request: STUB_REQUEST,
      });
      expect(result.diagnosticTrace!.structured_output_config?.enabled).toBe(true);
      expect(result.diagnosticTrace!.fallback_trace).toEqual([]);
    });

    it('fallback_trace records the LLM repair pass when pipelineOutcome.llm_repair.triggered is true', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      const outcomeWithRepair = {
        ...PIPELINE_OUTCOME,
        llm_repair: {
          triggered: true,
          outcome: 'accepted' as const,
          fallback_reason: 'structured_output_parse_failure',
          attempts: 1,
        },
      };
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(
          makeDraftResult({
            toolLLMTelemetry: TOOL_TELEMETRY,
            pipelineOutcome: outcomeWithRepair,
            draftGraphTimings: DRAFT_TIMINGS,
          }) as Awaited<ReturnType<typeof handleDraftGraph>>,
        );
      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: REQUEST_ID,
        request: STUB_REQUEST,
      });
      expect(result.diagnosticTrace!.fallback_trace.length).toBe(1);
      const fb = result.diagnosticTrace!.fallback_trace[0]!;
      expect(fb.stage).toBe('parse');
      expect(fb.fallback_action).toBe('llm_repair_pass');
      expect(fb.fallback_succeeded).toBe(true);
    });
  });

  describe('T5 — error path: timeout → trace attached on thrown error', () => {
    it('attaches diagnosticTrace to the thrown error with timed_out + error_type', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      class LLMTimeoutError extends Error {
        constructor() {
          super('llm timed out');
          this.name = 'LLMTimeoutError';
        }
      }
      const err = new LLMTimeoutError();
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>).mockRejectedValue(err);

      let caught: unknown;
      try {
        await dispatchDraftGraph({
          payload: makePayload(),
          requestId: REQUEST_ID,
          request: STUB_REQUEST,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const trace = (caught as { diagnosticTrace?: unknown }).diagnosticTrace as
        | { exit_path?: string; retry?: { timed_out?: boolean; error_type?: string } }
        | undefined;
      expect(trace).toBeDefined();
      expect(trace?.exit_path).toBe('draft_graph_error');
      expect(trace?.retry?.timed_out).toBe(true);
      expect(trace?.retry?.error_type).toBe('LLMTimeoutError');
    });
  });

  describe('T6 — redaction holds', () => {
    it('serialized trace does not contain raw brief text or API key prefix; prompt_identity hash present', async () => {
      process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
      (handleDraftGraph as MockedFunction<typeof handleDraftGraph>)
        .mockResolvedValue(
          makeDraftResult({
            toolLLMTelemetry: TOOL_TELEMETRY,
            pipelineOutcome: PIPELINE_OUTCOME,
            draftGraphTimings: DRAFT_TIMINGS,
          }) as Awaited<ReturnType<typeof handleDraftGraph>>,
        );

      const result = await dispatchDraftGraph({
        payload: makePayload(),
        requestId: REQUEST_ID,
        request: STUB_REQUEST,
      });

      const serialised = JSON.stringify(result.diagnosticTrace);
      expect(serialised).not.toContain(BRIEF_TEXT);
      expect(serialised).not.toContain(API_KEY_PREFIX);
      expect(result.diagnosticTrace!.prompt_identity[0]?.hash).toMatch(/^sha256:/);
    });
  });
});
