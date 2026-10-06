/**
 * ⭐ RT-19 (DL ruling (A), #87 6009566552): a figure stated for two ends with NO direct link gets the door's own words, never the
 * Agent's improvised offer. Through the REAL `/agent/v1/turn` route, the model's output scripted locally (0 LLM): the served
 * r18d reply (no tool call, a band question for a NEW link) on the SERVED r18d graph (cut-5 pin b38592ed).
 * Rows: 19's exact sentence fires; CONTROLS that must not fire: the link exists, the tool ran (route), another card or run made
 * this turn, one node + a figure, an ambiguous or nested label, an option end, no path or a loop, a question with or without a
 * figure, two levels, a denial, a figure in a clause naming one end (the guard itself, same graph).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noDirectLinkFigureReply, noSuchLinkUserWords, type NoDirectLinkTurn } from '../no-direct-link.js';

type Item = Record<string, unknown>;
const rows = new Map<string, { id: string; request_hash: string } & Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; userMessage?: string; assistantMessage?: string; llm_calls_used: number }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, user_message: w.userMessage ?? null,
      assistant_message: w.assistantMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
/** A card from an EARLIER turn awaiting the user's approval (Codex r1 P1-2): the route's own reader, overridden per row. */
let waitingProposal: string | undefined;
vi.mock('../held-approval-offers.js', async (original) => {
  const real = await original<typeof import('../held-approval-offers.js')>();
  return { ...real, executableWaitingProposal: (...a: Parameters<typeof real.executableWaitingProposal>) => waitingProposal ?? real.executableWaitingProposal(...a) };
});
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const GRAPH = (JSON.parse(readFileSync(new URL('./fixtures/served-dental-r18d-b38592ed.json', import.meta.url), 'utf8')) as { graph: Record<string, unknown> }).graph;
const SCENARIO = 'f604d89b-0000-4000-8000-000000000019';
const R18D = 'Each 10 percentage point rise in text reminder coverage lowers no-shows by about 1 percentage point of appointments.';
const IMPROVISED = 'Your estimate is 1 percentage point fewer no-shows for each 10-percentage-point increase in text reminder coverage.\n'
  + 'That direct link is not currently in the model: coverage acts through ‘Reminder reach rate’. Adding a direct link alongside that '
  + 'pathway could count the same benefit twice; your figure should not be attached to reach rate instead.\n'
  + 'To propose the missing direct link, how strong would you describe it: slight, moderate, strong or very strong?';
