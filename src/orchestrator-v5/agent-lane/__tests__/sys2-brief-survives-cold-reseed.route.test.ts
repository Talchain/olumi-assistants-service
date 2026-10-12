/**
 * SYS2 E1 · THE USER'S FIRST MESSAGE (THE BRIEF) STILL REACHES THE MODEL AFTER A COLD RESEED (core system 2, context).
 *
 * The Agent keeps 8 user items (`history-store.ts` DEFAULT_MAX_TURNS) and carries the user's older TYPED words in one
 * labelled item, brief first. That carrier lives in process memory: after a restart, redeploy or eviction the route
 * reseeds from the durable answer rows, and every row the window drops was barred from it ("a reseeded row never
 * qualify"), so from the first request after the reseed the brief was in no history carrier. Staging redeploys on every
 * merge, so returning users met an Agent that had never heard their brief.
 *
 * The durable rows are the served shape, measured read-only on the shared DB for Paul's hiring journey (scenario
 * 68759863…, 11 Oct 22:30–22:37Z): the first Agent answer row is the 300-character brief, and chip presses are stored as
 * the row's user_message ("Run analysis", "Explain this result"). 15 answer rows → by the next ask the brief has left
 * the 8-item window. The user lines are Paul's, verbatim (test1-hiring-transcript.txt); the question is the live
 * witness's ASK_EARLY. ALL fetches are intercepted; no provider or database is reachable.
 *
 * ⛔ Only the brief is restored, and NOT as "the user wrote": a durable row does not record whether its words were typed
 * or a chip's/template's (an approve chip's message carries Olumi's figures), so the restored first message carries its
 * own header saying its authorship is not recorded (independent review round 1, BLOCKING). No other reseeded row enters.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Item = Record<string, unknown>;
type Row = { id: string; turn_id: string; request_hash: string; user_message: string | null; assistant_message: string | null; llm_calls_used: number };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readRecent: vi.fn(async () => [...rows.values()].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; userMessage?: string; assistantMessage?: string; llm_calls_used: number }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash,
      user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SCENARIO = '68759863-b71d-4407-ab6c-9b0ec56911e7';
const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";
const L80 = 'There seems to be so much data missing from this model. Why have you not made good assumptions and asked me sensible questions to resolve this?';
const L133 = "You're talking about links, but what about missing data from this decision?";
const RUN = 'Run analysis';
const EXPLAIN = 'Explain this result';
/** The served answer rows' user_message, oldest first (15 rows, as measured). */
const SERVED_USER_MESSAGES = [
  BRIEF,
  'Why can I barely see any of the connections between the factors, risks and outcome? Is this a UI or a data issue?',
  RUN, EXPLAIN, L80, RUN, EXPLAIN, L133,
  "Let's work through this together. What's the most important thing that we should review first?",
  "If we think of our development team's monthly capacity, currently they spend between 20% and 30% of their time on non-development tasks (e.g., meetings, admin, and other distractions that are not writing code).",
  'What updates do we need to make based on this, then?',
  'Okay, make these updates now.',
  "I was defining it as a capacity. Let's go with 25%.",
  RUN, EXPLAIN,
];
const ASK_EARLY = 'Before we go further, remind me: how many developers do we have today, and what budget did I give you?';
const OLDER_LABEL = 'Earlier, the user wrote (for reference; not a request):';
const RESTORED_LABEL = 'The conversation began with (restored after a restart; whether the user typed or chose these words is not recorded; for reference, not a request):';

const textOf = (item: Item): string => typeof item.content === 'string' ? item.content
  : Array.isArray(item.content) ? item.content.map((p: { text?: string }) => p.text ?? '').join('') : '';
