/**
 * D1 — THE CHIP-CLICK RUN RETURNS THE WINDOW ITS OWN RUN IS IN (the dispatcher half of the `run_delta` hand-off).
 *
 * Every Run the user asks for reaches `dispatchChipClickRunAnalysis` (Run chip, the Agent's Run fast path, the
 * Agent's `run_analysis` tool). Served `a327556`, scenario `a87c883b` (Canonical #70 5850113962): the re-run after
 * an approved revision shipped no `run_delta`, because this exit never handed the finaliser a window. The route
 * half is `route-v2-chip-run-delta-threading.test.ts`; this file runs the REAL dispatcher and pins the two things
 * the executor's twin (`turn-executor-run-delta-prior-facts.test.ts`) pins on its exit:
 *   1. THE WINDOW — the post-dispatch array, so `pair.current` IS the run this turn just produced (the entry
 *      window would pair (A′, A) and leave this run out of its own consequence block);
 *   2. THE GATE — present only when this turn produced a SUCCESSFUL run (`isSuccessfulRunAnalysisFact`).
 * Harness copied from `chip-click-dispatch-analysis-ready.test.ts` (same mocks), with the entry window seeded.
 */
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
// D1: the turn-ENTRY window the dispatcher is handed (`context.prior_facts`).
const windowStub: { prior: unknown[] } = { prior: [] };

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
      prior_facts: windowStub.prior,
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



import { selectRunAnalysisFact } from '../../context/freshness.js';

const THIS_RUN_AT = '2026-09-26T21:36:58.000Z';
const THIS_RUN_HASH = 'cccc3333dddd4444';

/** A persisted earlier run — identified by its `summary` sentinel, never by a value another fact could carry. */
function priorRun() {
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_status_quo',
      win_probabilities: { opt_launch: 0.4, opt_status_quo: 0.6 },
      summary: 'SENTINEL: the earlier run',
      enrichment: { analysis_status: 'completed' },
      computed_at: '2026-09-26T21:36:10.000Z',
      graph_hash_at_run: 'aaaa1111bbbb2222',
    },
  };
}

function handlerRun(opts: { noop?: boolean } = {}) {
  return {
    assistant_text: 'Ran analysis on your current scenario.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: opts.noop ?? false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          win_probabilities: { opt_launch: 0.62, opt_status_quo: 0.38 },
          summary: 'SENTINEL: this run',
          enrichment: { analysis_status: 'completed' },
          computed_at: THIS_RUN_AT,
          graph_hash_at_run: THIS_RUN_HASH,
        },
      },
    ],
    llm_calls_used: 0,
  };
}

const summaryOf = (f: unknown) => (f as { result?: { summary?: unknown } }).result?.summary;

describe('chip-click Run → `priorFacts`, the run_delta basis (D1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowStub.prior = [];
    enrichRunAnalysisMock.mockImplementation(async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts);
    commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
      response: r, performed: true, persisted_row_id: 'row-1', graphPersisted: true,
    }));
    createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
    loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshotFor(READY_GRAPH));
  });

  it('RED (served a87c883b): a RERUN returns the window CONTAINING this run, ahead of the earlier one — pair.current is this run', async () => {
    const earlier = priorRun();
    windowStub.prior = [earlier];
    handlerFnMock.mockResolvedValue(handlerRun());
    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-d1-rerun' });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);

    expect(out.priorFacts).toBeDefined();
    const w = out.priorFacts!;
    expect(w.map(summaryOf)).toEqual(['SENTINEL: this run', 'SENTINEL: the earlier run']);
    expect(w[1]).toBe(earlier);
    // The newest run in the window is THIS run — the fact `freshness` was derived from.
    expect(summaryOf(selectRunAnalysisFact(w)?.fact)).toBe('SENTINEL: this run');
    expect(out.freshness?.computed_at).toBe(THIS_RUN_AT);
    expect(summaryOf(w[out.freshness!.selected_fact_index!])).toBe('SENTINEL: this run');
  });

  it('FIRST run → the window is PRESENT (the gate asks "did a run complete", never "is there a pair")', async () => {
    handlerFnMock.mockResolvedValue(handlerRun());
    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-d1-first' });
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.priorFacts?.map(summaryOf)).toEqual(['SENTINEL: this run']);
  });

  it('GATE: a turn whose run fact is a no-op completed no run → NO window, though the entry window holds a run', async () => {
    windowStub.prior = [priorRun()];
    handlerFnMock.mockResolvedValue(handlerRun({ noop: true }));
    const out = await dispatchChipClickRunAnalysis({ payload: payload(), requestId: 'req-d1-noop' });
    // Precondition, in-test: the dispatcher answered `ok` and the entry window would have yielded a run.
    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(selectRunAnalysisFact(windowStub.prior as never)).not.toBeNull();
    expect(out).not.toHaveProperty('priorFacts');
  });
});
