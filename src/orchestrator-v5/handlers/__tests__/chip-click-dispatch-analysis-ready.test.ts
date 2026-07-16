/**
 * V5 analysis_ready contract — chip-click-dispatch coverage.
 *
 * Pins the V5 golden-path Step 4→Step 5 wire fix: a successful run_analysis
 * chip-click ships analysis_ready computed from the SAME GraphV3T the
 * handler operated on. Without this the wire response carries no
 * runnability signal, the model gates Step 5 with "results aren't back
 * yet", and the legacy fallback cannot recover because chip-click does
 * not mutate any UI-visible store.
 *
 * Single-source-of-truth design (P1.1): the dispatcher pre-loads the
 * scenario snapshot ONCE via `loadScenarioSnapshotForRunAnalysis`,
 * injects it into the handler via a one-shot `ScenarioReader`, and
 * derives readiness from `snapshot.graph` AFTER commit. Both consumers
 * (handler and `computeStructuralReadiness`) read the same `GraphV3T`
 * reference — no second persistence read, no TOCTOU window.
 *
 * Tests use the REAL `computeStructuralReadiness` against a real
 * GraphV3T-shaped fixture; no schema/parse mocks. Drift in the readiness
 * helper or the schema would surface here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

// V5 Phase 1 brief persistence: stash a mutable holder so individual tests
// can override the stubbed context's scenarioBriefText (the field is read by
// chip-click-dispatch and forwarded to the decision-review enricher).
const buildTurnContextStub: { scenarioBriefText: string | null } = {
  scenarioBriefText: null,
};

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
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
      prior_facts: [],
      scenarioBriefText: buildTurnContextStub.scenarioBriefText,
      persistedGraph: null,
    })),
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
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

// Real schema-valid GraphV3T fixture (mirrors `analysis-ready-helper.test.ts`'s
// `makeReadyGraph` shape). The snapshot loader's contract is to return
// `snapshot.graph` already validated by `GraphV3.safeParse`, so consumers
// (including the cast inside chip-click-dispatch) treat it as a valid
// GraphV3T. Using a real fixture means a regression in the readiness
// helper or the schema definition will surface here, not be hidden by
// a parse mock.
const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      interventions: { fac_marketing: 0.7 },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Status quo',
      interventions: { fac_marketing: 0.3 },
    },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshotFor(graph: GraphV3T): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    // V5 state-trust: tests use the V3-shape graph as both the parsed
    // and the raw form (no separate Supabase round-trip in unit tests).
    // The hash function projects the same analysis-affecting fields
    // either way.
    rawPersistedGraph: graph,
  };
}

function handlerOk() {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
          summary: 'Ran analysis on your current scenario.',
          enrichment: {},
        },
      },
    ],
    llm_calls_used: 0,
  };
}

describe('chip-click-dispatch — analysisReady surfacing (V5 finaliser brief)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlerFnMock.mockResolvedValue(handlerOk());
    enrichRunAnalysisMock.mockImplementation(async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts);
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    });
    // Production path builds a per-call registry — return the same mocked
    // run_analysis handler so dispatch wiring is tested end-to-end.
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  });

  it('successful run_analysis surfaces analysisReady on the dispatch result, not on the response', async () => {
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(READY_GRAPH));

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-ok',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);

    // Composer-cleanliness invariant — chip-click compose output never
    // writes analysis_ready directly.
    expect('analysis_ready' in out.response).toBe(false);

    // Dispatch result carries the real readiness payload computed from
    // the cached snapshot graph. No mock of computeStructuralReadiness —
    // schema/helper drift would fail here.
    expect(out.analysisReady).toBeDefined();
    const ar = out.analysisReady!;
    expect(ar.goal_node_id).toBe('goal_revenue');
    expect(ar.status).toBe('ready');
    expect(ar.options.map((o) => o.option_id).sort()).toEqual(['opt_launch', 'opt_status_quo']);
    // Dispatcher does NOT attach computed_at — that's the finaliser's job.
    expect((ar as { computed_at?: string }).computed_at).toBeUndefined();
  });

  it('snapshot is loaded EXACTLY ONCE and the same reference is shared with the handler reader and readiness derivation (P1.1 — no TOCTOU)', async () => {
    const snapshot = snapshotFor(READY_GRAPH);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshot);

    // Capture the scenarioReader injected into createRegistry so we can
    // prove it returns the same snapshot reference the dispatcher uses
    // for readiness derivation.
    let capturedReader: (() => Promise<RunAnalysisScenarioSnapshot>) | null = null;
    createRegistryMock.mockImplementationOnce((overrides: { scenarioReader?: () => Promise<RunAnalysisScenarioSnapshot> }) => {
      capturedReader = overrides.scenarioReader ?? null;
      return new Map([['run_analysis', handlerFnMock]]);
    });

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-single-source',
    });

    // Persistence read is a single call against the SAME scenario_id the
    // handler is dispatched for.
    expect(loadScenarioSnapshotForRunAnalysisMock).toHaveBeenCalledTimes(1);
    // #343: the pre-load now also threads (sessionStore=undefined,
    // ingressGraphState) — undefined here because this dispatch carried no
    // graph_state, pinning that absence stays absence (byte-parity mode).
    expect(loadScenarioSnapshotForRunAnalysisMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      expect.any(String),
      undefined,
      undefined,
    );

    // The injected scenarioReader returns the SAME snapshot OBJECT IDENTITY
    // the dispatcher cached. Strict identity (===) — not deep equality —
    // is the load-bearing assertion: it proves there is no second
    // persistence read between handler invocation and readiness
    // derivation.
    expect(capturedReader).not.toBeNull();
    const readerOutput = await capturedReader!();
    expect(readerOutput).toBe(snapshot);
    expect(readerOutput.graph).toBe(snapshot.graph);
  });

  it('race regression: a concurrent edit-graph between handler-time and readiness-time CANNOT alter the readiness output (single-source-of-truth)', async () => {
    // Setup: snapshot with the original (ready) graph is loaded. AFTER
    // dispatch starts but BEFORE readiness is derived, simulate a
    // concurrent edit-graph dispatch from another session that would
    // change the persisted record. In the OLD design (two reads against
    // `loadPersistedGraph`) the readiness derivation could observe the
    // post-edit graph while the handler ran on the pre-edit graph — a
    // wire emission that doesn't match what the handler actually saw.
    // The redesign makes this impossible: readiness derives from the
    // cached snapshot reference, not from a fresh persistence read.
    const originalSnapshot = snapshotFor(READY_GRAPH);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(originalSnapshot);

    // Simulate the concurrent edit landing during handler execution by
    // queueing a SECOND mock for any subsequent persistence read. If the
    // implementation regresses and re-reads persistence for readiness,
    // it will see this divergent graph and emit drifted readiness. The
    // assertion below proves no second read happens.
    const divergentGraph: GraphV3T = {
      ...READY_GRAPH,
      nodes: READY_GRAPH.nodes.filter((n) => (n as { kind?: string }).kind !== 'goal'),
    } as GraphV3T;
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshotFor(divergentGraph));

    handlerFnMock.mockImplementationOnce(async () => {
      // Mid-handler: the divergent state is now in persistence. A
      // regressed implementation would observe it on a second read.
      return handlerOk();
    });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-race',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);

    // Persistence load is called exactly ONCE — no second read happens
    // for readiness. The divergent mock is never consumed.
    expect(loadScenarioSnapshotForRunAnalysisMock).toHaveBeenCalledTimes(1);

    // Readiness reflects the ORIGINAL graph the handler saw, NOT the
    // divergent post-edit state (which would have produced
    // `undefined` due to missing goal node).
    expect(out.analysisReady).toBeDefined();
    expect(out.analysisReady!.goal_node_id).toBe('goal_revenue');
    expect(out.analysisReady!.status).toBe('ready');
  });

  it('omits analysisReady when the persisted snapshot fails to load (no goal node, parse failure, or scenario not found) — and logs the reason', async () => {
    // A GENERIC reader failure (transport down / parse failure / missing goal node) —
    // NOT the null-persisted-graph case, which now throws AnalysisNotReadyError and
    // classifies as `analysis_not_ready`, not `scenario_read_failed`. This test mocks
    // both the reader and the handler, so it exercises dispatch outcome classification
    // independent of the real reader's contract.
    const loadError = new Error('Supabase unreachable');
    loadScenarioSnapshotForRunAnalysisMock.mockRejectedValueOnce(loadError);

    // The handler-reader re-throws the cached load error → handler's own catch ladder
    // wraps a generic read failure as HandlerInvocationFailedError(scenario_read_failed).
    // Stub the handler invocation to throw the corresponding error so we can observe
    // the dispatch's outcome classification.
    const { HandlerInvocationFailedError } = await import('../../tools/handler-errors.js');
    handlerFnMock.mockRejectedValueOnce(
      new HandlerInvocationFailedError('Scenario read failed', {
        cause_kind: 'scenario_read_failed',
        retryable: true,
        details: { handler_id: 'run_analysis' },
        cause: loadError,
      }),
    );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-no-snapshot',
    });

    // Outcome is handler_failure (typed) — no analysisReady stamped.
    expect(out.outcome).toBe('handler_failure');
    expect(out.analysisReady).toBeUndefined();
  });
});

// ─── V5 state-trust — REAL freshness derivation (not mocked) ──────────────

describe('chip-click-dispatch — freshness derivation runs against produced fact', () => {
  beforeEach(() => {
    // vi.clearAllMocks() only clears call history — it does NOT drain
    // queued mockResolvedValueOnce / mockRejectedValueOnce. The previous
    // describe block's last test queues a rejection on
    // loadScenarioSnapshotForRunAnalysisMock that would otherwise leak
    // into the first test here. mockReset() drains both call history
    // AND queued returns AND the implementation, giving each test a
    // pristine mock.
    loadScenarioSnapshotForRunAnalysisMock.mockReset();
    handlerFnMock.mockReset();
    vi.clearAllMocks();
    enrichRunAnalysisMock.mockImplementation(async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts);
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    });
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  });

  it('produces freshness=fresh when handler emits a fact whose graph_hash_at_run matches the snapshot graph hash', async () => {
    const snapshot = snapshotFor(READY_GRAPH);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshot);

    // Compute the actual analysis-affecting hash for the snapshot.
    // The dispatcher hashes from `rawPersistedGraph` (parsed via
    // GraphStateIngressSchema) so the test's expected hash must come
    // from the same path. snapshotFor() sets rawPersistedGraph to the
    // V3-shape graph; the Ingress schema accepts that shape via
    // passthrough().
    const { computeAnalysisAffectingGraphHash } = await import(
      '../../context/graph-hash.js'
    );
    const { GraphStateIngressSchema } = await import(
      '../../boundary/request-extensions.js'
    );
    const parsedForExpected = GraphStateIngressSchema.safeParse(snapshot.rawPersistedGraph);
    if (!parsedForExpected.success) throw new Error('test setup: ingress parse failed');
    const expectedHash = computeAnalysisAffectingGraphHash(parsedForExpected.data)!;

    // Handler returns a fact stamped with the matching hash. The
    // dispatcher's freshness derivation block must read this fact and
    // produce 'fresh' — NOT mocked.
    handlerFnMock.mockResolvedValueOnce({
      assistant_text: 'Ran analysis on your current scenario.',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_launch',
            win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
            summary: 'Ran analysis on your current scenario.',
            enrichment: { analysis_status: 'computed' },
            graph_hash_at_run: expectedHash,
            computed_at: '2026-04-30T12:00:00.000Z',
          },
        },
      ],
      llm_calls_used: 0,
    });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-real-freshness',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    // Real-derivation assertions: the dispatcher computed these from
    // (a) the fact the handler produced and (b) the snapshot graph.
    // No mock pre-set freshness on the result.
    expect(out.freshness).toBeDefined();
    expect(out.freshness!.freshness).toBe('fresh');
    expect(out.freshness!.reason).toBe('graph_hash_match');
    expect(out.freshness!.graph_hash_at_run).toBe(expectedHash);
    expect(out.freshness!.current_graph_hash).toBe(expectedHash);
    expect(out.freshness!.computed_at).toBe('2026-04-30T12:00:00.000Z');
  });

  it('produces freshness=stale when the produced fact records a different graph hash than the snapshot', async () => {
    // Edge case: handler produces a fact with a hash that does NOT match
    // the snapshot graph (could happen if the handler used a different
    // graph internally, or if the fact came from a previous turn). The
    // derivation must compare honestly and report stale.
    const snapshot = snapshotFor(READY_GRAPH);
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValueOnce(snapshot);

    handlerFnMock.mockResolvedValueOnce({
      assistant_text: 'Ran analysis on your current scenario.',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_launch',
            win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
            summary: 'Ran analysis on your current scenario.',
            enrichment: { analysis_status: 'computed' },
            graph_hash_at_run: 'forced_mismatch_',
            computed_at: '2026-04-30T12:00:00.000Z',
          },
        },
      ],
      llm_calls_used: 0,
    });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-real-stale',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.freshness!.freshness).toBe('stale');
    expect(out.freshness!.reason).toBe('graph_hash_diverged');
    expect(out.freshness!.graph_hash_at_run).toBe('forced_mismatch_');
  });
});

// ---------------------------------------------------------------------------
// V5 Phase 1 brief persistence — chip-click sources brief from canonical
// state via EnrichedTurnContext.scenarioBriefText. Pre-fix: chip-click
// hardcoded brief: null at the enricher invocation, so decision_review
// always skipped with reason `no_brief` on the chip-click leg
// (independent of TurnExecutor's parallel defect B bug).
// ---------------------------------------------------------------------------

describe('chip-click-dispatch — decision_review brief sourcing (V5 Phase 1)', () => {
  // V5 latency gate (#209, d92702d4): the decision_review auto-fire on the
  // chip-click run_analysis path is gated behind
  // `V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` (default false → skip with
  // reason `autofire_disabled`). These tests pin brief-sourcing INTO the
  // enricher, which only runs on the legacy await path, so run them with
  // the flag on — same pattern as
  // turn-executor-decision-review-resilience.test.ts.
  let priorAwaitFlag: string | undefined;
  beforeEach(async () => {
    vi.clearAllMocks();
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
    enrichRunAnalysisMock.mockImplementation(async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts);
    // Reset stub to default null between tests so brief-presence does
    // not leak across the suite.
    buildTurnContextStub.scenarioBriefText = null;
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });
  afterEach(async () => {
    if (priorAwaitFlag === undefined) {
      delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    } else {
      process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    }
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('passes context.scenarioBriefText to enrichRunAnalysisWithDecisionReview when persisted', async () => {
    buildTurnContextStub.scenarioBriefText = 'Should I take the offer?';

    handlerFnMock.mockResolvedValue({
      assistant_text: 'ran',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_launch',
            win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
            summary: 'Analysis ran with two options compared.',
            enrichment: { analysis_status: 'computed' },
          },
        },
      ],
      llm_calls_used: 0,
    });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-brief-canonical',
    });

    expect(out.outcome).toBe('ok');
    expect(enrichRunAnalysisMock).toHaveBeenCalled();
    const call = enrichRunAnalysisMock.mock.calls[enrichRunAnalysisMock.mock.calls.length - 1];
    expect(call[0].brief).toBe('Should I take the offer?');
  });

  it('passes null brief to enricher when no brief is persisted (graceful skip preserved)', async () => {
    buildTurnContextStub.scenarioBriefText = null;

    handlerFnMock.mockResolvedValue({
      assistant_text: 'ran',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_launch',
            win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
            summary: 'Analysis ran with two options compared.',
            enrichment: { analysis_status: 'computed' },
          },
        },
      ],
      llm_calls_used: 0,
    });

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-no-brief',
    });

    expect(out.outcome).toBe('ok');
    const call = enrichRunAnalysisMock.mock.calls[enrichRunAnalysisMock.mock.calls.length - 1];
    expect(call[0].brief).toBeNull();
  });

  it('Defect B regression — chip-click no longer hardcodes brief: null', async () => {
    // Pre-fix: chip-click-dispatch.ts:323 had `brief: null` hardcoded,
    // making decision_review always skip with reason `no_brief` on the
    // chip-click path even when a brief was supplied on the draft turn.
    // Post-fix: the persisted brief reaches the enricher.
    buildTurnContextStub.scenarioBriefText = 'A brief that must reach the enricher';

    handlerFnMock.mockResolvedValue({
      assistant_text: 'ran',
      handler_facts: [
        {
          fact_type: 'run_analysis' as const,
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: SCENARIO_ID,
            leading_option_id: 'opt_launch',
            win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
            summary: 'Analysis ran.',
            enrichment: { analysis_status: 'computed' },
          },
        },
      ],
      llm_calls_used: 0,
    });

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-defect-b',
    });

    const call = enrichRunAnalysisMock.mock.calls[enrichRunAnalysisMock.mock.calls.length - 1];
    expect(call[0].brief).not.toBeNull();
    expect(call[0].brief).toBe('A brief that must reach the enricher');
  });
});
