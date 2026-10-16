/**
 * ⭐ TODAY'S LEVEL DOES NOT DEPEND ON THE TARGET (TL 21:30Z; G1 founder on 829a152b turn 3: "We have no funding" refused
 * `no_target` beside a target held as 1.3 "million (currency unspecified)" with no cap). Through the real /agent/v1/turn route with a
 * scripted provider (the AI asks; the AI calls propose_goal_current_level; the card is pressed; the route registers; a fresh
 * /graph read is the cold readback):
 *  · a level-frame goal whose target has no cap: the user's explicit £0 and £50,000 save on the level's own frame;
 *  · none (0) needs no frame: saved with no cap, beside an unframed target or with no target at all;
 *  · KEPT: a target on another frame still refuses; words with no figure ("We have no funding.") are still no figure of the
 *    user's (that reading is not in this change).
 * SYNTHETIC answers, never an unseen brief. Harness from Relief's native kit (recovery-notes/level-answer-c72fc72c).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import type { SessionTurnWrite } from '../../session/store.js';

const { facade } = vi.hoisted(() => ({ facade: { value: null as unknown } }));
vi.mock('../../session/index.js', async (original) => ({ ...await original<Record<string, unknown>>(), getSessionStore: () => facade.value }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(),
  resolveUserIdentity: async () => ({ mode: 'off' }) }));

type Dict = Record<string, any>;
const SCENARIO = '550e8400-e29b-41d4-a716-4466554400dc';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const TOOL = 'propose_goal_current_level';
const apps: FastifyInstance[] = [];
let stored: Dict;
let writes: SessionTurnWrite[];
let phase: 'ask' | 'propose';
let emitted: boolean;
let question: string;
let args: Dict;
let toolResults: Dict[];

async function world(g: Dict) {
  stored = clone(g); writes = []; toolResults = []; emitted = false; phase = 'ask';
  const recent = () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i}`, scenario_id: w.scenario_id,
    turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
    response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms,
    user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null })).reverse();
  facade.value = createMockSessionStore({
    ensureScenarioExists: async () => ({ user_id: null }), getScenarioOwner: async () => null,
    scenarioExists: async () => true,
    loadGraph: async () => clone(stored), loadGraphAndBriefText: async () => ({ graph: clone(stored), briefText: null }),
    readRecent: async () => recent(), readMostRecentPendingActions: async () => clone(writes.at(-1)?.pending_actions ?? []),
    readFactsWithTurnFor: async (ids) => writes.flatMap((w, i) => ids.includes(`row-${i}`)
      ? w.handler_facts.map((fact) => ({ turn_id: `row-${i}`, fact_created_at: new Date().toISOString(), fact })) : []),
    append: async (w) => { writes.push(clone(w)); if (w.graph !== undefined) stored = clone(w.graph) as Dict; return { id: `row-${writes.length - 1}` }; },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init: { body?: unknown }) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const request = JSON.parse(String(init.body));
    for (const item of request.input ?? []) if (item.type === 'function_call_output') {
      try { toolResults.push(JSON.parse(item.output)); } catch { /* the raw request stays in the assertion messages */ }
    }
    const output = phase === 'propose' && !emitted
      ? [{ type: 'function_call', call_id: 'native-level', name: TOOL, arguments: JSON.stringify(args) }]
      : [{ type: 'message', content: [{ type: 'output_text', text: phase === 'ask' ? question : 'Review the current-level card before it is saved.' }] }];
    emitted = true;
    return new Response(JSON.stringify({ id: `stub-${randomUUID()}`, status: 'completed', output }), { status: 200 });
  }));
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: clone(stored),
    graph_hash: computeAnalysisAffectingGraphHash(stored as never), graph_identity_hash: computeGraphIdentityHash(stored as never) }));
  const register = (await import('../../../routes/assist.v1.scenario-graph-register.js')).default;
  await app.register(register);
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js'); await app.register(agentV1TurnRoute);
  await app.ready();
  const session = `level-reading-${randomUUID()}`;
  return { app, turn: (message: string, chip?: Dict) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, agent_session_id: session, message, ...(chip ? { chip } : {}),
  } }) };
}