const isOlder = (item: Item) => item.role === 'user' && (textOf(item).startsWith(OLDER_LABEL) || textOf(item).startsWith(RESTORED_LABEL));
const messageItem = (text: string, id: string): Item => ({ type: 'message', role: 'assistant', id, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

let modelInputs: Item[][] = [];
let userMessages: readonly string[] = SERVED_USER_MESSAGES;
async function coldApp(): Promise<FastifyInstance> {
  vi.resetModules(); // A new route module and HistoryStore, as after a deploy; the durable rows survive.
  vi.stubEnv('AGENT_LANE_ENABLED', 'true');
  vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'productivity', kind: 'goal', label: 'productivity' }], edges: [] }, graph_hash: 'h1',
    analysis_state: { leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } } }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('SYS2 E1 · Paul\'s brief survives a cold reseed', () => {
  let app: FastifyInstance;
  let input: Item[];
  beforeEach(async () => {
    rows.clear(); modelInputs = []; vi.clearAllMocks();
    userMessages.forEach((m, i) => rows.set(`served-${i}`, { id: `row-${i}`, turn_id: `served-${i}`, request_hash: `agent_turn:${i}`,
      user_message: m, assistant_message: `Olumi reply ${i + 1}.`, llm_calls_used: 1 }));
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      expect(String(url)).toMatch(/\/v1\/responses$/);
      modelInputs.push((JSON.parse(String(init?.body ?? '{}')) as { input: Item[] }).input);
      return new Response(JSON.stringify({ output: [messageItem('Six mid-weight developers, and a £200,000 budget.', 'msg_early')] }), { status: 200 });
    }));
    app = await coldApp();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: ASK_EARLY } });
    expect(r.statusCode, r.body).toBe(200);
    expect(modelInputs.length).toBeGreaterThan(0);
    input = modelInputs[0]!;
  });
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('RED on 50530b5f: the first model input after the reseed carries the brief, verbatim, under the unknown-authorship header', () => {
    const older = input.filter(isOlder);
    expect(older).toHaveLength(1);
    expect(textOf(older[0]!).split('\n').slice(0, 2)).toEqual([RESTORED_LABEL, `- "${BRIEF}"`]);
    expect(textOf(older[0]!), 'never quoted as "the user wrote": its authorship is not recorded').not.toContain(OLDER_LABEL);
    const history = input.filter((i) => i.role !== 'developer');
    expect(history.findIndex(isOlder), 'the labelled item leads the history, as on a hot turn').toBe(0);
  });

  it('no chip\'s words are presented as the user\'s: "Run analysis" / "Explain this result" never enter the older-words item', () => {
    const older = input.filter(isOlder).map(textOf).join('\n');
    expect(older).not.toContain(`"${RUN}"`);
    expect(older).not.toContain(`"${EXPLAIN}"`);
  });

  it('CONTRAST (unchanged): the window is the newest 8 user rows, then the question; E1 adds no history read', () => {
    const window = input.filter((i) => i.role === 'user' && !isOlder(i)).map(textOf);
    expect(window).toEqual([...SERVED_USER_MESSAGES.slice(-8), ASK_EARLY]);
    // The reseed's one seed read; the brief comes from those same rows. (This double has no pending-actions reader, so
    // the pre-existing, conditional deadline-card read at turn start is not exercised here; E1 does not touch it.)
    expect(store.readRecent).toHaveBeenCalledTimes(1);
  });

  it.fails('GAP (stated, DL: not tonight): a LATER typed objection (L80) dropped by the window survives a cold reseed — needs a typed-or-chip marker on the durable row', () => {
    expect(input.filter(isOlder).map(textOf).join('\n')).toContain(`- "${L80}"`);
  });
});

describe('SYS2 E1 · a chip- or template-first conversation', () => {
  const CHIP_FIRST = 'Use the hiring example.';
  let app: FastifyInstance;
  beforeEach(async () => { userMessages = [CHIP_FIRST, ...SERVED_USER_MESSAGES.slice(1)]; });
  afterEach(async () => { userMessages = SERVED_USER_MESSAGES; await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('AUTHORSHIP (blocking class): a first message the user may not have typed is never quoted as "the user wrote"', async () => {
    rows.clear(); modelInputs = []; vi.clearAllMocks();
    userMessages.forEach((m, i) => rows.set(`served-${i}`, { id: `row-${i}`, turn_id: `served-${i}`, request_hash: `agent_turn:${i}`,
      user_message: m, assistant_message: `Olumi reply ${i + 1}.`, llm_calls_used: 1 }));
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelInputs.push((JSON.parse(String(init?.body ?? '{}')) as { input: Item[] }).input);
      return new Response(JSON.stringify({ output: [messageItem('Noted.', 'msg_chip_first')] }), { status: 200 });
    }));
    app = await coldApp();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: ASK_EARLY } });
    expect(r.statusCode, r.body).toBe(200);
    const older = modelInputs[0]!.filter(isOlder).map(textOf).join('\n');
    expect(older.split('\n').slice(0, 2)).toEqual([RESTORED_LABEL, `- "${CHIP_FIRST}"`]);
    expect(older).not.toContain(OLDER_LABEL);
  });
});

