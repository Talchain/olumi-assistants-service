/**
 * WIRING test (decision-review-latency-attribution lane, follow-up to #471).
 *
 * The awaited decision_review enrichment LLM call is the DOMINANT analysis-turn
 * cost (~14 s on staging) yet today it is invisible in latency attribution:
 *   - it is NOT a `_diagnostic_trace.llm_calls` entry (only the routing/orient
 *     call is, post #471); and
 *   - its wall-clock is MISATTRIBUTED to `turnTimings.compose_ms` — the compose
 *     bracket (handler-return → commit-start) straddles the enricher await, so
 *     a synchronous LLM call is mislabelled as "response composition".
 *
 * This drives a REAL `runTurnExecutor` run_analysis turn under
 * `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true` (enricher awaited on the turn's
 * wall-clock — the deployed staging posture) and `CEE_DIAGNOSTIC_TRACE_ENABLED=
 * true` (timings captured + trace built). The underlying decision_review LLM
 * call is mocked to (a) take a measurable delay and (b) report a known
 * model/provider/token usage, which the enricher threads back via
 * `callTelemetrySink` and the executor surfaces. The trace is then built
 * EXACTLY as route-v2's `sendFinalised200` does.
 *
 * Proves (WIRING over purity — end-to-end, not a builder return):
 *   (1) `turnTimings.decision_review_ms` carries the awaited call's wall-clock,
 *       with the threaded model/provider/tokens co-set;
 *   (2) `compose_ms` NO LONGER absorbs that latency (compose_ms < the enricher
 *       delay); and
 *   (3) `_diagnostic_trace.llm_calls` gains a SECOND entry, role
 *       'decision_review', carrying the REAL threaded model/provider/tokens and
 *       the wall-clock latency — alongside the routing entry.
 *
 * MUTATION-CHECK — reverting ANY production edit turns this RED:
 *   - executor `turnTimings.decision_review_ms` population → (1) undefined,
 *     (2) compose absorbs the delay again, (3) no entry;
 *   - enricher `callTelemetrySink` population → executor gate never fires →
 *     same failures;
 *   - diagnostic-trace second `llm_calls` entry → (3) fails;
 *   - `compose_ms` subtraction → (2) fails (compose_ms >= decision_review_ms).
 *
 * Harness mirrors turn-executor-decision-review-resilience.test.ts (session
 * brief stub + golden PLoT) and turn-executor-diagnostic-llm-calls.test.ts
 * (trace build under CEE_DIAGNOSTIC_TRACE_ENABLED).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { ModelResolution } from '../../adapters/llm/router.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';
import type { V5TurnTimings } from '../telemetry/turn-timings.js';
import * as invokeMod from '../../cee/decision-review/invoke.js';

// Session-store stub: `loadGraphAndBriefText` returns the canonical brief so
// the enricher clears its `no_brief` gate and reaches the LLM call.
const mockSessionState: { briefText: string | null } = { briefText: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: mockSessionState.briefText }),
    storeDraftGraph: async () => undefined,
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { buildMinimalV5DiagnosticTrace } = await import('../diagnostics/v5-diagnostic-trace.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-dr-latency-attribution';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
});

// Known decision_review call attribution the mock reports; the assertions pin
// these EXACT values reach both `turnTimings` and the `decision_review`
// llm_calls entry (proves REAL threading, not zero-fill / fabrication).
const DR_MODEL = 'gpt-4.1';
const DR_PROVIDER = 'openai';
const DR_INPUT_TOKENS = 4321;
const DR_OUTPUT_TOKENS = 876;
// Measurable enricher delay so `decision_review_ms` is unambiguously non-trivial
// and the de-absorption of `compose_ms` is discriminating with a WIDE margin.
// Real compose work in this heavily-logged harness runs ~tens-to-few-hundred ms
// with variance, so the delay is set well above it: `compose_ms <
// decision_review_ms` then holds with room to spare, and reverting the
// subtraction (compose_ms ≈ compose_work + DR_DELAY_MS) flips it RED. Comfortably
// inside the 60 s default turn budget, so the enricher never aborts.
const DR_DELAY_MS = 1000;

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: DR_MODEL,
  resolution_source: 'task_default',
  provider: DR_PROVIDER,
};

function mkToolUseResult(input: unknown): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
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
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function resolvedRunAnalysisToolCall() {
  return {
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
      cited_context_fields: ['graph.options'],
    },
  };
}

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Plan A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Plan B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

function makeGoldenResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 },
      { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.3 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(async () => makeGoldenResponse()),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function mockRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => mkToolUseResult(resolvedRunAnalysisToolCall())),
  };
}

function mockDecisionReviewInvoke() {
  return vi.spyOn(invokeMod, 'invokeDecisionReview').mockImplementation(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, DR_DELAY_MS));
    return {
      output: {
        narrative_summary: 'Option A leads',
        story_headlines: ['A ahead'],
        robustness_explanation: 'stable',
        readiness_rationale: 'ready',
        evidence_enhancements: [],
        bias_findings: [],
        key_assumptions: ['price is elastic'],
        decision_quality_prompts: ['what if churn doubles'],
      },
      raw: '{}',
      model: DR_MODEL,
      provider: DR_PROVIDER,
      llm_latency_ms: DR_DELAY_MS,
      input_tokens: DR_INPUT_TOKENS,
      output_tokens: DR_OUTPUT_TOKENS,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    };
  });
}

let priorTraceFlag: string | undefined;
let priorAwaitFlag: string | undefined;
async function setFlags(): Promise<void> {
  priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
  process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
  process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}
async function restoreFlags(): Promise<void> {
  if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
  else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
  if (priorAwaitFlag === undefined) delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
  else process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

describe('TurnExecutor — decision_review latency attribution (observability lane)', () => {
  beforeEach(() => {
    setTestSink(() => {});
    mockSessionState.briefText = 'A decision brief about pricing strategy';
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('surfaces decision_review as its own llm_calls entry AND de-absorbs it from compose_ms', async () => {
    await setFlags();
    const drSpy = mockDecisionReviewInvoke();
    try {
      const run = await runTurnExecutor(BASE_PAYLOAD, REQUEST_ID, {
        routingAdapter: mockRoutingAdapter(),
        handlerRegistry: createRegistry({
          plotClient: makeMockPlotClient(),
          scenarioReader: async () => makeScenarioSnapshot(),
        }),
      });

      // The REAL enricher ran (not spied away) and reached the LLM call.
      expect(drSpy).toHaveBeenCalledTimes(1);
      expect(run.telemetry.commit_performed).toBe(true);

      const tt: V5TurnTimings | undefined = run.turnTimings;
      expect(tt).toBeDefined();

      // (1) The awaited decision_review wall-clock is captured, with the
      // call's REAL model/provider/tokens threaded back and co-set.
      expect(tt!.decision_review_ms).toBeGreaterThanOrEqual(DR_DELAY_MS - 60);
      expect(tt!.decision_review_model).toBe(DR_MODEL);
      expect(tt!.decision_review_provider).toBe(DR_PROVIDER);
      expect(tt!.decision_review_input_tokens).toBe(DR_INPUT_TOKENS);
      expect(tt!.decision_review_output_tokens).toBe(DR_OUTPUT_TOKENS);

      // (2) DE-ABSORPTION: compose_ms must no longer contain the enricher
      // delay. Real composition work here is a few ms; without the subtraction
      // compose_ms would be >= DR_DELAY_MS (it brackets the await).
      expect(tt!.compose_ms).toBeDefined();
      expect(tt!.compose_ms!).toBeLessThan(tt!.decision_review_ms!);

      // (3) Build the minimal trace EXACTLY as sendFinalised200 does — the
      // production wiring under test. A SECOND llm_calls entry (role
      // decision_review) appears with the threaded attribution.
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
      expect(trace!.llm_calls.length).toBeGreaterThanOrEqual(2);
      expect(trace!.llm_calls.some((c) => c.role === 'routing')).toBe(true);

      const drCall = trace!.llm_calls.find((c) => c.role === 'decision_review');
      expect(drCall).toBeDefined();
      expect(drCall!.provider).toBe(DR_PROVIDER);
      expect(drCall!.model).toBe(DR_MODEL);
      expect(drCall!.input_tokens).toBe(DR_INPUT_TOKENS);
      expect(drCall!.output_tokens).toBe(DR_OUTPUT_TOKENS);
      // The surfaced latency is the executor's wall-clock for the await.
      expect(drCall!.latency_ms).toBe(tt!.decision_review_ms);
    } finally {
      await restoreFlags();
    }
  });
});