/** Press the card, then the cold read: the one written graph equals a fresh /graph read, and that read's goal. */
async function pressAndReopen(w: { app: FastifyInstance; turn: (m: string, c?: Dict) => Promise<any> }, card: Dict) {
  const approved = await w.turn(card.message, card);
  expect(approved.statusCode, approved.body).toBe(200);
  const graphWrites = writes.filter((x) => x.graph !== undefined);
  expect(graphWrites).toHaveLength(1);
  const read = await w.app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
  const cold = clone(read.json().graph);
  expect(graphWrites[0]!.graph).toEqual(cold);
  return { cold, goal: cold.nodes.find((n: Dict) => n.id === 'goal') as Dict };
}

/** A level-frame goal whose target is held but not framed (no cap): the served turn-3 shape, in pounds. */
const unframed = (raw: number | null): Dict => projectGraphForPersistence({ nodes: [
  { id: 'goal', kind: 'goal', label: 'Funding secured', goal_threshold_unit: 'GBP', goal_threshold_frame: 'level', ...(raw === null ? {} : { goal_threshold_raw: raw }) },
  { id: 'pilot', kind: 'option', label: 'Pilot' }, { id: 'effort', kind: 'factor', label: 'Effort' },
], edges: [{ from: 'effort', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] }) as Dict;
async function turnOn(g: Dict, answer: string, given: Dict) {
  question = 'What is today\'s level of Funding secured?';
  args = { goal_label: 'Funding secured', user_stated: true, unit: 'GBP', ...given };
  const w = await world(g);
  await w.turn('Help me understand what is missing.');
  phase = 'propose'; emitted = false;
  const b = (await w.turn(answer)).json();
  return { ...w, b, card: b.suggested_actions?.find((c: Dict) => String(c.id).startsWith('agent-approve-proposal:')) };
}

beforeEach(() => {
  __setUseAppendV6ForTest(false);
  process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
});
afterEach(async () => { while (apps.length) await apps.pop()!.close(); vi.unstubAllGlobals(); });

describe('today\'s level does not depend on the target: AI ask → card → press → register → cold read', () => {
  it('⭐ the explicit "We have £0 funding today." beside an unframed target saves as the user\'s 0, with no frame', async () => {
    const w = await turnOn(unframed(250000), 'We have £0 funding today.', { value: 0 });
    expect(toolResults).not.toContainEqual(expect.objectContaining({ refusal: 'no_target' }));
    expect(w.card, JSON.stringify(toolResults)).toBeDefined();
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 0, value: 0, baseline: 0, unit: 'GBP', source: 'user_override' });
    expect(goal.observed_state).not.toHaveProperty('cap');
    expect(goal).toMatchObject({ goal_threshold_raw: 250000, goal_threshold_frame: 'level' });
  }, 30_000);
  it('a positive level beside the unframed target is recorded on its own frame, as with no target', async () => {
    const w = await turnOn(unframed(250000), 'We have £50,000 secured today.', { value: 50000 });
    expect(w.card, JSON.stringify(toolResults)).toBeDefined();
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 50000, source: 'user_override' });
    expect(goal.observed_state.cap).toBeGreaterThan(50000);
    expect(goal.observed_state.value).toBeCloseTo(50000 / goal.observed_state.cap, 12);
  }, 30_000);
  it('none needs no frame: "We have £0 secured today." with NO target saves as 0 with no cap (was refused no_target)', async () => {
    const w = await turnOn(unframed(null), 'We have £0 secured today.', { value: 0 });
    expect(toolResults).not.toContainEqual(expect.objectContaining({ refusal: 'no_target' }));
    const { goal } = await pressAndReopen(w, w.card);
    expect(goal.observed_state).toMatchObject({ raw_value: 0, value: 0, source: 'user_override' });
    expect(goal.observed_state).not.toHaveProperty('cap');
  }, 30_000);
  it('KEPT: a target on another frame (delta) still refuses no_target; nothing written', async () => {
    const g = unframed(250000); g.nodes.find((n: Dict) => n.id === 'goal').goal_threshold_frame = 'delta';
    const w = await turnOn(g, 'We have £50,000 secured today.', { value: 50000 });
    expect(toolResults).toContainEqual(expect.objectContaining({ ok: false, refusal: 'no_target' }));
    expect(w.card).toBeUndefined();
    expect(writes.filter((x) => x.graph !== undefined)).toHaveLength(0);
  }, 30_000);
  it('KEPT: "We have no funding." writes no figure, so it is still no figure of the user\'s (no card)', async () => {
    const w = await turnOn(unframed(250000), 'We have no funding.', { value: 0 });
    expect(toolResults).toContainEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_in_users_words' }));
    expect(w.card).toBeUndefined();
  }, 30_000);
});
