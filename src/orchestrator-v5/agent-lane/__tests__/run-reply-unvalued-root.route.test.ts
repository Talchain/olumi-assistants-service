/**
 * ⭐ GATE 2 CONSUMER (DL 0df0e1, 5 Oct; Science #2571; Acceptance #87 5987804248, scenario 9b9a4b81): a native Run on a
 * model whose goal path has an unvalued non-factor root ("Demand shortfall", treated as zero) said "Your results are
 * ready…" and nothing else. The typed carrier (`analysis_ready.unvalued_roots`) was right; the reply omitted both the
 * treated-as-zero disclosure and the ask. Now the Run turn, and the replay of a lost Run response, say the post-write
 * ask's own sentence (`readiness-view.ts` `treatedAsZeroLine`), from the readback graph.
 *
 * Harness: `result-first-replay.route.test.ts` (live route, the model stubbed, a store double that reads answer rows back
 * as the real store does). The graph is the held-out-shaped replica of `unvalued-root-disclosure.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_RESULT_READY_TEXT } from '../run-explanation.js';
import { dropRankingSentences } from '../withheld-leader-fail-closed.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import { survivesReplyEditors, treatedAsZeroReplyLine, TREATED_AS_ZERO_UNNAMED_ONE } from '../root-line.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '9b9a4b81-aaaa-4aaa-8aaa-aaaaaaaa0002';
const HASH = String(SERVED.block.computed_against_hash);
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const SENTENCE = 'No figure is set for "Demand shortfall" yet, so the analysis treats it as zero. How likely or how large is it today?';

type Rec = Record<string, unknown>;
const option = (id: string, label: string, interventions: Rec, is_baseline = false): Rec => ({
  id, option_id: id, kind: 'option', label, interventions, is_baseline,
});
const edge = (from: string, to: string, negative = false): Rec => ({
  from, to, strength: { mean: negative ? -0.4 : 0.4, std: 0.1 },
  exists_probability: 1, effect_direction: negative ? 'negative' : 'positive',
});
/** Two options and a baseline over two people factors, plus a risk root on the goal path — valued or not. */
function graphWith(riskValued: boolean, riskLabel = 'Demand shortfall'): Rec {
  const options = [
    option('hire_lead', 'Hire a Tech Lead', { tech_leads: { value: 2 / 10, source: 'brief_extraction' } }),
    option('hire_two', 'Hire Two Developers', { developers: { value: 6 / 30, source: 'brief_extraction' } }),
    option('carry_on', 'Carry On as Now', {}, true),
  ];
  const nodes: Rec[] = [
    { id: 'decision', kind: 'decision', label: 'Hiring approach' },
    { id: 'goal', kind: 'goal', label: 'Meet our next feature-launch deadline' },
    { id: 'tech_leads', kind: 'factor', label: 'Tech leads', category: 'controllable',
      observed_state: { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
    { id: 'developers', kind: 'factor', label: 'Developers', category: 'controllable',
      observed_state: { value: 4 / 30, raw_value: 4, unit: 'people', source: 'brief_extraction' } },
    { id: 'productivity', kind: 'factor', label: 'Delivery productivity', category: 'observable',
      observed_state: { value: 20 / 100, raw_value: 20, unit: 'feature points/week', source: 'brief_extraction' } },
    { id: 'demand_shortfall', kind: 'risk', label: riskLabel, category: 'observable',
      ...(riskValued ? { observed_state: { value: 0.35, source: 'brief_extraction' } } : {}) },
    ...options,
  ];
  const edges = [
    ...options.map((o) => edge('decision', String(o.id))),
    edge('hire_lead', 'tech_leads'), edge('hire_two', 'developers'), edge('carry_on', 'tech_leads'), edge('carry_on', 'developers'),
    edge('tech_leads', 'productivity'), edge('developers', 'productivity'), edge('productivity', 'goal'),
    edge('demand_shortfall', 'goal', true),
  ];
  return { nodes, edges, options, goal_node_id: 'goal' };
}

let riskValued = false;
let riskLabel = 'Demand shortfall';
/** What the readback says about the Run: current (bound), stale after an edit, or no result at all. */
let readback: 'current' | 'stale' | 'no_result' = 'current';
type Row = Record<string, unknown>;
const rows: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const r = rows.find((x) => x.turn_id === id);
    return r === undefined ? null : { id: String(r.turn_id), request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null,
      user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] };
  }),
  append: vi.fn(async (row: Row) => { rows.push({ ...row }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const state = () => ({ ...SERVED.analysis_state, run_state: { kind: 'complete_current', computed_at: '2026-10-05T03:48:55.163Z' } });
/** Run A completed; an edit then gave graph B (with the unvalued root) before the readback: the readback is stale. */
const staleState = () => ({ ...SERVED.analysis_state, run_state: { kind: 'complete_stale', computed_at: '2026-10-05T03:48:55.163Z', cause: 'graph_changed' } });

async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
    graph_hash: HASH, blocks: [SERVED.block], analysis_state: state(), analysis_ready: READY }));
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: graphWith(riskValued, riskLabel), graph_hash: HASH, analysis_ready: READY,
    analysis_state: readback === 'stale' ? staleState() : state(),
    ...(readback === 'no_result' ? {} : { analysis_result: SERVED.block }) }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

