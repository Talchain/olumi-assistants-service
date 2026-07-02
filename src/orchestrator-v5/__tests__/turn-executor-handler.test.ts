/**
 * TurnExecutor × run_analysis — C2 regression through Phase 1 seven-step flow.
 *
 * Same C2 invariants as before the routing refactor, but now dispatched via
 * the new tool-use seam instead of the classifier:
 *
 *   - Happy path: run_analysis fact persists, assistant_text is the typed
 *     confirmation template, BI-01 preserved, llm_calls accounting correct
 *   - HandlerInvocationFailedError path: PLoT error, scenarioReader failure,
 *     analysis_status=blocked → HANDLER_INVOCATION_FAILED → INTERNAL_ERROR;
 *     commit NOT performed; BI-01 preserved
 *   - HandlerResultInvalidError path: forced Zod safeParse failure →
 *     HANDLER_RESULT_INVALID → INTERNAL_ERROR; no partial persistence
 *   - Constraint 7: outer budget wins over inner handler error
 *
 * The new seam (tool-use) is mocked via an injected routingAdapter. The
 * handler registry is built with real createRegistry(overrides) so the
 * run_analysis handler is exercised end-to-end against mocked PLoT + stubbed
 * scenarioReader.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { makeMessagePayload } from './fixtures.js';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

// Session store mock — capture append() calls for fact-round-trip assertions
const appendCalls: Array<unknown> = [];
vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: unknown) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
  }),
  resetSessionStoreForTests: () => {},
}));

import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { RunAnalysisScenarioSnapshot } from '../tools/handlers/run-analysis.js';

const { runTurnExecutor } = await import('../turn-executor.js');
const { createRegistry } = await import('../tools/registry.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'run the analysis',
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

function mkToolUseResult(input: unknown, textBefore?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (textBefore) content.push({ type: 'text', text: textBefore });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

function makeGoldenResponse(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' },
    results: [
      { option_id: 'opt_a', option_label: 'A', win_probability: 0.6 },
      { option_id: 'opt_b', option_label: 'B', win_probability: 0.4 },
    ],
    response_hash: 'h-top',
    analysis_status: 'completed',
  } as V2RunResponseEnvelope;
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

function makeMockPlotClient(overrides?: Partial<{ run: PLoTClient['run'] }>): PLoTClient {
  const run = overrides?.run ?? vi.fn(async () => makeGoldenResponse());
  return {
    run,
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

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];
function installSink(): void {
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
}
function uninstallSink(): void {
  setTestSink(null);
}
function expectBI01(): void {
  const started = events.filter((e) => e.event === 'turn_executor.started');
  const completed = events.filter((e) => e.event === 'turn_executor.completed');
  expect(started).toHaveLength(1);
  expect(completed).toHaveLength(1);
  expect(completed[0]!.data.response_emitted).toBe(true);
}

beforeEach(() => {
  appendCalls.length = 0;
  events = [];
  installSink();
});

afterEach(() => {
  uninstallSink();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('turn-executor × run_analysis via tool-use — happy path', () => {
  it('routing → validate (graph subset skipped) → handler → confirm → compose → commit, BI-01 preserved', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-happy', {
      routingAdapter,
      handlerRegistry: registry,
    });

    expectBI01();
    OlumiResponseSchema.parse(response);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('handler');
    expect(telemetry.intent_class).toBe('execute');
    expect(telemetry.commit_performed).toBe(true);
    const stages = telemetry.stages_completed;
    expect(stages).toContain('orient');
    expect(stages).toContain('validate');
    expect(stages).toContain('validate_skipped_no_graph');
    expect(stages).toContain('execute');
    expect(stages).toContain('confirm');
    expect(stages).toContain('compose');
    expect(stages).toContain('commit');
  });

  it('llm_calls_used = 1 (routing call only; handler contributes 0)', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-r3', {
      routingAdapter,
      handlerRegistry: registry,
    });

    expect(telemetry.llm_calls_used).toBe(1);
  });

  it('assistant_text = typed confirmation template (registry-driven per correction 5)', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-text', {
      routingAdapter,
      handlerRegistry: registry,
    });

    // V5 deterministic headline (2026-05-28): the registry forwards the
    // handler's outcome.assistant_text (template OR headline shape) to the
    // wire confirmation. The synthetic happy fixture used by this mock
    // produces a Case D headline ("X currently leads with N% probability
    // ...") rather than the locked DEFAULT template.
    //
    // V5 Group 1 Task C: on a first successful run_analysis, Step 5 emits the
    // FIRST_ANALYSIS_COMPLETE signal and compose appends its coaching text
    // after the confirmation. Both pieces must be present; order is
    // confirmation then coaching (composeToolCallResponse).
    expect(response.assistant_text).toMatch(/ currently leads\b/);
    expect(response.assistant_text).toContain('first analysis');
  });

  it('commit receives handler_facts with exactly one run_analysis fact', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-commit', {
      routingAdapter,
      handlerRegistry: registry,
    });

    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0] as {
      handler_facts: unknown[];
      handler_id: string;
      turn_class: string;
    };
    expect(write.handler_id).toBe('run_analysis');
    expect(write.turn_class).toBe('handler');
    expect(write.handler_facts).toHaveLength(1);
    const fact = write.handler_facts[0] as { fact_type: string };
    expect(fact.fact_type).toBe('run_analysis');
  });

  it('fact persisted to append carries the enrichment byte-for-byte (round-trip evidence)', async () => {
    const plotResponse = makeGoldenResponse();
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient({ run: vi.fn(async () => plotResponse) }),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    await runTurnExecutor(BASE_PAYLOAD, 'req-roundtrip', {
      routingAdapter,
      handlerRegistry: registry,
    });

    const write = appendCalls[0] as { handler_facts: unknown[] };
    const fact = write.handler_facts[0] as { result: { enrichment: Record<string, unknown> } };
    // V5 Group 1 adds V5-namespaced keys to enrichment (v5.brief from the
    // ScenarioReader snapshot; coaching_signal_id / _turn_id / _produced_at
    // when Step 5 fires). PLoT-originated keys pass through byte-for-byte.
    for (const key of Object.keys(plotResponse)) {
      expect(fact.result.enrichment[key]).toEqual(
        (plotResponse as Record<string, unknown>)[key],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// HandlerInvocationFailedError paths
// ---------------------------------------------------------------------------

describe('turn-executor × run_analysis via tool-use — HandlerInvocationFailedError paths', () => {
  it('PLoT error → INTERNAL_ERROR envelope, commit_performed=false, BI-01 holds', async () => {
    const { PLoTError } = await import('../../orchestrator/plot-client.js');
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient({
        run: vi.fn(async () => {
          throw new PLoTError('503 from PLoT');
        }),
      }),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-plot-err', {
      routingAdapter,
      handlerRegistry: registry,
    });

    expectBI01();
    OlumiResponseSchema.parse(response);
    const block = response.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
    }
    expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
    expect(telemetry.commit_performed).toBe(false);
    expect(telemetry.stages_completed).not.toContain('compose');
    expect(telemetry.stages_completed).not.toContain('commit');
    expect(telemetry.turn_class).toBe('handler');
  });

  it('scenarioReader failure → INTERNAL_ERROR with error_code=scenario_read_failed in details', async () => {
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient(),
      scenarioReader: async () => {
        throw new Error('supabase unreachable');
      },
    });

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-scen-err', {
      routingAdapter,
      handlerRegistry: registry,
    });
    const block = response.blocks[0]!;
    if (block.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.details).toMatchObject({
        failure_origin: 'handler',
        error_code: 'scenario_read_failed',
      });
    }
  });

  it('analysis_status=blocked → recoverable clean direct_answer 200 (analysis_blocked ∈ RECOVERABLE_HANDLER_CAUSES)', async () => {
    // T4 Slice 2 assertion re-derivation (ex #273), verified against current
    // source: `analysis_blocked` is a RECOVERABLE_HANDLER_CAUSES member
    // (compose/recoverable-handler-causes.ts), so an engine "cannot answer"
    // verdict recovers as a clean direct_answer 200 — commit performed, no
    // failure_type, NO error block — rather than the obsolete Phase 2.3
    // fatal INTERNAL_ERROR mapping. See Docs/v5/v5-resilience-contract.md
    // Part C; the recoverable-cause matrix in
    // turn-executor-recoverable-handler.test.ts covers the full member set.
    const blockedResponse: V2RunResponseEnvelope = {
      meta: { seed_used: 1, n_samples: 10, response_hash: 'b' },
      results: [],
      response_hash: 'b-top',
      analysis_status: 'blocked',
    } as V2RunResponseEnvelope;
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient({ run: vi.fn(async () => blockedResponse) }),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-blocked', {
      routingAdapter,
      handlerRegistry: registry,
    });
    // Recoverable clean-200 shape: commit happened, no failure recorded, a
    // direct_answer turn, and no error block on the wire.
    expect(telemetry.commit_performed).toBe(true);
    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('direct_answer');
    expect(response.blocks.every((b) => b.type !== 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HandlerResultInvalidError path
// ---------------------------------------------------------------------------

describe('turn-executor × run_analysis via tool-use — HandlerResultInvalidError path', () => {
  it('constant wire mapping: HANDLER_RESULT_INVALID + HANDLER_INVOCATION_FAILED both map to INTERNAL_ERROR', async () => {
    const { INTERNAL_TO_WIRE } = await import('../types.js');
    expect(INTERNAL_TO_WIRE.HANDLER_RESULT_INVALID).toBe('INTERNAL_ERROR');
    expect(INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED).toBe('INTERNAL_ERROR');
  });

  it('forced safeParse failure → INTERNAL_ERROR + commit NOT performed + BI-01 holds', async () => {
    const schemas = await import('@talchain/schemas/orchestrator');
    const forcedError = new z.ZodError([
      { code: 'custom', path: ['result'], message: 'forced for test coverage' },
    ]);
    const spy = vi
      .spyOn(schemas.RunAnalysisHandlerFactSchema, 'safeParse')
      .mockReturnValue({ success: false, error: forcedError });

    try {
      const routingAdapter = mockRoutingAdapter(async () =>
        mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
      );
      const registry = createRegistry({
        plotClient: makeMockPlotClient(),
        scenarioReader: async () => makeScenarioSnapshot(),
      });

      const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-hri', {
        routingAdapter,
        handlerRegistry: registry,
      });

      expectBI01();
      OlumiResponseSchema.parse(response);

      const block = response.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('INTERNAL_ERROR');
        expect(block.details).toMatchObject({ reason: 'fact_schema_violation' });
      }

      expect(telemetry.failure_type).toBe('INTERNAL_ERROR');
      expect(telemetry.commit_performed).toBe(false);
      expect(telemetry.stages_completed).not.toContain('compose');
      expect(telemetry.stages_completed).not.toContain('commit');
      expect(telemetry.turn_class).toBe('handler');

      expect(appendCalls).toHaveLength(0);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Constraint 7 — BUDGET_EXCEEDED wins over handler errors
// ---------------------------------------------------------------------------

describe("turn-executor × run_analysis via tool-use — Paul's constraint 7 (BUDGET_EXCEEDED precedence)", () => {
  it('outer budget abort during PLoT call → BUDGET_EXCEEDED wins over handler error', async () => {
    const { PLoTTimeoutError } = await import('../../orchestrator/plot-client.js');
    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(RUN_ANALYSIS_TOOL_CALL_INPUT),
    );
    const registry = createRegistry({
      plotClient: makeMockPlotClient({
        run: vi.fn(async (_payload, _requestId, opts: unknown) => {
          await new Promise<void>((_resolve, reject) => {
            const o = opts as { turnSignal?: AbortSignal };
            o.turnSignal?.addEventListener('abort', () => {
              reject(new PLoTTimeoutError('budget abort'));
            });
            setTimeout(() => reject(new PLoTTimeoutError('safety net')), 500);
          });
        }),
      }),
      scenarioReader: async () => makeScenarioSnapshot(),
    });

    vi.stubEnv('TURN_BUDGET_MS', '5');
    try {
      const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-budget', {
        routingAdapter,
        handlerRegistry: registry,
      });
      expectBI01();
      expect(telemetry.failure_type).toBe('TURN_BUDGET_EXCEEDED');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
