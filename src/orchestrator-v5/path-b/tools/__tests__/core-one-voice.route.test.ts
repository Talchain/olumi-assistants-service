/**
 * ⭐ PATH-B `core`: THE AI IS THE ONE VOICE (DL-3 22:5xZ; Paul: out of the box; both judges FAIL criterion 5 on 548f886f, where a
 * host guidance card asked "Give your estimate" on the link the AI's reply had just said could not hold it). In core mode the
 * turn carries, beside the AI's reply, only the cards of a change waiting for a yes, the AI's own research offers, receipts and
 * blocks: no host guidance card, action bar, gap signal, sizing chip, next step or Run offer. The A lane is unchanged.
 * Harness: the real `/agent/v1/turn` route (as `goal-level-card.route.test.ts`); a scripted AI (0 provider calls). SYNTHETIC.
 */
import { randomUUID, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';

type Json = Record<string, any>;
let SCENARIO = '';
const CORE = { 'x-olumi-ai-mode': 'core' };
const SAID = 'Correction: about 110 a week, not 120.';
const CORRECTION = { public_label: 'Record today’s weekly orders', basis: 'The user corrected the baseline.',
  ops: [{ op: 'set_goal_current_level', goal_id: 'orders', value: 110, unit: 'orders a week', stance: 'stated_current',
    source: { origin: 'user', quote: 'about 110 a week', named_source: null } }] };
const PREPARED_WORDS = 'I have prepared your correction to 110 a week; press its card to save it.';

let persisted: Json;
const registered: Json[] = [];
const graphWrites: Json[] = [];
const turnRows = new Map<string, any>();
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
const identityOf = (g: unknown): string => createHash('sha256').update(JSON.stringify(g)).digest('hex');
const hashOf = (g: unknown): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
/** The goal "Weekly orders" at least 150 a week; today 120, from the brief; the vans on its path are Olumi's estimate (a host guidance item). */
function stored(target = true): Json {
  const options = [
    { id: 'add_vans', kind: 'option', label: 'Lease two more vans', interventions: { vans: { value: 0.5, source: 'brief_extraction', extractionType: 'explicit' } } },
    { id: 'carry_on', kind: 'option', label: 'Carry on as now', interventions: { vans: { value: 0.25, source: 'cee_inference' } }, is_baseline: true },
  ];
  const g = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Delivery capacity' },
      { id: 'orders', kind: 'goal', label: 'Weekly orders', ...(target ? { goal_threshold: 0.8, goal_threshold_raw: 150, goal_threshold_cap: 187.5,
        goal_threshold_unit: 'orders a week', goal_threshold_frame: 'level', goal_direction: 'at_least', goal_threshold_cap_provenance: 'target_derived_headroom' } : {}),
        observed_state: { value: 0.64, baseline: 0.64, raw_value: 120, unit: 'orders a week', cap: 187.5, source: 'brief_extraction' } },
      { id: 'vans', kind: 'factor', label: 'Vans on the road', category: 'controllable',
        observed_state: { value: 0.25, raw_value: 2, unit: 'vans', cap: 8, source: 'cee_inference', extractionType: 'inferred' } },
      ...options,
    ],
    edges: [
      ...options.map((o) => ({ from: 'decision', to: o.id, strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      ...options.map((o) => ({ from: o.id, to: 'vans', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' })),
      { from: 'vans', to: 'orders', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'orders',
  };
  return projectGraphForPersistence({ ...GraphV3.parse(g), options: [] as Json[] }) as Json;
}

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => []),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    if (write.graph !== undefined) { graphWrites.push(write); return { id: `graph-${graphWrites.length}` }; }
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date().toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
};
/** When set, the host guidance selector offers this card (its live trigger needs a measured Run this harness has none of). */
let offeredCard: Json | undefined;
vi.mock('../../../agent-lane/next-steps-from-guidance.js', async (original) => {
  const m = await original<typeof import('../../../agent-lane/next-steps-from-guidance.js')>();
  return { ...m, nextStepOffersForTurn: (...args: Parameters<typeof m.nextStepOffersForTurn>) => {
    const r = m.nextStepOffersForTurn(...args);
    return offeredCard === undefined ? r : { ...r, selection: offeredCard as never };
  } };
});
const GIVE_YOUR_ESTIMATE = { slot1: { policy_id: 'RC-STRENGTHEN-ITEM', priority: 'P1', variant: 'S1', item: 'vans->orders',
  primary_action: { label: 'Give your estimate', action_kind: 'edit_inline', target: 'vans->orders' }, state_key_hash: 'aaaaaaaaaaaa',
  copy: { title: 'A link on the path to your goal has no size yet.', why: 'This link connects vans on the road to weekly orders.',
    question: 'How much do vans on the road change weekly orders?' }, item_ref: { kind: 'link', from_id: 'vans', to_id: 'orders' } } };
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
let preparedId = '';
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: JSON.stringify(item.name === 'apply_change' && item.args === undefined ? { proposal_id: preparedId } : item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PROPOSAL_CONTROL = /^(agent-approve-proposal:|agent-amend-proposal$|agent-decline-proposal:|agent-review-proposal:)/;
const QUESTION = 'What does the model hold for weekly orders today?';
const ANSWER = 'The model holds 120 orders a week today, from your brief.';

describe('PATH-B core: beside the AI\u2019s reply, only its own cards; no host guidance or advice', () => {
  let app: FastifyInstance;
  let calls: Json[] = [];
  let outputs: Json[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_voice', object: 'conversation' });
      calls.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return json(responsesBody(outputs.shift() ?? [{ type: 'message', text: ANSWER }]));
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: persisted, graph_hash: hashOf(persisted),
      graph_identity_hash: { kind: 'graph_identity', value: identityOf(persisted), algorithm: 'sha256' },
      analysis_ready: { status: 'blocked', options: [], blockers: [] } }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: '', suggested_actions: [], insights: [], blocks: [] }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = stored(); registered.length = 0; graphWrites.length = 0; turnRows.clear(); conversationIds.clear();
    pausedRun = null; calls = []; outputs = []; preparedId = ''; offeredCard = GIVE_YOUR_ESTIMATE;
  });
  const post = (payload: Json, headers: Record<string, string> = CORE) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const hostCards = (j: Json): Json => ({ guidance: j.guidance, action_bar: j.action_bar, model_gap: j.model_gap, guided_sizing: j.guided_sizing,
    other_actions: ((j.suggested_actions ?? []) as Json[]).map((a) => String(a.id)).filter((id) => !PROPOSAL_CONTROL.test(id)) });
  const NONE = { guidance: undefined, action_bar: undefined, model_gap: undefined, guided_sizing: undefined, other_actions: [] };

  it('⭐ RED→GREEN: a core correction turn carries its own card and nothing a host composed beside the AI\u2019s reply', async () => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop_call', args: CORRECTION }], [{ type: 'message', text: PREPARED_WORDS }]];
    const r = await post({ turn_id: randomUUID(), message: SAID, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    preparedId = String((j._agent.tool_calls as Json[]).find((c) => c.name === 'propose_change' && c.ok)?.proposal_id ?? '');
    expect((j.suggested_actions as Json[]).map((a) => a.id), 'its own card is kept').toContain(`agent-approve-proposal:${preparedId}`);
    expect(j.assistant_text).toBe(PREPARED_WORDS);
    expect(hostCards(j)).toEqual(NONE);
  });

  it('⭐ RED→GREEN: a core question turn carries the AI\u2019s answer alone', async () => {
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.assistant_text).toBe(ANSWER);
    expect(hostCards(j)).toEqual(NONE);
  });

  it('⭐ RED→GREEN: a goal with no target: no host gap question beside the AI\u2019s answer', async () => {
    persisted = stored(false);
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expect(hostCards(r.json() as Json)).toEqual(NONE);
  });

  it('A-lane contrast: the same turns without the core header still carry the host guidance card, gap question and action bar', async () => {
    persisted = stored(false);
    const r = await post({ turn_id: randomUUID(), message: QUESTION, source: 'composer' }, {});
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j.guidance, 'the A lane is unchanged').toEqual(GIVE_YOUR_ESTIMATE);
    expect(j.model_gap).toMatchObject({ kind: 'goal_target_missing' });
    expect(j.action_bar).toBeDefined();
  });
});