const DOOR = noSuchLinkUserWords(GRAPH, { id: 'text_reminder_coverage', label: 'Text reminder coverage' }, { id: 'no_shows', label: 'no-shows' });
const messageItem = (text: string, id: string): Item => ({ type: 'message', role: 'assistant', id, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

let scripted: Item[][] = [];
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  vi.stubEnv('AGENT_LANE_ENABLED', 'true');
  vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: 'h-r18d' }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('the REAL turn route: the door\'s words replace an improvised offer, and only then', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    rows.clear(); scripted = []; waitingProposal = undefined;
    vi.clearAllMocks();
    // ALL fetches are intercepted: no provider or Supabase connection is possible.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      expect(String(url)).toMatch(/\/v1\/responses$/);
      const output = scripted.shift();
      expect(output, 'every model response is scripted locally').toBeDefined();
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    app = await freshApp();
  });
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const say = async (message: string): Promise<string> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, turn_id: randomUUID() } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { assistant_text: string }).assistant_text;
  };

  it('19\'s exact r18d sentence, the served improvised reply, no tool → the door\'s words; the band offer is gone', async () => {
    expect(DOOR).toContain('The model has no direct link from “Text reminder coverage” to “no-shows”');
    expect(DOOR).toContain('through “Reminder reach rate”');
    scripted.push([messageItem(IMPROVISED, 'msg_r18d')]);
    const text = await say(R18D);
    expect(text.startsWith(DOOR), text).toBe(true);
    expect(text).not.toContain('how strong would you describe it');
  });

  it('CONTROL: the link exists (Reminder reach rate → no-shows) → the Agent\'s own reply stands', async () => {
    const said = 'Each 10 percentage point rise in reminder reach rate lowers no-shows by about 1 percentage point of appointments.';
    scripted.push([messageItem('Noted. I can record that for you to approve.', 'msg_exists')]);
    expect(await say(said)).toContain('Noted. I can record that for you to approve.');
  });

  it('CONTROL: a card from an earlier turn awaits approval → the Agent\'s own reply stands', async () => {
    waitingProposal = 'prop_held_earlier';
    scripted.push([messageItem(IMPROVISED, 'msg_waiting')]);
    const text = await say(R18D);
    expect(text).toContain('how strong would you describe it');
    expect(text.startsWith(DOOR)).toBe(false);
  });

  it('CONTROL: the tool ran this turn → the turn\'s own reply stands', async () => {
    const call = { type: 'function_call', id: 'fc_effect', call_id: 'c_effect', name: 'propose_link_effect', arguments: JSON.stringify({
      from_label: 'Text reminder coverage', to_label: 'no-shows', amount: -1, amount_unit: 'percentage points', per_source_change: 10,
      per_source_change_unit: 'percentage points', quote: R18D }) };
    scripted.push([call], [messageItem('After the tool: that link is not in the model.', 'msg_after_tool')]);
    const text = await say(R18D);
    expect(text).toContain('After the tool: that link is not in the model.');
    expect(text.startsWith(DOOR)).toBe(false);
  });
});

const turn = (tools: readonly string[] = [], extra: Partial<NoDirectLinkTurn> = {}): NoDirectLinkTurn =>
  ({ tools, awaitingApproval: false, scopeQuestionOwed: false, ...extra });

