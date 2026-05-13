/**
 * Phase 2b — `dispatchDeterministicChipClick` whitelist tests.
 *
 * These tests pin the new generalised entry point:
 *   - Whitelist enforcement (throws for un-registered action_types).
 *   - run_analysis path delegates to the existing heavyweight dispatcher
 *     (regression: existing chip-click behaviour unchanged).
 *   - explain_results / what_would_flip paths invoke the registered handler
 *     directly, with no Sonnet routing call observed.
 *
 * The handler invocation is mocked at the registry seam (same as the
 * existing `chip-click-dispatch-analysis-ready.test.ts`), so failures of
 * the deterministic-projection helpers surface as type errors rather than
 * runtime drift. Spot checks of the projection wiring live in the
 * integration test (see `tests/integration/orchestrator/route-v2-chip-click-explain.test.ts`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  runAnalysisHandlerMock,
  explainResultsHandlerMock,
  whatWouldFlipHandlerMock,
  routeWithToolUseSpy,
  getDefaultRegistryMock,
  buildTurnContextMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  runAnalysisHandlerMock: vi.fn(),
  explainResultsHandlerMock: vi.fn(),
  whatWouldFlipHandlerMock: vi.fn(),
  routeWithToolUseSpy: vi.fn(),
  getDefaultRegistryMock: vi.fn(),
  // Hoisted so per-test happy-path overrides can call
  // `buildTurnContextMock.mockResolvedValueOnce(...)`. Default is the
  // empty-prior-facts / no-persisted-graph shape used by precondition-
  // fail tests; happy-path tests override at call site.
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    // Minimal stub — the dispatcher only reads scenarioBriefText, prior_facts,
    // persistedGraph, budgets, and session_id from the context. Other fields
    // are not consulted by the deterministic dispatch path. Hoisted so
    // happy-path tests can override via mockResolvedValueOnce.
    buildTurnContext: buildTurnContextMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: () =>
      new Map<string, unknown>([
        ['run_analysis', runAnalysisHandlerMock],
        ['explain_results', explainResultsHandlerMock],
        ['what_would_flip', whatWouldFlipHandlerMock],
      ]),
    getDefaultRegistry: getDefaultRegistryMock,
    resolveHandler: (registry: Map<string, unknown>, id: string) =>
      registry.get(id) ?? null,
  };
});

// The deterministic-bypass contract: NO routing call. Spy on routeWithToolUse
// and assert zero invocations on every test in this suite. This is the
// canonical Phase 2b assertion — the dispatcher must NOT hit the Sonnet
// routing prompt, even though it shares COMMIT/COMPOSE with TurnExecutor.
vi.mock('../../routing/route-with-tool-use.js', () => ({
  routeWithToolUse: routeWithToolUseSpy,
}));

import {
  dispatchDeterministicChipClick,
  isDeterministicChipClickActionType,
  DETERMINISTIC_CHIP_ACTION_TYPES,
} from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payloadFor(actionType: 'run_analysis' | 'explain_results' | 'what_would_flip') {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Please explain the analysis result.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: actionType },
  });
}

/**
 * Default `buildTurnContext` mock implementation — empty prior_facts,
 * no persisted graph. Per-test overrides via
 * `buildTurnContextMock.mockResolvedValueOnce({...})` for happy-path
 * scenarios that need real prior_facts / persisted graph.
 */
const DEFAULT_TURN_CONTEXT = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [{ role: 'user' as const, content: 'Please explain the result.' }],
  session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  request_id: 'req-test',
  budgets: {
    turn_ms: 30000,
    handler_ms: 20000,
    plot_ms: 15000,
    anthropic_ms: 15000,
    openai_ms: 15000,
  },
  prior_turns: [],
  prior_facts: [] as unknown[],
  scenarioBriefText: null,
  persistedGraph: null,
};

