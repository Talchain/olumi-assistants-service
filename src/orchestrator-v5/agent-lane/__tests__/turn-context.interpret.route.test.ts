/**
 * ⭐ S2 ONE TURN CONTEXT, THROUGH THE ROUTE (DL 15 Oct; arch12/2-context-management.md).
 *
 * The coaching call (`interpretSelectedRun`: the Explain press and the automatic Run) was given only the last 3 user turns
 * and no date, so the user's brief and their older words dropped out of the coaching. This presses the real Run and the
 * real Explain control on the real route, with each SERVED /graph read as the canonical read (no provider is contacted),
 * and checks the interpret request the provider would receive: today's date (a developer item), the brief verbatim
 * (a USER item, bound by the read's own `brief_text`), then the conversation, then the request.
 *
 * Fixtures (both served on staging, 14 Oct; keys untouched):
 * - capacity: the UI joined-flow witness's R2 read (CEE 880b35b4), after the edit and its automatic Run;
 * - hiring: the T1H negative r3 capture's read after its approval.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPressToolResponse } from './fixtures/run-press-model.js';
import { RUN_EXPLANATION_MESSAGE, recentRunExplanationConversation } from '../run-explanation.js';
import { BRIEF_LABEL } from '../turn-context.js';
import { TODAY_PREFIX } from '../runtime/agent-loop.js';
import { OLDER_WORDS_LABEL, olderWordsItem } from '../history-store.js';

type Json = Record<string, any>;
const served = (name: string): Json =>
  (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { body: Json }).body;
const BRIEFS: Record<string, Json> = {
  capacity: served('capacity-880b35b4-r2-served-read-20261014.json'),
  hiring: served('hiring-t1h-negative-r3-served-read-20261014.json'),
};

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const textOf = (item: Json): string => (Array.isArray(item?.content) ? item.content.map((c: Json) => c?.text ?? '').join('\n') : String(item?.content ?? ''));

describe('S2 turnContext: the coaching call is told today and the user’s brief, verbatim', () => {
  let app: FastifyInstance;
  let READ: Json = BRIEFS.capacity!;
  const bodies: Json[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      bodies.push(body);
      return runPressToolResponse(body) ?? new Response(JSON.stringify({ output: [
        { type: 'message', content: [{ type: 'output_text', text: 'In this model the result rests on the figures shown.' }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [READ.analysis_result], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => structuredClone(READ));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); bodies.length = 0; });

  /** Press Run, then the Explain control it offers; return the interpret call's request (the tool-less one). */
  const explainRequest = async (read: Json, prior: readonly string[] = []): Promise<Json> => {
    READ = read;
    const scenario = read.scenario_id as string;
    const session = randomUUID();
    for (const message of prior) {
      const correction = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: scenario, agent_session_id: session, turn_id: randomUUID(), message,
      } });
      expect(correction.statusCode, correction.body).toBe(200);
    }
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', agent_session_id: session, scenario_id: scenario, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    const chip = r.json().suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, 'the served Run offers the Explain control').toBeDefined();
    bodies.length = 0;
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: scenario, agent_session_id: r.json()._agent.session_id, turn_id: randomUUID(),
      message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id },
    } });
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json()._diagnostic_trace.fast_path).toBe('explain');
    const interpret = bodies.filter((b) => Array.isArray(b.tools) && b.tools.length === 0 && b.tool_choice === 'none');
    expect(interpret, 'exactly one interpreting call').toHaveLength(1);
    return interpret[0]!;
  };

  it('B1: one coaching instruction and retained corrections, with unsaved changes still distinguished', async () => {
    const corrections = [
      'My working assumption is 60 hours. The 80% estimate is conditional on an investor meeting.',
      'I have asked to replace the 40-hour options; those changes are still awaiting save.',
    ];
    const request = await explainRequest(BRIEFS.capacity!, corrections);
    const sent = JSON.stringify(request);
    for (const correction of corrections) expect(sent).toContain(correction);
    const { RUN_FACTS_USE } = await import('../run-facts.js');
    expect(request.instructions.split(RUN_FACTS_USE)).toHaveLength(2);
    expect(JSON.stringify(request.input)).not.toContain(RUN_FACTS_USE);
    expect(request.instructions).toContain('A proposed change is still awaiting approval or save until the actual readback confirms it');
    expect(request.instructions).toContain('A missing saved field does not justify asking again');
    expect(request.tool_choice).toBe('none');
    expect(request.tools).toEqual([]);
  }, 60_000);

  it.each(Object.keys(BRIEFS))('%s (served read): the interpret request opens with today, then the brief verbatim as the USER’s words', async (name) => {
    const read = BRIEFS[name]!;
    expect(typeof read.brief_text === 'string' && read.brief_text.trim().length > 40, 'fixture control: a real brief').toBe(true);
    const input = (await explainRequest(read)).input as Json[];
    const today = input.filter((i) => textOf(i).startsWith(TODAY_PREFIX));
    expect(today, 'one date line').toHaveLength(1);
    expect(today[0]!.role, 'the date is Olumi’s fact: a developer item').toBe('developer');
    const brief = input.filter((i) => textOf(i).startsWith(BRIEF_LABEL));
    expect(brief, 'the brief, once').toHaveLength(1);
    expect(brief[0]!.role, 'the brief is the user’s words: a user item, never developer').toBe('user');
    expect(textOf(brief[0]!), 'bound by the read’s own brief_text, verbatim').toBe(`${BRIEF_LABEL}\n${read.brief_text.trim()}`);
    expect(input.indexOf(today[0]!)).toBe(0);
    expect(input.indexOf(brief[0]!)).toBe(1);
    // The request (with the canonical state) stays last; the brief is reference, never re-sent as the request.
    const last = textOf(input.at(-1)!);
    expect(JSON.parse(last).request).toBe(RUN_EXPLANATION_MESSAGE);
    expect(last.includes(BRIEF_LABEL)).toBe(false);
  }, 60_000);

  it('B1 buddy regression: the actual interpreting request keeps standing unit, authorship and calculation safeguards', async () => {
    const request = await explainRequest(BRIEFS.capacity!);
    const instructions = String(request.instructions);
    for (const safeguard of [
      'A target is not a baseline',
      'Do not call an Olumi estimate',
      'CALCULATION BOUNDARY',
      'VOCABULARY',
      'Never express the chance as a percentage of model runs',
      'Never expose internal ids or field names',
    ]) expect(instructions, safeguard).toContain(safeguard);
    expect(request.tools).toEqual([]);
    expect(request.tool_choice).toBe('none');
  }, 60_000);
});

