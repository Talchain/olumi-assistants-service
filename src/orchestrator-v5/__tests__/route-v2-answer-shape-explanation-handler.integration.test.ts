/**
 * ROADMAP 1.132 (F1) — EGRESS-DEFAULT INVERSION (fourth F1 fix).
 *
 * `_answer_shape` on the LLM EXPLANATION-HANDLER answer — the FOURTH substantive
 * egress the first three F1 fixes missed — driven END-TO-END through the REAL
 * route + REAL executor + REAL egress.
 *
 * THE LIVE DEFECT (byte-authoritative, deployed 5b34a1a): the deterministic
 * advice-gate answers shape correctly, but two SIBLING substantive answers still
 * ship `_answer_shape` ABSENT — d9ac487d ("Give me the bottom line: which option
 * is strongest") and 86654fd0 ("Run a pre-mortem"). Their Render trace:
 * `post_analysis_advice_gate` did NOT match → fell through to the LLM router
 * (`calling_anthropic`) → `explanation.answer_verdict` → `handler_invocation` →
 * finalised with NO answer_shape. They compose via `composeToolCallResponse` on
 * the explanation-handler path (`EXPLANATION_HANDLER_IDS`), which the three
 * prior per-site fixes never declared substantive.
 *
 * THE INVERSION: the executor's finalise seam now DEFAULTS an answer to
 * `'substantive'` (functional only when explicitly captured), and the route
 * egress shapes UNLESS `answerKind === 'functional'`. So the explanation-handler
 * answer shapes BY DEFAULT — no per-site opt-in — closing the whack-a-mole.
 *
 * WHY THIS IS THE REAL PATH (not a fixture injection):
 *   - `runTurnExecutor` is NOT mocked. The REAL executor runs, the advice gate
 *     is REALLY checked and does NOT match, the turn REALLY falls through to the
 *     router, the REAL `what_would_flip` explanation handler (default registry)
 *     REALLY composes via `composeToolCallResponse`, and the REAL
 *     `sendFinalised200` egress synthesises `_answer_shape`.
 *   - ONLY the routing LLM call is mocked (`routeWithToolUse`) — there is no
 *     network in CI — returning a routed `what_would_flip` execute proposal whose
 *     `explanation.answer_text` is a valid multi-sentence answer. The assertion
 *     `routeWithToolUseMock` WAS called proves the advice gate did not
 *     short-circuit — this genuinely exercises the fall-through-to-router path.
 *   - The fresh run_analysis fact (freshness 'fresh') makes the composer emit
 *     Phase-3 lifecycle blocks alongside the prose, so this ALSO proves a
 *     BLOCK-CARRYING explanation answer still shapes (the narrow draft_graph-only
 *     block guard does not over-exclude it).
 *
 * RED before the inversion (answerKind forced 'functional' → egress skips →
 * `_answer_shape` absent); GREEN after.
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

// Mock ONLY the routing LLM call — no network. Returns a routed
// `what_would_flip` (an EXPLANATION_HANDLER) execute proposal, so the turn falls
// THROUGH the advice gate to the explanation-handler compose path. The
// `answer_text` is a valid multi-sentence answer (>= 80 chars, no forbidden
// internal terms, no mutation language, no raw decimals) so the handler uses it
// verbatim (see what-would-flip.ts `sonnetValid`).
const VALID_MULTI_SENTENCE_ANSWER =
  'Hiring the marketing manager is the strongest option on the table. ' +
  'It comes out ahead across the simulated outcomes, and its lead holds even ' +
  'when demand runs soft. The margin is comfortable enough that you can decide ' +
  'now rather than waiting for more information.';

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>(
    '../routing/route-with-tool-use.js',
  );
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
const { deriveAnswerTextFromShape } = await import('../routing/answer-shape.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const READY_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand' },
    { id: 'opt_hire', kind: 'option', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hold', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_growth', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market', to: 'goal_growth', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_growth',
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
          { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.72, outcome_mean: 0.5 },
          { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
        ],
        factor_sensitivity: [
          { factor_id: 'fac_capacity', factor_label: 'Capacity', sensitivity: 0.6, influence_score: 0.6, direction: 'positive' },
        ],
        flip_thresholds: [
          { factor_id: 'fac_market', factor_label: 'Market demand', flip_value: 0.45, direction: 'increase' },
        ],
        robustness_synthesis: { overall_assessment: 'moderate' },
      },
      win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
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

function routedWhatWouldFlip() {
  return {
    type: 'tool_call' as const,
    orientationText: '',
    llmCallCount: 1,
    droppedActions: [],
    rawResult: {
      content: [],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'mock',
      latencyMs: 0,
    },
    proposal: {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'what_would_flip',
        entity: {
          id: 'goal_growth',
          kind: 'goal' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'context_inference' as const,
        },
        parameters: [],
        cited_context_fields: [],
        explanation: { answer_text: VALID_MULTI_SENTENCE_ANSWER },
      },
    },
  };
}

async function postTurn(app: FastifyInstance, message: string, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message,
      turn_class: 'decide',
      source: 'composer',
      graph_state: READY_GRAPH,
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — `_answer_shape` on the REAL LLM explanation-handler answer (ROADMAP 1.132, F1 inversion)', () => {
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
    routeWithToolUseMock.mockReset();
    routeWithToolUseMock.mockResolvedValue(routedWhatWouldFlip());
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── RED-FIRST on the REAL explanation-handler path ─────────────────────────
  it('"bottom line" → falls through advice gate to LLM router → explanation handler → `_answer_shape` synthesised', async () => {
    const { status, body } = await postTurn(
      app,
      'Give me the bottom line: which option is strongest',
      'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa01',
    );
    expect(status).toBe(200);

    // Proof the advice gate did NOT short-circuit — the turn genuinely reached
    // the LLM router (the fall-through-to-explanation-handler path, NOT a fixture
    // that injects the answer or the kind).
    expect(routeWithToolUseMock).toHaveBeenCalled();

    // Sanity: this is the multi-sentence explanation-handler answer.
    expect(typeof body.assistant_text).toBe('string');
    expect(body.assistant_text.length).toBeGreaterThan(80);

    // THE FIX: the explanation-handler answer now ships `_answer_shape`.
    expect(body._answer_shape, 'explanation-handler answer must ship _answer_shape').toBeDefined();
    expect(typeof body._answer_shape.headline).toBe('string');
    expect(body._answer_shape.headline.length).toBeGreaterThan(0);
    expect(Array.isArray(body._answer_shape.bullets)).toBe(true);
    expect(body._answer_shape.bullets.length).toBeLessThanOrEqual(3);
    expect(typeof body._answer_shape.detail).toBe('string');
    expect(body._answer_shape.detail.length).toBeGreaterThan(0);
  });

  // ── BYTE-EQUALITY on the REAL answer (approach b, by construction) ──────────
  it('byte-equality: derive(_answer_shape) === assistant_text on the real explanation-handler answer', async () => {
    const { status, body } = await postTurn(
      app,
      'Give me the bottom line: which option is strongest',
      'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa02',
    );
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });

  // ── BLOCK-CARRYING answer STILL shapes (narrow draft_graph-only guard) ──────
  // The fresh run_analysis fact makes the composer emit Phase-3 lifecycle blocks
  // alongside the prose. A broad "blocks-empty" guard would have wrongly excluded
  // this answer; the draft_graph-specific guard does not, so it shapes.
  it('the explanation-handler answer carries lifecycle blocks AND is still shaped', async () => {
    const { status, body } = await postTurn(
      app,
      'Give me the bottom line: which option is strongest',
      'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa03',
    );
    expect(status).toBe(200);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.blocks.length).toBeGreaterThan(0);
    // No draft_graph block on this path (that is the ONE block type the guard
    // excludes); the prose is still shaped.
    expect(body.blocks.some((b: { type?: string }) => b.type === 'draft_graph')).toBe(false);
    expect(body._answer_shape, 'a block-carrying explanation answer must still ship _answer_shape').toBeDefined();
  });
});
