/**
 * ⭐ #3342 R2 (DL-3 03:2xZ condition; BUDDY-A 02:58Z AMEND): the WHOLE chain for a range of time inside the goal's own target
 * sentence, on the REAL build and the REAL /agent/v1/turn route, 0 LLM calls (the drafter and the Agent are scripted):
 *  1. the build holds the brief's words ("within 6 to 12 months"), asks the existing "Which date …" question, picks no end, and
 *     keeps the target reading awaiting its period (#3340: conditions kept, threshold minted, no chance licensed);
 *  2. the user types "12 months" → the Agent's propose_goal_deadline → the existing deadline card;
 *  3. the press saves the deadline once, and the awaiting reading then validates with that period and every condition.
 * CONTRAST (BUDDY-A B1): a window for ANOTHER event ("open a Nordic office in the next 6 to 12 months") never becomes the
 * goal's deadline: its role is asked first, and nothing is held. SYNTHETIC brief.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { goalTargetBasisOf } from '../../goal-target/goal-target-basis.js';

type Json = Record<string, any>;
const TARGET = 'We want 600 clients within 6 to 12 months.';
const BRIEF_IN = `Should we open a Nordic office? We have 300 clients today. ${TARGET} If monthly churn passes 10%, we lose money.`;
const BRIEF_WINDOW = 'Should we open a Nordic office in the next 6 to 12 months? We have 300 clients today. We want 600 clients. '
  + 'If monthly churn passes 10%, we lose money.';
const CONDITIONS = ['Monthly churn stays at or below 10%'];
const CREATED = '2026-10-17T09:00:00.000Z';
const subj = { kind: 'goal', label: 'Client base', to_label: null, factor_label: null };
const draft = (brief: string, targetQuote: string): Json => ({
  goal: { kind: null, deliverable: null, metric: 'Client base', operator: '>=', target_stated: true, value: 600, unit: 'clients',
    horizon_months: null, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 300, baseline_provenance: 'explicit',
    scope: null, quantity_frame: 'level', source_quote: targetQuote, deadline_words: null,
    basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'clients',
      effects_at_period_end: true, also_required: CONDITIONS, open_question: null } },
  constraints: [],
  options: [
    { label: 'Open a Nordic office', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Nordic offices opened', value: 1, value_kind: 'absolute', unit: 'offices', provenance: 'ai_proposed' }] },
    { label: 'Stay in the current market', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: true,
      interventions: [{ factor_label: 'Nordic offices opened', value: 0, value_kind: 'absolute', unit: 'offices', provenance: 'ai_proposed' }] },
  ],
  factors: [{ label: 'Nordic offices opened', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'offices', provenance: 'ai_proposed', plausible_max: 5 }],
  risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
  links: [{ from: 'Nordic offices opened', to: 'Client base', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
  statements: [
    { quote: 'We have 300 clients today.', subject: subj, field: 'level', form: 'point', value: 300, low: null, high: null, unit: 'clients', qualifier: 'today', conditions: null },
    { quote: targetQuote, subject: subj, field: 'target', form: 'lower_bound', value: 600, low: null, high: null, unit: 'clients', qualifier: null, conditions: null },
  ],
});
async function built(brief: string, targetQuote: string): Promise<{ graph: Json; result: Json }> {
  let graph: Json | undefined;
  const result = await buildModelFromBrief('7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f', brief, (async (path: string, body: Json) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: JSON.stringify(draft(brief, targetQuote)), status: 'completed' })) as never) as Json;
  expect(result.ok, JSON.stringify(result).slice(0, 600)).toBe(true);
  return { graph: graph!, result };
}

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null;
  user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const deadlineOf = (g: unknown): unknown => (g as Json | undefined)?.nodes?.find((n: Json) => n.kind === 'goal')?.goal_horizon?.deadline;
const deadlineChanges = new Map<string, number>();
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
      if (w.graph !== undefined && w.graph !== null) {
        const next = JSON.parse(JSON.stringify(w.graph)) as unknown;
        if (deadlineOf(next) !== deadlineOf(graphOf.get(w.scenario_id))) deadlineChanges.set(w.scenario_id, (deadlineChanges.get(w.scenario_id) ?? 0) + 1);
        graphOf.set(w.scenario_id, next);
      }
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


const briefOf = new Map<string, string>();

describe('a range of time in the goal\'s own target sentence, on the real build and route: words held, asked, answered, saved', () => {
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
      const id = (req.params as { id: string }).id;
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        brief_text: briefOf.get(id) ?? null, scenario_created_at: CREATED };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  beforeEach(() => { script = {}; scenario = randomUUID(); });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = async (payload: Json): Promise<Json> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: scenario, turn_id: randomUUID(), ...payload } });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return res.json() as Json;
  };
  const goalNow = (): Json => (graphOf.get(scenario) as Json).nodes.find((n: Json) => n.kind === 'goal');
  const callOf = (body: Json, name: string): Json | undefined => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === name);

  it('⭐ the whole chain: "Which date …" asked, no end picked → typed "12 months" → the deadline card → the press saves it once → the awaiting reading completes', async () => {
    const { graph, result } = await built(BRIEF_IN, TARGET);
    // 1. The build: the brief's words held, the existing question asked first, no month count, the reading awaiting its period.
    expect((result.open_questions as string[])[0]).toBe('Which date does "within 6 to 12 months" mean? It is the deadline your brief sets for "Client base"; '
      + 'the model keeps your words but no date, so no result answers whether it is met by then.');
    const goal0 = graph.nodes.find((n: Json) => n.kind === 'goal');
    expect(goal0.goal_deadline_as_stated).toBe('within 6 to 12 months');
    expect(goal0.goal_horizon_months).toBeUndefined();
    expect(goal0.goal_target_basis).toMatchObject({ also_required: CONDITIONS });
    expect(goal0.goal_target_basis).not.toHaveProperty('period_months');
    expect(goalTargetBasisOf(goal0)).toBeUndefined();
    graphOf.set(scenario, structuredClone(graph)); briefOf.set(scenario, BRIEF_IN);
    // 2. The user answers in their own words; the Agent proposes the deadline from them.
    const session = `horizon-${randomUUID()}`;
    script['12 months.'] = { name: 'propose_goal_deadline', args: { deadline_words: '12 months', deadline_date: '', reference_date: '',
      rationale: 'The user answered which date their target is for.' } };
    const offered = await send({ agent_session_id: session, message: '12 months.' });
    expect(callOf(offered, 'propose_goal_deadline'), JSON.stringify(offered._agent?.tool_calls)).toMatchObject({ ok: true });
    const chips = (offered.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(chips, JSON.stringify(offered.suggested_actions)).toHaveLength(1);
    expect(goalNow().goal_horizon, 'nothing saved before the press').toBeUndefined();
    // 3. The press saves it once; the reading kept awaiting its period now validates with it and every condition.
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    expect(deadlineChanges.get(scenario), 'the press writes the deadline once').toBe(1);
    expect(goalNow().goal_horizon?.deadline).toBe('2027-10-17');
    expect(goalTargetBasisOf(goalNow())).toMatchObject({ period_months: 12, also_required: CONDITIONS, target_raw: 600 });
  }, 120_000);

  it('CONTRAST (BUDDY-A B1): a window for another event never becomes the goal\'s deadline: its role is asked first and nothing is held', async () => {
    const { graph, result } = await built(BRIEF_WINDOW, 'We want 600 clients.');
    expect((result.open_questions as string[])[0]).toBe('Is "in the next 6 to 12 months" the period by which "Client base" should be achieved? '
      + 'Your brief does not say, so the model holds no deadline for it.');
    const goal = graph.nodes.find((n: Json) => n.kind === 'goal');
    expect(Object.hasOwn(goal, 'goal_deadline_as_stated')).toBe(false);
    expect(goal.goal_horizon_months).toBeUndefined();
    expect(goal.goal_horizon).toBeUndefined();
  }, 120_000);
});
