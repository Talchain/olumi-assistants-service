/**
 * ROADMAP 1.132 (F1) — `_answer_shape` on the DETERMINISTIC post-analysis
 * advice-gate answer, driven END-TO-END through the REAL route + REAL executor.
 *
 * THE LIVE DEFECT (A2 fetch-interceptor, deployed d290e69): 3/3 substantive
 * POST-ANALYSIS coach answers shipped `_answer_shape` ABSENT on the raw wire.
 * Root cause: those answers are composed by `tryPostAnalysisAdviceGate` — a
 * DETERMINISTIC direct_answer composer that never set the old `answerProse`
 * scope flag (which keyed on "was the text LLM-authored"), so the egress
 * synthesiser skipped them. The prior TWO fixes passed all tests but failed the
 * live wire because their tests drove a MOCKED executor that injected the scope
 * flag — never the REAL advice-gate compose. This test closes that gap:
 *
 *   - `runTurnExecutor` is NOT mocked. The REAL executor runs, matches the REAL
 *     `tryPostAnalysisAdviceGate`, composes the REAL projection-grounded answer,
 *     classifies it `answerKind: 'substantive'`, and the REAL `sendFinalised200`
 *     egress synthesises `_answer_shape`.
 *   - The session store is mocked (proven harness from
 *     `turn-executor-post-analysis-advice-ownership.integration.test.ts`) to
 *     return a FRESH run_analysis fact + a matching persisted graph (freshness
 *     verdict 'fresh'), the same shape PLoT publishes on staging, so the advice
 *     gate fires deterministically with ZERO LLM calls (no network).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    storeDraftGraph: async () => undefined,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
const { deriveAnswerTextFromShape } = await import('../routing/answer-shape.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_q3', kind: 'goal', label: 'Q3 Roadmap' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand' },
    { id: 'opt_hire', kind: 'option', label: 'Hire', interventions: { fac_capacity: 1 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_status_quo', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_q3', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market', to: 'goal_q3', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' as const },
  ],
  goal_node_id: 'goal_q3',
};

const READY_GRAPH_HASH = computeAnalysisAffectingGraphHash(READY_GRAPH as never)!;

function makeFreshRunAnalysisFact(): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment: {
        analysis_status: 'completed',
        option_comparison: [
          { option_id: 'opt_hire', option_label: 'Hire', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_status_quo', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
        factor_sensitivity: [
          { factor_id: 'fac_capacity', factor_label: 'Capacity', sensitivity: 0.6, influence_score: 0.6, direction: 'positive' },
          { factor_id: 'fac_market', factor_label: 'Market demand', sensitivity: 0.5, influence_score: 0.5, direction: 'negative' },
        ],
        robustness_synthesis: { overall_assessment: 'moderate' },
      },
      win_probabilities: { opt_hire: 0.72, opt_status_quo: 0.28 },
    },
  };
}

const PRIOR_RUN_ANALYSIS_TURN = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
};

async function postAnalyticalTurn(app: FastifyInstance, message: string, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: 'frame',
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — `_answer_shape` on the REAL post-analysis advice-gate answer (ROADMAP 1.132, F1)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.priorFacts = [makeFreshRunAnalysisFact()];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── RED-FIRST on the REAL PATH ─────────────────────────────────────────────
  // Drives the genuine `tryPostAnalysisAdviceGate` compose through the genuine
  // egress. FAILS before the fix (advice gate never set the scope signal, so
  // `_answer_shape` was absent — the exact A2 live failure); PASSES after. NOT a
  // fixture that injects the shape or the scope flag — the executor is real, the
  // compose is real, the synthesis is real.
  it('"What drove this result?" (deterministic advice gate) → `_answer_shape` synthesised at egress', async () => {
    const { status, body } = await postAnalyticalTurn(
      app,
      'What drove this result?',
      'eeeeeeee-1111-4eee-8eee-eeeeeeeeee01',
    );
    expect(status).toBe(200);

    // Sanity: this really is the deterministic advice-gate answer (grounded
    // projection prose naming the leading option), not an LLM turn.
    expect(typeof body.assistant_text).toBe('string');
    expect(body.assistant_text.length).toBeGreaterThan(0);
    expect(body.assistant_text).toContain('Hire');

    // THE FIX: the deterministic post-analysis answer now ships `_answer_shape`.
    expect(body._answer_shape, 'advice-gate answer must ship _answer_shape').toBeDefined();
    expect(typeof body._answer_shape.headline).toBe('string');
    expect(body._answer_shape.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(body._answer_shape.bullets)).toBe(true);
    expect(body._answer_shape.bullets.length).toBeLessThanOrEqual(3);
    expect(typeof body._answer_shape.detail).toBe('string');
    expect(body._answer_shape.detail.length).toBeGreaterThan(0);
  });

  // ── BYTE-EQUALITY on the REAL answer ───────────────────────────────────────
  // Approach (b): assistant_text is SET to derive(shape). The tie the sidecar
  // contract requires holds by identity — proven on the REAL projection copy,
  // not a hand-picked fixture string.
  it('byte-equality: derive(_answer_shape) === assistant_text on the real advice-gate answer', async () => {
    const { status, body } = await postAnalyticalTurn(
      app,
      'Why is this option ahead?',
      'eeeeeeee-1111-4eee-8eee-eeeeeeeeee02',
    );
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });

  // ── FUNCTIONAL STAYS PLAIN through the SAME REAL egress (mandate #4) ────────
  // With NO prior analysis, the same analytical question falls to the
  // deterministic "run analysis first" guard — functional copy. It must ship
  // PLAIN (no `_answer_shape`): the exclusion is by declared kind, NOT by "was
  // it deterministic" (the exact conflation the old answerProse axis made — the
  // advice gate above is ALSO deterministic yet correctly IS shaped). Driven
  // through the same real route + real executor as the substantive cases above,
  // whose presence assertions are the positive control proving THIS absence is
  // not vacuous (the harness CAN observe `_answer_shape` when present). The
  // MULTI-sentence functional exclusion (not merely the single-sentence
  // synthesiser skip) is pinned in route-v2-answer-shape-fallback.test.ts.
  it('functional copy (no-analysis-yet guard, real path) → NO `_answer_shape`, ships plain', async () => {
    mockState.priorTurns = [];
    mockState.priorFacts = [];
    const { status, body } = await postAnalyticalTurn(
      app,
      'What drove this result?',
      'eeeeeeee-2222-4eee-8eee-eeeeeeeeee01',
    );
    expect(status).toBe(200);
    expect(typeof body.assistant_text).toBe('string');
    expect(body.assistant_text.length).toBeGreaterThan(0);
    // Functional deterministic copy ships plain — NOT reshaped behind disclosure.
    expect(body).not.toHaveProperty('_answer_shape');
  });
});
