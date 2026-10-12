/**
 * ⭐ THE WIN-SHARE CLASS AT THE REAL V5 EXIT (route-v2, `exitPath: 'turn_executor'`) — the route rows of the one exit-sweep
 * property (`compose/__tests__/support/run-share-property.support.ts`; the sweep is `run-share-exit-sweep.test.ts`).
 *
 * The REAL `POST /orchestrate/v2/turn`: real route, real turn executor, real handlers (run_analysis with only the PLoT
 * transport injected; explain_results and what_would_flip on a seeded current Run), real finaliser. Mocked: the routing LLM
 * (`routeWithToolUse`), the session store and the PLoT transport — the harnesses of `constraint-disclosure-route-level` and
 * `withheld-explanation-answer-route-level`. The one filter is wrapped by a spy that records what the exit gave it, the
 * evidence it passed and what came back; every row then checks the SHIPPED BYTES:
 *   · a Run turn: the evidence is this turn's Run, the shipped reply and summary state no share, the body is the
 *     re-finalised one (never the egress-violation fallback);
 *   · an explanation of the current Run (the model's words, and the deterministic fallback): the share sentence is removed
 *     and the rest ships exactly;
 *   · reasoning (what_would_flip) and a converse reply: the exit returns its input BY REFERENCE and the share sentence ships.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { setTestSink } from '../../utils/telemetry.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { ScenarioReader } from '../tools/handlers/run-analysis.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { runShareViolations, type RunShareTruth } from '../compose/__tests__/support/run-share-property.support.js';
import type { ReplyRunEvidence } from '../compose/run-share-text.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { deriveAnswerTextFromShape, type AnswerShape } from '../routing/answer-shape.js';

type Rec = Record<string, any>;
const exits: { exitPath: string; evidence: ReplyRunEvidence; input: Rec; output: Rec }[] = [];
vi.mock('../compose/run-share-text.js', async () => {
  const actual = await vi.importActual<typeof import('../compose/run-share-text.js')>('../compose/run-share-text.js');
  return { ...actual, withRunShareFreeResult: <T extends object>(body: T, opts: Parameters<typeof actual.withRunShareFreeResult>[1]): T => {
    const output = actual.withRunShareFreeResult(body, opts);
    exits.push({ exitPath: opts.exitPath, evidence: opts.evidence, input: body as Rec, output: output as Rec });
    return output;
  } };
});
const { statesRunShare, RUN_RESULT_TEMPLATE } = await import('../compose/run-share-text.js');

const SCENARIO_ID = 'abababab-abab-4bab-8bab-abababababab';
const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth', goal_threshold: 0.8, goal_threshold_unit: 'customers', goal_direction: '>=' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold', is_baseline: true, interventions: { fac_capacity: 0 } },
  ],
  edges: [
    { from: 'opt_hire', to: 'fac_capacity', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_hold', to: 'fac_capacity', strength: { mean: 0.01, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_capacity', to: 'goal_growth', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
  goal_node_id: 'goal_growth',
};
const GRAPH_HASH = computeAnalysisAffectingGraphHash(GRAPH as never)!;

/** PLoT's envelope: both options carry a win share, so the Run handler's own words state one. */
const PLOT_RESPONSE = {
  meta: { seed_used: 1, n_samples: 1000, response_hash: 'sha256:fixture' },
  analysis_status: 'completed',
  option_comparison_status: 'computed',
  option_comparison: [
    { option_id: 'opt_hire', id: 'opt_hire', option_label: 'Hire Marketing Manager', label: 'Hire Marketing Manager', win_probability: 0.72,
      outcome: { mean: 0.5, std: 0.2, p10: 0.3, p90: 0.7 } },
    { option_id: 'opt_hold', id: 'opt_hold', option_label: 'Hold', label: 'Hold', win_probability: 0.28,
      outcome: { mean: 0.3, std: 0.2, p10: 0.1, p90: 0.5 } },
  ],
  response_hash: 'sha256:fixture-top',
};

/** A prior, current, permitted Run (the turn row AND its fact: `prior_facts` load by FK from the turn rows). */
const PRIOR_TURN = { id: 'efefefef-efef-4fef-8fef-efefefefefef', scenario_id: SCENARIO_ID, user_id: null, turn_id: 'prior-run',
  turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'sha256:prior-ra', response_emitted: true, llm_calls_used: 1,
  duration_ms: 200, created_at: new Date(Date.now() - 60_000).toISOString() };
