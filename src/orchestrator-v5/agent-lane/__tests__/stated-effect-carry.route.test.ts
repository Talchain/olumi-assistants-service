/** RC2: a refused stated effect remains one question, on the real Agent route and durable answer row. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { statedRangeSpread } from '../../stated-range-spread.js';

type Json = Record<string, any>;
let SID = randomUUID();
const PAUL = 'Our current churn is 4%, and we predict it will at least increase 1% with this price increase. If it goes above 6%, we start to lose money, which is a serious problem.';
const PAUL_QUOTE = 'Our current churn is 4%, and we predict it will at least increase 1% with this price increase.';
const PAUL_QUESTION = 'Does "at least increase 1%" mean at least one percentage point, or a relative increase of at least 1%?';
const SCIENCE_ASK = "You said churn will rise by at least 1 point. What's your best single guess, and what's the most it could plausibly be?";
const PAUL_ARGS = { from_label: 'Pro plan price', to_label: 'Monthly churn', amount: 1, amount_unit: '%',
  per_source_change: 1, per_source_change_unit: '£ per subscriber per month', quote: PAUL_QUOTE };
const CAFE_QUOTE = 'Raising prices by £1 will cut daily visits by 5%.';
const CAFE_QUESTION = 'Is that a 5-point fall in “Daily visits”, or 5% of today’s level?';
const CAFE_ARGS = { from_label: 'Prices', to_label: 'Daily visits', amount: -5, amount_unit: '%',
  per_source_change: 1, per_source_change_unit: 'GBP', quote: CAFE_QUOTE };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';
const CONTROL_LIMIT = 'rc2:monthly_support_requests:<=';
const hash = () => computeAnalysisAffectingGraphHash(graph as never)!;
const now = () => new Date().toISOString();

function saasGraph(): Json {
  const g = structuredClone(SERVED.graph);
  const e = g.edges.find((e: Json) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
  e.defaulted = true;
  e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
    amount: 1, amount_unit: 'percentage points', per_source_change: 10, per_source_change_unit: '£ per subscriber per month',
    strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength',
  } };
  delete e.provenance_display;
  // Independent control path: it still needs a size and keeps the ordinary ask.
  g.nodes.push({ id: 'monthly_support_requests', kind: 'factor', label: 'Monthly support requests', category: 'observable',
    observed_state: { value: 0.2, raw_value: 200, cap: 1000, unit: 'requests per month', source: 'user_override' } });
  g.edges.push({ from: 'pro_plan_price', to: 'monthly_support_requests', strength: { mean: -0.5, std: 0.1 },
    effect_direction: 'negative', exists_probability: 0.8, defaulted: true,
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
      amount: -50, amount_unit: 'requests per month', per_source_change: 1, per_source_change_unit: '£ per subscriber per month',
      strength_mean: -0.5, strength_mean_frame: 'edge_strength',
    } } });
  g.goal_constraints.push({ constraint_id: CONTROL_LIMIT, node_id: 'monthly_support_requests', label: 'Monthly support requests',
    operator: '<=', value: 300, unit: 'requests per month', provenance: 'explicit', value_frame: 'level' });
  return g;
}

/** A different café brief, with visits explicitly represented as % of current trade (100 today). */
function cafeGraph(): Json {
  return { nodes: [
    { id: 'cafe_decision', kind: 'decision', label: 'Café pricing' },
    { id: 'margin', kind: 'goal', label: 'Gross margin', goal_direction: '>=', goal_threshold: 0.6,
      goal_threshold_raw: 60, goal_threshold_cap: 100, goal_threshold_unit: '%', goal_threshold_frame: 'level',
      observed_state: { raw_value: 50, value: 0.5, cap: 100, unit: '%', source: 'brief_extraction' } },
    { id: 'raise_prices', kind: 'option', label: 'Raise prices', interventions: { prices: { raw_value: 4, value: 0.4, unit: 'GBP', source: 'brief_extraction' } } },
    { id: 'keep_prices', kind: 'option', label: 'Keep prices', is_baseline: true },
    { id: 'prices', kind: 'factor', label: 'Prices', category: 'controllable', observed_state: { raw_value: 3, value: 0.3, cap: 10, unit: 'GBP', source: 'brief_extraction' } },
    { id: 'daily_visits', kind: 'factor', label: 'Daily visits', category: 'observable', observed_state: { raw_value: 100, value: 1, cap: 100, unit: '%', source: 'brief_extraction' } },
  ], edges: [
    { from: 'cafe_decision', to: 'raise_prices', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'cafe_decision', to: 'keep_prices', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'raise_prices', to: 'prices', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'prices', to: 'daily_visits', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'negative', defaulted: true, provenance: { source: 'cee_hypothesis' } },
    { from: 'daily_visits', to: 'margin', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } },
  ] };
}