describe('the guard\'s own conditions on the served graph (each control must not fire)', () => {
  it('fires on 19\'s sentence with no tool: exactly the door\'s words', () => {
    expect(noDirectLinkFigureReply(GRAPH, R18D, turn())).toBe(DOOR);
  });
  it('the same figure after a colon in a request to record it still fires (r18g\'s words, no tool)', () => {
    const r18g = 'Record my figure for the link from Text reminder coverage to no-shows: each 10 percentage point rise in text reminder coverage lowers no-shows by about 1 percentage point of appointments.';
    expect(noDirectLinkFigureReply(GRAPH, r18g, turn())).toBe(DOOR);
  });
  it('"A 10 percentage point rise …" (a change word AFTER the figure) still fires: exactly the door\'s words', () => {
    expect(noDirectLinkFigureReply(GRAPH, 'A 10 percentage point rise in text reminder coverage would lower no-shows by about 1 point.', turn())).toBe(DOOR);
  });
  it('a read-only tool (get_canonical_state) does not stop it: exactly the door\'s words', () => {
    expect(noDirectLinkFigureReply(GRAPH, R18D, turn(['get_canonical_state']))).toBe(DOOR);
  });
  it.each([
    ['the tool ran', R18D, ['propose_link_effect']],
    ['another card-making tool ran (propose_model_change)', R18D, ['propose_model_change']],
    ['an analysis ran this turn (run_analysis)', R18D, ['run_analysis']],
    ['a build ran this turn (build_model_from_brief)', R18D, ['build_model_from_brief']],
    ['a span, not a change (Codex r1)', 'Compare text reminder coverage and no-shows over 12 months.', []],
    ['a sum, not a change (Codex r1)', 'We allocated £500 to investigate text reminder coverage and no-shows.', []],
    ['"a" before a sum and a span is no change (Codex r2)', 'We allocated a £500 budget for a 12 month study of text reminder coverage and no-shows.', []],
    ['the changes are about other quantities, in a clause naming neither end', 'Text reminder coverage is up and no-shows are down. Each 10 percentage point rise in staff hours cuts waiting time by about 1 point.', []],
    ['one change figure only (a level beside it)', 'Each 10 percentage point rise in text reminder coverage leaves no-shows at 8%.', []],
    ['one node + a figure', 'No-shows are about 8% of appointments today.', []],
    ['a question with no figure', 'Does text reminder coverage affect no-shows?', []],
    ['a what-if question WITH a figure', 'If text reminder coverage reached 90%, what would no-shows be?', []],
    ['two levels ("is 60%", "are about 8%")', 'Text reminder coverage is 60% today and no-shows are about 8% of appointments.', []],
    ['two levels ("is 60%", "run at 8%")', 'Our text reminder coverage is 60%; no-shows run at 8%.', []],
    ['a denial', 'I do not think a 10 point rise in text reminder coverage lowers no-shows by 1 percentage point.', []],
    ['the figure is in a clause naming one end only', 'Does text reminder coverage affect no-shows? We saw no-shows fall 2 points last year.', []],
    ['the link exists', 'Each 10 percentage point rise in reminder reach rate lowers no-shows by about 1 percentage point.', []],
    ['no path either way (coverage, online rescheduling)', 'Each 10 percentage point rise in text reminder coverage lowers online rescheduling availability by about 1 percentage point.', []],
    ['an option is one of the two (Send Text Reminders)', 'Send Text Reminders would lower no-shows by about 1 percentage point of appointments.', []],
  ] as const)('CONTROL: %s → null', (_n, message, tools) => {
    expect(noDirectLinkFigureReply(GRAPH, message, turn(tools))).toBeNull();
  });
  it.each([
    ['a card awaits approval', { awaitingApproval: true }],
    ['a scope question is owed', { scopeQuestionOwed: true }],
  ] as const)('CONTROL: %s → null', (_n, extra) => {
    expect(noDirectLinkFigureReply(GRAPH, R18D, turn([], extra))).toBeNull();
  });
  it('CONTROL: each reaches the other (no-shows → Staff time → coverage) → the direction is unsaid → null', () => {
    const g = structuredClone(GRAPH) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    g.nodes.push({ id: 'staff_time', kind: 'factor', label: 'Staff time' });
    g.edges.push({ from: 'no_shows', to: 'staff_time' }, { from: 'staff_time', to: 'text_reminder_coverage' });
    expect(noDirectLinkFigureReply(g, R18D, turn())).toBeNull();
  });
  it('CONTROL: an option end, even where a path reaches it (reach rate → no-shows → Send Text Reminders) → null', () => {
    const g = structuredClone(GRAPH) as { edges: Record<string, unknown>[] };
    g.edges.push({ from: 'no_shows', to: 'send_text_reminders' });
    expect(noDirectLinkFigureReply(g, 'Each 10 percentage point rise in reminder reach rate raises Send Text Reminders by about 1 point.', turn())).toBeNull();
  });
  it('CONTROL: one label inside the other ("Reminder coverage" in "text reminder coverage") → null', () => {
    const g = structuredClone(GRAPH) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    g.nodes.push({ id: 'reminder_coverage', kind: 'factor', label: 'Reminder coverage' });
    g.edges.push({ from: 'reminder_reach_rate', to: 'reminder_coverage' });
    expect(noDirectLinkFigureReply(g, 'Each 10 percentage point rise in text reminder coverage lowers it by about 1 percentage point.', turn())).toBeNull();
  });
  it('CONTROL: an ambiguous label (two nodes share "Text reminder coverage") → null', () => {
    const g = structuredClone(GRAPH) as { nodes: Record<string, unknown>[] };
    g.nodes.push({ id: 'text_reminder_coverage_2', kind: 'factor', label: 'Text reminder coverage' });
    expect(noDirectLinkFigureReply(g, R18D, turn())).toBeNull();
  });
});
