/** RC2a: stored words are context only; only a current-turn answer can size the held link. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { statedRangeSpread } from '../../stated-range-spread.js';
import { deriveAnswerTextFromShape } from '../../routing/answer-shape.js';

type Json = Record<string, any>;
// Script only the mixed disclosure row at the runtime seam; the route, carry lifecycle and composer remain real.
const replySeam = vi.hoisted(() => ({ result: undefined as Json | undefined, run: false }));
vi.mock('../runtime/agent-loop.js', async original => {
  const actual = await original<typeof import('../runtime/agent-loop.js')>();
  return { ...actual, runAgentTurn: async (...args: Parameters<typeof actual.runAgentTurn>) => {
    if (replySeam.result === undefined) return actual.runAgentTurn(...args);
    if (!replySeam.run) return replySeam.result;
    const ran = await args[1].runAnalysis(args[0].ctx, { reason: 'The user asked for this Run.' });
    return { ...replySeam.result,
      tool_calls: [...replySeam.result.tool_calls, { name: 'run_analysis', ok: ran.ok, mutated: false }],
      tool_results: [...replySeam.result.tool_results, ran] };
  } };
});
let SID = randomUUID();
const PAUL = 'Our current churn is 4%, and we predict it will at least increase 1% with this price increase. If it goes above 6%, we start to lose money, which is a serious problem.';
const PAUL_QUOTE = 'Our current churn is 4%, and we predict it will at least increase 1% with this price increase.';
const PAUL_QUESTION = 'Does "at least increase 1%" mean at least one percentage point, or a relative increase of at least 1%?';
const bestGuessAsk = (quote: string, _from: string, _to: string): string =>
  `You said ‘${quote}’. What's your best single guess, and the lowest and highest it could plausibly be?`;
const SCIENCE_ASK = bestGuessAsk(PAUL_QUOTE, 'Pro plan price', 'Monthly churn');
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

/** A different café brief, counting visits in its own units rather than a percentage frame. */
function cafeGraph(): Json {
  return { nodes: [
    { id: 'cafe_decision', kind: 'decision', label: 'Café pricing' },
    { id: 'margin', kind: 'goal', label: 'Gross margin', goal_direction: '>=', goal_threshold: 0.6,
      goal_threshold_raw: 60, goal_threshold_cap: 100, goal_threshold_unit: '%', goal_threshold_frame: 'level',
      observed_state: { raw_value: 50, value: 0.5, cap: 100, unit: '%', source: 'brief_extraction' } },
    { id: 'raise_prices', kind: 'option', label: 'Raise prices', interventions: { prices: { raw_value: 4, value: 0.4, unit: 'GBP', source: 'brief_extraction' } } },
    { id: 'keep_prices', kind: 'option', label: 'Keep prices', is_baseline: true },
    { id: 'prices', kind: 'factor', label: 'Prices', category: 'controllable', observed_state: { raw_value: 3, value: 0.3, cap: 10, unit: 'GBP', source: 'brief_extraction' } },
    { id: 'daily_visits', kind: 'factor', label: 'Daily visits', category: 'observable', observed_state: { raw_value: 100, value: 0.5, cap: 200, unit: 'visits per day', source: 'brief_extraction' } },
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
let runStatus = 200;
let runHasResult = true;
let beforeProviderReply: (() => void) | undefined;
const pending = new Map<string, unknown[]>();
const writes: SessionTurnWrite[] = [];
const rows = new Map<string, Json>();
const script: Json[] = [];
const providerBodies: Json[] = [];
const doorCalls: Json[] = [];
const replyShapeLogs: Json[] = [];
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

describe('RC2a current-turn-only stated-effect carry, the real /agent/v1/turn door', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      providerBodies.push(body);
      if (String(init?.body ?? '').includes('"propose_link_effect"')) {
        const hook = beforeProviderReply;
        beforeProviderReply = undefined;
        hook?.();
        return new Response(JSON.stringify(script.shift() ?? message('Those figures are noted.')), { status: 200 });
      }
      return new Response(JSON.stringify(message('Those figures are noted.')), { status: 200 });
    }));
    const { log } = await import('../../../utils/telemetry.js');
    vi.spyOn(log, 'info').mockImplementation((entry) => {
      if (entry?.event === 'agent_lane.reply_shaped') replyShapeLogs.push(entry);
    });
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: hash(), ...(runRead ?? {}) }));
    app.post('/orchestrate/v2/turn', async (_req, reply) => {
      if (runStatus !== 200) return reply.code(runStatus).send({ error: 'Run failed' });
      if (!runHasResult) {
        return { response_version: 2, assistant_text: 'The analysis did not produce a result.', suggested_actions: [],
          insights: [], graph_hash: hash(), analysis_ready: { status: 'ready' }, blocks: [] };
      }
      // The real Run answer carries strict prior pending actions; it does not consume an open ask.
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
  beforeEach(() => { SID = randomUUID(); graph = saasGraph(); runRead = undefined; runStatus = 200; runHasResult = true;
    beforeProviderReply = undefined;
    replySeam.result = undefined; replySeam.run = false; replyShapeLogs.length = 0;
    pending.clear(); writes.length = 0; rows.clear(); script.length = 0; providerBodies.length = 0; doorCalls.length = 0; });
  afterAll(async () => { await app.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  const turn = async (words: string, extra: Json = {}): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID,
      turn_id: randomUUID(), agent_session_id: `rc2-${randomUUID()}`, message: words, ...extra } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };

  const cards = (body: Json): Json[] => body.suggested_actions.filter((c: Json) => c.id.startsWith('agent-approve-proposal:'));
  const marginLink = (): void => {
    graph = cafeGraph();
    graph.edges.push({ from: 'prices', to: 'margin', strength: { mean: 0.1, std: 0.05 }, effect_direction: 'positive',
      exists_probability: 0.8, defaulted: true, provenance: { source: 'cee_hypothesis' } });
  };
  const marginArgs = (quote: string): Json => ({ from_label: 'Prices', to_label: 'Gross margin', amount: 5,
    amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'GBP', quote });

  it.each([false, true])('RC2a-r3 P1 denied carrier floor cannot supply missing lower extreme (grouped=%s)', async grouped => {
    marginLink();
    graph.nodes.find((n: Json) => n.id === 'prices').label = 'Café price';
    const quote = 'Raising the café price by £1 will increase gross margin by at least 5%';
    const source = `I do not believe this claim: ${quote}`;
    const held = seedClarification(true);
    held.action = { ...held.action, from_id: 'prices', to_id: 'margin', from_label: 'Café price', to_label: 'Gross margin',
      quote, source_text: source, statement_classification: 'asserted', question: bestGuessAsk(quote, 'Café price', 'Gross margin') };
    pending.set(SID, [held]);
    const propose = (args: Json): Json => calls(['propose_link_effect', grouped ? { links: [{ ...args, from_label: 'Café price' }] } : { ...args, from_label: 'Café price' }]);
    script.push(propose({ ...marginArgs(quote), amount_unit: '%' }), message('Please state current figures.'));
    await turn('points');
    const before = structuredClone(graph);
    const answer = '6, at most 7';
    script.push(propose({ ...marginArgs(answer), amount: 6, upper: 7 }), message('Please state all extremes.'));
    const body = await turn(answer);
    const offered = cards(body);
    expect.soft(offered).toEqual([]);
    for (const card of offered) await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect.soft(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
  });

  it.each([false, true])('RC2a-r3 P1 stored floor never validates a fully named current 2-point write (unrelated=%s)', async unrelated => {
    marginLink();
    const held = seedClarification(true);
    const quote = 'Raising prices by £1 will increase gross margin by at least 5 points.';
    held.action = { ...held.action, from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin', quote,
      resolved_reading: 'points', question: bestGuessAsk(quote, 'Prices', 'Gross margin'), floor: { from_id: 'prices', to_id: 'margin',
        value: 5, unit: 'percentage points', reading: 'points', words: 'at least 5 points', per_source_change: 1,
        per_source_change_unit: 'GBP', reading_answer: 'points', source_quote: quote } };
    const other = structuredClone(held);
    other.id = randomUUID(); other.chip_id += ':other';
    other.action = { ...other.action, to_id: 'daily_visits', to_label: 'Daily visits', floor: undefined };
    pending.set(SID, unrelated ? [held, other] : [held]);
    const answer = 'Raising prices by £1 will increase gross margin by 2 points.';
    script.push(calls(['propose_link_effect', { ...marginArgs(answer), amount: 2 }]), message('Review the current figure.'));
    const body = await turn(answer);
    const card = cards(body)[0];
    expect(card, JSON.stringify(body)).toBeDefined();
    await turn(card!.message, { source: 'chip', chip: { id: card!.id } });
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0]!.link_effect.clarification?.floor).toBeUndefined();
    expect(graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'margin').provenance.natural_effect.amount).toBe(2);
  });

  it.each([[5, false], [999, false], [5, true], [999, true]] as const)(
    'RC2a class MUTANT: stored floor %s cannot reach current range sigma or validation (grouped=%s)', async (storedFloor, grouped) => {
      marginLink();
      const held = seedClarification(true);
      const quote = 'Raising prices by £1 will increase gross margin by at least 5 points.';
      held.action = { ...held.action, from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
        quote, resolved_reading: 'points', question: bestGuessAsk(quote, 'Prices', 'Gross margin'), floor: {
          from_id: 'prices', to_id: 'margin', value: storedFloor, unit: 'percentage points', reading: 'points',
          words: `at least ${storedFloor} points`, per_source_change: 1, per_source_change_unit: 'GBP', reading_answer: 'points' } };
      pending.set(SID, [held]);
      const answer = '6, lowest 2, highest 7';
      const args = { ...marginArgs(answer), amount: 6, lower: 2, upper: 7 };
      script.push(calls(['propose_link_effect', grouped ? { links: [args] } : args]), message('Review all current figures.'));
      const body = await turn(answer);
      const card = cards(body)[0];
      expect(card, JSON.stringify(body)).toBeDefined();
      await turn(card!.message, { source: 'chip', chip: { id: card!.id } });
      const written = doorCalls[0]!.link_effect;
      expect.soft(written.clarification.floor).toBeUndefined();
      const edge = graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'margin');
      expect(edge.provenance.natural_effect.amount).toBe(6);
      const fit = statedRangeSpread(2, 7, 0.9);
      if (!fit.ok) throw new Error(fit.refusal);
      expect(edge.strength.std * 6 / edge.strength.mean).toBeCloseTo(fit.std, 10);
      expect(edge.provenance).toMatchObject({ stated_effect_lower: 2, stated_effect_upper: 7, stated_effect_std: fit.std });
      expect(edge.provenance.stated_effect_floor).toBeUndefined();
    },
  );

  it('RC2a audit RED: the card preserves the signs of both current plausible extremes', async () => {
    marginLink();
    const held = seedClarification(true);
    held.action = { ...held.action, from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
      quote: 'Raising prices by £1 will increase gross margin by 5 points.', resolved_reading: 'points',
      question: bestGuessAsk('Raising prices by £1 will increase gross margin by 5 points.', 'Prices', 'Gross margin') };
    pending.set(SID, [held]);
    const answer = '-6, [-7, -2]';
    script.push(calls(['propose_link_effect', { ...marginArgs(answer), amount: -6, lower: -7, upper: -2 }]), message('Review the current range.'));
    const body = await turn(answer);
    const card = cards(body)[0]!;
    expect(card, JSON.stringify(body)).toBeDefined();
    expect(card.detail).toContain('plausible extremes are −7');
    expect(card.detail).toContain('and −2');
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'margin').provenance)
      .toMatchObject({ stated_effect_lower: -7, stated_effect_upper: -2, natural_effect: { amount: -6 } });
  });

  const R2_STORED_WORDS = [
    'Raising prices by £1 will increase gross margin by 5%',
    'I reject this claim: Raising prices by £1 will increase gross margin by 5%',
    'Raising prices by £1 will produce at least a 5 percentage point increase in gross margin.',
    'Raising prices by £1 will increase gross margin by at least roughly 5 points.',
    'As I said, raising prices by £1 will increase gross margin by 5 points',
    'Our supplier says raising prices by £1 will increase gross margin by 5 points.',
  ];
  it.each(R2_STORED_WORDS)('r2 RED: stored words cannot license a reading-only card or write (%s)', async quote => {
    marginLink();
    const before = structuredClone(graph);
    const stored = seedClarification(true);
    stored.action = { ...stored.action, from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
      quote, source_text: quote, question: bestGuessAsk(quote, 'Prices', 'Gross margin') };
    pending.set(SID, [stored]);
    // Deliberately hostile provider replay: the figure is present only in the carrier/tool arguments.
    script.push(calls(['propose_link_effect', marginArgs(quote)]), message('Please supply your best guess.'));
    const body = await turn('Percentage points');
    const offered = cards(body);
    expect.soft(offered).toEqual([]);
    // Mutants that restore quote authority must also cross approval and the canonical writer.
    for (const card of offered) await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect.soft(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ quote, resolved_reading: 'points',
      question: bestGuessAsk(quote, 'Prices', 'Gross margin') });
    expect(body.assistant_text).toContain(bestGuessAsk(quote, 'Prices', 'Gross margin'));
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
  });

  it.each([
    'I reject this claim: Raising prices by £1 will increase gross margin by 5%',
    'As I said, raising prices by £1 will increase gross margin by 5 points',
    'Our supplier says raising prices by £1 will increase gross margin by 5 points.',
  ])('r2 RED: any refused named-link statement arms a neutral question (%s)', async quote => {
    marginLink();
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', { ...marginArgs(quote), amount_unit: '%' }]), message('Please supply your best guess.'));
    const body = await turn(quote);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ quote, question: bestGuessAsk(quote, 'Prices', 'Gross margin') });
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
  });

  it.each([
    ['zero source denominator', { per_source_change: 0 }],
    ['empty target unit', { amount_unit: '' }],
    ['non-verbatim provider quote', { quote: 'The price change will affect the margin.' }],
  ] as const)('any-refusal CONTROL: malformed provider %s preserves the user’s actual named-link words', async (_kind, malformed) => {
    marginLink();
    const quote = 'Raising prices by £1 will increase gross margin by 5 points.';
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', { ...marginArgs(quote), ...malformed }]), message('Please give your best guess.'));
    const initial = await turn(quote);
    expect(initial._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(cards(initial)).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ from_id: 'prices', to_id: 'margin', quote,
      question: bestGuessAsk(quote, 'Prices', 'Gross margin') });
    expect(initial.assistant_text).toContain(bestGuessAsk(quote, 'Prices', 'Gross margin'));
    // Even when the provider repairs its own malformed args, the prior words stay context only.
    script.push(calls(['propose_link_effect', marginArgs(quote)]), message('Please supply a current guess.'));
    const reading = await turn('points');
    expect(cards(reading)).toEqual([]);
    expect(clarifications()[0]!.action.question).toBe(bestGuessAsk(quote, 'Prices', 'Gross margin'));
    expect(reading.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
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
    script.push(calls(['propose_link_effect', { ...args, amount: 2, per_source_change: 1, quote: 'My best guess is 2 points.' }]), message('Review this figure.'));
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
    'at least roughly 5 points',
  ];
  it.each(REVIEW_BOUNDS)('bound-as-mean RED: a current bounded statement asks, without a card or write (%s)', async bound => {
    marginLink();
    const quote = `Raising prices by £1 will increase gross margin by ${bound}.`;
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', marginArgs(quote)]), message('Please give your best guess.'));
    const body = await turn(quote);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ quote, question: bestGuessAsk(quote, 'Prices', 'Gross margin') });
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
  });

  it('r2 RED: “produce at least a 5 percentage point increase” remains a bound, never a mean', async () => {
    marginLink();
    const quote = 'Raising prices by £1 will produce at least a 5 percentage point increase in gross margin.';
    script.push(calls(['propose_link_effect', marginArgs(quote)]), message('Please give your best guess.'));
    const body = await turn(quote);
    expect(cards(body)).toEqual([]);
    expect(clarifications()[0]!.action.question).toBe(bestGuessAsk(quote, 'Prices', 'Gross margin'));
    expect(doorCalls).toEqual([]);
  });

  it.each(['more than', 'over'])('strict floor CONTROL: the current equality guess is a point independent of the recorded minimum (%s)', async comparator => {
    marginLink();
    const quote = `Raising prices by £1 will increase gross margin by ${comparator} 5 points.`;
    script.push(calls(['propose_link_effect', marginArgs(quote)]), message('Please give your best guess.'));
    await turn(quote);
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 5, exclusive: true });
    const answer = 'My best guess is 5 points.';
    script.push(calls(['propose_link_effect', marginArgs(answer)]), message('Review your current guess.'));
    const body = await turn(answer);
    const card = cards(body)[0]!;
    expect(card, JSON.stringify(body)).toBeDefined();
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0]!.link_effect.clarification?.floor).toBeUndefined();
    expect(graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'margin').provenance.natural_effect.amount).toBe(5);
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

  it('R1 RED: Paul’s exact statement offers churn=4% and carries the unresolved effect verbatim', async () => {
    script.push(calls(['propose_link_effect', PAUL_ARGS], ['propose_assumptions', { assumptions: [{ factor_label: 'Monthly churn', value: 4, unit: '%',
      basis: 'Our current churn is 4%', revise: true }] }]), message('Here is the current churn figure to record.'));
    const body = await turn(PAUL);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_assumptions', ok: true }));
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    const currentLevelCard = cards(body)[0]!;
    expect(currentLevelCard).toBeDefined();
    expect(JSON.stringify(currentLevelCard)).toContain('Monthly churn');
    expect(JSON.stringify(currentLevelCard)).toMatch(/4\s*%/);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ kind: 'elicit_link_effect_clarification', from_id: 'pro_plan_price',
      to_id: 'monthly_churn', quote: PAUL_QUOTE, question: expect.any(String), refusal: expect.any(String) });
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect((answerWrite().pending_actions ?? []).some(p => p.action.kind === 'elicit_link_effect_clarification')).toBe(true);
    const initial = structuredClone(clarifications()[0]!);
    const approved = await turn(currentLevelCard.message, { source: 'chip', chip: { id: currentLevelCard.id } });
    expect(approved._diagnostic_trace.fast_path).toBe('approve');
    expect(graph.nodes.find((n: Json) => n.id === 'monthly_churn').observed_state).toMatchObject({ raw_value: 4, source: 'user_override' });
    expect(clarifications()).toEqual([initial]);
  });

  it.each([
    ['points', { per_source_change: 0 }],
    ['relative', { per_source_change: 0 }],
    ['points', { amount_unit: '' }],
  ] as const)('grouped-malformed CONTROL: a current %s reply advances context before rejecting provider figures', async (reading, malformed) => {
    script.push(calls(['propose_link_effect', PAUL_ARGS]), message('Please clarify the reading.'));
    const initial = await turn(PAUL);
    expect(cards(initial)).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    const before = structuredClone(graph);
    script.push(calls(['propose_link_effect', { links: [{ ...PAUL_ARGS, ...malformed }] }]), message('Please give your best guess.'));
    const body = await turn(reading);
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(graph).toEqual(before);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ quote: PAUL_QUOTE, resolved_reading: reading, question: SCIENCE_ASK });
    expect(body.assistant_text).toContain(SCIENCE_ASK);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
  });

  const frameForCurrentUnitAnswers = (): void => {
    // This acceptance brief compares £49 with £50 (plus a £49.50 alternative). A 50-pound source
    // frame and the natural 100-point churn frame represent 2 points per £1 at beta=1. The served
    // source's 200-pound frame would require beta=4, which the existing factor-refit guard refuses.
    const price = graph.nodes.find((n: Json) => n.id === 'pro_plan_price');
    price.observed_state = { ...price.observed_state, cap: 50, raw_value: 49, value: 49 / 50 };
    for (const [id, level, label] of [
      ['raise_to_59', 50, 'Raise to £50'], ['raise_to_54', 49.5, 'Raise to £49.50'],
    ] as const) {
      const option = graph.nodes.find((n: Json) => n.id === id);
      option.label = label;
      option.interventions.pro_plan_price = { ...option.interventions.pro_plan_price, raw_value: level,
        value: level / 50, unit: '£ per subscriber per month' };
    }
    const decision = graph.nodes.find((n: Json) => n.kind === 'decision');
    decision.label = 'Should we raise the Pro plan price?';
    decision.description = 'Should we raise our Pro plan price from £49 to £50 a month?';
  };
  const resolvedFloor = async (reading = 'points', seed = true): Promise<Json> => {
    frameForCurrentUnitAnswers();
    if (seed) seedClarification();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount_unit: 'percentage points' }]), message('Please give your best guess.'));
    const body = await turn(reading);
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
    const ask = clarifications()[0]!;
    expect(ask.action).toMatchObject({ quote: PAUL_QUOTE, resolved_reading: 'points', question: SCIENCE_ASK,
      floor: { value: 1, unit: 'percentage points', reading: 'points', per_source_change: 1, words: 'at least 1 point' } });
    expect(body.assistant_text).toContain(SCIENCE_ASK);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    return structuredClone(ask);
  };
  const effectEdge = (): Json => graph.edges.find((e: Json) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
  it.each([false, true])('RC2a-fix2 P1 selected lineage C arriving after snapshot A is consumed exactly (grouped=%s)', async grouped => {
    const a = await resolvedFloor();
    const c = structuredClone(a);
    c.id = randomUUID();
    c.chip_id = `agent-link-effect-clarification:${c.id}`;
    c.emitted_at_iso = new Date(Date.now() + 1).toISOString();
    const quote = PAUL_QUOTE.replace('1%', '3 points');
    c.action = { ...c.action, lineage_id: c.id, quote, source_text: quote,
      question: bestGuessAsk(quote, 'Pro plan price', 'Monthly churn'),
      floor: { ...c.action.floor, value: 3, words: 'at least 3 points', source_quote: quote } };
    beforeProviderReply = () => pending.set(SID, [c]);
    const answer = 'Every £1 Pro plan price rise raises monthly churn by 2 points.';
    const args = { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points', per_source_change: 1, quote: answer };
    script.push(calls(['propose_link_effect', grouped ? { links: [args] } : args]), message('Review your current figure.'));
    const body = await turn(answer);
    expect(cards(body), JSON.stringify(body)).toHaveLength(1);
    expect(body.assistant_text).toContain('Earlier you said ‘at least 3 points’; Olumi now uses your latest figures.');
    expect(clarifications()).toEqual([]);
    expect(doorCalls).toEqual([]);
  });
  it.each([false, true])('RC2a-fix2 P1 refused lineage C arriving after snapshot A keeps its lineage and lifetime (grouped=%s)', async grouped => {
    const a = await resolvedFloor();
    const c = structuredClone(a);
    c.id = randomUUID();
    c.chip_id = `agent-link-effect-clarification:${c.id}`;
    c.emitted_at_iso = new Date(Date.parse(a.emitted_at_iso) + 1).toISOString();
    c.expires_at_iso = new Date(Date.now() + 60_000).toISOString();
    c.expires_at_turn_count = 2;
    const quote = PAUL_QUOTE.replace('1%', '3%');
    c.action = { ...c.action, lineage_id: c.id, quote, source_text: quote, resolved_reading: 'relative',
      question: bestGuessAsk(quote, 'Pro plan price', 'Monthly churn') };
    delete c.action.floor;
    beforeProviderReply = () => pending.set(SID, [c]);
    const args = { ...PAUL_ARGS, amount: 4, amount_unit: 'percentage points', per_source_change: 1, quote: '4' };
    script.push(calls(['propose_link_effect', grouped ? { links: [args] } : args]), message('Please state your current figure.'));
    const body = await turn('4');
    expect(cards(body)).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action.lineage_id).toBe(c.id);
    expect(clarifications()[0]!.expires_at_iso).toBe(c.expires_at_iso);
    expect(clarifications()[0]!.expires_at_turn_count).toBe(1);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(doorCalls).toEqual([]);
  });
  const guessCard = async (answer: string, guess: number, extra: Json = {}): Promise<Json> => {
    providerBodies.length = 0;
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: guess, amount_unit: 'percentage points',
      per_source_change: 1, quote: answer, ...extra }]), message('Review your best guess.'));
    const body = await turn(answer);
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: 'propose_link_effect' });
    const card = cards(body)[0];
    expect(card, JSON.stringify(body)).toBeDefined();
    expect(card.detail).toContain(answer);
    expect(doorCalls).toEqual([]);
    return card!;
  };

  describe.each([false, true])('Science 393023 latest figures (grouped=%s)', grouped => {
    it.each([
      ['0.5, lowest 0.2, highest 2', 0.5, 0.2, 2, true],
      ['2, lowest 1, highest 3', 2, 1, 3, false],
      ['2, lowest 0.2, highest 3', 2, 0.2, 3, true],
      ['My best guess is 0.5 points.', 0.5, undefined, undefined, true],
    ] as const)('stored floor is disclosure only: %s', async (answer, guess, lower, upper, disclose) => {
      await resolvedFloor();
      const args = { ...PAUL_ARGS, amount: guess, amount_unit: 'percentage points', per_source_change: 1,
        quote: answer, ...(lower === undefined ? {} : { lower, upper }) };
      script.push(calls(['propose_link_effect', grouped ? { links: [args] } : args]), message('Review your best guess.'));
      const body = await turn(answer);
      const card = cards(body)[0]!;
      expect(card, JSON.stringify(body)).toBeDefined();
      expect(card.detail).toContain(`→ +${guess} percentage points`);
      const sentence = 'Earlier you said ‘at least 1 point’; Olumi now uses your latest figures.';
      expect.soft(body.assistant_text.includes(sentence)).toBe(disclose);
      expect.soft(answerWrite().assistantMessage).toBe(body.assistant_text);
      expect(doorCalls).toEqual([]);
      await turn(card.message, { source: 'chip', chip: { id: card.id } });
      expect(doorCalls).toHaveLength(1);
      expect(doorCalls[0]!.link_effect.clarification.floor).toBeUndefined();
      const edge = effectEdge();
      expect(edge.provenance.natural_effect.amount).toBe(guess);
      expect(edge.provenance.stated_effect_floor).toBeUndefined();
      if (lower !== undefined && upper !== undefined) {
        const spread = statedRangeSpread(lower, upper, 0.9);
        if (!spread.ok) throw new Error(spread.refusal);
        expect(edge.strength.std * guess / edge.strength.mean).toBeCloseTo(spread.std, 10);
        expect(edge.provenance).toMatchObject({ stated_effect_lower: lower, stated_effect_upper: upper,
          stated_effect_std: spread.std });
      }
    });
  });

  it('Paul RED: exact statement → points → best-guess ask → incomplete “2, at most 3” asks once → current triplet card and canonical write', async () => {
    frameForCurrentUnitAnswers();
    script.push(calls(['propose_link_effect', PAUL_ARGS]), message('Please clarify the reading.'));
    const initial = await turn(PAUL);
    expect(cards(initial)).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    await resolvedFloor('points', false);
    const incomplete = '2, at most 3';
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points',
      quote: incomplete, upper: 3 }]), message('Please give both current extremes.'));
    const questioned = await turn(incomplete);
    expect(cards(questioned)).toEqual([]);
    expect(questioned.assistant_text.match(/\?/g)).toHaveLength(1);
    const answer = '2, lowest 0.5, highest 3';
    const card = await guessCard(answer, 2, { lower: 0.5, upper: 3 });
    expect(card.detail).toContain('0.5');
    expect(clarifications()).toEqual([]);
    const approved = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(approved._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true }));
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0]!.link_effect).toMatchObject({ quote: answer, effect: { amount: 2, per_source_change: 1 },
      clarification: { current_turn: true, quote: answer, answer, reading: 'points', lower: 0.5, upper: 3 } });
    const edge = effectEdge();
    expect(edge.provenance.natural_effect).toMatchObject({ amount: 2, amount_unit: 'percentage points', per_source_change: 1 });
    expect(edge.provenance.source_quote).toBe(answer);
    const fit = statedRangeSpread(0.5, 3, 0.9);
    if (!fit.ok) throw new Error(fit.refusal);
    expect(Math.abs(edge.strength.std * 2 / edge.strength.mean - fit.std)).toBeLessThan(1e-9);
  });

  it('r2 mixed-frames RED: option raw £5 and current normalised 0.3 never invent a £4.70 source change', async () => {
    marginLink();
    graph.nodes.find((n: Json) => n.id === 'prices').observed_state = { value: 0.3, cap: 10, unit: 'GBP', source: 'brief_extraction' };
    graph.nodes.find((n: Json) => n.id === 'raise_prices').interventions.prices = { raw_value: 5, unit: 'GBP', source: 'user_specified' };
    const quote = 'Raising prices will increase gross margin by at least 1 point with this price increase.';
    const args = { ...marginArgs(quote), amount: 1 };
    script.push(calls(['propose_link_effect', args]), message('Please give your best guess.'));
    const first = await turn(quote);
    expect(cards(first)).toEqual([]);
    expect(clarifications()[0]!.action.floor).toMatchObject({ per_source_change: 1 });
    script.push(calls(['propose_link_effect', args]), message('Please give your best guess.'));
    const reading = await turn('points');
    expect(cards(reading)).toEqual([]);
    expect(doorCalls).toEqual([]);
    const answer = '2 points';
    script.push(calls(['propose_link_effect', { ...args, amount: 2, quote: answer }]), message('Review your best guess.'));
    const offered = await turn(answer);
    const card = cards(offered)[0]!;
    expect(card, JSON.stringify(offered)).toBeDefined();
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(doorCalls[0]!.link_effect.effect.per_source_change).toBe(1);
    expect(graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'margin').provenance.natural_effect)
      .toMatchObject({ amount: 2, per_source_change: 1 });
  });

  it('Café RED: relative asks for the current figure; “about 4 fewer visits a day” supplies the card and write', async () => {
    graph = cafeGraph();
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Please clarify the reading.'));
    await turn(CAFE_QUOTE);
    expect(clarifications()).toHaveLength(1);
    script.push(calls(['propose_link_effect', CAFE_ARGS]), message('Please supply your best guess.'));
    const reading = await turn('relative');
    const ask = bestGuessAsk(CAFE_QUOTE, 'Prices', 'Daily visits');
    expect(cards(reading)).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(clarifications()[0]!.action).toMatchObject({ quote: CAFE_QUOTE, resolved_reading: 'relative', question: ask });
    expect(reading.assistant_text).toContain(ask);
    expect(reading.assistant_text.match(/\?/g)).toHaveLength(1);
    const answer = 'about 4 fewer visits a day';
    script.push(calls(['propose_link_effect', { ...CAFE_ARGS, amount: -4, amount_unit: 'visits per day', quote: answer }]), message('Review your best guess.'));
    const offered = await turn(answer);
    const card = cards(offered)[0]!;
    expect(card, JSON.stringify(offered)).toBeDefined();
    expect(card.detail).toContain(answer);
    expect(clarifications()).toEqual([]);
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(doorCalls[0]!.link_effect).toMatchObject({ quote: answer, effect: { amount: -4, amount_unit: 'visits per day', per_source_change: 1 },
      clarification: { current_turn: true, quote: answer, answer, reading: 'relative' } });
    const edge = graph.edges.find((e: Json) => e.from === 'prices' && e.to === 'daily_visits');
    expect(edge.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', source_quote: answer,
      natural_effect: { amount: -4, amount_unit: 'visits per day', per_source_change: 1 } });
  });

  it('relative CONTROL: a current answer that is not in the link’s own units asks again with no conversion', async () => {
    graph = cafeGraph();
    const held = seedClarification(true);
    held.action = { ...held.action, resolved_reading: 'relative', question: bestGuessAsk(CAFE_QUOTE, 'Prices', 'Daily visits') };
    pending.set(SID, [held]);
    const answer = 'My best guess is 4%.';
    script.push(calls(['propose_link_effect', { ...CAFE_ARGS, amount: -4, quote: answer }]), message('Please give the change in visits per day.'));
    const body = await turn(answer);
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
    expect(clarifications()).toHaveLength(1);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
  });

  it.each([0.5, 1, 1.5])('floor disclosure CONTROL: Runs change no size and disclose only a current effect below the floor (%s points)', async current => {
    frameForCurrentUnitAnswers();
    const edge = effectEdge();
    edge.strength.mean = current / 2;
    edge.provenance.natural_effect.amount = current;
    edge.provenance.natural_effect.per_source_change = 1;
    edge.provenance.natural_effect.strength_mean = edge.strength.mean;
    const before = structuredClone(edge);
    const held = await resolvedFloor();
    const body = await run();
    const disclosure = "Olumi's current figure for how much ‘Pro plan price’ affects ‘Monthly churn’ is below your ‘at least 1 point’, so this Run likely understates churn and may flatter the price rise.";
    if (current < 1) {
      const face = body._answer_shape === undefined ? body.assistant_text
        : [body._answer_shape.headline, ...body._answer_shape.bullets].join('\n');
      expect(face).toContain(disclosure);
    }
    else expect(body.assistant_text).not.toContain(disclosure);
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(effectEdge()).toEqual(before);
    expect(doorCalls).toEqual([]);
  });

  it.each([
    [500, false, false],
    [500, false, true],
    [200, false, false],
    [200, false, true],
    [200, true, false],
  ] as const)('RC2a-fix2 P2 Run floor warning requires this Run to return analysis (HTTP %s, result=%s, prior result=%s)', async (status, hasResult, priorResult) => {
    await resolvedFloor();
    const edge = effectEdge();
    edge.strength.mean = 0.25;
    edge.provenance.natural_effect.amount = 0.5;
    edge.provenance.natural_effect.per_source_change = 1;
    edge.provenance.natural_effect.strength_mean = edge.strength.mean;
    const before = structuredClone(edge);
    if (priorResult) {
      runRead = {
        analysis_state: { run_state: { kind: 'complete_current', computed_at: now() }, leader_claim: { permitted: false } },
        analysis_result: { type: 'analysis_result', computed_against_hash: hash(), summary: 'An earlier result.' },
      };
    }
    runStatus = status;
    runHasResult = hasResult;
    const body = await run();
    if (status === 200 && hasResult) expect(body.assistant_text).toContain('this Run likely understates churn');
    else expect(body.assistant_text).not.toContain('this Run likely understates churn');
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(effectEdge()).toEqual(before);
    expect(doorCalls).toEqual([]);
  });

  it('guess-only CONTROL: a current guess writes its point without any stored floor or invented range', async () => {
    await resolvedFloor();
    const card = await guessCard('My best guess is 2 points.', 2);
    const body = await turn(card.message, { source: 'chip', chip: { id: card.id } });
    const edge = effectEdge();
    expect(edge.provenance.natural_effect.amount).toBe(2);
    expect(edge.strength.std).toBeCloseTo(Math.abs(edge.strength.mean) / 2, 12);
    expect(edge.provenance.stated_effect_floor).toBeUndefined();
    expect(edge.provenance.stated_effect_upper).toBeUndefined();
    expect(edge.provenance.natural_effect.stated_range).toBeUndefined();
    expect(body.assistant_text).toContain('My best guess is 2 points.');
  });

  it.each(['', 'Here is my estimate. '])('full-current-statement CONTROL: a verbatim current quote span sizes the link independently of its recorded floor (prefix=%s)', async prefix => {
    await resolvedFloor();
    const quote = 'Every £1 Pro plan price rise raises monthly churn by 2 points.';
    const currentText = `${prefix}${quote}`;
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points',
      per_source_change: 1, quote }]), message('Review your best guess.'));
    const offered = await turn(currentText);
    const card = cards(offered)[0]!;
    expect(card, JSON.stringify(offered)).toBeDefined();
    expect(card.detail).toContain(quote);
    expect(card.detail).not.toContain('Your recorded floor');
    expect(doorCalls).toEqual([]);
    expect(clarifications()).toEqual([]);
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(doorCalls).toHaveLength(1);
    expect(doorCalls[0]!.link_effect).toMatchObject({ quote, effect: { amount: 2, per_source_change: 1 },
      clarification: { current_turn: true, quote } });
    const edge = effectEdge();
    expect(edge.provenance.source_quote).toBe(quote);
    expect(edge.provenance.natural_effect).toMatchObject({ amount: 2, amount_unit: 'percentage points', per_source_change: 1 });
    expect(edge.provenance.stated_effect_floor).toBeUndefined();
    expect(edge.strength.std).toBeCloseTo(Math.abs(edge.strength.mean) / 2, 12);
    expect(edge.provenance.stated_effect_upper).toBeUndefined();
    expect(edge.provenance.natural_effect.stated_range).toBeUndefined();
  });

  it('resolved-floor CONTROL: “1 point” in the next turn is the current numeric guess, not a reading-only reply', async () => {
    await resolvedFloor();
    const answer = '1 point';
    const card = await guessCard(answer, 1);
    expect(clarifications()).toEqual([]);
    await turn(card.message, { source: 'chip', chip: { id: card.id } });
    expect(doorCalls[0]!.link_effect).toMatchObject({ quote: answer, effect: { amount: 1, per_source_change: 1 },
      clarification: { current_turn: true, quote: answer, answer, reading: 'points' } });
    expect(effectEdge().provenance.natural_effect.amount).toBe(1);
  });

  it.each([
    ['My best guess is 0.5 points; the lowest it could plausibly be is 1 point; the highest it could plausibly be is 3 points.', 0.5, 3, 'outside_stated_bounds'],
    ['My best guess is 4 points; the lowest it could plausibly be is 1 point; the highest it could plausibly be is 3 points.', 4, 3, 'outside_stated_bounds'],
    ['My best guess is 1 point; the lowest it could plausibly be is 1 point; the highest it could plausibly be is 1 point.', 1, 1, 'RANGE_ZERO_WIDTH'],
  ])('invalid-range CONTROL: current guess or helper refusal keeps the floor (%s)', async (answer, guess, upper, refusal) => {
    const held = await resolvedFloor();
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: guess, amount_unit: 'percentage points',
      per_source_change: 1, quote: answer, upper }]), message('Please clarify your guess.'));
    const body = await turn(answer);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false, refusal }));
    expect(cards(body)).toEqual([]);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(doorCalls).toEqual([]);
  });

  it('floor CONTROL: a placeholder without natural-effect metadata still discloses a current figure below the floor', async () => {
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

  it('writer CONTROL: a broad current-turn range is checked before any approval is offered', async () => {
    graph.nodes.find((n: Json) => n.id === 'monthly_churn').observed_state = { raw_value: 4, value: 0.04, cap: 100, unit: '%', source: 'user_override' };
    const held = await resolvedFloor();
    const answer = 'My best guess is 2 points; the lowest it could plausibly be is 1 point; the highest it could plausibly be is 50 points.';
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount: 2, amount_unit: 'percentage points',
      per_source_change: 1, quote: answer, upper: 50 }]), message('That range cannot hold across these options.'));
    const body = await turn(answer);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false, refusal: 'out_of_domain' }));
    expect(cards(body)).toEqual([]);
    expect(clarifications()[0]!.action.floor).toEqual(held.action.floor);
    expect(doorCalls).toEqual([]);
  });

  it('B9 RED: an explicit one-point bound immediately asks with the user’s exact words', async () => {
    const quote = PAUL_QUOTE.replace('increase 1%', 'increase 1 point');
    script.push(calls(['propose_link_effect', { ...PAUL_ARGS, amount_unit: 'percentage points', quote }]), message('Please give your guess.'));
    const body = await turn(quote);
    const ask = bestGuessAsk(quote, 'Pro plan price', 'Monthly churn');
    expect(clarifications()[0]!.action.question).toBe(ask);
    expect(clarifications()[0]!.action.floor).toMatchObject({ value: 1, reading: 'points', unit: 'percentage points',
      per_source_change: 1, words: 'at least 1 point' });
    expect(body.assistant_text).toContain(ask);
    expect(cards(body)).toEqual([]);
    expect(doorCalls).toEqual([]);
  });

  it('G1 CONTROL: grouped refusal carries the exact words and one delivered question', async () => {
    graph = cafeGraph();
    script.push(calls(['propose_link_effect', { links: [CAFE_ARGS] }]), message('Please clarify this reading.'));
    const body = await turn(CAFE_QUOTE);
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_effect', ok: false }));
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]!.action).toMatchObject({ from_id: 'prices', to_id: 'daily_visits', quote: CAFE_QUOTE,
      refusal: 'unit_mismatch' });
    expect(body.assistant_text).toContain(clarifications()[0]!.action.question);
    expect(body.assistant_text.match(/\?/g)).toHaveLength(1);
    expect(doorCalls).toEqual([]);
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

  it('COPY-SHAPE: an effect ask, two capacity lapses and two latest-figures receipts still shape through the real door', async () => {
    graph = cafeGraph();
    graph.edges.push({ from: 'prices', to: 'margin', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis' } });
    const values = [['stock', 'Stock', 'items'], ['staff_hours', 'Staff hours', 'hours per week']] as const;
    for (const [id, label, unit] of values) {
      graph.nodes.push({ id, label, kind: 'factor', category: 'observable', observed_state: {
        raw_value: 100, value: 0.1, cap: 1000, unit, source: 'brief_extraction' } });
    }
    for (const [_id, label, unit] of values) {
      script.push(calls(['propose_assumptions', { assumptions: [{ factor_label: label, value: 101, unit,
        basis: 'The figure the user supplied.', revise: true }] }]), message('Please review this value.'));
      await turn(`Set ${label} to 101 ${unit}.`);
    }
    const holds = (pending.get(SID) ?? []).filter((p: any) => p.action?.inline_patch?.agent_proposal !== undefined);
    expect(holds).toHaveLength(2);
    const base = seedClarification(true);
    const effects = [
      { from_id: 'prices', to_id: 'margin', from_label: 'Prices', to_label: 'Gross margin',
        quote: 'Each £1 rise in Prices increases Gross margin by 3%.', question: 'Is that three points or 3% relative?' },
      { from_id: 'daily_visits', to_id: 'margin', from_label: 'Daily visits', to_label: 'Gross margin',
        quote: 'Each 1% increase in Daily visits lifts Gross margin by 2%.', question: 'Is that two points or 2% relative?' },
      { ...base.action },
    ].map((action, i) => {
      const id = randomUUID();
      return { ...structuredClone(base), id, chip_id: `agent-link-effect-clarification:${id}`,
        action: { ...base.action, ...action, source_text: action.quote },
        emitted_at_iso: new Date(Date.now() - (3 - i) * 60_000).toISOString() };
    });
    pending.set(SID, [...holds, ...effects]);
    const latest = ['at least 3 points', 'at least 2 points']
      .map(words => `Earlier you said ‘${words}’; Olumi now uses your latest figures.`);
    replySeam.result = { assistant_text: 'The model keeps your open statement. The team can review the remaining assumptions together and compare them with evidence before relying on this model.',
      items: [], tool_calls: [{ name: 'propose_link_effect', ok: true, mutated: false }],
      tool_results: [{ ok: true, mutated: false, link_effect_clarifications: [effects[2]!.action],
        link_effect_latest_figure_disclosures: latest }], mutated: false, hops: 1, stopped_reason: 'answered', timing: {} };
    const body = await turn('Keep the remaining effect question visible.');
    expect(body._answer_shape).toBeDefined();
    const shape = body._answer_shape;
    const face = [shape.headline, ...shape.bullets].join('\n');
    expect(shape.bullets).toHaveLength(3);
    expect(face).toContain(CAFE_QUESTION);
    for (const effect of effects.slice(0, 2)) {
      const lapse = `I've set aside your earlier statement about how ‘${effect.action.from_label}’ affects ‘${effect.action.to_label}’; say it again whenever you want it in the model.`;
      expect(face).toContain(lapse);
      expect(body.assistant_text.split(lapse)).toHaveLength(2);
    }
    for (const line of latest) {
      expect(shape.detail).toContain(line);
      expect(body.assistant_text.split(line)).toHaveLength(2);
    }
    expect(replyShapeLogs.at(-1)).toMatchObject({ outcome: 'shaped', face_over_cap: false });
    expect(deriveAnswerTextFromShape(shape)).toBe(body.assistant_text);
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(clarifications().map(p => p.action.quote)).toEqual([CAFE_QUOTE]);
    expect(doorCalls).toEqual([]);
  });

  it('COPY-SHAPE: the same reply carries the Run floor warning, effect ask, two held lapses and two latest-figures receipts', async () => {
    const floor = await resolvedFloor();
    const values = [['stock', 'Stock', 'items'], ['staff_hours', 'Staff hours', 'hours per week']] as const;
    for (const [id, label, unit] of values) {
      graph.nodes.push({ id, label, kind: 'factor', category: 'observable', observed_state: {
        raw_value: 100, value: 0.1, cap: 1000, unit, source: 'brief_extraction' } });
    }
    for (const [_id, label, unit] of values) {
      script.push(calls(['propose_assumptions', { assumptions: [{ factor_label: label, value: 101, unit,
        basis: 'The figure the user supplied.', revise: true }] }]), message('Please review this value.'));
      await turn(`Set ${label} to 101 ${unit}.`);
    }
    const holds = (pending.get(SID) ?? []).filter((p: any) => p.action?.inline_patch?.agent_proposal !== undefined) as Json[];
    expect(holds).toHaveLength(2);
    for (const hold of holds) hold.expires_at_iso = new Date(Date.now() - 1000).toISOString();
    pending.set(SID, [...holds, floor]);
    const edge = effectEdge();
    edge.strength.mean = 0.25;
    edge.provenance.natural_effect.amount = 0.5;
    edge.provenance.natural_effect.per_source_change = 1;
    edge.provenance.natural_effect.strength_mean = edge.strength.mean;
    const before = structuredClone(graph);
    const latest = ['at least 3 points', 'at least 2 points']
      .map(words => `Earlier you said ‘${words}’; Olumi now uses your latest figures.`);
    replySeam.run = true;
    replySeam.result = { assistant_text: 'The Run keeps the open assumption visible. The team can review the remaining assumptions together and compare them with evidence before relying on this model.',
      items: [], tool_calls: [{ name: 'propose_link_effect', ok: true, mutated: false }],
      tool_results: [{ ok: true, mutated: false, link_effect_clarifications: [floor.action],
        link_effect_latest_figure_disclosures: latest }], mutated: false, hops: 1, stopped_reason: 'answered', timing: {} };
    const body = await turn('Run the analysis with the latest figures.');
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'run_analysis', ok: true }));
    expect(body._answer_shape).toBeDefined();
    const shape = body._answer_shape;
    const face = [shape.headline, ...shape.bullets].join('\n');
    const disclosure = "Olumi's current figure for how much ‘Pro plan price’ affects ‘Monthly churn’ is below your ‘at least 1 point’, so this Run likely understates churn and may flatter the price rise.";
    expect(face).toContain(disclosure);
    expect(face).toContain(SCIENCE_ASK);
    const { heldChangeName } = await import('../proposal-object/record.js');
    const { heldLapseSentence } = await import('../proposal-object/reply.js');
    for (const hold of holds) {
      const lapse = heldLapseSentence(heldChangeName(hold), 'idle');
      expect(body.assistant_text.split(lapse)).toHaveLength(2);
    }
    for (const line of latest) {
      expect(shape.detail).toContain(line);
      expect(body.assistant_text.split(line)).toHaveLength(2);
    }
    expect(replyShapeLogs.at(-1)).toMatchObject({ outcome: 'shaped', face_over_cap: false });
    expect(deriveAnswerTextFromShape(shape)).toBe(body.assistant_text);
    expect(answerWrite().assistantMessage).toBe(body.assistant_text);
    expect(graph).toEqual(before);
    expect(doorCalls).toEqual([]);
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
    prior.action.question = SCIENCE_ASK;
    prior.action.resolved_reading = 'points';
    pending.set(SID, [prior]);
    const first = await run();
    expect(clarifications()).toHaveLength(1);
    expect(clarifications()[0]).toEqual(prior);
    const context = await explain(first);
    const checks = context.limit_checks?.limits as Json[] | undefined;
    expect(checks, JSON.stringify(context)).toBeDefined();
    const churn = checks!.find(r => r.constraint_id === CHURN_LIMIT)!;
    const control = checks!.find(r => r.constraint_id === CONTROL_LIMIT)!;
    expect(churn.ask).toBe(SCIENCE_ASK);
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