let graph: Json;
let runRead: Json | undefined;
const pending = new Map<string, unknown[]>();
const writes: SessionTurnWrite[] = [];
const rows = new Map<string, Json>();
const script: Json[] = [];
const providerBodies: Json[] = [];
const doorCalls: Json[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => [...rows.values()].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return (pending.get(sid) ?? []).map(p => parsePendingAction(structuredClone(p))).filter(p => p !== null);
  }),
  append: vi.fn(async (write: SessionTurnWrite) => {
    const w = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
    writes.push(w);
    rows.set(w.turn_id, { id: w.turn_id, turn_id: w.turn_id, scenario_id: w.scenario_id,
      request_hash: w.request_hash, user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null,
      llm_calls_used: w.llm_calls_used, created_at: now() });
    if (!w.turn_id.endsWith(':claim')) pending.set(w.scenario_id, structuredClone(w.pending_actions ?? []));
    return { id: w.turn_id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../../system-events/dispatch.js', async original => ({
  ...await original<Record<string, unknown>>(),
  commitOptionLevelsInProcess: async (raw: unknown) => {
    const input = raw as Json;
    doorCalls.push(structuredClone(input));
    if (Array.isArray(input.values) && input.values.length > 0) {
      const { applyFactorValueEdit } = await import('../../system-events/factor-value-edit.js');
      for (const value of input.values as Json[]) {
        const node = graph.nodes.find((n: Json) => n.id === value.factor_id);
        // Match the existing levels-port fake: a capless factor takes the raw value; its writer owns scale_frame.
        const cap = typeof node.observed_state?.cap === 'number' ? node.observed_state.cap : undefined;
        const event = { kind: 'factor_value_edit', target_id: value.factor_id,
          ...(cap !== undefined ? { value: value.value / cap, raw_value: value.value } : { value: value.value }), unit: value.unit };
        const out = await applyFactorValueEdit({ persistedGraph: structuredClone(graph), event: event as never,
          payload: { kind: 'system_event', scenario_id: SID, turn_id: input.turn_id, stage: 'frame', event } as never,
          requestId: 'rc2-assumption-card', priorFacts: [] });
        if (out.kind !== 'mutated') throw new Error(`RC2 real value writer refused: ${JSON.stringify(out)}`);
        graph = structuredClone(out.mutatedGraph as Json);
      }
      return { status: 'committed', graph_hash: hash(), receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    }
    const le = input.link_effect as Json;
    const { applyLinkEffectEdit } = await import('../../system-events/link-effect-edit.js');
    const out = applyLinkEffectEdit({ persistedGraph: structuredClone(graph), from: le.from, to: le.to,
      effect: le.effect, quote: le.quote, clarification: le.clarification,
      expected: { graph_hash: hash(), edge_token: le.edge_token }, reading_token: le.reading_token,
      ...(le.unit_readings !== undefined ? { unit_readings: le.unit_readings } : {}),
      ...(le.reversal !== undefined ? { reversal: le.reversal } : {}), frameRefit: true });
    if (out.kind !== 'mutated') throw new Error(`RC2 real writer refused: ${JSON.stringify(out)}`);
    graph = structuredClone(out.mutatedGraph as Json);
    return { status: 'committed', graph_hash: hash(), receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
  },
}));

const message = (text: string): Json => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const calls = (...tools: [string, Json][]): Json => ({ output: tools.map(([name, args], i) => ({
  type: 'function_call', call_id: `rc2-${i}`, name, arguments: JSON.stringify(args),
})) });
const clarifications = () => (pending.get(SID) ?? []).filter((p: any) => p.action?.kind === 'elicit_link_effect_clarification') as Json[];
const answerWrite = () => writes.filter(w => w.assistantMessage !== undefined).at(-1)!;
function seedClarification(cafe = false): Json {
  const p = { id: randomUUID(), scenario_id: SID, chip_id: 'agent-link-effect-clarification',
    action: { kind: 'elicit_link_effect_clarification', from_id: cafe ? 'prices' : 'pro_plan_price',
      to_id: cafe ? 'daily_visits' : 'monthly_churn', from_label: cafe ? 'Prices' : 'Pro plan price',
      to_label: cafe ? 'Daily visits' : 'Monthly churn', quote: cafe ? CAFE_QUOTE : PAUL_QUOTE,
      statement_classification: 'asserted', source_text: cafe ? CAFE_QUOTE : PAUL_QUOTE,
      question: cafe ? CAFE_QUESTION : PAUL_QUESTION, refusal: 'unit_mismatch', value_text: cafe ? '5%' : 'at least increase 1%' },
    preconditions: {}, emitted_at_iso: now(),
    expires_at_iso: new Date(Date.now() + 86_400_000).toISOString(), expires_at_turn_count: 6 };
  pending.set(SID, [p]);
  return p;
}

describe('RC2 stated-effect carry, the real /agent/v1/turn door', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      providerBodies.push(body);
      if (String(init?.body ?? '').includes('"propose_link_effect"')) {
        return new Response(JSON.stringify(script.shift() ?? message('Those figures are noted.')), { status: 200 });
      }
      return new Response(JSON.stringify(message('Those figures are noted.')), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: hash(), ...(runRead ?? {}) }));
    app.post('/orchestrate/v2/turn', async () => {
      pending.set(SID, []); // Inner Run row; only the outer answer can restore the pending statement.
      runRead = {
        analysis_state: { run_state: { kind: 'complete_current', computed_at: now() }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
        analysis_result: { type: 'analysis_result', computed_against_hash: hash(), summary: 'The model has a result.' },
        analysis_limit_verdicts: { per_limit: [
          { constraint_id: CHURN_LIMIT, state: 'unscored', reason: 'limit_rests_on_olumi_guess' },
          { constraint_id: CONTROL_LIMIT, state: 'unscored', reason: 'limit_rests_on_olumi_guess' },
        ], joint: { state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [CHURN_LIMIT, CONTROL_LIMIT] } },
      };
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: hash(),
        analysis_state: runRead.analysis_state, analysis_ready: { status: 'ready' }, blocks: [runRead.analysis_result] };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  beforeEach(() => { SID = randomUUID(); graph = saasGraph(); runRead = undefined; pending.clear(); writes.length = 0; rows.clear(); script.length = 0; providerBodies.length = 0; doorCalls.length = 0; });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  const turn = async (words: string, extra: Json = {}): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID,
      turn_id: randomUUID(), agent_session_id: `rc2-${randomUUID()}`, message: words, ...extra } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  it.each([false, true])('F1 RED: denial plus percentage points never arms, cards or writes (grouped=%s)', async grouped => {
    const quote = 'A £10 rise in Pro plan price adds about 0.5% to monthly churn';
    const denial = `I do not believe this claim: ${quote}`;
    const args = { ...PAUL_ARGS, amount: 0.5, per_source_change: 10, quote };
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', grouped ? { links: [args] } : args]), message('That claim is denied.'));
    const denied = await turn(denial);
    const armed = structuredClone(clarifications());
    script.push(calls(['propose_link_effect', grouped ? { links: [{ ...args, amount_unit: 'percentage points' }] } : { ...args, amount_unit: 'percentage points' }]), message('Nothing was recorded.'));
    const answered = await turn('percentage points');
    expect(armed, 'a denied sentence never arms the inner assertion').toEqual([]);
    for (const body of [denied, answered]) expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
  });

  it('F1b RED: a stale carrier cannot drop denial context at answer time', async () => {
    const quote = 'A £10 rise in Pro plan price adds about 0.5% to monthly churn';
    const seeded = seedClarification();
    seeded.action = { ...seeded.action, quote, statement_classification: 'asserted', source_text: `I do not believe this claim: ${quote}` };
    pending.set(SID, [seeded]);
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 0.5, per_source_change: 10, amount_unit: 'percentage points', quote }]), message('Nothing was recorded.'));
    const body = await turn('percentage points');
    expect(providerBodies[0]?.tool_choice).not.toEqual({ type: 'function', name: 'propose_link_effect' });
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
  });

  it('F2 RED: Paul’s churn statement never sizes price to Gross margin, including a later guess', async () => {
    graph.nodes.push({ id: 'gross_margin', label: 'Gross margin', kind: 'factor', category: 'observable',
      observed_state: { raw_value: 50, value: 0.5, cap: 100, unit: '%', source: 'brief_extraction' } });
    graph.edges.push({ from: 'pro_plan_price', to: 'gross_margin', strength: { mean: 0.2, std: 0.1 }, effect_direction: 'positive', exists_probability: 0.8,
      defaulted: true, provenance: { source: 'cee_hypothesis' } });
    graph.nodes.find((n: Json) => n.id === 'raise_to_59').interventions.pro_plan_price = { raw_value: 59, value: 0.295, unit: '£ per subscriber per month', source: 'user_specified' };
    const before = structuredClone(graph.edges.find((e: Json) => e.to === 'gross_margin'));
    const args = { ...PAUL_ARGS, to_label: 'Gross margin', amount_unit: 'percentage points' };
    script.push(calls(['propose_link_effect', args]), message('Please supply the size.'));
    await turn(PAUL);
    script.push(calls(['propose_link_effect', args]), message('Please give your best guess.'));
    await turn('percentage points');
    const armedFloor = clarifications().find(c => c.action.to_id === 'gross_margin')?.action.floor;
    script.push(calls(['propose_link_effect', { ...args, amount: 2, per_source_change: 10 }]), message('Review this figure.'));
    const body = await turn('My best guess is 2 points.');
    const card = body.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'));
    if (card) await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(armedFloor, 'the source-grounded bound must still name this target').toBeUndefined();
    expect(card).toBeUndefined();
    expect(doorCalls).toEqual([]);
    expect(graph.edges.find((e: Json) => e.to === 'gross_margin')).toEqual(before);
  });

  const REVIEW_BOUNDS = [
    'at least 5 percentage points', '5 percentage points or more', 'no less than 5 points',
    'at minimum 5 points', 'a minimum of 5 points', 'upwards of 5 points', 'more than 5 points', 'over 5 points', '+5 points or more',
    'no more than 5 points', 'at most 5 points', 'up to 5 points', '5 points or less', 'a maximum of 5 points', 'less than 5 points', 'under 5 points',
  ];
  it.each(REVIEW_BOUNDS)('F3 RED: bounded effect is refused and carried, never a point (%s)', async bound => {
    graph = cafeGraph();
    graph.edges.push({ from: 'prices', to: 'margin', strength: { mean: 0.1, std: 0.05 }, effect_direction: 'positive', exists_probability: 0.8, defaulted: true,
      provenance: { source: 'cee_hypothesis' } });
    const quote = `Raising prices by £1 will increase gross margin by ${bound}.`;
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', { from_label: 'Prices', to_label: 'Gross margin', amount: 5, amount_unit: 'percentage points',
      per_source_change: 1, per_source_change_unit: 'GBP', quote }]), message('Please give your best guess.'));
    const body = await turn(quote);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ quote, statement_classification: 'asserted' });
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
  });

  it.each(['more than', 'over'])('F3 CONTROL: a strict lower bound cannot later license an equal best guess (%s)', async comparator => {
    graph = cafeGraph();
    graph.edges.push({ from: 'prices', to: 'margin', strength: { mean: 0.1, std: 0.05 }, effect_direction: 'positive', exists_probability: 0.8,
      defaulted: true, provenance: { source: 'cee_hypothesis' } });
    const quote = `Raising prices by £1 will increase gross margin by ${comparator} 5 points.`;
    const args = { from_label: 'Prices', to_label: 'Gross margin', amount: 5, amount_unit: 'percentage points',
      per_source_change: 1, per_source_change_unit: 'GBP', quote };
    script.push(calls(['propose_link_effect', args]), message('Please give your best guess.'));
    await turn(quote);
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 5, exclusive: true });
    script.push(calls(['propose_link_effect', args]), message('Please give a guess above the minimum.'));
    const body = await turn('My best guess is 5 points.');
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false, refusal: 'outside_stated_bounds' }));
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
  });

  it.each([100, 80])('F4 RED: café relative answer converts from CURRENT %s level and discloses its basis', async level => {
    graph = cafeGraph();
    graph.nodes.find((n: Json) => n.id === 'daily_visits').observed_state = { raw_value: level, value: level / 100, cap: 100, unit: '%', source: 'brief_extraction' };
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Please clarify the reading.'));
    await turn(CAFE_QUOTE);
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Review this figure.'));
    const body = await turn('relative');
    const card = body.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'));
    expect(card, JSON.stringify(body)).toBeDefined();
    expect(card.detail).toContain('relative');
    expect(card.detail).toContain(String(level));
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    const edge = graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'daily_visits');
    expect(edge.provenance.natural_effect.amount).toBe(-5 * level / 100);
    expect(edge.provenance.natural_effect.amount_unit).toBe('percentage points');
    expect(clarifications()).toEqual([]);
  });

  it('F4b RED: relative with unknown CURRENT level carries one current-level question and writes nothing', async () => {
    graph = cafeGraph();
    graph.nodes.find((n: Json) => n.id === 'daily_visits').observed_state = { unit: '%' };
    seedClarification(true);
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Please clarify the reading.'));
    const body = await turn('relative');
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action.question).toMatch(/current|today/i);
    expect(clarifications()[0]!.action.question).not.toMatch(/or 5%|5-point/);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
  });

  it.each([
    'How does Pro plan price affect Monthly support requests?',
    'Should we size Pro plan price → Monthly support requests in percentage points?',
    'Can we allocate at least two support hours each week?',
  ])('F7 RED: a churn clarification preserves the unrelated question: %s', async unrelatedQuestion => {
    script.push(calls(['propose_link_effect', PAUL_ARGS]), message(unrelatedQuestion));
    const body = await turn(PAUL_QUOTE);
    expect(clarifications()).toHaveLength(1);
    expect(body.assistant_text).toContain(unrelatedQuestion);
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(doorCalls).toEqual([]);
  });

  it('R1 RED: Paul’s exact statement offers churn=4% and persists its one unresolved effect verbatim', async () => {
    script.push(calls(['propose_link_effect', PAUL_ARGS], ['propose_assumptions', { assumptions: [{ factor_label: 'Monthly churn', value: 4, unit: '%',
      basis: 'Our current churn is 4%', revise: true }] }]), message('Here is the current churn figure to record.'));
    const body = await turn(PAUL);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_assumptions', ok: true }));
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(body.suggested_actions).toContainEqual(expect.objectContaining({ id: expect.stringContaining('agent-approve-proposal:') }));
    const currentLevelCard = body.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'))!;
    expect(JSON.stringify(currentLevelCard)).toContain('Monthly churn');
    expect(JSON.stringify(currentLevelCard)).toMatch(/4\s*%/);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ kind: 'elicit_link_effect_clarification', from_id: 'pro_plan_price',
      to_id: 'monthly_churn', quote: PAUL_QUOTE, question: expect.any(String), refusal: expect.any(String) });
    // The model deliberately omits the question: the delivered producer question and the carrier must still agree.
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(clarifications()[0]!.action.question).toContain('at least');
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect((answerWrite().pending_actions ?? []).some(p => p.action.kind === 'elicit_link_effect_clarification')).toBe(true);
    const initial = structuredClone(clarifications()[0]!);
    const approved = await turn(currentLevelCard.message, { source: 'chip', chip: { id: currentLevelCard.id } });
    expect(approved._diagnostic_trace.fast_path).toBe('approve');
    expect(approved._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true }));
    expect(graph.nodes.find((n: Json) => n.id === 'monthly_churn').observed_state).toMatchObject({ raw_value: 4, source: 'user_override' });
    expect(clarifications()).toEqual([initial]); // The churn card changed its level, never this still-open effect.
  });

  it('R2 RED: “one percentage point” binds the stored statement, still refuses its lower bound and keeps “at least” live', async () => {
    const prior = seedClarification();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount_unit: 'percentage points' }]), message('You said at least one percentage point. What single change would you use?'));
    const body = await turn('one percentage point');
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: 'propose_link_effect' });
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action.quote).toBe(prior.action.quote);
    expect(clarifications()[0]!.action.question).toBe(SCIENCE_ASK);
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 1, unit: 'percentage points', reading: 'points', words: 'at least 1 point' });
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
  });


  const resolvedFloor = async (): Promise<Json> => {
    // The reference to this increase is the user's one actual +£10 option, in raw units.
    graph.nodes.find((n: Json) => n.id === 'raise_to_59').interventions.pro_plan_price = { raw_value: 59, value: 0.295, unit: '£ per subscriber per month', source: 'user_specified' };
    seedClarification();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount_unit: 'percentage points' }]), message('Please give your best guess.'));
    await turn('one percentage point');
    return structuredClone(clarifications()[0]!);
  };
  const effectEdge = (): Json => graph.edges.find((e: Json) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
  const guessCard = async (answer: string, guess: number, extra: Json = {}): Promise<Json> => {
    providerBodies.length = 0;
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: guess, amount_unit: 'percentage points', per_source_change: 10, ...extra }]), message('Review your best guess.'));
    const body = await turn(answer);
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: 'propose_link_effect' });
    const card = body.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'));
    expect(card, JSON.stringify(body)).toBeDefined();
    expect(doorCalls).toEqual([]);
    return card!;
  };

  it.each([0.5, 1, 1.5])('B1 RED: bound alone writes no size and the next Run discloses only a current effect below the floor (%s points)', async current => {
    const edge = effectEdge();
    edge.strength.mean = current / 5;
    edge.provenance.natural_effect.amount = current;
    edge.provenance.natural_effect.strength_mean = edge.strength.mean;
    const before = structuredClone(edge);
    const held = await resolvedFloor();
    expect(effectEdge()).toEqual(before);
    expect(doorCalls).toEqual([]);
    expect(held.action.floor).toMatchObject({ value: 1, unit: 'percentage points', per_source_change: 10, reading: 'points', words: 'at least 1 point' });
    const body = await run();
    const disclosure = "Olumi's current figure for how much ‘Pro plan price’ affects ‘Monthly churn’ is below your ‘at least 1 point’, so this Run likely understates churn and may flatter the price rise.";
    if (current < 1) expect(body.assistant_text).toContain(disclosure);
    else expect(body.assistant_text).not.toContain(disclosure);
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(effectEdge()).toEqual(before);
  });

  it('B2 RED: best guess and plausible upper prepare and write the guess, with shared-helper 90% spread', async () => {
    await resolvedFloor();
    const card = await guessCard('My best guess is 2 points; the most it could plausibly be is 4 points.', 2, { upper: 4 });
    expect(card.detail).toContain('at least 1 point');
    expect(card.detail).toContain('4');
    expect(clarifications()).toEqual([]);
    const body = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true }));
    const edge = effectEdge();
    expect(edge.provenance.natural_effect.amount).toBe(2);
    expect(edge.strength.mean).toBeCloseTo(0.4, 12); // The bound would be 0.2 on this frame.
    const fit = statedRangeSpread(1, 4, 0.9);
    expect(fit.ok).toBe(true);
    if (!fit.ok) throw new Error(fit.refusal);
    expect(Math.abs(edge.strength.std * 2 / edge.strength.mean - fit.std)).toBeLessThan(1e-9);
    expect(body.assistant_text).toContain('at least 1 point');
    await run();
    expect(Math.abs(effectEdge().strength.std * 2 / effectEdge().strength.mean - fit.std)).toBeLessThan(1e-9);
  });

  it('B3 RED: a best guess only writes that point with the existing spread and records the floor without a range', async () => {
    await resolvedFloor();
    const card = await guessCard('My best guess is 2 points.', 2);
    expect(card.detail).toContain('at least 1 point');
    const body = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    const edge = effectEdge();
    expect(edge.provenance.natural_effect.amount).toBe(2);
    expect(edge.strength.std).toBeCloseTo(Math.abs(edge.strength.mean) / 2, 12);
    expect(edge.provenance.stated_effect_floor).toMatchObject({ value: 1, words: 'at least 1 point' });
    expect(edge.provenance.stated_effect_upper).toBeUndefined();
    expect(edge.provenance.natural_effect.stated_range).toBeUndefined();
    expect(body.assistant_text).toContain('at least 1 point');
  });

  it.each([
    ['My best guess is 0.5 points; the most it could plausibly be is 3 points.', 0.5, 3, 'outside_stated_bounds'],
    ['My best guess is 4 points; the most it could plausibly be is 3 points.', 4, 3, 'outside_stated_bounds'],
    ['My best guess is 1 point; the most it could plausibly be is 1 point.', 1, 1, 'RANGE_ZERO_WIDTH'],
  ])('B4 RED: an invalid guess or helper refusal keeps the floor and asks a clear question (%s)', async (answer, guess, upper, refusal) => {
    const held = await resolvedFloor();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: guess, amount_unit: 'percentage points', per_source_change: 10, upper }]), message('Please clarify your guess.'));
    const body = await turn(answer);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false, refusal }));
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(body.assistant_text).toContain('?');
    expect(doorCalls).toEqual([]);
  });

  it('B5 CONTROL: a placeholder without a natural-effect record still discloses a current figure below the floor', async () => {
    effectEdge().strength.mean = 0.1;
    delete effectEdge().provenance.natural_effect;
    await resolvedFloor();
    const body = await run();
    expect(body.assistant_text).toContain("is below your ‘at least 1 point’, so this Run likely understates churn and may flatter the price rise.");
    const face = body._answer_shape === undefined ? body.assistant_text : [body._answer_shape.headline, ...body._answer_shape.bullets].join(' ');
    expect(face).toContain('is below your');
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(doorCalls).toEqual([]);
  });

  it('B6 CONTROL: a relative reading retains the stated base and converts the guess and helper spread in that reading', async () => {
    graph.nodes.find((n: Json) => n.id === 'raise_to_59').interventions.pro_plan_price = { raw_value: 59, value: 0.295, unit: '£ per subscriber per month', source: 'user_specified' };
    seedClarification();
    script.push(calls(['propose_link_effect', PAUL_ARGS]), message('Please supply your guess.'));
    await turn('relative');
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 1, reading: 'relative', relative_base: 4, unit: '%', per_source_change: 10 });
    const card = await guessCard('My best guess is 2%; the most it could plausibly be is 4%.', 0.08, { upper: 4 });
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    const edge = effectEdge();
    expect(edge.provenance.natural_effect.amount).toBe(0.08);
    expect(edge.provenance.stated_effect_floor.reading).toBe('relative');
    const fit = statedRangeSpread(1, 4, 0.9);
    if (!fit.ok) throw new Error(fit.refusal);
    expect(Math.abs(edge.strength.std * 0.08 / edge.strength.mean - fit.std * 4 / 100)).toBeLessThan(1e-9);
  });

  it('B7 CONTROL: a points floor cannot license a percent guess or a different source denominator', async () => {
    const held = await resolvedFloor();
    for (const [answer, per] of [['My best guess is 2%.', 10], ['My best guess is 2 points.', 1]] as const) {
      script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points', per_source_change: per }]), message('Please clarify your guess.'));
      const body = await turn(answer);
      expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
      expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
      expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
      expect(doorCalls).toEqual([]);
    }
  });

  it('B8 CONTROL: a broad elicited spread is checked by the size writer before any approval is offered', async () => {
    graph.nodes.find((n: Json) => n.id === 'monthly_churn').observed_state = { raw_value: 4, value: 0.04, cap: 100, unit: '%', source: 'user_override' };
    const held = await resolvedFloor();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points', per_source_change: 10, upper: 50 }]), message('That range cannot hold across these options.'));
    const body = await turn('My best guess is 2 points; the most it could plausibly be is 50 points.');
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false, refusal: 'out_of_domain' }));
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(doorCalls).toEqual([]);
  });

  it('B9 RED: an explicitly stated one-point floor already has its reading and immediately asks Science’s exact question', async () => {
    graph.nodes.find((n: Json) => n.id === 'raise_to_59').interventions.pro_plan_price = { raw_value: 59, value: 0.295, unit: '£ per subscriber per month', source: 'user_specified' };
    const quote = PAUL_QUOTE.replace('increase 1%', 'increase 1 point');
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount_unit: 'percentage points', quote }]), message('Please give your guess.'));
    const body = await turn(quote);
    expect(clarifications()[0]!.action.question).toBe(SCIENCE_ASK);
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 1, reading: 'points', unit: 'percentage points', words: 'at least 1 point' });
    expect(body.assistant_text).toContain(SCIENCE_ASK);
    expect(body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'))).toEqual([]);
    expect(doorCalls).toEqual([]);
  });

  it('G1 CONTROL: the grouped refusal path carries the same exact stated effect with one delivered question', async () => {
    graph = cafeGraph();
    script.push(calls(['propose_link_effect', { links: [CAFE_ARGS] }]), message('Please clarify this reading.'));
    const body = await turn(CAFE_QUOTE);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ from_id: 'prices', to_id: 'daily_visits', quote: CAFE_QUOTE,
      refusal: 'unit_mismatch' });
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
  });

  it('C1 RED: three unrelated held proposals outrank a fresh clarification and name the statement set aside', async () => {
    graph = cafeGraph();
    const values = [
      { id: 'stock', label: 'Stock', value: 101, unit: 'items', baseline: 100, cap: 1000 },
      { id: 'staff_hours', label: 'Staff hours', value: 41, unit: 'hours per week', baseline: 40, cap: 100 },
      { id: 'waste_rate', label: 'Waste rate', value: 7, unit: '%', baseline: 6, cap: 100 },
    ];
    graph.nodes.push(...values.map(v => ({ id: v.id, kind: 'factor', label: v.label, category: 'observable',
      observed_state: { raw_value: v.baseline, value: v.baseline / v.cap, cap: v.cap, unit: v.unit, source: 'brief_extraction' } })));
    for (const v of values) {
      script.push(calls(['propose_assumptions', { assumptions: [{ factor_label: v.label, value: v.value, unit: v.unit,
        basis: 'The figure the user supplied.', revise: true }] }]), message('Please review this value.'));
      const offer = await turn(`Set ${v.label} to ${v.value} ${v.unit}.`);
      expect(offer._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_assumptions', ok: true }));
    }
    const heldBefore = (pending.get(SID) ?? []).filter((p: any) => p.action?.inline_patch?.agent_proposal !== undefined) as Json[];
    expect(heldBefore, 'precondition: the latest answer row holds all three unrelated proposals').toHaveLength(3);
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Please clarify this reading.'));
    const body = await turn(CAFE_QUOTE);
    expect(clarifications()).toEqual([]);
    const finalPending = pending.get(SID) ?? [];
    expect(finalPending).toHaveLength(3);
    const heldAfter = finalPending.filter((p: any) => p.action?.inline_patch?.agent_proposal !== undefined) as Json[];
    expect(heldAfter).toHaveLength(3);
    expect(heldAfter.map(p => p.chip_id)).toEqual(heldBefore.map(p => p.chip_id));
    expect(body.assistant_text).toContain("I've set aside your earlier statement about how ‘Prices’ affects ‘Daily visits’; say it again whenever you want it in the model.");
    expect(body.assistant_text).not.toContain(CAFE_QUESTION);
    expect(body.assistant_text).not.toContain('was set aside because only three changes can wait at once');
    expect(body._proposal_fields.proposals.map((p: Json) => p.proposal_id)).toEqual(
      heldBefore.map(p => p.action.inline_patch.agent_proposal.proposal_id));
    expect(doorCalls).toEqual([]); // Preparing and setting aside holds never writes a figure.
  });

  it('C2 RED: a new unrelated approval outranks three live effects and explicitly lapses the oldest clarification', async () => {
    graph = cafeGraph();
    graph.edges.push({ from: 'prices', to: 'margin', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } });
    graph.nodes.push({ id: 'stock', kind: 'factor', label: 'Stock', category: 'observable',
      observed_state: { raw_value: 100, value: 0.1, cap: 1000, unit: 'items', source: 'brief_extraction' } });
    const first = seedClarification(true);
    const effects = [
      { from_id: 'prices', to_id: 'daily_visits', from_label: 'Prices', to_label: 'Daily visits', quote: CAFE_QUOTE,
        question: CAFE_QUESTION, value_text: '5%' },
      { from_id: 'daily_visits', to_id: 'margin', from_label: 'Daily visits', to_label: 'Gross margin',
        quote: 'Each 1% increase in daily visits lifts Gross margin by 2%.',
        question: 'Is the stated change in Gross margin two percentage points or a relative 2%?', value_text: '2%' },
      { from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
        quote: 'Each £1 rise in prices increases Gross margin by 3%.',
        question: 'Is the stated change in Gross margin three percentage points or a relative 3%?', value_text: '3%' },
    ].map((action, i) => {
      const id = randomUUID();
      return { ...structuredClone(first), id, chip_id: `agent-link-effect-clarification:${id}`,
        action: { ...first.action, ...action, source_text: action.quote }, preconditions: { target_entity_ids: [action.from_id, action.to_id] },
        emitted_at_iso: new Date(Date.now() - (3 - i) * 60_000).toISOString() };
    });
    pending.set(SID, [effects[2]!, effects[0]!, effects[1]!]); // Timestamp, rather than input order, decides which one lapses.
    expect(clarifications()).toHaveLength(3);
    script.push(calls(['propose_assumptions', { assumptions: [{ factor_label: 'Stock', value: 101, unit: 'items',
      basis: 'The figure the user supplied.', revise: true }] }]), message('Please review this value.'));
    const body = await turn('Set Stock to 101 items.');
    const proposed = body._agent.tool_calls.find((c: Json) => c.name === 'propose_assumptions' && c.ok === true);
    expect(proposed, 'precondition: the new unrelated proposal was actually prepared').toBeDefined();
    expect(proposed.proposal_id).toMatch(/^prop_/);
    expect(clarifications()).toHaveLength(2);
    expect(clarifications().map(p => p.action)).toEqual(effects.slice(1).map(p => p.action));
    expect(pending.get(SID)).toHaveLength(3);
    expect(body.suggested_actions.some((c: Json) => c.id === `agent-approve-proposal:${proposed.proposal_id}`)).toBe(true);
    expect(body._proposal_fields.proposals.map((p: Json) => p.proposal_id)).toEqual([proposed.proposal_id]);
    const lapse = "I've set aside your earlier statement about how ‘Prices’ affects ‘Daily visits’; say it again whenever you want it in the model.";
    expect(body.assistant_text).toContain(lapse);
    expect(body.assistant_text.split(lapse)).toHaveLength(2); // One sentence, delivered and persisted exactly once.
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(body.assistant_text).not.toContain('was set aside because only three changes can wait at once');
    expect(doorCalls).toEqual([]);
    expect(writes.every(w => w.graph === undefined)).toBe(true);
  });

  it('R3 RED: a different café brief’s “percentage points” reply prepares the card from the stored quote and consumes the clarification', async () => {
    graph = cafeGraph();
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message(CAFE_QUESTION));
    await turn(CAFE_QUOTE);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action.quote).toBe(CAFE_QUOTE);
    providerBodies.length = 0;
    script.push(calls(['propose_link_effect', { ...CAFE_ARGS, amount_unit: 'percentage points' }]), message('Here is the reading to approve.'));
    const body = await turn('percentage points');
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: 'propose_link_effect' });
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: true }));
    const card = body.suggested_actions.find((c: Json) => c.id.startsWith('agent-approve-proposal:'));
    expect(card, JSON.stringify(body)).toBeDefined();
    expect(card.detail).toContain(CAFE_QUOTE);
    expect(card.detail).toContain('Daily visits');
    expect(card.detail).toContain('Your clarification: “percentage points”.');
    expect(clarifications()).toEqual([]);
    expect(writes.every(w => w.graph === undefined)).toBe(true);
    const pressed = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(pressed._diagnostic_trace.fast_path).toBe('approve');
    expect(pressed._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true }));
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0]!.link_effect.clarification).toEqual({ node_id: 'daily_visits', quote: CAFE_QUOTE, answer: 'percentage points',
      from_id: 'prices', to_id: 'daily_visits', statement_classification: 'asserted', source_text: CAFE_QUOTE });
    const recorded = graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'daily_visits');
    expect(recorded.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', source_quote: CAFE_QUOTE,
      reading: 'agent_proposed_user_confirmed', natural_effect: { amount: -5, amount_unit: 'percentage points' } });
    expect(clarifications()).toEqual([]);
  });

  const run = async (): Promise<Json> => {
    const body = await turn('Run the analysis', { source: 'chip_click', chip: { action_type: 'run_analysis' } });
    expect(body._diagnostic_trace.fast_path).toBe('run');
    return body;
  };
  const explain = async (first: Json): Promise<Json> => {
    const chip = first.suggested_actions.find((c: Json) => c.id.startsWith('agent-explain-run:'));
    expect(chip, JSON.stringify(first)).toBeDefined();
    providerBodies.length = 0;
    await turn(chip.message, { agent_session_id: first._agent.session_id, chip: { id: chip.id } });
    const context = providerBodies.map(b => explanationContext(b.input)).find(c => c !== undefined);
    expect(context, JSON.stringify(providerBodies)).toBeDefined();
    return context!;
  };

  it('R4 RED: a Run and Explain carry the statement and ask its stored question; a control link keeps its template', async () => {
    const prior = seedClarification();
    const first = await run();
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]).toEqual(prior);
    const context = await explain(first);
    const checks = context.limit_checks?.limits as Json[] | undefined;
    expect(checks, JSON.stringify(context)).toBeDefined();
    const churn = checks!.find(r => r.constraint_id === CHURN_LIMIT)!;
    const control = checks!.find(r => r.constraint_id === CONTROL_LIMIT)!;
    expect(churn.ask).toBe(`You said “${PAUL_QUOTE}”. ${PAUL_QUESTION}`);
    expect(churn.ask).not.toContain('How much does');
    expect(control.ask).toBe('How much does ‘Pro plan price’ change ‘Monthly support requests’?');
    expect(clarifications()[0]).toEqual(prior);
  });

  it('R5 CONTROL: sizing the link another way as user_stated expires the clarification and never restores the generic ask', async () => {
    seedClarification();
    // Reloaded postimage of an independent user edit; expiry reads authority from the final graph.
    const e = graph.edges.find((e: Json) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
    e.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: {
      amount: 1, amount_unit: 'percentage points', per_source_change: 10, per_source_change_unit: '£ per subscriber per month',
      strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength',
    } };
    graph.nodes.find((n: Json) => n.id === 'monthly_churn').observed_state.source = 'user_override';
    const first = await run();
    expect(clarifications()).toEqual([]);
    const context = await explain(first);
    const checks = context.limit_checks?.limits as Json[] | undefined;
    expect(checks, JSON.stringify(context)).toBeDefined();
    const row = checks!.find(r => r.constraint_id === CHURN_LIMIT)!;
    expect(row, JSON.stringify(checks)).toBeDefined();
    expect(row.ask ?? '').not.toContain('How much does ‘Pro plan price’ change ‘Monthly churn’');
    expect(row.ask ?? '').not.toContain('You said');
    expect(clarifications()).toEqual([]);
  });

  it('R6 CONTROL: no stated effect leaves the persisted answer bytes unchanged and arms no clarification', async () => {
    script.push(message('Those figures are noted.'));
    const body = await turn('Please explain the model.');
    expect(body.assistant_text).toBe('Those figures are noted.');
    const saved = answerWrite();
    expect(JSON.stringify({ assistantMessage: saved.assistantMessage, pending_actions: saved.pending_actions ?? [] }))
      .toBe('{"assistantMessage":"Those figures are noted.","pending_actions":[]}');
    expect(clarifications()).toEqual([]);
    expect(body._agent.tool_calls ?? []).toEqual([]);
  });
});
