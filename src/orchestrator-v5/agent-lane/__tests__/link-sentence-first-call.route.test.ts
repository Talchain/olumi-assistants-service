/**
 * ⭐ A TYPED SENTENCE SAYING HOW STRONG AN EXISTING LINK IS GOES TO `propose_link_strength` (AI Harness; DL design note
 * "Link-sentence defect", 6 Oct; `link-sentence-route.ts`).
 *
 * Through the REAL `/agent/v1/turn` route, 0 LLM: the provider's HTTP call is stubbed, and the stub answers in PROSE unless
 * the request FORCES `propose_link_strength`. So a must-fire row reaches the held change card only when the host forces
 * the first call, exactly the served defect (the Agent answered in prose and nothing reached the canvas).
 * Must-fire: the FIRST provider request carries `tool_choice: {type:'function', name:'propose_link_strength'}`, and the
 * turn ends on the tool's own held card (ok, nothing written). Must-not: that request's tool choice stays free.
 *
 * Graphs are REAL served graphs (`fixtures/served-link-sentence-graphs.json`, each with its capture path), except the
 * AUTHORED graph below. Every row says where its words came from:
 *   · CAPTURED (DL corpus): typed in output/acceptance-successor-20261005 (the DL's three-directory corpus);
 *   · CAPTURED (pre-restriction): typed in red-team-87 / r3-successor-996ec64d / rc-delivery-lead-20260925 captures,
 *     found before the DL narrowed the corpus;
 *   · AUTHORED: written for this PR (the brief's own sentences included).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { linkSentenceFirstCall, LINK_SENTENCE_TOOL } from '../link-sentence-route.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-link-sentence-graphs.json', import.meta.url), 'utf8')) as Record<string, { source: string; graph: Graph }>;
const DENTAL = (JSON.parse(readFileSync(new URL('./fixtures/served-dental-r18d-b38592ed.json', import.meta.url), 'utf8')) as { graph: Graph }).graph;
const g = (name: string): Graph => SERVED[name]!.graph;

const link = (from: string, to: string, mean: number): Record<string, unknown> => ({
  from, to, strength: { mean, std: 0.1 }, effect_direction: mean < 0 ? 'negative' : 'positive', exists_probability: 0.8,
  provenance: { source: 'cee_hypothesis' },
});
/** AUTHORED: the brief's own words need labels "Price", "Churn", "Marketing spend", "Sign-ups". */
const AUTHORED: Graph = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Decision: revenue' },
    { id: 'opt', kind: 'option', label: 'Raise the price' },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
    { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.3 } },
    { id: 'mkt', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.4 } },
    { id: 'signups', kind: 'factor', label: 'Sign-ups', observed_state: { value: 0.4 } },
    { id: 'rev', kind: 'goal', label: 'Revenue' },
  ],
  edges: [
    { from: 'dec', to: 'opt', strength: { mean: 1, std: 0.01 } }, { from: 'opt', to: 'price', strength: { mean: 1, std: 0.01 } },
    link('price', 'churn', 0.3), link('mkt', 'signups', 0.4), link('churn', 'rev', -0.5), link('signups', 'rev', 0.5),
  ],
};
/** AUTHORED: two nodes carry the label "Churn" (a factor and a risk); only one is linked from Price. */
const SHARED_LABEL: Graph = {
  nodes: [...AUTHORED.nodes, { id: 'churn_risk', kind: 'risk', label: 'Churn' }],
  edges: AUTHORED.edges,
};
const EMPTY: Graph = { nodes: [], edges: [] };

