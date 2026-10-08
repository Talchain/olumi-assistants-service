/** W1 R3: captured founder Run/auto Explain must carry the delivered ask. No provider/DB contacted. */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_LEVEL_TOOL, currentLevelAnswerFirstCall, currentLevelAskOnAnswer, latestCurrentLevelAsk } from '../current-level-answer.js';
import { currentLevelAskForAnswerRow } from '../current-level-ask-carry.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import type { SessionTurnWrite } from '../../session/store.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type Request = { scenario_id: string; turn_id: string; message: string; source: string; chip?: { id?: string; action_type?: string } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/founder-evening-1-current-level-carry.json', import.meta.url), 'utf8')) as {
  requests: { draft: Request; run: Request; explain: Request; sizes: Request };
  graph: Graph; explainText: string;
  run: { graph_hash: string; analysis_state: Record<string, unknown>; analysis_ready: unknown;
    blocks: { type: string; enrichment: { inference_warnings: { first_ask?: { question: string } }[] } }[] } & Record<string, unknown>;
};
const SCENARIO = FX.requests.run.scenario_id;
const GOAL = 'productivity';
const HASH = FX.run.graph_hash;
const RESULT = FX.run.blocks[0]!;
const QUESTION = RESULT.enrichment.inference_warnings.find(w => w.first_ask !== undefined)!.first_ask!.question;
const SIZES = 'We can fit 4 large, 8 medium, 16 small, roughly';
const CHOICE = 'Do you mean a mix of sizes in one sprint, or equivalent capacity of 4 large, 8 medium or 16 small?';
const roundTrip = (p: PendingAction): PendingAction => parsePendingAction(JSON.parse(JSON.stringify(p)))!;
const now = () => new Date().toISOString();
const arm = () => currentLevelAskOnAnswer({ graph: FX.graph, analysisResult: RESULT, sentText: QUESTION,
  scenarioId: SCENARIO, userId: null, emittedAtIso: now(), prior: null, answered: false,
  message: FX.requests.draft.message, awaitingApproval: false })!;
const clarify = (p: PendingAction) => currentLevelAskOnAnswer({ graph: FX.graph, analysisResult: RESULT,
  sentText: CHOICE, scenarioId: SCENARIO, userId: null, emittedAtIso: now(),
  prior: latestCurrentLevelAsk([p], SCENARIO, null), answered: true, message: SIZES, awaitingApproval: false })!;
const selected = (p: PendingAction) => latestCurrentLevelAsk([roundTrip(p)], SCENARIO, null);
const carry = (p: PendingAction, extra: Partial<Parameters<typeof currentLevelAskForAnswerRow>[0]> = {}) =>
  currentLevelAskForAnswerRow({ prior: selected(p), next: null, answered: false, graph: FX.graph,
    graphHash: HASH, nowMs: Date.now(), typedByUser: true, ...extra });
const state = { ok: true, entities: [{ id: GOAL, kind: 'goal', label: GOAL }],
  goal: { id: GOAL, target: { frame: 'change_rel', unit: '%' } } };
const changedGraph = (change: Record<string, unknown>): Graph => ({ ...FX.graph,
  nodes: FX.graph.nodes.map(n => n.id === GOAL ? { ...n, ...change } : n) });

