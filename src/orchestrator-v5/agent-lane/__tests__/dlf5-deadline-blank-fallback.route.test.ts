/**
 * DLf5 on the REAL route, for the 22:19Z served FAIL (CEE ffe10d51, 12 `unreadable_deadline` refusals). Paul types his
 * deadline; the stubbed model calls `propose_goal_deadline` with his phrase and BLANK optional fields (`deadline_date: ""`,
 * `reference_date: ""`). The served arguments were NOT retained (Render logged `proposed: '{}'`), so this blank shape is
 * INFERRED from the pre-fix door, which refused only on the model's date. Flow: the card → its approve chip through the
 * route → the production writer (exactly one deadline change) → the saved goal read back → his team-time forecast is no
 * longer `deadline_not_held`.
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
    expect(String(chips[0]!.detail), 'one phrase in the message: the user\u2019s own reading').not.toContain('Olumi\u2019s interpretation');
    expect(goalNow().goal_horizon?.deadline, 'nothing saved before the approval').toBeUndefined();
    expect(deadlineChanges.get(scenario) ?? 0).toBe(0);
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    expect({ deadline: goalNow().goal_horizon?.deadline, reference: goalNow().goal_horizon_reference_date, stated: goalNow().goal_horizon_stated_months })
      .toEqual({ deadline: '2027-04-13', reference: '2026-10-13', stated: 6 });
    expect(deadlineChanges.get(scenario), 'the approval writes the deadline once').toBe(1);
    script[TEAM] = { name: 'propose_team_time', args: { quote: QUOTE, low_months: 7, high_months: 7 } };
    const team = await send({ agent_session_id: session, message: TEAM });
    const teamCall = callOf(team, 'propose_team_time');
    expect(teamCall, JSON.stringify(team._agent?.tool_calls)).toBeDefined();
    expect(teamCall!.refusal, 'the deadline is held, so the forecast is offered').not.toBe('deadline_not_held');
    expect(teamCall).toMatchObject({ ok: true });
    expect(deadlineChanges.get(scenario), 'the team turn leaves the saved deadline alone').toBe(1);
  });

  /** The Codex check on 394c95eb: offer the card, press its approve chip, read the saved goal back. */
  const offerAndApprove = async (message: string, args: Json) => {
    const session = `dlf5-${randomUUID()}`;
    script[message] = { name: 'propose_goal_deadline', args: { deadline_date: '', rationale: 'The user stated their launch deadline.', ...args } };
    const offered = await send({ agent_session_id: session, message });
    expect(callOf(offered, 'propose_goal_deadline'), JSON.stringify(offered._agent?.tool_calls)).toMatchObject({ ok: true });
    const chips = (offered.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(chips, JSON.stringify(offered.suggested_actions)).toHaveLength(1);
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    return { detail: String(chips[0]!.detail), saved: { deadline: goalNow().goal_horizon?.deadline, reference: goalNow().goal_horizon_reference_date,
      stated: goalNow().goal_horizon_stated_months }, changes: deadlineChanges.get(scenario) ?? 0 };
  };

  it('Codex blocking 1: an "as of" date in ANOTHER clause never dates the deadline, whatever the model echoes (was 2027-03-01)', async () => {
    const { detail, saved, changes } = await offerAndApprove('Revenue was 2m as of 2026-09-01, and our launch deadline is 6 months from today.',
      { deadline_words: '6 months from today', reference_date: '2026-09-01' });
    expect(saved).toEqual({ deadline: '2027-04-13', reference: '2026-10-13', stated: 6 });
    expect(detail).toContain('Is your deadline 13 April 2027 (6 months from 13 October 2026)? Your words: \u201c6 months from today\u201d.');
    // The model's echoed date was set aside, so the reading is Olumi's for the user to check (buddy r3: class, not words).
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
    expect(changes).toBe(1);
  });

  it.each([
    ['in six months', { deadline: '2027-04-13', reference: '2026-10-13', stated: 6 }],
    ['in nine months', { deadline: '2027-07-13', reference: '2026-10-13', stated: 9 }],
  ] as const)('Codex blocking 2: two durations in one message ("%s" quoted) → Olumi\u2019s reading for the user to check, never theirs', async (deadline_words, want) => {
    const { detail, saved, changes } = await offerAndApprove('Our office lease expires in six months, and our launch deadline is in nine months.',
      { deadline_words, reference_date: '' });
    expect(detail).toContain(`Your words: \u201c${deadline_words}\u201d. Olumi\u2019s interpretation; check the date and reference before approving.`);
    expect(saved).toEqual(want);
    expect(changes).toBe(1);
  });

  // Buddy review r2 (Codex, read-only, 11dc9f30): a clause joiner other than "and"/"but", and a duration the reader will not place.
  it('buddy r2: "As of D revenue was 2m whereas our launch deadline is six months" keeps the host reference (D echoed)', async () => {
    const { saved, detail } = await offerAndApprove('As of 2026-09-01 revenue was 2m whereas our launch deadline is six months.',
      { deadline_words: 'six months', reference_date: '2026-09-01' });
    expect(saved).toEqual({ deadline: '2027-04-13', reference: '2026-10-13', stated: 6 });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
  });
  it.each([
    ['As of 2026-01-01 revenue was \u00a32m plus our launch deadline is in six months.', 'in six months', '2026-01-01'],
    ['As of 2026-01-01, revenue was \u00a32m; our launch deadline is in six months.', 'in six months', '2026-01-01'],
    ['Our launch deadline is in six months, as of 2026-01-01 revenue was \u00a32m.', 'in six months', '2026-01-01'],
  ])('buddy r3: "%s" (echo %s) keeps the host reference: the as-of is not part of the deadline\u2019s phrase', async (message, deadline_words, reference_date) => {
    const { saved, detail } = await offerAndApprove(message, { deadline_words, reference_date });
    expect(saved).toEqual({ deadline: '2027-04-13', reference: '2026-10-13', stated: 6 });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
  });
  it('the as-of that IS part of the deadline\u2019s phrase still dates it: "As of 2026-11-01, our deadline is six months"', async () => {
    const { saved, detail } = await offerAndApprove('As of 2026-11-01, our deadline is six months.', { deadline_words: 'six months', reference_date: '2026-11-01' });
    expect(saved).toEqual({ deadline: '2027-05-01', reference: '2026-11-01', stated: 6 });
    expect(detail).not.toContain('Olumi\u2019s interpretation');
  });
  it('buddy r3: a quote holding the deadline AND another phrase is never the user\u2019s ("deadline is in nine months and our lease expires in six months")', async () => {
    const { detail } = await offerAndApprove('Our deadline is in nine months and our lease expires in six months.',
      { deadline_words: 'deadline is in nine months and our lease expires in six months', reference_date: '' });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
  });
  it('buddy r2: "… lease expires in six months, and our launch deadline is in 180 days" quoting the lease → Olumi\u2019s reading', async () => {
    const { detail } = await offerAndApprove('Our office lease expires in six months, and our launch deadline is in 180 days.',
      { deadline_words: 'in six months', reference_date: '' });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
  });
  // Buddy r4: a "deadline"-word exception was attacked every round ("supplier deadline … launch"), so none is kept (DL rule):
  // with two durations, even a quote naming the deadline is Olumi's reading. The right date is still offered and saved.
  it('two durations: even a quote naming the deadline is Olumi\u2019s reading, with the right date', async () => {
    const { detail, saved } = await offerAndApprove('Our office lease expires in six months, and our launch deadline is in nine months.',
      { deadline_words: 'launch deadline is in nine months', reference_date: '' });
    expect(detail).toContain('Your words: \u201claunch deadline is in nine months\u201d. Olumi\u2019s interpretation; check the date and reference before approving.');
    expect(saved).toEqual({ deadline: '2027-07-13', reference: '2026-10-13', stated: 9 });
  });
  it.each([
    ['Our office lease deadline is in six months, and our launch deadline is in nine months.', 'lease deadline is in six months', ''],
    ['Our supplier deadline is in six months; our launch must happen in nine months.', 'supplier deadline is in six months', ''],
    ['Our launch deadline is in six months\nAs of 2026-10-01, revenue was \u00a32m.', 'in six months', '2026-10-01'],
  ])('buddy r4: "%s" (quote "%s", echo "%s") → Olumi\u2019s reading for the user to check, on the host reference', async (message, deadline_words, reference_date) => {
    const { detail, saved } = await offerAndApprove(message, { deadline_words, reference_date });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
    expect(saved?.reference).toBe('2026-10-13');
  });
  it('"lease deadline … launch deadline" → Olumi\u2019s reading', async () => {
    const { detail } = await offerAndApprove('Our office lease deadline is in six months, and our launch deadline is in nine months.',
      { deadline_words: 'lease deadline is in six months', reference_date: '' });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
  });

  // ⛔ DLf5 r2 (Codex on 3e43cebc): "thirteen weeks" was missed by a number-word list. The class: the reader's own spans, and
  // FAIL SAFE any other time-unit word or month name is a phrase of its own, so the card is Olumi's reading to check.
  it.each([
    'Our office lease expires in thirteen weeks, and our launch deadline is in nine months.',
    'Our launch deadline is in nine months, and the review is in a fortnight.',
    'Our launch deadline is in nine months, but the budget must be signed by March.',
  ])('r2: "%s" quoting "in nine months" → Olumi\u2019s reading, with the right date', async (message) => {
    const { detail, saved } = await offerAndApprove(message, { deadline_words: 'in nine months', reference_date: '' });
    expect(detail).toContain('Olumi\u2019s interpretation; check the date and reference before approving.');
    expect(saved).toEqual({ deadline: '2027-07-13', reference: '2026-10-13', stated: 9 });
  });
});