const priorRunFact = () => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO_ID, leading_option_id: 'opt_hire', summary: 'Prior analysis result', graph_hash_at_run: GRAPH_HASH,
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    enrichment: {
      analysis_status: 'completed',
      robustness: { level: 'high', near_tie: { is_tie: false } },
      option_comparison: [
        { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: 0.72, outcome_mean: 0.5 },
        { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.28, outcome_mean: 0.3 },
      ],
      factor_sensitivity: [{ factor_id: 'fac_capacity', factor_label: 'Capacity', sensitivity: 0.6, influence_score: 0.6, direction: 'positive' }],
    },
    win_probabilities: { opt_hire: 0.72, opt_hold: 0.28 },
  },
});
let priorTurns: Rec[] = [];
let priorFacts: Rec[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => priorTurns,
    readFactsFor: async () => priorFacts,
    loadGraph: async () => GRAPH,
    loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
    ensureScenarioExists: async (_id: string, userId: string | null) => ({ user_id: userId }),
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => undefined,
  SessionReadError: class SessionReadError extends Error {},
}));

const routeWithToolUseMock = vi.fn();
vi.mock('../routing/route-with-tool-use.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/route-with-tool-use.js')>('../routing/route-with-tool-use.js');
  return { ...actual, routeWithToolUse: routeWithToolUseMock };
});

vi.mock('../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../tools/registry.js')>('../tools/registry.js');
  const plotClient = { run: async () => structuredClone(PLOT_RESPONSE), validatePatch: async () => ({}) } as unknown as PLoTClient;
  const scenarioReader: ScenarioReader = async () => ({
    graph: GRAPH,
    options: [
      { id: 'opt_hire', option_id: 'opt_hire', label: 'Hire Marketing Manager', interventions: { fac_capacity: 1 } },
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Hold', interventions: { fac_capacity: 0 } },
    ],
    goal_node_id: 'goal_growth',
    rawPersistedGraph: GRAPH,
  } as never);
  return { ...actual, getDefaultRegistry: () => actual.createRegistry({ plotClient, scenarioReader }) };
});

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

const raw = { content: [], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, model: 'mock', latencyMs: 0 };
const routed = (handlerId: string, answerText?: string) => ({
  type: 'tool_call' as const, orientationText: '', llmCallCount: 1, droppedActions: [], rawResult: raw,
  proposal: { intent_class: 'execute' as const, action: {
    handler_id: handlerId,
    entity: handlerId === 'run_analysis'
      ? { id: 'opt_hire', kind: 'option' as const, resolution_status: 'resolved' as const, resolution_method: 'id_match' as const }
      : { id: 'goal_growth', kind: 'goal' as const, resolution_status: 'resolved' as const, resolution_method: 'context_inference' as const },
    parameters: [], cited_context_fields: handlerId === 'run_analysis' ? ['graph.options'] : [],
    ...(answerText !== undefined ? { explanation: { answer_text: answerText } } : {}),
  } },
});
const conversed = (text: string) => ({ type: 'text_only' as const, text, inferredIntent: 'converse' as const, rawResult: { ...raw, stop_reason: 'end_turn' }, llmCallCount: 1 });

/** The model's explanation: passes the side-band rules (≥ 80 chars, no internal terms, no raw decimals), so it ships verbatim. */
const KEEP = 'Capacity is the strongest computed driver here, so firming up that number would sharpen the comparison.';
const SHARE = 'In this model, Hire Marketing Manager was supported by 72% of runs.';
const EXPLAINED = `${SHARE} ${KEEP}`;
const VALIDATION_FALLBACK = 'The server produced a response that failed validation.';

async function turn(app: FastifyInstance, message: string): Promise<{ status: number; body: Rec }> {
  const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
    kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO_ID, stage: 'analyse', message, turn_class: 'decide', source: 'composer',
    graph_state: GRAPH,
  } });
  return { status: res.statusCode, body: JSON.parse(res.body) as Rec };
}
const executorExit = () => {
  const found = exits.filter((e) => e.exitPath === 'turn_executor');
  expect(found, 'the turn_executor exit ran once').toHaveLength(1);
  return found[0]!;
};
const truthOf = (e: ReplyRunEvidence): RunShareTruth => ({ ran: e.surface === 'run_result', explains: e.surface === 'run_explanation' });
/** AIE #94 6132355107: the FINAL edited body at the real exit — its V5 members pass the strict schema, and a shape that ships
 *  still derives exactly the words that ship. */
const V5_KEYS = ['response_version', 'assistant_text', 'blocks', 'suggested_actions', 'insights', 'stage_indicator'] as const;
const expectValidAtExit = (b: Rec) => {
  const parsed = OlumiResponseSchema.safeParse(Object.fromEntries(V5_KEYS.filter((k) => k in b).map((k) => [k, b[k]])));
  expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  if (b._answer_shape !== undefined) expect(deriveAnswerTextFromShape(b._answer_shape as AnswerShape)).toBe(b.assistant_text);
};

