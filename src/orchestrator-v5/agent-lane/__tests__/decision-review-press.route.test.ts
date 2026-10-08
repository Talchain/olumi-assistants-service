/**
 * ⭐ A4 SLICE 1 on the LIVE route: the "Review this decision" press (lease #87 5991360031). Harness:
 * `run-reply-unvalued-root.route.test.ts` (the route, the model stubbed, a store double that reads answer rows back as
 * the real store does), on the served withheld block (0948Z) with the gate-2 case's graph shape (9b9a4b81).
 *
 * Outcome metric M1 (Paul's held-out a994c38a): the default-0 risk is surfaced, with its ask, by a press that calls no
 * model. The leader is withheld here, so the wire's ranking drop and shared gate run over the review: every item must
 * reach the user whole.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DECISION_REVIEW_OPENING, DECISION_REVIEW_PRESS_ID } from '../decision-review-press.js';
import { RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../run-explanation.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { structuralChallengePressId } from '../method-turn/structural-challenge-turn.js';
import { guidanceHistoryOf } from '../turn-context/guidance-history.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '9b9a4b81-aaaa-4aaa-8aaa-aaaaaaaa0003';
const HASH = String(SERVED.block.computed_against_hash);
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const ROOT_SENTENCE = 'No figure is set for "Demand shortfall" yet, so the analysis treats it as zero. How likely or how large is "Demand shortfall" today?';
const WITHHELD_SAY = goalChanceWithheldForAgent(SERVED.block)!.say;

type Rec = Record<string, unknown>;
const option = (id: string, label: string, interventions: Rec, is_baseline = false): Rec => ({
  id, option_id: id, kind: 'option', label, interventions, is_baseline,
});
const edge = (from: string, to: string, negative = false): Rec => ({
  from, to, strength: { mean: negative ? -0.4 : 0.4, std: 0.1 },
  exists_probability: 1, effect_direction: negative ? 'negative' : 'positive',
});
function graph(): Rec {
  const options = [
    option('hire_lead', 'Hire a Tech Lead', { tech_leads: { value: 2 / 10, source: 'brief_extraction' } }),
    option('hire_two', 'Hire Two Developers', { developers: { value: 6 / 30, source: 'brief_extraction' } }),
    option('carry_on', 'Carry On as Now', {}, true),
  ];
  return {
    goal_node_id: 'goal', options,
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Hiring approach' },
      { id: 'goal', kind: 'goal', label: 'Meet our next feature-launch deadline' },
      { id: 'tech_leads', kind: 'factor', label: 'Tech leads', category: 'controllable',
        observed_state: { value: 1 / 10, raw_value: 1, unit: 'people', source: 'brief_extraction' } },
      { id: 'developers', kind: 'factor', label: 'Developers', category: 'controllable',
        observed_state: { value: 4 / 30, raw_value: 4, unit: 'people', source: 'brief_extraction' } },
      { id: 'productivity', kind: 'factor', label: 'Delivery productivity', category: 'observable',
        observed_state: { value: 20 / 100, raw_value: 20, unit: 'feature points/week', source: 'brief_extraction' } },
      { id: 'demand_shortfall', kind: 'risk', label: 'Demand shortfall', category: 'observable' },
      ...options,
    ],
    edges: [
      ...options.map((o) => edge('decision', String(o.id))),
      edge('hire_lead', 'tech_leads'), edge('hire_two', 'developers'), edge('carry_on', 'tech_leads'), edge('carry_on', 'developers'),
      edge('tech_leads', 'productivity'), edge('developers', 'productivity'), edge('productivity', 'goal'),
      edge('demand_shortfall', 'goal', true),
    ],
  };
}

let runKind: 'complete_current' | 'complete_stale' = 'complete_current';
/**
 * 'g2' = the gate-2 case (withheld leader); 'b5' = the served b5 a6ed1bff graph + PLoT response with a licensed leader;
 * 'b5held' = a later Run on the same graph whose leader is withheld (so SCI-CHANGE would not answer).
 */