describe('S2 turnContext: the user’s older words survive the coaching call’s 3-turn trim', () => {
  const turn = (role: 'user' | 'assistant', text: string): Json => ({ role, content: [{ type: 'input_text', text }] });
  const older = olderWordsItem(['The brief: two staffing options, 80 tickets a week today.', 'Our budget is £120k, not more.']) as Json;

  it('the labelled older-words item is kept, first, with only the last 3 turns after it', () => {
    const history = [older, ...[1, 2, 3, 4, 5].flatMap((n) => [turn('user', `u${n}`), turn('assistant', `a${n}`)])];
    const kept = recentRunExplanationConversation(history) as Json[];
    expect(textOf(kept[0]!).startsWith(OLDER_WORDS_LABEL)).toBe(true);
    expect(textOf(kept[0]!)).toContain('Our budget is £120k, not more.');
    expect(kept[0]!.role).toBe('user');
    expect(kept.slice(1).map(textOf)).toEqual(['u3', 'a3', 'u4', 'a4', 'u5', 'a5']);
  });

  it('CONTROL: with no older-words item the trim is exactly the last 3 turns, as before', () => {
    const history = [1, 2, 3, 4].flatMap((n) => [turn('user', `u${n}`), turn('assistant', `a${n}`)]);
    expect((recentRunExplanationConversation(history) as Json[]).map(textOf)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });
});
