/**
 * ADVERSARIAL-REVIEW TEST for PR #788 — R1: the turn-executor JOIN.
 *
 * The PR's own residual R1: mutant 5 deleted the single `turn-executor.ts`
 * line `flipClaimPosture: pickLatestFlipClaimPosture(context.prior_facts)`
 * and every test stayed green. Gate, selector and both composers are each
 * unit-tested; the JOIN is not.
 *
 * This test drives the REAL route + REAL `runTurnExecutor` (harness proven by
 * `route-v2-answer-shape-advice-gate.integration.test.ts` — session store
 * mocked, executor NOT mocked, zero LLM calls) with a run_analysis fact whose
 * enrichment carries attested-no-flip `flip_thresholds`. The posture is
 * derivable ONLY from that fact via the executor's threading line, so the
 * no-flip copy appearing in the response proves the join executes.
 *
 * Trap-13 positive control: the same turn WITHOUT flip evidence must emit the
 * flippability claim — proving this harness exercises the fragile branch and
 * the matcher can see the claim.
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

/** Attested-no-flip rows, shaped as on the witnessed wire (witness-2267). */
const ATTESTED_FLIP_THRESHOLDS = [
  {
    factor_id: 'fac_capacity',
    factor_label: 'Capacity',
    current_value: 0.5,
    flip_value: null,
    flip_reason: 'structurally_invariant',
    no_flip_in_range: true,
  },
  {
    factor_id: 'fac_market',
    factor_label: 'Market demand',
    current_value: 0.8,
    flip_value: null,
    flip_reason: 'structurally_invariant',
    no_flip_in_range: true,
  },
];

function makeFreshRunAnalysisFact(opts: { attestedNoFlip: boolean }): Record<string, unknown> {
  const enrichment: Record<string, unknown> = {
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
    // Raw fragile signal → the gate's fragile branch (the branch under test).
    robustness: { level: 'very_low', is_robust: false },
  };
  if (opts.attestedNoFlip) enrichment.flip_thresholds = ATTESTED_FLIP_THRESHOLDS;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_hire',
      summary: 'Prior analysis result',
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      graph_hash_at_run: READY_GRAPH_HASH,
      computed_at: new Date(Date.now() - 60_000).toISOString(),
      enrichment,
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

// Shared, negation-aware matcher (amendment A2 made the honest copy contain
// the claim's own words; a plain regex could not tell assertion from denial).
import { assertsFlippability } from './support/flip-claim-matcher.support.js';

describe('PR #788 R1 — flipClaimPosture JOIN through the REAL route + REAL turn-executor', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    mockState.priorTurns = [PRIOR_RUN_ANALYSIS_TURN];
    mockState.persistedGraph = READY_GRAPH;
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── Trap-13 positive control: WITHOUT flip evidence, the claim ships. ──────
  it('POSITIVE CONTROL — no flip evidence on the fact → fragile flippability claim present', async () => {
    mockState.priorFacts = [makeFreshRunAnalysisFact({ attestedNoFlip: false })];
    const { status, body } = await postAnalyticalTurn(
      app,
      'Explain the results.',
      'eeeeeeee-7888-4eee-8eee-eeeeeeeeee01',
    );
    expect(status).toBe(200);
    expect(typeof body.assistant_text).toBe('string');
    expect(assertsFlippability(body.assistant_text as string)).toBe(true);
  });

  // ── THE JOIN: posture derivable ONLY from the fact, via the executor line. ─
  it('attested-no-flip fact → the executor threads the posture and the claim is re-aimed', async () => {
    mockState.priorFacts = [makeFreshRunAnalysisFact({ attestedNoFlip: true })];
    const { status, body } = await postAnalyticalTurn(
      app,
      'Explain the results.',
      'eeeeeeee-7888-4eee-8eee-eeeeeeeeee02',
    );
    expect(status).toBe(200);
    expect(typeof body.assistant_text).toBe('string');
    // The caveat survives (re-aim, not suppression)…
    expect(body.assistant_text).toMatch(/fragile/i);
    // …but the flippability claim must be gone,
    expect(assertsFlippability(body.assistant_text as string)).toBe(false);
    // …replaced by the no-flip variant — present ONLY if the turn-executor
    // threading line executed (deleting it reverts to the old copy).
    expect(body.assistant_text).toMatch(
      /no single factor we tested would change which option leads on its own/i,
    );
  });
});