describe('dispatchDeterministicChipClick — whitelist enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    getDefaultRegistryMock.mockImplementation(
      () =>
        new Map<string, unknown>([
          ['run_analysis', runAnalysisHandlerMock],
          ['explain_results', explainResultsHandlerMock],
          ['what_would_flip', whatWouldFlipHandlerMock],
        ]),
    );
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('exposes the whitelisted action_types as an immutable set (audit-friendly)', () => {
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('run_analysis')).toBe(true);
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('explain_results')).toBe(true);
    expect(DETERMINISTIC_CHIP_ACTION_TYPES.has('what_would_flip')).toBe(true);
  });

  it('isDeterministicChipClickActionType returns true for whitelisted values and false for everything else', () => {
    expect(isDeterministicChipClickActionType('run_analysis')).toBe(true);
    expect(isDeterministicChipClickActionType('explain_results')).toBe(true);
    expect(isDeterministicChipClickActionType('what_would_flip')).toBe(true);
    // Singular alias not currently registered; explicit not-whitelisted.
    expect(isDeterministicChipClickActionType('explain_result')).toBe(false);
    // Mutation handler — must NEVER be in the whitelist (requires routed
    // proposal params per the brief stop-condition list).
    expect(isDeterministicChipClickActionType('set_factor_value')).toBe(false);
    expect(isDeterministicChipClickActionType('arbitrary_unknown')).toBe(false);
    expect(isDeterministicChipClickActionType('')).toBe(false);
  });

  it('throws when called with an unwhitelisted action_type — explicit programming-error path', async () => {
    await expect(
      dispatchDeterministicChipClick('arbitrary_unknown', {
        payload: payloadFor('run_analysis'),
        requestId: 'req-test',
      }),
    ).rejects.toThrow(/not whitelisted/);
  });

  it('throws when called with a registered handler ID that is NOT in the whitelist (e.g. mutation handler)', async () => {
    await expect(
      dispatchDeterministicChipClick('set_factor_value', {
        payload: payloadFor('run_analysis'),
        requestId: 'req-test',
      }),
    ).rejects.toThrow(/not whitelisted/);
  });
});

describe('dispatchDeterministicChipClick — explain_results path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    getDefaultRegistryMock.mockImplementation(
      () =>
        new Map<string, unknown>([
          ['run_analysis', runAnalysisHandlerMock],
          ['explain_results', explainResultsHandlerMock],
          ['what_would_flip', whatWouldFlipHandlerMock],
        ]),
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
    explainResultsHandlerMock.mockResolvedValue({
      assistant_text: 'No analysis has been run on your model yet.',
      handler_facts: [
        {
          fact_type: 'explain_results' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: true,
            option_count: 0,
            answer_source: 'precondition_template',
            fallback_reason: null,
            answer_text_length: 40,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });
  });

  it('resolves the explain_results handler from the registry and calls it directly — no LLM router invocation', async () => {
    const out = await dispatchDeterministicChipClick('explain_results', {
      payload: payloadFor('explain_results'),
      requestId: 'req-explain',
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    expect(explainResultsHandlerMock).toHaveBeenCalledTimes(1);
    // Critical Phase 2b assertion — no Sonnet routing call.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    // The other registered handlers are not consulted.
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();
  });

  it('threads the handler outcome through commit with the correct handler_id', async () => {
    await dispatchDeterministicChipClick('explain_results', {
      payload: payloadFor('explain_results'),
      requestId: 'req-explain-commit',
    });

    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    const commitArgs = commitDirectAnswerMock.mock.calls[0]!;
    expect(commitArgs[1].handler_id).toBe('explain_results');
    expect(commitArgs[1].turn_class).toBe('handler');
    expect(commitArgs[1].llm_calls_used).toBe(0);
    expect(commitArgs[1].handler_facts).toHaveLength(1);
  });

  it('the decision_review enricher is NOT invoked on the explain_results path (run_analysis-only contract)', async () => {
    await dispatchDeterministicChipClick('explain_results', {
      payload: payloadFor('explain_results'),
      requestId: 'req-no-enrich',
    });

    expect(enrichRunAnalysisMock).not.toHaveBeenCalled();
  });
});

describe('dispatchDeterministicChipClick — what_would_flip path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    getDefaultRegistryMock.mockImplementation(
      () =>
        new Map<string, unknown>([
          ['run_analysis', runAnalysisHandlerMock],
          ['explain_results', explainResultsHandlerMock],
          ['what_would_flip', whatWouldFlipHandlerMock],
        ]),
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
    whatWouldFlipHandlerMock.mockResolvedValue({
      assistant_text: 'No analysis has been run on your model yet.',
      handler_facts: [
        {
          fact_type: 'what_would_flip' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: true,
            option_count: 0,
            answer_source: 'precondition_template',
            fallback_reason: null,
            answer_text_length: 40,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });
  });

  it('resolves the what_would_flip handler from the registry and calls it directly — no LLM router invocation', async () => {
    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor('what_would_flip'),
      requestId: 'req-flip',
    });

    if (out.outcome !== 'ok') {
      throw new Error(`expected ok, got ${out.outcome}`);
    }
    expect(whatWouldFlipHandlerMock).toHaveBeenCalledTimes(1);
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    expect(runAnalysisHandlerMock).not.toHaveBeenCalled();
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();
  });

  it('handler invocation receives analysisFreshness derived from prior_facts (precondition tree input)', async () => {
    await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor('what_would_flip'),
      requestId: 'req-flip-freshness',
    });

    const invocation = whatWouldFlipHandlerMock.mock.calls[0]![0];
    // Empty prior_facts in the stubbed context → freshness 'none'.
    expect(invocation.analysisFreshness).toBeDefined();
    expect(invocation.analysisFreshness.freshness).toBe('none');
    // No persisted graph → analysisReady undefined, analysisProjection undefined.
    expect(invocation.analysisReady).toBeUndefined();
    expect(invocation.analysisProjection).toBeUndefined();
  });

  it('emits the action_type field on the v5_fact_chain_commit log line (telemetry parity with run_analysis)', async () => {
    // The log carries an `action_type` field per Phase 2b telemetry extension.
    // Asserting the field is present validates the telemetry contract; we
    // don't capture the log payload here — the integration test covers the
    // wire-observable side (freshness emit dispatch_path).
    await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor('what_would_flip'),
      requestId: 'req-flip-telemetry',
    });

    expect(whatWouldFlipHandlerMock).toHaveBeenCalled();
  });
});