describe('route-v2 (turn_executor): the class property on the shipped bytes', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready(); });
  afterAll(async () => app.close());
  beforeEach(() => { setTestSink(() => {}); exits.length = 0; routeWithToolUseMock.mockReset(); priorTurns = []; priorFacts = []; });
  afterEach(() => { setTestSink(null); vi.clearAllMocks(); });

  it('a Run turn: this turn\'s Run is the evidence; the shipped reply and summary state no share; the edited body was re-finalised', async () => {
    routeWithToolUseMock.mockResolvedValue(routed('run_analysis'));
    const { status, body } = await turn(app, 'Run the analysis');
    expect(status).toBe(200);
    const exit = executorExit();
    expect(exit.evidence).toEqual({ surface: 'run_result', basis: 'ran_this_turn' });
    // Non-vacuity: what reached the exit stated a share (the Run handler's own words or its summary).
    const summaryIn = (exit.input.blocks ?? []).find((b: Rec) => b.type === 'analysis_result')?.summary;
    expect(statesRunShare(exit.input.assistant_text) || statesRunShare(summaryIn), JSON.stringify([exit.input.assistant_text, summaryIn])).toBe(true);
    expect(runShareViolations({ ran: true, explains: false }, exit.input, body)).toEqual([]);
    expect(body.assistant_text).toBe(exit.output.assistant_text);
    expect(body.assistant_text).not.toContain(VALIDATION_FALLBACK);
    expect(statesRunShare(JSON.stringify(body.blocks))).toBe(false);
    expectValidAtExit(body);
  });

  it('an explanation of the current Run (the model\'s words): the share sentence is removed and the rest ships exactly', async () => {
    priorTurns = [PRIOR_TURN]; priorFacts = [priorRunFact()];
    routeWithToolUseMock.mockResolvedValue(routed('explain_results', EXPLAINED));
    const { status, body } = await turn(app, 'Explain the result');
    expect(status).toBe(200);
    const exit = executorExit();
    expect(exit.evidence).toEqual({ surface: 'run_explanation', basis: 'explains_current_run' });
    expect(exit.input.assistant_text, 'the control: the model\'s words reached the exit verbatim').toContain(EXPLAINED);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, body)).toEqual([]);
    expect(body.assistant_text).not.toContain(SHARE);
    expect(body.assistant_text).toContain(KEEP);
    expect(body.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expectValidAtExit(body);
  });

  it('the explanation FALLBACK (the model\'s answer fails the side-band rules): its share sentence is removed, never a Run claim', async () => {
    priorTurns = [PRIOR_TURN]; priorFacts = [priorRunFact()];
    routeWithToolUseMock.mockResolvedValue(routed('explain_results', 'Too short.'));
    const { status, body } = await turn(app, 'Explain the result');
    expect(status).toBe(200);
    const exit = executorExit();
    expect(exit.evidence).toEqual({ surface: 'run_explanation', basis: 'explains_current_run' });
    expect(exit.input.assistant_text, 'the control: the deterministic fallback stated the share').toContain('Hire Marketing Manager was supported by 72% of runs.');
    expect(runShareViolations(truthOf(exit.evidence), exit.input, body)).toEqual([]);
    expect(statesRunShare(body.assistant_text)).toBe(false);
    expect(body.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expectValidAtExit(body);
  });

  it('reasoning (what_would_flip): the exit returns its input BY REFERENCE and the share sentence ships', async () => {
    priorTurns = [PRIOR_TURN]; priorFacts = [priorRunFact()];
    routeWithToolUseMock.mockResolvedValue(routed('what_would_flip', EXPLAINED));
    const { status, body } = await turn(app, 'What would change the result?');
    expect(status).toBe(200);
    const exit = executorExit();
    expect(exit.evidence).toEqual({ surface: 'reasoning' });
    expect(statesRunShare(exit.input.assistant_text), 'the control: the reasoning reply states a share').toBe(true);
    expect(exit.output.assistant_text).toBe(exit.input.assistant_text);
    expect(runShareViolations(truthOf(exit.evidence), exit.input, body)).toEqual([]);
    expect(body.assistant_text).toBe(exit.input.assistant_text);
    expectValidAtExit(body);
  });

  it('a converse reply that states a share: reasoning, shipped untouched, never a Run claim', async () => {
    routeWithToolUseMock.mockResolvedValue(conversed(`${SHARE} Tell me your deadline when you have it.`));
    const { status, body } = await turn(app, 'What do you make of this?');
    expect(status).toBe(200);
    const exit = executorExit();
    expect(exit.evidence).toEqual({ surface: 'reasoning' });
    expect(exit.output).toBe(exit.input);
    expect(runShareViolations({ ran: false, explains: false }, exit.input, body)).toEqual([]);
    expect(body.assistant_text).not.toContain(RUN_RESULT_TEMPLATE);
    expectValidAtExit(body);
  });
});