const rows = new Map<string, { id: string; request_hash: string } & Record<string, unknown>>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** The graph each scenario reads, and what the stub fills a FORCED call with (the model's job, scripted here). */
const graphs = new Map<string, Graph>();
let forcedArgs: Record<string, unknown> | undefined;
const sent: Record<string, unknown>[] = [];
const prose = (text: string): Record<string, unknown> => ({ type: 'message', role: 'assistant', id: `msg_${randomUUID()}`, status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });

type Turn = { first: Record<string, unknown>; body: { assistant_text: string; _agent?: { tool_calls?: { name: string; ok: boolean; mutated: boolean; proposal_id?: string; refusal?: string }[] } } };

describe('the REAL turn route: a typed link-strength sentence forces propose_link_strength, and only then', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      expect(String(url), 'every outbound call is the provider, stubbed').toMatch(/\/v1\/responses$/);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      sent.push(body);
      const choice = body['tool_choice'] as { name?: unknown } | undefined;
      if (choice !== undefined && typeof choice === 'object' && choice.name === LINK_SENTENCE_TOOL) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', id: `fc_${randomUUID()}`, call_id: `c_${randomUUID()}`,
          name: LINK_SENTENCE_TOOL, arguments: JSON.stringify(forcedArgs ?? { from_label: '?', to_label: '?', strength: 'strong', rationale: '?' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [prose('PROSE: noted, that is how you see that link.')] }), { status: 200 });
    }));
    vi.resetModules();
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const graph = graphs.get((req.params as { id: string }).id) ?? EMPTY;
      return { graph, graph_hash: graph.nodes.length === 0 ? null : `h-${(req.params as { id: string }).id}` };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const turn = async (graph: Graph, message: string, extra: Record<string, unknown> = {}, args?: Record<string, unknown>): Promise<Turn> => {
    const scenario = randomUUID();
    graphs.set(scenario, graph);
    forcedArgs = args;
    const before = sent.length;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message, turn_id: randomUUID(), ...extra } });
    expect(r.statusCode, r.body).toBe(200);
    const first = sent.slice(before).find((b) => Array.isArray(b['tools']) && (b['tools'] as unknown[]).length > 0);
    expect(first, 'the turn made its Agent call').toBeDefined();
    return { first: first!, body: r.json() as Turn['body'] };
  };
  const FORCED = { type: 'function', name: LINK_SENTENCE_TOOL };

  /**
   * [source, words, graph, from, to, band the stub fills, what the DOOR answers]. The door decides, never the route: a
   * link holding the user's own figure is refused `user_figure_held` (F1: a band would drop their figure, so they hear it
   * quoted), and that refusal is the right answer to the sentence. Either way nothing is written.
   */
  const MUST_FIRE: readonly [string, string, () => Graph, string, string, string, 'card' | 'user_figure_held'][] = [
    ['CAPTURED (pre-restriction) r3 f5 user_message', 'Actually AI reporting module availability has only a slight effect on Enterprise prospect signing likelihood — change that link to slight.', () => g('ai_reporting'), 'AI reporting module availability', 'Enterprise prospect signing likelihood', 'weak', 'card'],
    ['CAPTURED (pre-restriction) r3 crn-final2 user_message', 'I think AI reporting module availability has a much stronger effect on Enterprise prospect signing likelihood than Olumi assumed — make that link strong.', () => g('ai_reporting_rs1'), 'AI reporting module availability', 'Enterprise prospect signing likelihood', 'strong', 'card'],
    ['CAPTURED (pre-restriction) red-team f1-fix req', 'Make the Customers lost to price rise to MRR lost to price churn link weak.', () => g('customers_lost_f1fix'), 'Customers lost to price rise', 'MRR lost to price churn', 'weak', 'user_figure_held'],
    ['CAPTURED (pre-restriction) red-team f1-fix req, on the DL-corpus g1 graph', 'Make the Customers lost to price rise to MRR lost to price churn link weak.', () => g('customers_lost_g1'), 'Customers lost to price rise', 'MRR lost to price churn', 'weak', 'user_figure_held'],
    ['CAPTURED (pre-restriction) red-team f1-ui req', 'Make the Customer losses from price rise to monthly recurring revenue link weak.', () => g('customer_losses_f1ui'), 'Customer losses from price rise', 'monthly recurring revenue', 'weak', 'card'],
    ['CAPTURED (pre-restriction) red-team f1-ui req; "Price rise" is a node AND sits inside the longer label', 'Make the Customer losses from price rise to monthly recurring revenue link weak.', () => g('customer_losses_j4'), 'Customer losses from price rise', 'monthly recurring revenue', 'weak', 'user_figure_held'],
    ['CAPTURED (pre-restriction) red-team f1-ui req', 'Make the Customer losses from price rise to monthly recurring revenue link weak.', () => g('customer_losses_rt17'), 'Customer losses from price rise', 'monthly recurring revenue', 'weak', 'user_figure_held'],
    ['CAPTURED (pre-restriction) acceptance F8 req', 'I am confident about one link: the Pro plan price has a strong effect on MRR. Please record that link as strong, as my own estimate.', () => g('pro_plan_f8'), 'Pro plan price', 'MRR', 'strong', 'card'],
    ['CAPTURED (pre-restriction) acceptance F8 req', 'I am confident about one link: the Pro plan price has a strong effect on MRR. Please record that link as strong, as my own estimate.', () => g('pro_plan_pj0928'), 'Pro plan price', 'MRR', 'strong', 'card'],
    ['AUTHORED (the brief)', 'Price affects churn quite strongly.', () => AUTHORED, 'Price', 'Churn', 'strong', 'card'],
    ['AUTHORED (the brief)', 'Marketing spend has only a weak effect on sign-ups.', () => AUTHORED, 'Marketing spend', 'Sign-ups', 'weak', 'card'],
    ['AUTHORED (the prompt’s own example form)', 'Pro plan price barely affects MRR.', () => g('pro_plan_f8'), 'Pro plan price', 'MRR', 'weak', 'card'],
    ['AUTHORED (named target first, very strong)', 'Monthly churn is very strongly driven by Price sensitivity.', () => g('pro_plan_f8'), 'Price sensitivity', 'Monthly churn', 'very strong', 'card'],
  ];

  for (const [source, words, graph, from, to, band, door] of MUST_FIRE) {
    it(`MUST FIRE · ${source} → ${door}: "${words}"`, async () => {
      const { first, body } = await turn(graph(), words, {}, { from_label: from, to_label: to, strength: band, rationale: words, whole_request: true });
      expect(first['tool_choice'], 'the first Agent call is forced to the link-strength door').toEqual(FORCED);
      const call = body._agent?.tool_calls?.find((c) => c.name === LINK_SENTENCE_TOOL);
      if (door === 'card') {
        expect(call, JSON.stringify(body._agent?.tool_calls)).toMatchObject({ ok: true, mutated: false });
        expect(call?.proposal_id, 'a held card awaits the user’s approval').toMatch(/^prop_/);
      } else {
        expect(call, JSON.stringify(body._agent?.tool_calls)).toMatchObject({ ok: false, mutated: false, refusal: 'user_figure_held' });
      }
    });
  }

  /** [source, words, graph, why] */
  const MUST_NOT: readonly [string, string, () => Graph, string][] = [
    // CAPTURED (DL corpus: output/acceptance-successor-20261005)
    ['CAPTURED (DL corpus)', 'I think fixing the integration-step bug cuts trial profile abandonment much more than slightly. Please make that link strong, about -0.55.', () => g('ai_reporting'), 'a figure in numbers'],
    ['CAPTURED (DL corpus)', 'Each 1% Price rise increases Customers lost to price rise by about 3 customers', () => g('customers_lost_f1fix'), 'a figure, on the link it names'],
    ['CAPTURED (DL corpus)', 'Each 1% price rise loses about 3 customers.', () => g('price_rise_cut5'), 'a figure'],
    ['CAPTURED (DL corpus)', 'Record my figure for the link from Text reminder coverage to no-shows: each 10 percentage point rise in Text reminder coverage lowers no-shows by about 2 percentage points.', () => DENTAL, 'a figure, and no direct link'],
    ['CAPTURED (DL corpus)', 'When median first response goes up by 1 hour, customers waiting over one day rise by about 2 percentage points.', () => g('pro_plan_f8'), 'a figure'],
    ['CAPTURED (DL corpus)', 'Every 1 more Enterprise deals won adds about £40,000 per quarter of quarterly revenue.', () => g('ai_reporting'), 'a figure'],
    ['CAPTURED (DL corpus)', 'What would most likely change this result?', () => g('pro_plan_f8'), 'a question'],
    ['CAPTURED (DL corpus)', 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?', () => g('pro_plan_f8'), 'a supposition'],
    ['CAPTURED (DL corpus)', 'Is the value on this one from me or from you?', () => g('pro_plan_f8'), 'a question'],
    ['CAPTURED (DL corpus)', 'What would need to change for another option to be better supported than AI Reporting Module Sprint?', () => g('ai_reporting'), 'a question naming an option'],
    ['CAPTURED (DL corpus)', 'Test without this link', () => g('pro_plan_f8'), 'no link named, no band'],
    ['CAPTURED (DL corpus)', 'Yes, that one.', () => g('pro_plan_f8'), 'no link named'],
    // CAPTURED (pre-restriction)
    ['CAPTURED (pre-restriction) r3 rt-2470', 'Olumi’s estimate for how strongly AI reporting module availability affects Enterprise prospect signing likelihood looks right to me — keep it as it is.', () => g('ai_reporting'), 'an embedded question ("how strongly"): the user names no band'],
    ['CAPTURED (pre-restriction) r3 crn-final2', 'Integration-step bug resolution raises Enterprise prospect signing likelihood, moderately — add that link.', () => g('ai_reporting'), 'a NEW link: none exists between them'],
    ['CAPTURED (pre-restriction) r3 crn-final2', 'Integration-step bug resolution also directly affects Enterprise prospect signing likelihood — add that link.', () => g('ai_reporting'), 'a NEW link, no band'],
    ['CAPTURED (pre-restriction) release-captain read', 'Make the link from Integration Bug Fix Sprint to Integration-step bug resolution moderate.', () => g('ai_reporting'), 'an option end: no causal link between them'],
    ['CAPTURED (pre-restriction) aiconv gallery', 'I believe the effect of the Pro plan price on MRR is only weak, not strong. Please record that.', () => g('pro_plan_f8'), 'a denial in its sentence'],
    ['CAPTURED (pre-restriction) paul-test', 'Talk me through what would change if the link from Pro plan price to MRR were weaker or stronger. Don’t change the model or re-run anything yet.', () => g('pro_plan_f8'), 'a condition'],
    ['CAPTURED (pre-restriction) red-team f1-fix req', 'Replace my figure with slight on the Customers lost to price rise to MRR lost to price churn link.', () => g('customers_lost_f1fix'), '"slight on": no band by the tool’s own reader'],
    ['CAPTURED (pre-restriction)', 'Make that link strong — the pre-mortem says Olumi understated it.', () => g('ai_reporting'), 'no link named'],
    ['CAPTURED (pre-restriction) acceptance pj A16', 'Get on and update it to very strong. And the potential churn increase', () => g('pro_plan_f8'), 'no link named'],
    ['CAPTURED (pre-restriction) req corpus', 'What does this one affect, and how strongly does the model say it matters?', () => g('pro_plan_f8'), 'a question'],
    ['CAPTURED (pre-restriction)', 'I think strong.', () => g('pro_plan_f8'), 'no link named'],
    // AUTHORED: one discriminating row per class
    ['AUTHORED (the brief)', 'Price doesn’t affect churn.', () => AUTHORED, 'a denial, no band'],
    ['AUTHORED', 'Pro plan price doesn’t affect MRR strongly.', () => g('pro_plan_f8'), 'a denied band'],
    ['AUTHORED (negation after the band)', 'A strong effect of Pro plan price on MRR is not what we see.', () => g('pro_plan_f8'), 'a denial the band reader alone does not see'],
    ['AUTHORED (the brief)', 'Does price affect churn much?', () => AUTHORED, 'a question'],
    ['AUTHORED', 'Does Pro plan price strongly affect MRR?', () => g('pro_plan_f8'), 'a question with a band'],
    ['AUTHORED', 'Pro plan price strongly affects MRR, right?', () => g('pro_plan_f8'), 'a tag question'],
    ['AUTHORED (the brief)', 'If price affected churn strongly, renewals would show it.', () => AUTHORED, 'a condition'],
    ['AUTHORED', 'Pro plan price has a strong effect on MRR: every £1 loses about 50 subscribers.', () => g('pro_plan_f8'), 'a figure in another clause'],
    ['AUTHORED', 'Marketing spend strongly affects churn.', () => AUTHORED, 'a NEW link: none exists'],
    ['AUTHORED (2 candidates in one clause)', 'Pro plan price strongly drives MRR and Price sensitivity.', () => g('pro_plan_f8'), 'two existing links'],
    ['AUTHORED (2 links, 2 clauses)', 'Pro plan price strongly drives MRR; Price sensitivity weakly drives Monthly churn.', () => g('pro_plan_f8'), 'two links'],
    ['AUTHORED (a shared label)', 'Price strongly affects churn.', () => SHARED_LABEL, 'two nodes carry "Churn"'],
    ['AUTHORED (structure)', 'Raise Price to £59 strongly drives Pro plan price.', () => g('pro_plan_f8'), 'an option’s link is structure'],
    ['AUTHORED (first brief)', 'We sell a Pro plan, and Pro plan price strongly drives MRR.', () => EMPTY, 'an empty model: a first brief'],
  ];

  for (const [source, words, graph, why] of MUST_NOT) {
    it(`MUST NOT FIRE · ${source} · ${why}: "${words}"`, async () => {
      const { first, body } = await turn(graph(), words);
      expect(first['tool_choice'], 'the first Agent call stays free').toBeUndefined();
      expect(body._agent?.tool_calls?.some((c) => c.name === LINK_SENTENCE_TOOL) ?? false).toBe(false);
    });
  }

  it('MUST NOT FIRE · a pressed chip carrying a link sentence: the chip owns the turn', async () => {
    const { first } = await turn(g('pro_plan_f8'), 'Pro plan price barely affects MRR.', { chip: { id: 'link-sentence-control-chip' }, source: 'chip' });
    expect(first['tool_choice']).toBeUndefined();
  });

  /** KNOWN MISSES (pinned): today's free choice stays. On the wire the Agent called the tool itself for the first (red-team bw2619). */
  it.each([
    ['CAPTURED (pre-restriction) red-team bw2619: a partial label ("customer churn" for "Customer churn from price rise")', 'Make the price rise to customer churn link weak.', 'price_rise_cut5'],
    ['CAPTURED (pre-restriction) acceptance F8 variant: the ends and the band in different clauses', 'I am confident about one link: Pro plan price → MRR. Its effect is strong. Please record that link as strong, as my own estimate.', 'pro_plan_f8'],
  ])('KNOWN MISS · %s', async (_why, words, graph) => {
    const { first } = await turn(g(graph), words);
    expect(first['tool_choice']).toBeUndefined();
  });
});

describe('linkSentenceFirstCall: what it reads, and the precedence it yields', () => {
  const stateOf = (graph: Graph): Record<string, unknown> => ({ ok: true, entities: graph.nodes, links: graph.edges.map((e) => ({ from: e['from'], to: e['to'] })) });
  const F8 = 'I am confident about one link: the Pro plan price has a strong effect on MRR. Please record that link as strong, as my own estimate.';

  it('the control: a typed sentence on the read state fires', () => {
    expect(linkSentenceFirstCall(stateOf(g('pro_plan_f8')), F8, false)).toBe(LINK_SENTENCE_TOOL);
  });
  it('another forced path (a first brief’s host call, a method or widen turn) keeps precedence', () => {
    expect(linkSentenceFirstCall(stateOf(g('pro_plan_f8')), F8, true)).toBeUndefined();
  });
  it('a chip’s words (not typed), or an unread state, never fire', () => {
    expect(linkSentenceFirstCall(stateOf(g('pro_plan_f8')), null, false)).toBeUndefined();
    expect(linkSentenceFirstCall({ ok: false }, F8, false)).toBeUndefined();
    expect(linkSentenceFirstCall(undefined, F8, false)).toBeUndefined();
  });
});
