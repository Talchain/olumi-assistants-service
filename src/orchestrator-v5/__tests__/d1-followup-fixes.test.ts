/**
 * V5 D1 follow-up bug fixes (P0-2 / P1-3 / P1-5 / P1-6).
 *
 * Each fix has a focused test that pins the regression so a future change
 * can't silently revert the contract:
 *
 *   - P0-2: loadScenarioSnapshotForRunAnalysis must surface
 *     graph.goal_constraints on the snapshot so PLoT receives them.
 *   - P1-3: post-handler freshness uses the mutated_graph hash, so a
 *     value mutation correctly marks any prior analysis stale on the
 *     same response.
 *   - P1-5: capped factors reject rawInput > cap when a unit is supplied.
 *   - P1-6: AdjustEdgeStrengthStdSchema rejects std === 0.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import type { OrchestratorTurnPayload } from '@talchain/schemas/boundary';

import { D1HandlerError } from '../tools/handlers/d1-shared/errors.js';
import { normaliseFactorValue } from '../tools/handlers/d1-shared/normalise-factor-value.js';
import { AdjustEdgeStrengthStdSchema } from '../tools/handlers/adjust-edge-strength.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';

// -------------------------------------------------------------------------
// P1-5: capped factor rejects rawInput > cap when unit supplied
// -------------------------------------------------------------------------

describe('P1-5 — normaliseFactorValue rejects over-cap when unit supplied', () => {
  it('rejects 150% on a 100% cap', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: 150,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      }),
    ).toThrow(D1HandlerError);
  });

  it('error message names both the value and the cap (percentage formatting)', () => {
    let caught: D1HandlerError | null = null;
    try {
      normaliseFactorValue({
        rawInput: 150,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      });
    } catch (err) {
      caught = err as D1HandlerError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('PARAMETER_INVALID');
    // Percentage formatting: "150%" / "100%", no stray spaces.
    expect(caught?.message).toContain('150%');
    expect(caught?.message).toContain('100%');
    expect(caught?.message).not.toMatch(/\d\s+%/);
    expect(caught?.userGuidance).toContain('exceeds');
  });

  it('formats currency caps with prefix unit and thousands separators', () => {
    // Reuses formatValueWithUnit so currency reads as "£150,000" /
    // "£100,000", not "150000£" suffix. Exercises the polish noted in
    // the post-D1 review.
    let caught: D1HandlerError | null = null;
    try {
      normaliseFactorValue({
        rawInput: 150000,
        unit: '£',
        proposalCap: 100000,
        inputHasUnit: true,
      });
    } catch (err) {
      caught = err as D1HandlerError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('£150,000');
    expect(caught?.message).toContain('£100,000');
    expect(caught?.userGuidance).toContain('£150,000');
    expect(caught?.userGuidance).toContain('£100,000');
  });

  it('rejects negative raw_value when unit supplied', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: -5,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      }),
    ).toThrow(D1HandlerError);
  });

  it('still accepts in-range with unit', () => {
    const result = normaliseFactorValue({
      rawInput: 50,
      unit: '%',
      proposalCap: 100,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 50, value: 0.5 });
  });

  it('boundary case: rawInput exactly equal to cap is accepted', () => {
    const result = normaliseFactorValue({
      rawInput: 100,
      unit: '%',
      proposalCap: 100,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 100, value: 1 });
  });
});

// -------------------------------------------------------------------------
// P1-6: AdjustEdgeStrengthStdSchema rejects std === 0
// -------------------------------------------------------------------------

describe('P1-6 — adjust_edge_strength std must be > 0', () => {
  it('rejects 0', () => {
    const result = AdjustEdgeStrengthStdSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it('rejects negative', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(-0.1).success).toBe(false);
  });

  it('accepts a small positive', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.0001).success).toBe(true);
  });

  it('accepts the upper bound 0.5', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.5).success).toBe(true);
  });

  it('rejects above 0.5', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.51).success).toBe(false);
  });
});

// -------------------------------------------------------------------------
// P0-2: scenario snapshot includes goal_constraints
// -------------------------------------------------------------------------

describe('P0-2 — loadScenarioSnapshotForRunAnalysis surfaces goal_constraints', () => {
  it('forwards graph.goal_constraints to snapshot.goal_constraints', async () => {
    const graphWithConstraints: GraphV3T = {
      ...buildD1Fixture(),
      goal_constraints: [
        {
          constraint_id: 'gc-test-1',
          node_id: 'f-churn',
          operator: '<=',
          value: 5,
          unit: '%',
          label: 'Churn cap',
          provenance: 'explicit',
        },
      ],
    };

    const fakeStore = {
      append: async () => ({ id: 'mock-row-id' }),
      readRecent: async () => [],
      readFactsFor: async () => [],
      invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      storeDraftGraph: async () => undefined,
      loadGraph: async () => graphWithConstraints as unknown,
      loadGraphAndBriefText: async () => ({
        graph: graphWithConstraints as unknown,
        briefText: null,
      }),
      ensureScenarioExists: async () => ({ user_id: null }),
    };

    const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(
      'scn-test',
      'req-test',
      // Cast satisfies the SessionStore interface for this scoped test.
      fakeStore as unknown as Parameters<typeof loadScenarioSnapshotForRunAnalysis>[2],
    );
    expect(snapshot.goal_constraints).toBeDefined();
    expect(Array.isArray(snapshot.goal_constraints)).toBe(true);
    expect((snapshot.goal_constraints as Array<{ constraint_id: string }>)[0].constraint_id).toBe(
      'gc-test-1',
    );
  });

  it('omits goal_constraints when the graph has none', async () => {
    const graphWithoutConstraints = buildD1Fixture();
    const fakeStore = {
      append: async () => ({ id: 'mock-row-id' }),
      readRecent: async () => [],
      readFactsFor: async () => [],
      invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      storeDraftGraph: async () => undefined,
      loadGraph: async () => graphWithoutConstraints as unknown,
      loadGraphAndBriefText: async () => ({
        graph: graphWithoutConstraints as unknown,
        briefText: null,
      }),
      ensureScenarioExists: async () => ({ user_id: null }),
    };

    const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(
      'scn-test',
      'req-test',
      fakeStore as unknown as Parameters<typeof loadScenarioSnapshotForRunAnalysis>[2],
    );
    expect(snapshot.goal_constraints).toBeUndefined();
  });

  it('snapshot.goal_constraints reaches the PLoT run payload via the run_analysis handler', async () => {
    // End-to-end coverage: the snapshot field is meaningless unless the
    // handler actually forwards it. Mock the PLoT client's `run` to
    // capture the payload, then assert the forwarded `goal_constraints`
    // matches what the snapshot carried.
    const { createRunAnalysisHandler } = await import(
      '../tools/handlers/run-analysis.js'
    );
    const goalConstraints = [
      {
        constraint_id: 'gc-test-2',
        node_id: 'f-churn',
        operator: '<=' as const,
        value: 5,
        unit: '%',
        label: 'Churn cap',
        provenance: 'explicit' as const,
      },
    ];

    let capturedPayload: Record<string, unknown> | null = null;
    const fakePlotClient = {
      run: async (payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return {
          analysis_status: 'completed',
          results: [{ option_id: 'o-launch', win_probability: 0.6 }],
        } as unknown as Awaited<
          ReturnType<
            Awaited<ReturnType<typeof createRunAnalysisHandler>>
          > extends infer _R ? unknown : never
        >;
      },
      validatePatch: async () => {
        throw new Error('not used in this test');
      },
    } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];

    const handler = createRunAnalysisHandler({
      plotClient: fakePlotClient,
      scenarioReader: async () => ({
        graph: buildD1Fixture() as unknown as never,
        options: [
          { id: 'o-launch', option_id: 'o-launch', label: 'Launch now', interventions: { 'f-churn': 1 } },
        ],
        goal_node_id: 'g-revenue',
        goal_constraints: goalConstraints,
        rawPersistedGraph: buildD1Fixture(),
      }),
    });

    const SCN_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const TURN_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await handler({
      context: {
        session_id: SCN_UUID,
        stage: 'analyse',
        request_id: 'req-rg',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as never,
      payload: {
        kind: 'message',
        scenario_id: SCN_UUID,
        turn_id: TURN_UUID,
        stage: 'analyse',
        message: 'run the analysis',
      } as never,
      requestId: 'req-rg',
      signal: new AbortController().signal,
      orientationText: '',
    });

    expect(capturedPayload).not.toBeNull();
    expect((capturedPayload as Record<string, unknown>).goal_constraints).toEqual(
      goalConstraints,
    );
  });
});

// -------------------------------------------------------------------------
// P1-3: post-handler freshness uses mutated graph hash
// -------------------------------------------------------------------------

const appendCalls: Array<{
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}> = [];

// Module-state-driven mock so tests can inject prior turns/facts before
// each invocation. The turn-executor pulls prior_facts via
// build-turn-context's session-store reads, so injecting at this seam
// surfaces them on context.prior_facts at execute time.
const mockState: {
  priorTurns: ReadonlyArray<Record<string, unknown>>;
  priorFacts: ReadonlyArray<Record<string, unknown>>;
} = {
  priorTurns: [],
  priorFacts: [],
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown; handler_id?: unknown; handler_facts?: unknown }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BASE_PAYLOAD: OrchestratorTurnPayload = {
  turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: TEST_SCENARIO_ID,
  message: 'update the customer churn factor',
  turn_class: 'frame',
  stage: 'frame',
};

const SET_FACTOR_VALUE_TOOL_CALL = {
  intent_class: 'execute',
  action: {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-churn',
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: { value: 5, unit: '%', cap: 100 },
        operator: 'set',
        source: 'user_explicit',
        unit: '%',
      },
    ],
    cited_context_fields: ['graph.nodes'],
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
    latencyMs: 50,
  };
}

function mockRoutingAdapter(
  impl: (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>,
) {
  return { chatWithTools: vi.fn(impl as never) };
}

describe('P1-3 — post-handler freshness reflects mutated graph', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    setTestSink(() => undefined);
  });

  afterEach(() => {
    setTestSink(null);
  });

  it('a value mutation marks a prior fresh run_analysis fact stale on the same response', async () => {
    // Prime the executor with a prior run_analysis fact whose
    // graph_hash_at_run matches the post-merge hash that turn-executor
    // would compute for the INGRESS shape. Pre-fix the post-handler
    // hash was the same ingress hash, so freshness rendered 'fresh' on
    // a mutation turn. Post-fix the hash is computed from the merged
    // {ingress + mutation} shape and freshness reads 'stale'.
    const ingressGraph = buildD1Fixture();
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const priorGraphHash = computeAnalysisAffectingGraphHash(
      ingressGraph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );
    expect(priorGraphHash).not.toBeNull();

    // Inject a real prior turn + fact so build-turn-context surfaces
    // them on context.prior_facts, which deriveAnalysisFreshness then
    // reads.
    const priorTurnRowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    mockState.priorTurns = [
      {
        id: priorTurnRowId,
        scenario_id: TEST_SCENARIO_ID,
        user_id: null,
        turn_id: 'prior-turn-1',
        turn_class: 'handler',
        handler_id: 'run_analysis',
        request_hash: 'sha256:prior',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 12,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    mockState.priorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: TEST_SCENARIO_ID,
          leading_option_id: 'o-launch',
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
          graph_hash_at_run: priorGraphHash!,
          computed_at: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    ];

    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(SET_FACTOR_VALUE_TOOL_CALL),
    );

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));

    const { telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-p13', {
      routingAdapter,
      graphState: ingressGraph,
    });

    expect(telemetry.failure_type).toBeNull();
    expect(telemetry.turn_class).toBe('handler');

    // Post-handler freshness telemetry: must be 'stale' because the
    // mutation changed the graph hash relative to the prior fact's
    // graph_hash_at_run.
    //
    // Note: the rerun chip itself is gated to NEXT-turn explanation
    // handlers (chip-generator only fires the rerun chip when
    // `noopExplanationHandlerJustRan != null`). On a mutation turn,
    // the wire signal is the freshness verdict and the chip surfaces
    // on the user's follow-up explanation turn — not on the mutation
    // response. Asserting the freshness flip is therefore the correct
    // contract for this fix.
    const postHandlerFreshness = events
      .filter((e) => e.event === 'v5.analysis_freshness.derived')
      .find((e) => e.data.dispatch_path === 'turn_executor_post_handler');
    expect(postHandlerFreshness).toBeDefined();
    expect(postHandlerFreshness!.data.freshness).toBe('stale');
    expect(postHandlerFreshness!.data.reason).toBe('graph_hash_diverged');
    expect(postHandlerFreshness!.data.graph_hash_at_run).toBe(priorGraphHash);
    expect(postHandlerFreshness!.data.current_graph_hash).not.toBe(priorGraphHash);
  });

  it('a no-op mutation (same value) keeps freshness fresh against the prior fact', async () => {
    // When the handler mutates but the result is byte-identical to
    // the ingress (same value, same unit, same cap), the post-merge
    // hash matches `graph_hash_at_run` and freshness stays 'fresh'.
    // Proves the fix isn't over-eager: cosmetic re-saves of the same
    // value don't spuriously stale the analysis.
    const ingressGraph = buildD1Fixture();
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const priorGraphHash = computeAnalysisAffectingGraphHash(
      ingressGraph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );

    mockState.priorTurns = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        scenario_id: TEST_SCENARIO_ID,
        user_id: null,
        turn_id: 'prior-turn-1',
        turn_class: 'handler',
        handler_id: 'run_analysis',
        request_hash: 'sha256:prior',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 12,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      },
    ];
    mockState.priorFacts = [
      {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: TEST_SCENARIO_ID,
          leading_option_id: 'o-launch',
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
          graph_hash_at_run: priorGraphHash!,
          computed_at: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    ];

    // Set the factor to its existing value (4%) — no-op mutation.
    const noopToolCall = {
      intent_class: 'execute',
      action: {
        handler_id: 'set_factor_value',
        entity: {
          id: 'f-churn',
          kind: 'node',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [
          {
            name: 'value',
            value: { value: 4, unit: '%', cap: 100 },
            operator: 'set',
            source: 'user_explicit',
            unit: '%',
          },
        ],
        cited_context_fields: ['graph.nodes'],
      },
    };

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));

    const routingAdapter = mockRoutingAdapter(async () => mkToolUseResult(noopToolCall));
    await runTurnExecutor(BASE_PAYLOAD, 'req-p13-noop-value', {
      routingAdapter,
      graphState: ingressGraph,
    });

    const postHandlerFreshness = events
      .filter((e) => e.event === 'v5.analysis_freshness.derived')
      .find((e) => e.data.dispatch_path === 'turn_executor_post_handler');
    expect(postHandlerFreshness).toBeDefined();
    expect(postHandlerFreshness!.data.freshness).toBe('fresh');
    expect(postHandlerFreshness!.data.current_graph_hash).toBe(priorGraphHash);
  });

  it('post-handler hash equals the pre-mutation hash for a no-op handler invocation', async () => {
    // Computation/explanation handlers don't emit mutated_graph; the
    // post-handler hash should equal the pre-handler hash (the ingress).
    const ingressGraph = buildD1Fixture();
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const ingressHash = computeAnalysisAffectingGraphHash(
      ingressGraph as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );

    const explanationToolCall = {
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'g-revenue',
          kind: 'goal',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [],
        cited_context_fields: ['graph.nodes'],
        explanation: { answer_text: 'A short structural answer.' },
      },
    };

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((eventName, data) => events.push({ event: eventName, data }));

    const routingAdapter = mockRoutingAdapter(async () =>
      mkToolUseResult(explanationToolCall),
    );
    await runTurnExecutor(BASE_PAYLOAD, 'req-p13-noop', {
      routingAdapter,
      graphState: ingressGraph,
    });

    const postHandlerFreshness = events
      .filter((e) => e.event === 'v5.analysis_freshness.derived')
      .find((e) => e.data.dispatch_path === 'turn_executor_post_handler');
    expect(postHandlerFreshness).toBeDefined();
    expect(postHandlerFreshness!.data.current_graph_hash).toBe(ingressHash);
  });
});
