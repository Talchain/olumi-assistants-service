/**
 * DLf5 on the REAL route: the served 22:19Z deadline shape (CEE ffe10d51, 12 `unreadable_deadline` refusals). Paul types
 * his deadline; the stubbed model calls `propose_goal_deadline` with his phrase and BLANK optional fields
 * (`deadline_date: ""`, `reference_date: ""`), as the served model did → the card → its approve chip through the route →
 * the production writer → the saved goal read back → his team-time forecast is no longer `deadline_not_held`.
 * Retained graph/brief/creation: `fixtures/dlf-turn13-deadline.json`. 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import fixture from './fixtures/dlf-turn13-deadline.json';

type Json = Record<string, any>;
const SAID = 'We need to hit our launch deadline in six months time.';
const TEAM = "The team are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.";
const QUOTE = "they're going to be a month late delivering the next feature (so, 7 months)";

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null;
  user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string): Row | undefined => [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  return (row ? JSON.parse(JSON.stringify(row.pending_actions)) as unknown[] : []).map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  getScenarioOwner: vi.fn(async () => null),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: Json) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) as unknown[],
        created_at: new Date(Date.UTC(2026, 9, 13, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, JSON.parse(JSON.stringify(w.graph)));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let script: Record<string, Json> = {};
const lastUserText = (body: Json): string => String((body.input as Json[]).filter((i) => i.role === 'user').pop()?.content?.[0]?.text ?? '');
const reply = (output: Json[]) => new Response(JSON.stringify({ output }), { status: 200 });

describe('DLf5 on /agent/v1/turn: a blank model date never vetoes the user\u2019s resolved deadline', () => {
  let app: FastifyInstance;
  let scenario = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Json;
      const input = body.input as Json[];
      const thisTurn = input.slice(input.map((i) => i.role === 'user').lastIndexOf(true) + 1);
      const call = script[lastUserText(body)];
      if (call !== undefined && !thisTurn.some((i) => i.type === 'function_call_output')) {
        return reply([{ type: 'function_call', name: call.name, call_id: `fixture_${call.name}`, arguments: JSON.stringify(call.args) }]);
      }
      return reply([{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }]);
    }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        brief_text: fixture.brief_text, scenario_created_at: fixture.scenario_created_at };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  beforeEach(() => { script = {}; scenario = randomUUID(); graphOf.set(scenario, structuredClone(fixture.graph)); });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = async (payload: Json): Promise<Json> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: scenario, turn_id: randomUUID(), ...payload } });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return res.json() as Json;
  };
  const goalNow = (): Json => (graphOf.get(scenario) as Json).nodes.find((n: Json) => n.kind === 'goal');
  const callOf = (body: Json, name: string): Json | undefined => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === name);

  it.each(['', '  ', null])('served shape (deadline_date %j, reference_date ""): card → approve → saved 2027-04-13 → team time is not deadline_not_held', async deadline_date => {
    const session = `dlf5-${randomUUID()}`;
    script[SAID] = { name: 'propose_goal_deadline', args: { deadline_words: 'in six months time', deadline_date, reference_date: '', rationale: 'The user stated their launch deadline.' } };
    const offered = await send({ agent_session_id: session, message: SAID });
    expect(callOf(offered, 'propose_goal_deadline'), JSON.stringify(offered._agent?.tool_calls)).toMatchObject({ ok: true });
    const chips = (offered.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(chips, JSON.stringify(offered.suggested_actions)).toHaveLength(1);
    expect(goalNow().goal_horizon?.deadline, 'nothing saved before the approval').toBeUndefined();
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    expect({ deadline: goalNow().goal_horizon?.deadline, reference: goalNow().goal_horizon_reference_date, stated: goalNow().goal_horizon_stated_months })
      .toEqual({ deadline: '2027-04-13', reference: '2026-10-13', stated: 6 });
    script[TEAM] = { name: 'propose_team_time', args: { quote: QUOTE, low_months: 7, high_months: 7 } };
    const team = await send({ agent_session_id: session, message: TEAM });
    const teamCall = callOf(team, 'propose_team_time');
    expect(teamCall, JSON.stringify(team._agent?.tool_calls)).toBeDefined();
    expect(teamCall!.refusal, 'the deadline is held, so the forecast is offered').not.toBe('deadline_not_held');
    expect(teamCall).toMatchObject({ ok: true });
  });
});
