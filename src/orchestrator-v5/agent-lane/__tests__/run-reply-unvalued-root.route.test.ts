import { runPressToolResponse } from './fixtures/run-press-model.js';
/**
 * The real Run/replay route carries the canonical unknown-risk withholding ask.
 * Its result seam replays a historical Run; this does not license a new Run on
 * the unsupported graph. Exact response/restart and stale-result checks remain.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionInputAsk } from '../decision-input-ask.js';
import { sentencesOf } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
const RUN_INTERPRETATION = 'The model result is provisional.';
import { dropRankingSentences } from '../withheld-leader-fail-closed.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import { survivesReplyEditors, treatedAsZeroReplyLine, missingRootUnnamedLine } from '../root-line.js';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '9b9a4b81-aaaa-4aaa-8aaa-aaaaaaaa0002';
const HASH = String(SERVED.block.computed_against_hash);
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const WITHHELD_FINDING = 'This run doesn’t yet show each option’s chance of meeting your goal.';
const riskAsk = (label: string): string => `How likely or how large is "${label}" today? The numerical analysis is withheld until this risk has a supported value. You can also ask Olumi to propose a labelled starting assumption for review.`;
const SENTENCE = riskAsk('Demand shortfall');
const MISSING_ROOT_UNNAMED_ONE = missingRootUnnamedLine(1);

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
  app.post('/assist/v1/scenarios/:id/graph', async () => {
    const graph = graphWith(riskValued, riskLabel);
    const analysis_state = readback === 'stale' ? staleState() : state();
    const analysis_result = readback === 'no_result' ? null : SERVED.block;
    // Reconstruct only the successful fact wrapper for the captured Run; the read's public result owns cell gating.
    const canonical_analysis_view = projectCanonicalAnalysisView({ graph,
      runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
        scenario_id: SCENARIO, run_id: 'fixture-unvalued-root-run', summary: SERVED.block.summary,
        leading_option_id: SERVED.block.leading_option_id, enrichment: SERVED.block.enrichment,
        graph_hash_at_run: HASH, computed_at: analysis_state.run_state.computed_at,
      } } as never,
      analysisState: analysis_state as never, analysisReady: READY, currentResult: analysis_result as never });
    return { graph, graph_hash: HASH, analysis_ready: READY, analysis_state, canonical_analysis_view,
      ...(analysis_result === null ? {} : { analysis_result }) };
  });
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

type Body = { assistant_text: string; _answer_shape?: AnswerShape; narration?: { status: string; run_key: string } };

function expectWithheldContract(body: Body, rootLine?: string): void {
  const shape = body._answer_shape;
  expect(shape, body.assistant_text).toBeDefined();
  expect(shape!.headline).toBe('Not shown yet; why is under More detail');
  const rootOwnsAsk = rootLine?.includes('?') === true;
  const targetAsk = rootOwnsAsk ? null : decisionInputAsk(graphWith(riskValued, riskLabel), {
    restingText: [RUN_INTERPRETATION, rootLine, WITHHELD_FINDING].filter(Boolean).join('\n\n'),
    questionsToggle: false, awaitingApproval: false, builtOrRan: true,
  });
  if (!rootOwnsAsk) expect(targetAsk).toBe('What figure should "Meet our next feature-launch deadline" reach or stay under? I\'ll propose it as your target.');
  const targetSentences = targetAsk === null ? [] : sentencesOf(targetAsk);
  expect(shape!.bullets).toEqual([rootOwnsAsk ? rootLine! : targetSentences[0]!]);
  expect(shape!.detail).toBe([RUN_INTERPRETATION, rootOwnsAsk ? undefined : rootLine, ...targetSentences.slice(1), WITHHELD_FINDING].filter(Boolean).join('\n\n'));
  expect(shape!.detail.split(WITHHELD_FINDING)).toHaveLength(2);
  expect(body.assistant_text.split(WITHHELD_FINDING)).toHaveLength(2);
  expect(body.assistant_text).toBe(deriveAnswerTextFromShape(shape!));
  expect(body.assistant_text.split(RUN_INTERPRETATION)).toHaveLength(2);
  if (rootLine !== undefined) expect(body.assistant_text.split(rootLine)).toHaveLength(2);
  for (const sentence of targetSentences) expect(body.assistant_text.split(sentence)).toHaveLength(2);
  const face = [shape!.headline, ...shape!.bullets].join('\n');
  expect(face).not.toContain(WITHHELD_FINDING);
  expect(face.match(/\?/g) ?? []).toHaveLength(1);
}

describe('a native Run with an unvalued risk root carries the numerical withholding ask (live route)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => runPressToolResponse(JSON.parse(String(init?.body ?? '{}'))) ?? new Response(JSON.stringify({ output: [
      { type: 'message', content: [{ type: 'output_text', text: RUN_INTERPRETATION }] },
    ] }), { status: 200 })));
    app = await freshApp();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; riskValued = false; riskLabel = 'Demand shortfall'; readback = 'current'; });

  const runTurn = (turnId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: turnId, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });

  it('RED: the Run face leads with the withheld finding and one disclosure/ask; Olumi\'s ready line is in detail', async () => {
    const body = (await runTurn(randomUUID())).json() as Body;
    expect(goalChanceWithheldForAgent(SERVED.block, graphWith(riskValued, riskLabel))?.say).toBe(WITHHELD_FINDING);
    expectWithheldContract(body, riskValued ? undefined : SENTENCE);
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

  // NEVER RE-ASK parity (Codex r1 on #2664 P2): the live Run turn adds this line AFTER its never-re-ask rule, so it keeps its
  // question even when an earlier answer asked it; a lost response must replay those same words, not a shorter line.
  it('a lost Run response replays the live words after an earlier answer asked the root question (live = replay)', async () => {
    const earlier = { turn_id: randomUUID(), request_hash: 'agent_turn:earlier', assistant_message: `${RUN_INTERPRETATION} ${SENTENCE}` };
    store.readRecent.mockImplementation((async () => [earlier]) as never);
    try {
      const turnId = randomUUID();
      const first = (await runTurn(turnId)).json() as Body;
      expect(first.assistant_text, 'precondition: the live turn said the root line whole').toContain(SENTENCE);
      const replay = (await runTurn(turnId)).json() as Body;
      expect(replay.assistant_text).toBe(first.assistant_text);
    } finally {
      store.readRecent.mockImplementation(async () => []);
    }
  });

  it('CONTROL: the same risk with a figure → no treated-as-zero sentence', async () => {
    riskValued = true;
    const body = (await runTurn(randomUUID())).json() as Body;
    expectWithheldContract(body);
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
    expect(first.assistant_text.startsWith(RUN_INTERPRETATION)).toBe(false); // the unbound headline, not "ready"
    expect(first.assistant_text).not.toContain('treats it as zero');
    expect(first.assistant_text).not.toContain(SENTENCE);
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(turnId)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).not.toContain('treats it as zero');
      expect(replay.assistant_text, `restart=${restart}`).not.toContain(SENTENCE);
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
    expectWithheldContract(first, MISSING_ROOT_UNNAMED_ONE);
    expect(first.assistant_text.split(MISSING_ROOT_UNNAMED_ONE)).toHaveLength(2);
    expect(first.assistant_text.split('Numerical analysis is withheld')).toHaveLength(2);
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
    const sentence = riskAsk(shown);
    const body = (await runTurn(randomUUID())).json() as Body;
    expect(body.assistant_text.split(sentence)).toHaveLength(2);
    expect(body.assistant_text).not.toContain(MISSING_ROOT_UNNAMED_ONE);
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
    const line = `No figure is set for "${label}" yet, so the analysis treats it as zero. How likely or how large is "${label}" today?`;
    expect(survivesReplyEditors(line, graphWith(false, label), READY)).toBe(false);
  });
  // Plural and 3+: the WHOLE line is quoted or none of it; the count is the typed roots'.
  const withRisks = (labels: string[]): Rec => {
    const g = graphWith(false, labels[0]);
    labels.slice(1).forEach((label, i) => {
      (g.nodes as Rec[]).push({ id: `risk_${i + 2}`, kind: 'risk', label, category: 'observable' });
      (g.edges as Rec[]).push(edge(`risk_${i + 2}`, 'goal', true));
    });
    return g;
  };
  it.each([
    ['two ordinary labels', ['Demand shortfall', 'Supplier delay'],
      [riskAsk('Demand shortfall'), riskAsk('Supplier delay')].join(' ')],
    ['three ordinary labels', ['Demand shortfall', 'Supplier delay', 'Churn spike'],
      [riskAsk('Demand shortfall'), riskAsk('Supplier delay'), riskAsk('Churn spike')].join(' ')],
    ['two, one unsafe (either position)', ['Demand shortfall', 'Hire a Tech Lead leads. Demand falls'],
      missingRootUnnamedLine(2)],
    ['two, the first unsafe', ['Demand prop_abcdef12 falls', 'Supplier delay'],
      missingRootUnnamedLine(2)],
    ['three, the third label is unsafe', ['Demand shortfall', 'Supplier delay', 'The analysis shows which option leads'],
      missingRootUnnamedLine(3)],
    ['three, a displayed one unsafe', ['Demand shortfall', 'The analysis shows which option leads', 'Supplier delay'],
      missingRootUnnamedLine(3)],
  ])('treatedAsZeroReplyLine, %s → the exact line', (_n, labels, line) => {
    expect(treatedAsZeroReplyLine(withRisks(labels as string[]), READY)).toBe(line);
  });

  it('survivesReplyEditors CONTROL: the ordinary label is quoted, and both label-free forms survive every editor', () => {
    expect(survivesReplyEditors(SENTENCE, graphWith(false), READY)).toBe(true);
    expect(survivesReplyEditors(MISSING_ROOT_UNNAMED_ONE, graphWith(false), READY)).toBe(true);
    expect(survivesReplyEditors(missingRootUnnamedLine(3), graphWith(false), READY)).toBe(true);
    expect(treatedAsZeroReplyLine(graphWith(false), READY)).toBe(SENTENCE);
    expect(treatedAsZeroReplyLine(graphWith(false, 'Hire a Tech Lead backlog'), READY)).toBe(MISSING_ROOT_UNNAMED_ONE);
  });

  it('the protected line is kept only where it stands whole; a neighbouring ranking sentence still goes', () => {
    const line = 'No figure is set for "Competitor wins. Demand falls" yet, so the analysis treats it as zero. How likely or how large is "Competitor wins. Demand falls" today?';
    const text = `Hire a Tech Lead is the best option here.\n\n${line}`;
    const out = dropRankingSentences(text, undefined, [line]);
    expect(out.text).toBe(line);
    expect(out.droppedSentences).toBe(1);
    // CONTROL: unprotected, the same line is cut into fragments.
    expect(dropRankingSentences(line).text).not.toBe(line);
  });
});