describe('same lifecycle as commit; final-goal licence', () => {
  it('keeps identity and wall expiry; Run, Explain and further non-typed carries preserve TTL', () => {
    const initial = arm();
    const run = carry(initial, { typedByUser: false })!;
    const explain = carry(run, { typedByUser: false })!;
    expect(run).toEqual(initial);
    expect(explain).toEqual(initial);
    expect(carry(explain, { typedByUser: false })).toEqual(initial);
  });
  it('a consumed answer is not carried, but the existing typed clarification can replace it', () => {
    const initial = arm();
    expect(carry(initial, { answered: true })).toBeNull();
    const next = clarify(initial);
    expect(carry(initial, { next: selected(next), answered: true })).toEqual(next);
    expect(next.expires_at_turn_count).toBe(2); // not decremented a second time
    expect(next.expires_at_iso).toBe(initial.expires_at_iso);
  });
  it('typed clarification at the last turn does not persist an exhausted ask', () => {
    const last = { ...arm(), expires_at_turn_count: 1 };
    const next = clarify(last);
    expect(next.expires_at_turn_count).toBe(0);
    expect(carry(last, { next: next as NonNullable<ReturnType<typeof latestCurrentLevelAsk>>, answered: true })).toBeNull();
  });
  it.each([
    { id: 'another-goal' }, { label: 'Revenue' }, { kind: 'factor' },
    { observed_state: { raw_value: 0, unit: 'updates/sprint' } },
    { observed_state: { unit: 'updates/sprint' } },
  ])('drops a changed, removed or filled goal: %j', change => {
    expect(carry(arm(), { graph: changedGraph(change) })).toBeNull();
  });
  it('unavailable final graph cannot carry an answer licence', () => {
    expect(carry(arm(), { graph: undefined })).toBeNull();
  });
  it('a new producer ask supersedes the prior; expiry and hash mismatch are honoured', () => {
    const prior = arm();
    const next = arm();
    expect(carry(prior, { next: selected(next) })).toEqual(next);
    expect(next.id).not.toBe(prior.id);
    expect(carry(prior, { nowMs: Date.parse(prior.expires_at_iso) + 1 })).toBeNull();
    const pinned = { ...prior, preconditions: { ...prior.preconditions, graph_hash: 'other-hash' } };
    expect(carry(pinned)).toBeNull();
  });
  it('DL control: bare sizes remain unforced after carry; qualifying goal prefix reaches the same door', () => {
    const ask = carry(arm());
    expect(currentLevelAnswerFirstCall(state, ask, SIZES, false)).toBeUndefined();
    expect(currentLevelAnswerFirstCall(state, ask, `Productivity: ${SIZES}`, false)).toBe(CURRENT_LEVEL_TOOL);
    expect(currentLevelAnswerFirstCall(state, ask, 'We can fit 6 people in the office.', false)).toBeUndefined();
  });
});

