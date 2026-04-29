/**
 * V5 TurnExecutor — decision_review enricher resilience.
 *
 * The enricher itself is robust by design (catches its own failures, emits
 * v5.decision_review.failed, returns input facts unchanged). This file
 * tests the *defensive* try/catch in turn-executor that wraps the await
 * site — it fires only if a future regression lets an exception escape.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    loadGraph: async () => null,
    storeDraftGraph: async () => undefined,
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';
import * as enricherMod from '../coaching/decision-review-enricher.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
  turn_class: 'decide',
  stage: 'analyse',
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
    results: [{ option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 }],
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

type ChatWithToolsMock = (
  args: ChatWithToolsArgs,
  opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ChatWithToolsResult>;

function mockRoutingAdapter(impl: ChatWithToolsMock) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(impl as never),
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}
function degradedEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.decision_review_degraded');
}

beforeEach(() => {
  events = [];
  installSink();
});
afterEach(() => {
  uninstallSink();
  vi.restoreAllMocks();
});

describe('TurnExecutor — decision_review enricher resilience', () => {
  it('enricher throws → analysis result still returned, v5.decision_review_degraded fires', async () => {
    // Bypass the enricher's own try/catch by replacing the entire export
    // with a synchronous throw. This simulates a future regression where
    // the never-throws invariant is broken.
    vi.spyOn(enricherMod, 'enrichRunAnalysisWithDecisionReview').mockImplementation(
      async () => {
        throw new Error('simulated enricher regression');
      },
    );

    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(resolvedRunAnalysisToolCall()),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-degr', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
      scenarioBrief: 'A decision brief',
    });

    // The turn still succeeds — the analysis result is committed with
    // enrichment.decision_review explicitly set to `null` so consumers can
    // distinguish "review attempted, degraded" from "review absent".
    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.commit_performed).toBe(true);
    const analysisBlock = result.response.blocks.find((b) => b.type === 'analysis_result');
    expect(analysisBlock).toBeDefined();
    if (analysisBlock?.type === 'analysis_result') {
      expect(analysisBlock.enrichment).toBeDefined();
      expect(analysisBlock.enrichment?.decision_review).toBeNull();
    }

    // The defensive telemetry event fires.
    const ev = degradedEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.scenario_id).toBe(TEST_SCENARIO_ID);
    expect(ev!.data.request_id).toBe('req-degr');
    expect(ev!.data.reason).toBe('simulated enricher regression');
  });

  it('happy path → no v5.decision_review_degraded event (no regression)', async () => {
    // Default enricher behaviour: the spy is not installed. The real
    // enricher runs; with no v5.brief LLM call configured, it skips with
    // reason 'no_brief' (we pass scenarioBrief: undefined). What matters
    // here is that no degraded event fires when the enricher behaves.
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(resolvedRunAnalysisToolCall()),
    );

    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-happy', {
      routingAdapter,
      handlerRegistry: createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      }),
    });

    expect(result.telemetry.failure_type).toBeNull();
    expect(result.telemetry.commit_performed).toBe(true);
    expect(degradedEvent()).toBeUndefined();
  });
});
