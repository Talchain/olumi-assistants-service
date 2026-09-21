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
const { deriveAnswerTextFromShape, synthesiseAnswerShapeFromText } = await import(
  '../routing/answer-shape.js'
);

/**
 * THE COLLAPSE FLOOR (18 Sep 2026) — why the reachability assertions below
 * bind to TELEMETRY rather than to the sidecar's presence.
 *
 * `_answer_shape` is a WIRE DIRECTIVE to collapse the answer to its headline,
 * and CEE now issues it only above `ANSWER_SHAPE_COLLAPSE_FLOOR_CHARS` (3,000
 * — the deployed UI's own `CLAMP_CHAR_THRESHOLD`, below which the free-text
 * body renders whole regardless).
 *
 * ⛔ This file's subject is REACHABILITY, and the floor would have hollowed it
 * out silently. Three prior F1 fixes each shipped believing the egress
 * synthesiser ran on a path it never reached; the explanation handler was the
 * third such miss and is why this file exists. A real explanation answer is a
 * few hundred characters, so below the floor it correctly ships plain — and
 * "no sidecar" would then mean BOTH "correctly below the floor" AND "this
 * path went dark again". One absence, two meanings, and the second is the one
 * this file was written to catch.
 *
 * The decline is therefore ANNOUNCED. `v5.answer_shape.declined_below_floor`
 * carries the dispatch path, so a genuinely dark path emits nothing and these
 * tests RED — the same guarantee as before, bound to an event instead of a
 * field.
 */
const emitted: Array<{ event: string; fields: Record<string, unknown> }> = [];
function declinesBelowFloor() {
  return emitted.filter((e) => e.event === 'v5.answer_shape.declined_below_floor');
}

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
    emitted.length = 0;
    setTestSink((event: string, fields: Record<string, unknown>) => {
      emitted.push({ event, fields });
    });
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

    // THE FIX (reachability): the explanation-handler answer REACHES the egress
    // synthesiser. Before it, `composeToolCallResponse` answers were never
    // declared substantive and the egress skipped this path entirely.
    expect(
      declinesBelowFloor().map((d) => d.fields.dispatch_path),
      'the explanation-handler answer must REACH the egress — no event means the path is dark again',
    ).toContain('route_egress_synthesised');

    // And it is genuinely shapeable, so the floor is the ONLY reason it ships
    // plain. Without this limb the assertion above could be satisfied by an
    // answer the synthesiser would have refused for its own reasons.
    const shape = synthesiseAnswerShapeFromText(body.assistant_text);
    expect(shape, 'the real explanation-handler answer must be shapeable').not.toBeNull();
    expect(shape!.headline.length).toBeGreaterThan(0);
    expect(shape!.bullets.length).toBeLessThanOrEqual(3);
    expect(shape!.detail.length).toBeGreaterThan(0);

    // THE USER OUTCOME: below the floor nothing is hidden.
    expect(body).not.toHaveProperty('_answer_shape');
  });

  // ── THE TWIN OF BYTE-EQUALITY: below the floor, NOTHING IS REWRITTEN ─────
  // `derive(shape) === assistant_text` is the contract for a SHIPPED sidecar.
  // Below the floor nothing ships, so asserting it here would assert a
  // conditional with a false antecedent — true for free, and blind. What must
  // hold instead is that the treatment was not HALF applied: attaching the
  // sidecar also reflows the headline/detail join from a single space to a
  // blank line, and declining must leave the handler's own bytes alone. Both
  // limbs are DERIVED from the shape, never from hardcoded answer copy.
  it('below the floor the real explanation-handler answer ships unreflowed and unshaped', async () => {
    const { status, body } = await postTurn(
      app,
      'Give me the bottom line: which option is strongest',
      'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa02',
    );
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    const shape = synthesiseAnswerShapeFromText(body.assistant_text);
    expect(shape).not.toBeNull();
    const wouldHaveShipped = deriveAnswerTextFromShape(shape!);
    expect(wouldHaveShipped.startsWith(`${shape!.headline}\n\n`)).toBe(true);
    expect(body.assistant_text.startsWith(`${shape!.headline} `)).toBe(true);
    expect(body.assistant_text).not.toBe(wouldHaveShipped);
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
    // The narrow guard still lets this answer through to the synthesiser — the
    // point of the test. A broad "blocks-empty" guard would have excluded it,
    // and then NO decline event would be emitted for this turn.
    expect(
      declinesBelowFloor().map((d) => d.fields.dispatch_path),
      'a block-carrying explanation answer must still reach the egress synthesiser',
    ).toContain('route_egress_synthesised');
    expect(synthesiseAnswerShapeFromText(body.assistant_text)).not.toBeNull();
  });
});