let fixture: 'g2' | 'b5' | 'b5held' = 'g2';
/** A competing writer: every graph read after this many sees the Run gone stale. */
let staleAfterReads = Number.POSITIVE_INFINITY;
let graphReads = 0;
const B5 = '../../../../tests/fixtures/cross-service/b5-per-limit/';
const B5_STORED = JSON.parse(readFileSync(new URL(`${B5}a6ed1bff.graph.json`, import.meta.url), 'utf8')) as { graph: Rec; graph_hash: string };
const B5_PLOT = JSON.parse(readFileSync(new URL(`${B5}a6ed1bff.plot-response.json`, import.meta.url), 'utf8')) as Rec;
const B5_BLOCK = { type: 'analysis_result', computed_against_hash: B5_STORED.graph_hash, enrichment: B5_PLOT };
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
  /** Read as served, so the guidance selector runs on every turn (`t2-guidance-wire.test.ts`): no row offered yet. */
  readGuidanceHistory: vi.fn(async () => guidanceHistoryOf([])),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const state = (kind = runKind) => ({ ...SERVED.analysis_state, run_state: kind === 'complete_current'
  ? { kind: 'complete_current', computed_at: '2026-10-05T03:48:55.163Z' }
  : { kind: 'complete_stale', computed_at: '2026-10-05T03:48:55.163Z', cause: 'graph_changed' } });

const modelCalls = vi.fn(async () => new Response(JSON.stringify({ output: [] }), { status: 200 }));
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'unused', suggested_actions: [], insights: [],
    graph_hash: HASH, blocks: [SERVED.block], analysis_state: state(), analysis_ready: READY }));
  app.post('/assist/v1/scenarios/:id/graph', async () => {
    graphReads += 1;
    const moved = graphReads > staleAfterReads;
    return fixture === 'g2'
      ? { graph: graph(), graph_hash: HASH, analysis_ready: READY, analysis_state: state(moved ? 'complete_stale' : runKind), analysis_result: SERVED.block }
      : { graph: B5_STORED.graph, graph_hash: B5_STORED.graph_hash, analysis_ready: READY,
        // The served state's shape (0948Z: `usable_for_chips`/`usable_for_prose`), with a licensed leader.
        analysis_state: { ...SERVED.analysis_state, run_state: { kind: 'complete_current', computed_at: fixture === 'b5' ? '2026-10-05T03:48:55.163Z' : '2026-10-05T09:12:00.000Z' },
          leader_claim: fixture === 'b5' ? { permitted: true, separation: 'separated' } : { permitted: false, withheld_reason: 'separation_unavailable' } },
        analysis_result: B5_BLOCK };
  });
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

type Body = { assistant_text: string; suggested_actions?: Array<{ id: string; label: string }>; guidance?: { slot1?: unknown; slot2?: unknown }; diagnostic?: { fast_path?: string; timing?: { provider_calls?: number } } };

