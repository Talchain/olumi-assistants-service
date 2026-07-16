/**
 * #343 CEE half — chip-click run_analysis adopts a valid ingress graph when no
 * model is persisted (adopt-on-empty), asserted THROUGH the real dispatch path.
 *
 * This is the LIVE front-door seam: the UI's "Analyse first pass" CTA arrives
 * as source='chip_click' + chip.action_type='run_analysis' and route-v2 hands
 * it to `dispatchChipClickRunAnalysis`. These tests run the REAL
 * `loadScenarioSnapshotForRunAnalysis` / `loadPersistedGraphStrict` (session
 * store mocked at the module seam), the REAL run_analysis handler (PLoT
 * transport mocked via a createRegistry override), and capture the REAL
 * `commitDirectAnswer` metadata — so they pin assistant_text AND persisted
 * state, not just an internal verdict.
 *
 * Modes pinned:
 *   1. null persisted + ingress graph → outcome 'ok'; the commit carries the
 *      adopted canonical graph (CAS first_write expecteds when the mode is on).
 *   2. null persisted + NO ingress → 'handler_recovered' with the existing
 *      "Draft or save a model first" copy; NOTHING persisted (unchanged mode —
 *      the V5 UI half that attaches graph_state ships separately).
 *   3. null persisted + unrecoverable ingress → 'handler_recovered' with the
 *      SPECIFIC verdict copy; NOTHING persisted.
 *   4. TOCTOU withhold: a graph appears between the pre-load and the commit →
 *      the turn still commits, but WITHOUT the graph (never overwrite a
 *      concurrent canonical write).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { config } from '../../../config/index.js';

type Dict = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Session-store mock (module seam — the REAL reader functions run over it).
// `loadGraphAndBriefText` feeds the pre-load strict read; `loadGraph` feeds
// the commit-time strict re-verify (loadPersistedGraphStrict). Keeping them
// separately armable lets the TOCTOU case diverge the two reads.
// ---------------------------------------------------------------------------
let preLoadGraph: unknown = null;
let reVerifyGraph: unknown = null;
const loadGraphCalls: string[] = [];

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    loadGraphAndBriefText: async () => ({ graph: preLoadGraph, briefText: null }),
    loadGraph: async (scenarioId: string) => {
      loadGraphCalls.push(scenarioId);
      return reVerifyGraph;
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    append: async () => ({ id: 'mock-row-id' }),
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

// buildTurnContext stub (template pattern from chip-click-dispatch-analysis-ready
// .test.ts) — the adoption seam under test lives in the REAL
// loadScenarioSnapshotForRunAnalysis / loadPersistedGraphStrict, which the
// importActual spread keeps production code; only the context assembly is
// stubbed so the test stays hermetic.
vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: true,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run analysis' }],
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
      scenarioBriefText: null,
      persistedGraph: null,
    })),
  };
});

// commitDirectAnswer capture (the persisted-state assertion surface).
const commitCalls: Array<{ response: { assistant_text?: string }; meta: Dict }> = [];
vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(async (response: { assistant_text?: string }, meta: Dict) => {
    commitCalls.push({ response, meta });
    return { performed: true };
  }),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

// PLoT transport mock, injected by overriding ONLY createRegistry's plotClient —
// the registry construction, the one-shot scenarioReader wiring, and the REAL
// run_analysis handler all stay production code.
const plotRunCalls: { n: number } = { n: 0 };
const PLOT_OK = {
  analysis_status: 'computed',
  results: [
    { option_id: 'opt_hybrid', option_label: 'Hybrid', win_probability: 0.6 },
    { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.4 },
  ],
  response_hash: 'hash_x',
  meta: { seed_used: 1 },
};
vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    getDefaultPlotClient: () => ({
      run: async () => { plotRunCalls.n += 1; return PLOT_OK; },
    }),
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run analysis',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

/** Valid analysable ingress graph (same fixture family as the reader tests). */
function makeIngressGraph(): Dict {
  return {
    goal_node_id: 'goal_1',
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Hybrid', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_hybrid', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_status_quo', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_status_quo', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'fac_annual_cost', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
  };
}
function makeUnrecoverableIngress(): Dict {
  const g = makeIngressGraph();
  const opt = (g.nodes as Dict[]).find((n) => n.id === 'opt_hybrid')!;
  delete opt.interventions;
  opt.data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } };
  const fac = (g.nodes as Dict[]).find((n) => n.id === 'fac_annual_cost')!;
  fac.observed_state = { value: 0.6, unit: '£' }; // cap removed
  return g;
}