type Body = { assistant_text: string; narration?: { status: string; run_key: string } };

describe('a native Run with an unvalued risk root says it is treated as zero, and asks for it (live route)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [] }), { status: 200 })));
    app = await freshApp();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; riskValued = false; riskLabel = 'Demand shortfall'; readback = 'current'; });

  const runTurn = (turnId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: turnId, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });

  it('RED: the Run reply carries the disclosure AND the ask, after Olumi\'s fixed line', async () => {
    const body = (await runTurn(randomUUID())).json() as Body;
    expect(body.assistant_text.startsWith(RUN_RESULT_READY_TEXT)).toBe(true);
    expect(body.assistant_text).toContain(SENTENCE);
    expect(body.assistant_text.split(SENTENCE)).toHaveLength(2); // said once
  });

  it('RED: a lost Run response replays the same words (also after a restart)', async () => {
    const turnId = randomUUID();
    const first = (await runTurn(turnId)).json() as Body;
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(turnId)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).toContain(SENTENCE);
      expect(replay.assistant_text, `restart=${restart}`).toBe(first.assistant_text);
    }
  });

  it('CONTROL: the same risk with a figure → no treated-as-zero sentence', async () => {
    riskValued = true;
    const body = (await runTurn(randomUUID())).json() as Body;
    expect(body.assistant_text.startsWith(RUN_RESULT_READY_TEXT)).toBe(true);
    expect(body.assistant_text).not.toContain('treats it as zero');
  });

  it('the sentence survives the withheld-leader rails: no leader claim, no ranking sentence', () => {
    expect(findLeaderClaims({ assistant_text: SENTENCE, blocks: [], suggested_actions: [] } as never)).toEqual([]);
    expect(dropRankingSentences(SENTENCE)).toEqual({ text: SENTENCE, droppedSentences: 0 });
  });

  // ⛔ Codex #2577 P1: the sentence speaks of the result on screen. When the readback no longer binds to this Run, the
  // readback's roots are not the ones the Run treated as zero, so nothing is said — live, on a replay, or after a restart.
  it.each([
    ['stale: an edit landed before the readback', 'stale'],
    ['no result in the readback', 'no_result'],
  ] as const)('RED: Run ran, readback %s → no treated-as-zero sentence, live or replayed', async (_n, kind) => {
    readback = kind;
    const turnId = randomUUID();
    const first = (await runTurn(turnId)).json() as Body;
    expect(first.assistant_text.startsWith(RUN_RESULT_READY_TEXT)).toBe(false); // the unbound headline, not "ready"
    expect(first.assistant_text).not.toContain('treats it as zero');
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(turnId)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).not.toContain('treats it as zero');
    }
  });

  // ⛔ Codex #2577 r1 P2 + r2 P2 ×3: a node label is user text, and every editor after placement reads text. A label that one
  // of them would rewrite, cut or truncate is not quoted: the label-free form is said, whole, once — live, on replay and
  // after a restart. The leader is withheld here, so the wire's ranking drop and the shared gate both run.
  it.each([
    ['". " + ranking word (r1)', 'Competitor wins. Demand falls', 'Demand falls'],
    ['"? " + ranking word (r1)', 'Who wins? Demand falls', 'Demand falls'],
    ['"! " + ranking word (r1)', 'Rival leads! Demand falls', 'Demand falls'],
    ['an option name + "leads" (r2 #1)', 'Hire a Tech Lead leads. Demand falls', 'Demand falls'],
    ['implicit leader words, no option named (r2 #1)', 'The analysis shows which option leads', 'which option leads'],
    ['a proposal id (r2 #2)', 'Competitor wins. Demand prop_abcdef falls', 'Demand'],
    ['a backticked proposal id (r2 #2)', 'Demand `prop_abc123` falls', 'Demand'],
    ['the at-rest questions marker (r2 #3)', 'Demand falls. Questions this model does not answer yet: What now?', 'What now'],
  ])('RED: a risk labelled with %s → the label-free line, whole, once, live and replayed', async (_n, label, tail) => {
    riskLabel = label;
    const turnId = randomUUID();
    const first = (await runTurn(turnId)).json() as Body;
    expect(first.assistant_text.startsWith(RUN_RESULT_READY_TEXT)).toBe(true);
    expect(first.assistant_text.split(TREATED_AS_ZERO_UNNAMED_ONE)).toHaveLength(2);
    expect(first.assistant_text.split('treats it as zero')).toHaveLength(2);
    expect(first.assistant_text).not.toContain(tail);
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(turnId)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).toBe(first.assistant_text);
    }
  });

  it.each([
    ['an ordinary label', 'Demand shortfall'],
    ['a label with abbreviation full stops and no ranking word', 'U.S. demand shortfall'],
    ['a line break, collapsed', 'Demand\nshortfall'],
  ])('CONTROL: %s → the labelled sentence, whole, once', async (_n, label) => {
    riskLabel = label;
    const shown = label.replace(/\s+/g, ' ');
    const sentence = `No figure is set for "${shown}" yet, so the analysis treats it as zero. How likely or how large is it today?`;
    const body = (await runTurn(randomUUID())).json() as Body;
    expect(body.assistant_text.split(sentence)).toHaveLength(2);
    expect(body.assistant_text).not.toContain(TREATED_AS_ZERO_UNNAMED_ONE);
  });

  // One row per editor: each label is rewritten by exactly that editor, so dropping that check from
  // `survivesReplyEditors` turns exactly its row RED.
  it.each([
    ['the proposal-id scrub', 'Demand prop_abcdef12 falls'],
    ['the at-rest marker parse (whitespace before the marker, as the consumer splits)', 'Demand Questions this model does not answer yet: what now'],
    ['the ranking drop', 'Competitor wins. Demand falls'],
    ['the option-name gate', 'Hire a Tech Lead backlog'],
    ['a line break that reached the check', 'Demand\nfalls'],
  ])('survivesReplyEditors: %s → not quoted', (_n, label) => {
    const line = `No figure is set for "${label}" yet, so the analysis treats it as zero. How likely or how large is it today?`;
    expect(survivesReplyEditors(line, graphWith(false, label), READY)).toBe(false);
  });
  it('survivesReplyEditors CONTROL: the ordinary label is quoted, and both label-free forms survive every editor', () => {
    expect(survivesReplyEditors(SENTENCE, graphWith(false), READY)).toBe(true);
    expect(survivesReplyEditors(TREATED_AS_ZERO_UNNAMED_ONE, graphWith(false), READY)).toBe(true);
    expect(treatedAsZeroReplyLine(graphWith(false), READY)).toBe(SENTENCE);
    expect(treatedAsZeroReplyLine(graphWith(false, 'Hire a Tech Lead backlog'), READY)).toBe(TREATED_AS_ZERO_UNNAMED_ONE);
  });

  it('the protected line is kept only where it stands whole; a neighbouring ranking sentence still goes', () => {
    const line = 'No figure is set for "Competitor wins. Demand falls" yet, so the analysis treats it as zero. How likely or how large is it today?';
    const text = `Hire a Tech Lead is the best option here.\n\n${line}`;
    const out = dropRankingSentences(text, undefined, [line]);
    expect(out.text).toBe(line);
    expect(out.droppedSentences).toBe(1);
    // CONTROL: unprotected, the same line is cut into fragments.
    expect(dropRankingSentences(line).text).not.toBe(line);
  });
});
