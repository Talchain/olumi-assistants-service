/** W1b round 2: re-witness wire, typed-turn budget. No provider/DB contacted. */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_LEVEL_TOOL, currentLevelAskOnAnswer, latestCurrentLevelAsk } from '../current-level-answer.js';
import { typedByUser } from '../stated-by-user.js';
import { currentLevelAskForAnswerRow } from '../current-level-ask-carry.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import type { SessionTurnWrite } from '../../session/store.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
type Request = { scenario_id: string; turn_id: string; message: string; source: string; chip?: { id?: string; action_type?: string } };
const FX = JSON.parse(readFileSync(new URL('./fixtures/founder-rewitness-1-current-level-typed-turns.json', import.meta.url), 'utf8')) as {
  requests: { draft: Request; run: Request; explain: Request; sizes: Request; confirmation: Request };
  graph: Graph; explainText: string; clarificationText: string;
  run: { graph_hash: string; analysis_state: Record<string, unknown>; analysis_ready: unknown;
    blocks: { type: string; enrichment: { inference_warnings: { first_ask?: { question: string } }[] } }[] } & Record<string, unknown>;
};
const SCENARIO = FX.requests.run.scenario_id;
const GOAL = 'productivity';
const HASH = FX.run.graph_hash;
const RESULT = FX.run.blocks[0]!;
const QUESTION = RESULT.enrichment.inference_warnings.find(w => w.first_ask !== undefined)!.first_ask!.question;
const SIZES = 'We can fit 4 large, 8 medium, 16 small, roughly';
const CHOICE = FX.clarificationText;
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
const changedGraph = (change: Record<string, unknown>): Graph => ({ ...FX.graph,
  nodes: FX.graph.nodes.map(n => n.id === GOAL ? { ...n, ...change } : n) });

describe('non-typed carry controls', () => {
  it.each([FX.requests.run, FX.requests.explain, { kind: 'message', source: 'retry' },
    { kind: 'system_event' }, { source: 'composer', chip: { id: 'another-chip' } }])(
    'keeps the last live turn for non-typed provenance: %j', request => {
      const initial = { ...arm(), expires_at_turn_count: 1 };
      expect(typedByUser(request)).toBe(false);
      expect(carry(initial, { typedByUser: typedByUser(request) })).toEqual(initial);
    });
  it.each([FX.requests.sizes, { kind: 'message' }])('typed provenance still decrements once: %j', request => {
    const initial = arm();
    expect(typedByUser(request)).toBe(true);
    expect(carry(initial, { typedByUser: typedByUser(request) })).toEqual({ ...initial, expires_at_turn_count: 2 });
  });
  it('non-typed turns cannot revive an exhausted ask or bypass wall/hash/goal checks or consumption', () => {
    const initial = arm();
    expect(carry(initial, { prior: { ...initial, expires_at_turn_count: 0 }, typedByUser: false })).toBeNull();
    expect(carry(initial, { nowMs: Date.parse(initial.expires_at_iso) + 1, typedByUser: false })).toBeNull();
    expect(carry(initial, { prior: { ...initial, preconditions: { graph_hash: 'changed' } }, typedByUser: false })).toBeNull();
    expect(carry(initial, { graph: changedGraph({ label: 'Revenue' }), typedByUser: false })).toBeNull();
    expect(carry(initial, { answered: true, typedByUser: false })).toBeNull();
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
  const providerBodies: { tool_choice?: unknown; input?: unknown }[] = [];
  beforeEach(async () => {
    pending = []; writes.length = 0; rows.clear(); providerBodies.length = 0;
    graph = structuredClone(FX.graph); reply = 'Those figures are noted.';
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { tool_choice?: { name?: string }; input?: unknown };
      providerBodies.push(body);
      const call = body.tool_choice?.name === CURRENT_LEVEL_TOOL;
      return new Response(JSON.stringify({ output: call ? [{ type: 'function_call', call_id: 'level-answer', name: CURRENT_LEVEL_TOOL,
        arguments: JSON.stringify({ goal_label: GOAL, value: 16, unit: 'small-update equivalents per sprint', user_stated: true }) }]
        : [{ type: 'message', content: [{ type: 'output_text', text: reply }] }] }), { status: 200 });
    }));
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      pending = []; // the inner Run's row, before the Agent's outer answer
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

  it('RED at base: draft → captured Run → auto Explain and its completed reply → goal-named answer forces the door', async () => {
    const initial = await draft();
    expect(initial.expires_at_turn_count).toBe(3);
    await run();
    expect(askOnLatest()).toEqual(initial);
    const explanation = await explain(); // returns only after the outer reply has persisted
    expect(writes.at(-1)?.assistantMessage).toBe(explanation.assistant_text);
    expect(askOnLatest()).toEqual(initial);
    providerBodies.length = 0;
    const body = await answer(`Productivity: ${FX.requests.sizes.message}`);
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: CURRENT_LEVEL_TOOL });
    expect(body._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(askOnLatest()).toBeNull();
    expect(writes.every(w => w.graph === undefined)).toBe(true);
  });
  it('RED at base: a clarified ask survives captured Run → auto Explain and reply → captured confirmation', async () => {
    await draft();
    pending = [roundTrip(clarify(pending[0]!))]; // existing qualified typed-clarification producer
    const initial = askOnLatest()!;
    expect(initial.expires_at_turn_count).toBe(2);
    expect(initial.action.confirmation).toBe('choice');
    await run();
    expect(askOnLatest()).toEqual(initial);
    await explain();
    expect(askOnLatest()).toEqual(initial);
    providerBodies.length = 0;
    const body = await turn(FX.requests.confirmation);
    expect(providerBodies[0]?.tool_choice).toEqual({ type: 'function', name: CURRENT_LEVEL_TOOL });
    expect(body._agent?.tool_calls).toContainEqual(expect.objectContaining({ name: CURRENT_LEVEL_TOOL }));
    expect(askOnLatest()).toBeNull();
  });
  it('CONTROL: after Run/Explain, exactly three unrelated typed turns exhaust the ask', async () => {
    const initial = await draft(); await run(); await explain();
    for (const remaining of [2, 1, 0]) {
      providerBodies.length = 0;
      await answer('Thanks.');
      expect(providerBodies[0]?.tool_choice).toBeUndefined();
      expect(askOnLatest()).toEqual(remaining === 0 ? null : { ...initial, expires_at_turn_count: remaining });
    }
    providerBodies.length = 0;
    await answer(`Productivity: ${SIZES}`);
    expect(providerBodies[0]?.tool_choice).toBeUndefined();
  });
  it.each(['run', 'explain'] as const)('CONTROL: wall expiry still applies on a captured %s turn', async path => {
    await draft();
    if (path === 'explain') await run();
    const held = askOnLatest()!;
    pending = [{ ...held, expires_at_iso: '2000-01-01T00:00:00.000Z' }];
    if (path === 'run') await run(); else await explain();
    expect(askOnLatest()).toBeNull();
  });
});
