/**
 * WIRING test (observability lane) — `_diagnostic_trace.llm_calls` must be
 * NON-EMPTY on a REAL `runTurnExecutor` turn.
 *
 * The defect this pins: the minimal V5 diagnostic trace (the builder used for
 * the 4 non-draft V5 exits, incl. turn_executor) had its ONLY production call
 * site — `route-v2.ts` `sendFinalised200` — omit `turnTimings`, so
 * `populateCollectorFromTurnTimings` never ran and `llm_calls` was
 * structurally ALWAYS `[]`, even though a real Sonnet routing call happened.
 * The pre-existing unit tests only exercised the pure BUILDER (feeding it
 * `turnTimings` by hand) — a shape production never emitted (guarantee
 * theatre). This test drives the executor end-to-end and then builds the
 * trace EXACTLY as route-v2 does (`turnTimings: run.turnTimings`), proving the
 * real turn now surfaces a populated `llm_calls[]`.
 *
 * MUTATION-CHECK: revert the `route-v2` / `finalizeRun` threading of
 * `turnTimings` (so `run.turnTimings` is undefined) and this test goes RED —
 * `llm_calls` collapses to `[]`, exactly the shipped defect. That is the
 * discriminating power the builder-only tests lacked.
 *
 * Harness mirrors `turn-executor-reasoning-capture.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import type { HandlerFn, HandlerRegistry } from '../tools/registry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { V5TurnTimings, TurnTimingsBlock } from '../telemetry/turn-timings.js';

const mockState = vi.hoisted(() => ({
  priorTurns: [] as Array<Record<string, unknown>>,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { buildMinimalV5DiagnosticTrace } = await import('../diagnostics/v5-diagnostic-trace.js');

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-diag-llm-calls';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

const PROPOSAL_RUN_ANALYSIS = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: [],
  },
};

const GRAPH_WITH_OPTIONS: GraphStateIngress = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Profit' },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { f1: { value: 1 } } },
    { id: 'opt_b', status: 'ready', interventions: { f1: { value: 0 } } },
  ],
} as GraphStateIngress;

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran the analysis on your scenario.',
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'completed' },
      win_probabilities: { opt_a: 0.62, opt_b: 0.38 },
    },
  } as HandlerFact;
}

function makeSuccessRegistry(): HandlerRegistry {
  const handler: HandlerFn = async () => ({
    assistant_text: 'Ran the analysis on your scenario.',
    handler_facts: [runAnalysisFact()],
    llm_calls_used: 0,
  });
  return new Map([['run_analysis', handler]]);
}

// Real routing-call numbers the mock adapter reports; the assertions below
// pin that these EXACT values reach `_diagnostic_trace.llm_calls[0]`.
const ROUTING_MODEL = 'claude-sonnet-4-6';
const ROUTING_INPUT_TOKENS = 5000;
const ROUTING_OUTPUT_TOKENS = 321;
const ROUTING_CACHE_READ = 200;

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: 'Routing…' },
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: input as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: {
      input_tokens: ROUTING_INPUT_TOKENS,
      output_tokens: ROUTING_OUTPUT_TOKENS,
      cache_read_input_tokens: ROUTING_CACHE_READ,
    },
    model: ROUTING_MODEL,
    latencyMs: 800,
  };
}

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkToolUseResult(PROPOSAL_RUN_ANALYSIS)),
  };
}

let priorFlag: string | undefined;
async function setDiagnosticTraceFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  if (value === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = value;
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}
async function restoreDiagnosticTraceFlag() {
  if (priorFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorFlag;
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

describe('TurnExecutor — diagnostic trace llm_calls wiring (observability lane)', () => {
  beforeEach(() => {
    setTestSink(() => {});
    mockState.priorTurns = [];
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('flag ON: run.turnTimings carries the REAL routing call, and the route-v2 minimal trace surfaces a non-empty llm_calls[]', async () => {
    await setDiagnosticTraceFlag('true');
    try {
      const run = await runTurnExecutor(BASE_PAYLOAD, REQUEST_ID, {
        routingAdapter: mockRoutingAdapter(),
        handlerRegistry: makeSuccessRegistry(),
        graphState: GRAPH_WITH_OPTIONS,
      });

      expect(run.telemetry.commit_performed).toBe(true);
      // The turn made exactly one routing LLM call.
      expect(run.telemetry.llm_calls_used).toBeGreaterThanOrEqual(1);

      // (1) The executor exposes the fully-populated per-stage timings that
      // route-v2 threads into the trace. This is the field the fix added; its
      // absence is the shipped defect.
      const tt: V5TurnTimings | undefined = run.turnTimings;
      expect(tt).toBeDefined();
      expect(tt!.routing_llm_ms).toBeGreaterThanOrEqual(0);
      expect(tt!.total_input_tokens).toBe(ROUTING_INPUT_TOKENS);
      expect(tt!.routing_model).toBe(ROUTING_MODEL);
      expect(tt!.routing_output_tokens).toBe(ROUTING_OUTPUT_TOKENS);
      expect(tt!.cache_read_input_tokens).toBe(ROUTING_CACHE_READ);
      expect(typeof tt!.routing_prompt_hash).toBe('string');
      expect(tt!.routing_prompt_hash!.length).toBeGreaterThan(0);

      // (2) The SAME timings ride the wire `_timings.turn` block route-v2
      // strips off the body — proving the data source is real, not injected.
      const bodyTimings = (run.response as Record<string, unknown>)._timings as
        | TurnTimingsBlock
        | undefined;
      expect(bodyTimings?.turn?.routing_llm_ms).toBe(tt!.routing_llm_ms);
      expect(bodyTimings?.turn?.routing_model).toBe(ROUTING_MODEL);

      // (3) Build the minimal trace EXACTLY as sendFinalised200 does — this is
      // the production wiring under test. llm_calls must be non-empty and
      // correctly shaped with the routing call's real data.
      const trace = buildMinimalV5DiagnosticTrace({
        startedAt: Date.now() - 100,
        scenarioId: SCENARIO_ID,
        turnId: TURN_ID,
        requestId: REQUEST_ID,
        exitPath: 'turn_executor',
        graph: null,
        turnTimings: run.turnTimings,
      });

      expect(trace).toBeDefined();
      expect(trace!.llm_calls.length).toBeGreaterThanOrEqual(1);
      const call = trace!.llm_calls[0]!;
      expect(call.role).toBe('routing');
      expect(call.provider).toBe('anthropic');
      expect(call.model).toBe(ROUTING_MODEL);
      expect(call.input_tokens).toBe(ROUTING_INPUT_TOKENS);
      expect(call.output_tokens).toBe(ROUTING_OUTPUT_TOKENS);
      expect(call.cache_read_tokens).toBe(ROUTING_CACHE_READ);
      expect(call.latency_ms).toBe(run.turnTimings!.routing_llm_ms);
      // Prompt identity threaded through both the collector and correlation IDs.
      expect(trace!.prompt_identity.length).toBeGreaterThanOrEqual(1);
      expect(trace!.prompt_identity[0]!.task_id).toBe('routing');
      expect(trace!.correlation_ids.prompt_hash).toBe(run.turnTimings!.routing_prompt_hash);
    } finally {
      await restoreDiagnosticTraceFlag();
    }
  });
});