beforeEach(() => {
  preLoadGraph = null;
  reVerifyGraph = null;
  loadGraphCalls.length = 0;
  commitCalls.length = 0;
  plotRunCalls.n = 0;
  (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = true;
  (config.features as { graphCasMode: string }).graphCasMode = 'observe';
});
afterEach(() => {
  (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = true;
  (config.features as { graphCasMode: string }).graphCasMode = 'off';
});

describe('#343 adopt-on-empty — chip_click run_analysis dispatch', () => {
  it('null persisted + valid ingress: ok outcome, PLoT ran, commit persists the adopted canonical graph with first_write CAS expecteds', async () => {
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-adopt-ok',
      ingressGraphState: makeIngressGraph(),
    });

    expect(result.outcome).toBe('ok');
    expect(plotRunCalls.n).toBe(1);
    // WIRING on assistant_text: the analysis actually ran — no dead-end copy.
    expect(result.response.assistant_text).not.toContain('Draft or save a model first');

    // PERSISTED STATE: the commit carries the adopted canonical graph.
    expect(commitCalls).toHaveLength(1);
    const meta = commitCalls[0].meta;
    expect(meta.graph).toBeDefined();
    const parsed = GraphStateIngressSchema.safeParse(meta.graph);
    expect(parsed.success).toBe(true);
    expect((parsed.data!.nodes as Dict[]).some((n) => n.id === 'goal_1')).toBe(true);
    // CAS first_write: server base read happened and was null → {null, null}.
    expect(meta.expectedGraphIdentityHash).toBeNull();
    expect(meta.expectedGraphAnalysisHash).toBeNull();
    // The commit-time strict re-verify actually ran, keyed by the SCENARIO id.
    expect(loadGraphCalls).toContain(SCENARIO_ID);
  });

  it('null persisted + NO ingress: handler_recovered with the existing NO_GRAPH copy; nothing persisted (unchanged mode)', async () => {
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-no-ingress',
    });

    expect(result.outcome).toBe('handler_recovered');
    expect(
      (result as { response: { assistant_text?: string } }).response.assistant_text,
    ).toBe('Draft or save a model first, then run analysis.');
    expect(plotRunCalls.n).toBe(0);
    expect(commitCalls).toHaveLength(0);
  });

  it('flag OFF + valid ingress: rolls back to the NO_GRAPH recovery exactly as before (kill-switch)', async () => {
    (config.cee as { runAnalysisAdoptIngressGraph: boolean }).runAnalysisAdoptIngressGraph = false;
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-flag-off',
      ingressGraphState: makeIngressGraph(),
    });

    expect(result.outcome).toBe('handler_recovered');
    expect(
      (result as { response: { assistant_text?: string } }).response.assistant_text,
    ).toBe('Draft or save a model first, then run analysis.');
    expect(plotRunCalls.n).toBe(0);
    expect(commitCalls).toHaveLength(0);
  });

  it('null persisted + UNRECOVERABLE ingress: handler_recovered with the SPECIFIC verdict copy, never the false NO_GRAPH copy; nothing persisted', async () => {
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-unrecoverable',
      ingressGraphState: makeUnrecoverableIngress(),
    });

    expect(result.outcome).toBe('handler_recovered');
    const text = (result as { response: { assistant_text?: string } }).response.assistant_text ?? '';
    expect(text).not.toContain('Draft or save a model first');
    expect(text).toContain('bound (cap)');
    expect(plotRunCalls.n).toBe(0);
    expect(commitCalls).toHaveLength(0);
  });

  it('TOCTOU withhold: a graph appears between pre-load and commit → turn commits WITHOUT a graph (concurrent canonical write is never overwritten)', async () => {
    // Pre-load sees null (adoption engages); by commit time a concurrent
    // writer has persisted a graph — the strict re-verify must WITHHOLD the
    // adopted write while the analysis turn itself still commits.
    reVerifyGraph = makeIngressGraph();
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-toctou',
      ingressGraphState: makeIngressGraph(),
    });

    expect(result.outcome).toBe('ok');
    expect(plotRunCalls.n).toBe(1);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0].meta.graph).toBeUndefined();
  });

  it('PRESENT persisted graph + ingress supplied: analysed from canonical state; no graph write on the commit (byte-parity with today)', async () => {
    preLoadGraph = makeIngressGraph();
    const result = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-persisted-present',
      ingressGraphState: makeUnrecoverableIngress(), // provably ignored
    });

    expect(result.outcome).toBe('ok');
    expect(plotRunCalls.n).toBe(1);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0].meta.graph).toBeUndefined();
    expect(commitCalls[0].meta.expectedGraphIdentityHash).toBeUndefined();
  });
});