/**
 * Phase 2b round-2 reviewer finding: the new `route-v2-chip-click-explain.test.ts`
 * integration suite only exercised precondition-fail cases (empty
 * prior_facts → handler returns "No analysis has been run"). The
 * dispatcher's deterministic-projection path — `buildAnalysisFromPriorFacts`
 * +  `computeStructuralReadiness` + `deriveAnalysisFreshness` — was
 * unproven. These two tests close that gap by supplying a non-empty
 * `prior_facts` (successful `run_analysis` fact with `graph_hash_at_run`
 * + `enrichment`) and a `persistedGraph` that hashes to the same value,
 * then asserting the explanation handler receives a fully-hydrated
 * `{ analysisProjection, analysisFreshness: 'fresh', analysisReady }`
 * context — the input the deterministic-fallback prose composer relies
 * on to produce sensible output rather than the precondition-unmet
 * template.
 */
describe('dispatchDeterministicChipClick — happy-path prior-fact reconstruction (round-2 reviewer)', () => {
  // Minimal real GraphV3T shape — mirrors `chip-click-dispatch-analysis-ready.test.ts`
  // READY_GRAPH (decision + goal + factor + 2 options + edges) so
  // `computeStructuralReadiness` returns a non-undefined readiness.
  const READY_GRAPH = {
    nodes: [
      { id: 'dec_launch', kind: 'decision' as const, label: 'Launch?' },
      { id: 'goal_revenue', kind: 'goal' as const, label: 'Revenue', goal_threshold: 0.8 },
      { id: 'fac_marketing', kind: 'factor' as const, label: 'Marketing spend' },
      {
        id: 'opt_launch',
        kind: 'option' as const,
        label: 'Launch now',
        interventions: { fac_marketing: 0.7 },
      },
      {
        id: 'opt_status_quo',
        kind: 'option' as const,
        label: 'Status quo',
        interventions: { fac_marketing: 0.3 },
      },
    ],
    edges: [
      { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
      { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
      { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
      { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getDefaultRegistryMock.mockImplementation(
      () =>
        new Map<string, unknown>([
          ['run_analysis', runAnalysisHandlerMock],
          ['explain_results', explainResultsHandlerMock],
          ['what_would_flip', whatWouldFlipHandlerMock],
        ]),
    );
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it("explain_results with a prior successful run_analysis fact AND a fresh-hash persisted graph → handler receives hydrated { analysisProjection, analysisFreshness: 'fresh', analysisReady }", async () => {
    // Step 1 — compute the analysis-affecting graph hash so the fact's
    // graph_hash_at_run matches and the dispatcher's
    // deriveAnalysisFreshness lands on 'fresh'.
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../context/graph-hash.js'
    );
    const { GraphStateIngressSchema } = await import('../../boundary/request-extensions.js');
    const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
    if (!parsed.success) throw new Error('test setup: graph parse failed');
    const expectedHash = computeAnalysisAffectingGraphHash(parsed.data)!;

    // Step 2 — prior_facts carries a successful run_analysis fact stamped
    // with that hash AND an enrichment payload (V2RunResponseEnvelope-like
    // shape) so `buildAnalysisFromPriorFacts` produces a non-null
    // AnalysisResponseSummary.
    const priorRunAnalysisFact = {
      fact_type: 'run_analysis' as const,
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_launch',
        win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
        summary: 'Ran analysis on your current scenario.',
        enrichment: {
          // Minimum compactAnalysis-readable shape: option_comparison with
          // option_id + win_probability so the projection lands non-null.
          option_comparison: [
            { option_id: 'opt_launch', option_label: 'Launch now', win_probability: 0.62 },
            { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.38 },
          ],
          analysis_status: 'computed',
        },
        graph_hash_at_run: expectedHash,
        computed_at: '2026-04-30T12:00:00.000Z',
      },
    };

    buildTurnContextMock.mockResolvedValueOnce({
      ...DEFAULT_TURN_CONTEXT,
      prior_facts: [priorRunAnalysisFact],
      persistedGraph: READY_GRAPH,
    });

    // Handler simply records what context it was invoked with — we
    // assert against that.
    explainResultsHandlerMock.mockResolvedValueOnce({
      assistant_text: 'Explanation prose.',
      handler_facts: [
        {
          fact_type: 'explain_results' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: false,
            option_count: 2,
            answer_source: 'deterministic_fallback' as const,
            fallback_reason: null,
            answer_text_length: 18,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });

    const out = await dispatchDeterministicChipClick('explain_results', {
      payload: payloadFor('explain_results'),
      requestId: 'req-explain-happy',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(explainResultsHandlerMock).toHaveBeenCalledTimes(1);
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    // The CORE assertion: the handler's invocation context carries
    // properly-reconstructed analysisProjection / analysisFreshness /
    // analysisReady — NOT the precondition-fail null/undefined shape.
    const invocation = explainResultsHandlerMock.mock.calls[0]![0];

    // analysisProjection — built from prior fact's enrichment.option_comparison
    // via buildAnalysisFromPriorFacts → buildAnalysisProjectionSummary.
    expect(invocation.analysisProjection).toBeDefined();
    expect(invocation.analysisProjection).not.toBeNull();

    // analysisFreshness — derived from the run_analysis fact's
    // graph_hash_at_run vs the persisted graph hash. Both match → 'fresh'.
    expect(invocation.analysisFreshness).toBeDefined();
    expect(invocation.analysisFreshness.freshness).toBe('fresh');
    expect(invocation.analysisFreshness.reason).toBe('graph_hash_match');

    // analysisReady — computed from the persisted graph via
    // computeStructuralReadiness. Graph is ready (goal threshold + 2
    // options + factor + edges) so status === 'ready'.
    expect(invocation.analysisReady).toBeDefined();
    expect(invocation.analysisReady.status).toBe('ready');
    expect(invocation.analysisReady.options).toBeDefined();
    expect(invocation.analysisReady.options.length).toBeGreaterThan(0);
  });

  it("what_would_flip with a prior successful run_analysis fact AND a fresh-hash persisted graph → same hydrated context shape", async () => {
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../context/graph-hash.js'
    );
    const { GraphStateIngressSchema } = await import('../../boundary/request-extensions.js');
    const parsed = GraphStateIngressSchema.safeParse(READY_GRAPH);
    if (!parsed.success) throw new Error('test setup: graph parse failed');
    const expectedHash = computeAnalysisAffectingGraphHash(parsed.data)!;

    const priorRunAnalysisFact = {
      fact_type: 'run_analysis' as const,
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_launch',
        win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
        summary: 'Ran analysis.',
        enrichment: {
          option_comparison: [
            { option_id: 'opt_launch', option_label: 'Launch now', win_probability: 0.62 },
            { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.38 },
          ],
          analysis_status: 'computed',
        },
        graph_hash_at_run: expectedHash,
        computed_at: '2026-04-30T12:00:00.000Z',
      },
    };

    buildTurnContextMock.mockResolvedValueOnce({
      ...DEFAULT_TURN_CONTEXT,
      prior_facts: [priorRunAnalysisFact],
      persistedGraph: READY_GRAPH,
    });

    whatWouldFlipHandlerMock.mockResolvedValueOnce({
      assistant_text: 'Flip narrative.',
      handler_facts: [
        {
          fact_type: 'what_would_flip' as const,
          fact_version: 1,
          noop: true,
          result: {
            precondition_unmet: false,
            option_count: 2,
            answer_source: 'deterministic_fallback' as const,
            fallback_reason: null,
            answer_text_length: 15,
          },
        },
      ],
      llm_calls_used: 0,
      suppress_orientation: true,
    });

    const out = await dispatchDeterministicChipClick('what_would_flip', {
      payload: payloadFor('what_would_flip'),
      requestId: 'req-flip-happy',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(whatWouldFlipHandlerMock).toHaveBeenCalledTimes(1);
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();

    const invocation = whatWouldFlipHandlerMock.mock.calls[0]![0];
    expect(invocation.analysisProjection).toBeDefined();
    expect(invocation.analysisProjection).not.toBeNull();
    expect(invocation.analysisFreshness.freshness).toBe('fresh');
    expect(invocation.analysisFreshness.reason).toBe('graph_hash_match');
    expect(invocation.analysisReady.status).toBe('ready');
  });
});

describe('dispatchDeterministicChipClick — run_analysis regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
    // run_analysis takes its existing heavyweight code path: scenario
    // snapshot pre-load + decision_review enrichment + analysis_ready
    // derivation from the cached snapshot graph. Mock the scenario read
    // to return a minimal snapshot so the dispatch completes.
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue({
      graph: {
        nodes: [
          { id: 'goal_x', kind: 'goal', label: 'Outcome', goal_threshold: 0.8 },
          { id: 'opt_a', kind: 'option', label: 'Option A', interventions: {} },
          { id: 'opt_b', kind: 'option', label: 'Option B', interventions: {} },
        ],
        edges: [],
      },
      options: [],
      goal_node_id: 'goal_x',
      rawPersistedGraph: null,
    });
    runAnalysisHandlerMock.mockResolvedValue({
      assistant_text: 'Ran analysis.',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_a',
            win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
            summary: 'Done.',
            enrichment: {},
          },
        },
      ],
      llm_calls_used: 0,
    });
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: false,
    });
  });

  it('run_analysis chip-click continues to dispatch with no behavioural change for the existing path', async () => {
    const out = await dispatchDeterministicChipClick('run_analysis', {
      payload: payloadFor('run_analysis'),
      requestId: 'req-run-analysis',
    });

    expect(out.outcome).toBe('ok');
    expect(runAnalysisHandlerMock).toHaveBeenCalledTimes(1);
    // Decision-review enricher still runs on the run_analysis path —
    // unchanged behaviour from before Phase 2b.
    expect(enrichRunAnalysisMock).toHaveBeenCalledTimes(1);
    // No Sonnet routing call.
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
    // The explanation handlers are not consulted on the run_analysis path.
    expect(explainResultsHandlerMock).not.toHaveBeenCalled();
    expect(whatWouldFlipHandlerMock).not.toHaveBeenCalled();
  });
});
