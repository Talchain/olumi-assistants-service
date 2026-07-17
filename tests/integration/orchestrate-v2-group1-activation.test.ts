/**
 * V5 Group 3 — Group 1 activation proof (final integration test).
 *
 * The purpose of the Group 3 brief is to make V5 the live path so that the
 * coaching-pipeline improvements shipped in Group 1 actually run on traffic.
 * This test proves that: a single V5 `run_analysis` turn, after the Task A
 * pre-flight, Task C model resolution, and Task B fail-closed changes are
 * applied, fires both Group 1 activation points:
 *
 *   1. enrichment.decision_review is attached to the run_analysis handler
 *      fact (Group 1 Task B — decision_review auto-fire).
 *
 *   2. coaching_signal_id === 'FIRST_ANALYSIS_COMPLETE' is emitted on the
 *      routing log record (Group 1 Task C — Step 5 coaching signal).
 *
 * Approach: a focused turn-executor test (not a full HTTP test) — mocks the
 * routing adapter, PLoT client, session store, and the
 * `invokeDecisionReview` seam, then invokes `runTurnExecutor` directly. This
 * keeps the test deterministic and avoids re-testing infrastructure already
 * covered by the other Group 3 tests. The goal is evidence that the Group 1
 * activations STILL fire end-to-end through the TurnExecutor in the
 * Group-3-updated world.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../src/utils/telemetry.js';
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';

// ----- session store mock: capture commit writes so we can inspect facts ----
// ROADMAP 1.148 — importOriginal-spread + complete shared store mock
// (derive, don't mirror): interface growth can't silently break this suite.
const appendCalls: Array<unknown> = [];
vi.mock('../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () =>
      createMockSessionStore({
        append: async (write) => {
          appendCalls.push(write);
          return { id: 'mock-row-id' };
        },
      }),
    resetSessionStoreForTests: () => {},
  };
});

// ----- config mock: control the decision_review auto-fire latency gate -----
// ROADMAP 1.148 C7: PR #209 (latency fix 1.41 FIX 3) gated the run_analysis
// decision_review auto-fire behind V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW,
// DEFAULT FALSE. The default path emits `v5.decision_review.skipped`
// (reason=autofire_disabled) instead of awaiting the enrichment LLM call.
// Both branches are pinned below; this mutable flag selects the branch.
let awaitDecisionReviewFlag = false;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'runAnalysisAwaitDecisionReview') return awaitDecisionReviewFlag;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

// ----- decision_review mock: return a fake output so enrichment lights up ---
const FAKE_DECISION_REVIEW_OUTPUT = {
  summary: 'Proceed with option A — dominant on return of investment.',
  confidence: 'high',
  headline: 'Group 1 activation proof',
};
vi.mock('../../src/cee/decision-review/invoke.js', () => ({
  invokeDecisionReview: async () => ({
    output: FAKE_DECISION_REVIEW_OUTPUT,
    raw: JSON.stringify(FAKE_DECISION_REVIEW_OUTPUT),
    model: 'group1-activation-mock',
    provider: 'openai',
    llm_latency_ms: 5,
    input_tokens: 100,
    output_tokens: 50,
    prompt_version: 'test',
  }),
}));

import type { PLoTClient } from '../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../../src/orchestrator-v5/tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../../src/orchestrator-v5/turn-executor.js');
const { createRegistry } = await import('../../src/orchestrator-v5/tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../../src/orchestrator-v5/routing/tool-schema.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const RUN_ANALYSIS_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis on my scenario',
  turn_class: 'decide',
  stage: 'analyse',
});

const RUN_ANALYSIS_TOOL_CALL_INPUT = {
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
    latencyMs: 10,
  };
}

function makeGoldenPlotResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'B', win_probability: 0.38 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
    // Non-empty enrichment is a pre-condition for the decision_review
    // enricher to fire. Any non-empty object suffices — the enricher's
    // passthrough invariant preserves unknown keys.
    enrichment: { factor_sensitivity: [] },
  } as unknown as V2RunResponseEnvelope;
}

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] },
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f: 0 } },
    ],
    goal_node_id: 'g',
  };
}

function makeMockPlotClient(): PLoTClient {
  return {
    run: vi.fn(async () => makeGoldenPlotResponse()),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

function mockRoutingAdapter(impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>) {
  return { chatWithTools: vi.fn().mockImplementation(impl as never) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

type TelemEvent = { event: string; data: Record<string, unknown> };

describe('V5 Group 1 activation proof — final integration test (Group 3)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    awaitDecisionReviewFlag = false;
  });

  /**
   * Shared single-turn driver: one V5 run_analysis turn through the real
   * TurnExecutor with routing adapter / PLoT / decision_review mocked.
   */
  async function runOneRunAnalysisTurn() {
    const events: TelemEvent[] = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScenarioSnapshot(),
    });
    // Routing log writer — the brief's acceptance criterion is that the
    // routing log includes coaching_signal_id for FIRST_ANALYSIS_COMPLETE.
    const routingLogWriter = vi.fn().mockResolvedValue(undefined);
    const { response, telemetry } = await runTurnExecutor(
      RUN_ANALYSIS_PAYLOAD,
      'req-group1-activation',
      {
        routingAdapter,
        handlerRegistry: registry,
        routingLogWriter,
        // Non-empty brief is the pre-condition for decision_review auto-fire.
        // It is passed out-of-band (not through the handler fact) per the
        // handler-ownership invariant documented in turn-executor.ts:179-183.
        scenarioBrief: 'Should we expand into the German market this quarter?',
      },
    );
    setTestSink(null);
    return { response, telemetry, events, routingLogWriter };
  }

  // ROADMAP 1.148 C7 — pin the DEFAULT behaviour: PR #209 (latency fix)
  // gates the decision_review auto-fire behind
  // V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW (default FALSE). On the default
  // path run_analysis returns without awaiting the enrichment LLM call,
  // `enrichment.decision_review` is absent, and the skip is RECORDED via
  // `v5.decision_review.skipped` reason=autofire_disabled. The Group 1
  // Task C coaching signal is NOT gated and must still fire.
  it('DEFAULT flag=false: decision_review auto-fire is skipped (autofire_disabled telemetry), coaching signal still fires', async () => {
    awaitDecisionReviewFlag = false;
    const { response, telemetry, events, routingLogWriter } =
      await runOneRunAnalysisTurn();

    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);

    // The skip is explicit, not silent.
    const skipped = events.filter((e) => e.event === 'v5.decision_review.skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.data.reason).toBe('autofire_disabled');
    expect(skipped[0]!.data.brief_present).toBe(true);

    // No decision_review enrichment on the persisted fact.
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0] as {
      handler_facts: Array<{ fact_type: string; result: { enrichment?: Record<string, unknown> } }>;
    };
    const raFact = write.handler_facts.find((f) => f.fact_type === 'run_analysis');
    expect(raFact).toBeDefined();
    expect(raFact!.result.enrichment?.decision_review).toBeUndefined();

    // Group 1 Task C is NOT behind the latency gate — still fires.
    await new Promise((r) => setImmediate(r));
    expect(routingLogWriter).toHaveBeenCalledTimes(1);
    const record = routingLogWriter.mock.calls[0]![0] as {
      coaching_signal_id: string | null;
    };
    expect(record.coaching_signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
  });

  it('flag=true: activates BOTH Group 1 outputs on a single V5 run_analysis turn', async () => {
    // ROADMAP 1.148 C7: opt in to the auto-fire (PR #209 default is
    // false) so the original Group 1 activation proof still runs against
    // the real awaited path.
    awaitDecisionReviewFlag = true;
    const { response, telemetry, events, routingLogWriter } =
      await runOneRunAnalysisTurn();

    // ---- Basic turn health ----------------------------------------------
    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');

    // ---- Group 1 Task B: decision_review enrichment attached to fact ----
    // The handler fact persisted to `commit` must carry
    // enrichment.decision_review with the (mocked) LLM output.
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0] as {
      handler_id: string;
      handler_facts: Array<{
        fact_type: string;
        result: { enrichment?: Record<string, unknown> };
      }>;
    };
    expect(write.handler_id).toBe('run_analysis');
    const raFact = write.handler_facts.find((f) => f.fact_type === 'run_analysis');
    expect(raFact).toBeDefined();
    const enrichment = raFact!.result.enrichment;
    expect(enrichment).toBeDefined();
    // The decision_review key is the Group 1 Task B activation signal.
    expect(enrichment!.decision_review).toBeDefined();
    const review = enrichment!.decision_review as Record<string, unknown>;
    expect(review.summary).toBe(FAKE_DECISION_REVIEW_OUTPUT.summary);
    expect(review.confidence).toBe(FAKE_DECISION_REVIEW_OUTPUT.confidence);
    // Enricher stamps its own produced_at; its presence confirms the
    // enricher's code path ran (as opposed to any upstream attaching a
    // decision_review key by chance).
    expect(typeof review.produced_at).toBe('string');

    // ---- Group 1 Task C: coaching_signal_id on the routing log ----------
    // Wait one microtask for the fire-and-forget routing-log writer.
    await new Promise((r) => setImmediate(r));
    expect(routingLogWriter).toHaveBeenCalledTimes(1);
    const record = routingLogWriter.mock.calls[0]![0] as {
      scenario_id: string;
      intent_class: string;
      handler_id: string | null;
      coaching_signal_id: string | null;
    };
    expect(record.scenario_id).toBe(TEST_SCENARIO_ID);
    expect(record.intent_class).toBe('execute');
    expect(record.handler_id).toBe('run_analysis');
    // Core Group 1 Task C assertion.
    expect(record.coaching_signal_id).toBe('FIRST_ANALYSIS_COMPLETE');

    // Sanity: Step 5's v5.coaching.signal_fired telemetry event also fired.
    const signalEvents = events.filter((e) => e.event === 'v5.coaching.signal_fired');
    expect(signalEvents).toHaveLength(1);
    expect(signalEvents[0]!.data.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
  });
});