describe('the "Review this decision" press on the live route', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', modelCalls);
    app = await freshApp();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    rows.length = 0; runKind = 'complete_current'; fixture = 'g2'; staleAfterReads = Number.POSITIVE_INFINITY; graphReads = 0;
    modelCalls.mockClear();
  });
  const chips = (b: Body): string[][] => (b.suggested_actions ?? []).map((a) => [a.id, a.label]);
  const TEST_LINK = [structuralChallengePressId({ from_id: 'pro_plan_price', to_id: 'mrr' }), 'Test without this link'];
  const WHAT_WOULD_CHANGE = ['agent-next-what-would-change', 'What would change this?'];

  const press = (turnId: string) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { scenario_id: SCENARIO, turn_id: turnId, message: 'Review this decision', source: 'chip_click', chip: { id: DECISION_REVIEW_PRESS_ID } } });

  it('RED (M1): the default-0 risk with its ask, and the typed goal-figure reason, each whole, with no model call', async () => {
    const body = (await press(randomUUID())).json() as Body;
    expect(body.assistant_text).toBe([DECISION_REVIEW_OPENING, '', `- ${ROOT_SENTENCE}`, `- ${WITHHELD_SAY}`].join('\n'));
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('a lost response replays the same words, also after a restart', async () => {
    const turnId = randomUUID();
    const first = (await press(turnId)).json() as Body;
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await press(turnId)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).toBe(first.assistant_text);
    }
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('RED: a replay after the Run went stale says today\'s answer, not the earlier review (also after a restart)', async () => {
    const turnId = randomUUID();
    expect(((await press(turnId)).json() as Body).assistant_text).toContain(ROOT_SENTENCE);
    runKind = 'complete_stale';
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      // S-B (Codex r1 P2-3 on #2751): the replay says what the live press says today: the typed "can't yet" with its exit.
      expect(((await press(turnId)).json() as Body).assistant_text, `restart=${restart}`).toBe('I can’t review this decision yet: it needs a current analysis first.');
    }
  });

  it('RED: each item\'s next step is offered as the existing press — the link test for its link, What would change', async () => {
    fixture = 'b5';
    const body = (await press(randomUUID())).json() as Body;
    expect(body.assistant_text).toContain('The link from ‘Pro plan price’ to ‘MRR’ is one of the links this result is most sensitive to.');
    expect(chips(body)).toEqual([TEST_LINK, WHAT_WOULD_CHANGE]);
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('RED (Science (c)): a Run whose leader is withheld → no What would change (SCI-CHANGE would not answer it)', async () => {
    fixture = 'b5held';
    expect(chips((await press(randomUUID())).json() as Body)).toEqual([TEST_LINK]);
  });

  it.each(['', 'explain_results'])('RED (Codex r2 P2): the review is the id-only press — a chip with its id and action_type %j is not one', async (actionType) => {
    const body = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { scenario_id: SCENARIO, turn_id: randomUUID(),
      message: 'Review this decision', source: 'chip_click', chip: { id: DECISION_REVIEW_PRESS_ID, action_type: actionType } } })).json() as Body;
    expect(body.assistant_text.startsWith(DECISION_REVIEW_OPENING)).toBe(false);
  });

  it.each(['g2', 'b5'] as const)('RED (Codex P2): a review offers its own presses only — no general next steps, no other method (%s)', async (f) => {
    fixture = f;
    const body = (await press(randomUUID())).json() as Body;
    expect(body.assistant_text.startsWith(DECISION_REVIEW_OPENING)).toBe(true);
    expect(chips(body)).toEqual(f === 'g2' ? [] : [TEST_LINK, WHAT_WOULD_CHANGE]);
    expect(body.guidance?.slot1).toBeUndefined();
    expect(body.guidance?.slot2).toBeUndefined();
  });

  it('RED (Codex P1): a Run another writer replaces before the reply is composed is not reviewed', async () => {
    staleAfterReads = 1;
    const body = (await press(randomUUID())).json() as Body;
    expect(graphReads).toBeGreaterThan(1);
    // S-B: the press is now re-derived on a read of its own first, so the replacement may be seen there (the typed "can't
    // yet") or at composition (the review's unavailable reply). Either way the replaced Run is never reviewed.
    expect([RUN_EXPLANATION_UNAVAILABLE_TEXT, 'I can’t review this decision yet: it needs a current analysis first.']).toContain(body.assistant_text);
  });

  it('RED (Codex P2): a replay after the Run is replaced offers today\'s presses only, also after a restart', async () => {
    fixture = 'b5';
    const turnId = randomUUID();
    expect(chips((await press(turnId)).json() as Body)).toEqual([TEST_LINK, WHAT_WOULD_CHANGE]);
    fixture = 'b5held';
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      expect(chips((await press(turnId)).json() as Body), `restart=${restart}`).toEqual([TEST_LINK]);
    }
  });

  // ⭐ S-B (ACTION-SYSTEM §D5, PL + DL binding, 7 Oct): a press whose precondition fails gets a typed "can't yet" AND a working
  // exit. This row pinned the old dead end ("nothing to press"); the review press is now gated on the current offer.
  it('S-B: a Run that is no longer current → a typed "can\'t yet" with the Run as its exit, no model call', async () => {
    runKind = 'complete_stale';
    const body = (await press(randomUUID())).json() as Body;
    expect(body.assistant_text).toBe('I can’t review this decision yet: it needs a current analysis first.');
    expect(body.assistant_text).not.toContain(ROOT_SENTENCE);
    expect(chips(body)).toEqual([['agent-run-analysis', 'Run analysis']]);
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('CONTROL: an ordinary message is not the press (no review opening)', async () => {
    const body = (await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Review this decision', source: 'typed' } })).json() as Body;
    expect(body.assistant_text.startsWith(DECISION_REVIEW_OPENING)).toBe(false);
  });
});