// Latest pending reads JSON-round-trip exactly what the outer answer wrote. Inner Run rows
// deliberately clear it, reproducing the witnessed persistence boundary and catching a late read.
let pending: PendingAction[] = [];
const writes: SessionTurnWrite[] = [];
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  readRecent: vi.fn(async () => [...writes].reverse().filter(w => w.assistantMessage !== undefined).map(w => ({
    scenario_id: SCENARIO, turn_id: w.turn_id, request_hash: w.request_hash,
    user_message: w.userMessage, assistant_message: w.assistantMessage, created_at: now(),
  }))),
  readMostRecentPendingActions: vi.fn(async () => pending.map(roundTrip)),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: SessionTurnWrite) => {
    writes.push(w);
    rows.set(w.turn_id, { id: w.turn_id, turn_id: w.turn_id, request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null });
    if (!w.turn_id.endsWith(':claim')) pending = [...(w.pending_actions ?? [])].map(roundTrip);
    return { id: w.turn_id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('real Agent final-answer persistence, captured founder requests', () => {
  let app: FastifyInstance;
  let graph: Graph;
  let reply: string;
  let direct: boolean;
  let levelUnit: string;
  let mutateOnRun: Record<string, unknown> | undefined;
  const providerBodies: { tool_choice?: unknown; input?: unknown }[] = [];
  beforeEach(async () => {
    pending = []; writes.length = 0; rows.clear(); providerBodies.length = 0;
    graph = structuredClone(FX.graph); reply = 'Those figures are noted.'; direct = false;
    levelUnit = 'small-update equivalents per sprint'; mutateOnRun = undefined;
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { tool_choice?: { name?: string }; input?: unknown };
      providerBodies.push(body);
      const call = body.tool_choice?.name === CURRENT_LEVEL_TOOL || (direct && providerBodies.length === 1);
      return new Response(JSON.stringify({ output: call ? [{ type: 'function_call', call_id: 'level-answer', name: CURRENT_LEVEL_TOOL,
        arguments: JSON.stringify({ goal_label: GOAL, value: 16, unit: levelUnit, user_stated: true }) }]
        : [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      pending = []; // the inner Run's row, before the Agent's outer answer
      if (mutateOnRun !== undefined) graph = changedGraph(mutateOnRun);
      return FX.run;
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph, graph_hash: HASH,
      analysis_state: FX.run.analysis_state, analysis_ready: FX.run.analysis_ready, analysis_result: RESULT }, SCENARIO));
    await app.register(agentV1TurnRoute); await app.ready();
  }, 120_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); });
  afterAll(() => { delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const turn = async (request: Request | Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: request });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { assistant_text: string; narration?: { status: string }; _diagnostic_trace?: { fast_path?: string };
      _agent?: { tool_calls?: { name: string }[] }; suggested_actions?: { label: string }[] };
  };
  const askOnLatest = () => latestCurrentLevelAsk(pending, SCENARIO, null);
  const draft = async () => {
    reply = QUESTION;
    await turn(FX.requests.draft); // post-constructor served graph; fixed witnessed delivered question
    const ask = askOnLatest();
    expect(ask).not.toBeNull();
    expect(ask!.action.question).toBe(QUESTION);
    reply = 'Those figures are noted.';
    return ask!;
  };
  const run = async () => {
    const body = await turn(FX.requests.run);
    expect(body._diagnostic_trace?.fast_path).toBe('run');
    return body;
  };
  const explain = async () => {
    reply = FX.explainText;
    const body = await turn(FX.requests.explain);
    expect(body._diagnostic_trace?.fast_path).toBe('explain');
    expect(body.narration?.status).toBe('ready'); // proves the captured id binds this Run
    reply = 'Those figures are noted.';
    return body;
  };
  const answer = (message: string) => turn({ ...FX.requests.sizes, turn_id: randomUUID(), message });

  it('RED at base: draft → witnessed Run → auto Explain preserves ask identity, expiry and TTL', async () => {
    const initial = await draft();
    await run();
    expect(askOnLatest()).toEqual(initial);
    await explain();
    expect(askOnLatest()).toEqual(initial);
    expect(writes.every(w => w.graph === undefined)).toBe(true);
  });
  it('RED at base: goal-named SIZES after Run + Explain forces the existing door, then consumes the ask', async () => {
    await draft(); await run(); await explain(); providerBodies.length = 0;
    const body = await answer(`Productivity: ${SIZES}`);
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: CURRENT_LEVEL_TOOL });
    expect(body._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(askOnLatest()).toBeNull();
    expect(writes.every(w => w.graph === undefined)).toBe(true);
  });
  it('RED at base: typed clarified confirmation survives Run and forces the door with its original user quote', async () => {
    await draft(); pending = [roundTrip(clarify(pending[0]!))];
    const initial = askOnLatest()!;
    await run();
    expect(askOnLatest()).toEqual(initial);
    providerBodies.length = 0;
    const body = await answer('The latter.');
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: CURRENT_LEVEL_TOOL });
    // The figures reach the door through the tool context user_text (agent-v1-turn.ts figure_quote), not the model input.
    expect(body._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(askOnLatest()).toBeNull();
  });
  it.each([SIZES, FX.requests.sizes.message, 'We can fit 6 people in the office.'])('CONTROL: "%s" stays unforced after Run', async message => {
    const initial = await draft(); await run(); providerBodies.length = 0;
    const body = await answer(message);
    expect(providerBodies[0]?.tool_choice).toBeUndefined();
    expect(body._agent?.tool_calls ?? []).not.toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(askOnLatest()).toEqual({ ...initial, expires_at_turn_count: 2 });
  });
  it('a model-selected level-door refusal consumes the ask even for the bare witnessed reply', async () => {
    await draft(); await run(); providerBodies.length = 0; direct = true;
    levelUnit = 'an intentionally overlong unrecognised measurement unit for sprint capacity';
    const body = await answer(FX.requests.sizes.message);
    expect(providerBodies[0]?.tool_choice).toBeUndefined();
    expect(body._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL, ok: false }));
    expect(askOnLatest()).toBeNull();
  });
  it.each([{ label: 'Revenue' }, { observed_state: { raw_value: 0, unit: 'updates/sprint' } },
    { observed_state: { unit: 'updates/sprint' } }])('final readback drops a changed/filled goal during Run: %j', async change => {
    await draft(); mutateOnRun = change; await run();
    expect(askOnLatest()).toBeNull();
  });
  it('new delivered ask supersedes instead of coexisting; wall expiry is never renewed by carry', async () => {
    const prior = await draft();
    reply = QUESTION;
    await answer('What do you need?');
    const next = askOnLatest()!;
    expect(next.id).not.toBe(prior.id);
    expect(pending.filter(p => p.action.kind === 'elicit_goal_current_level')).toHaveLength(1);
    pending = [{ ...next, expires_at_iso: '2000-01-01T00:00:00.000Z' }];
    await run(); expect(askOnLatest()).toBeNull();
  });
  it('non-typed turns and replay preserve TTL; one typed unrelated turn decrements once', async () => {
    const initial = await draft(); await run();
    await turn(FX.requests.run); // actual committed replay, not a new logical turn
    expect(askOnLatest()).toEqual(initial);
    await explain(); await answer('Thanks.');
    expect(askOnLatest()).toEqual({ ...initial, expires_at_turn_count: 2 });
  });
});
