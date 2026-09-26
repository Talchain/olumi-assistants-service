/**
 * ⭐ THE AUTOMATIC FIRST ANALYSIS SHOWS ITS ONE RUN-TURN COACHING CARD (run-turn coaching contract, #1855).
 * Since the limit-first rule (#70, Paul's manual test 1a298d6d), a run whose leader is withheld FOR A LIMIT —
 * as this fixture's is — shows the limit card (coaching/limit-unchecked-card.ts), never a link card.
 *
 * Paul (24 Sep): a blank first experience is not acceptable. On this lane the automatic run is always
 * leader-withheld and has no decision_review, so the run's own upstream blocks carry no coaching; the
 * card `runTurnCoaching` builds from the hash-bound readback is what the first pass shows.
 *
 * The real route, the real builder, the real first-analysis runner, over a product double (the
 * `first-analysis-route.test.ts` harness). The run orchestration and the readback answer from the
 * SERVED agent-lane capture `c19-8428207-B` turn t2 (CEE 8428207; constraint verdict withheld;
 * 12 fragile edges). The model is a fetch stub: no provider, no network.
 */
import { readFileSync } from 'node:fs';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { CoachingBlockSchema } from '@talchain/schemas/boundary';
import { READY_GRAPH, BLOCKED_GRAPH } from './fixtures/first-analysis-graphs.js';
import { runTurnCoaching } from '../analysis-coaching-pass-through.js';

type Turn = { graph_hash: string; analysis_state: Record<string, unknown>; analysis_ready: unknown; analysis_result: Record<string, unknown> };
const fixture = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/c19-8428207-B.run-turns.trimmed.json', import.meta.url), 'utf8')) as { turns: Record<string, Turn> };
const T2 = fixture.turns.t2!;
const COMPUTED_AT = (T2.analysis_state.run_state as { computed_at: string }).computed_at;

interface Scenario { registered: boolean; graph: typeof READY_GRAPH; ran: boolean; inProcessRuns: number; injectRuns: number }
const scenarios = new Map<string, Scenario>();
const st = (sid: string): Scenario => {
  let s = scenarios.get(sid);
  if (s === undefined) { s = { registered: false, graph: READY_GRAPH, ran: false, inProcessRuns: 0, injectRuns: 0 }; scenarios.set(sid, s); }
  return s;
};

/** Knobs, reset per test. `stale`: the readback after the run no longer shows it as current. */
let knobs: { graph: typeof READY_GRAPH; readbackAfterRun: 'current' | 'stale' } = { graph: READY_GRAPH, readbackAfterRun: 'current' };

const { runStub } = vi.hoisted(() => ({ runStub: { impl: null as null | ((a: unknown) => Promise<unknown>) } }));
vi.mock('../../handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dispatchChipClickRunAnalysis: (a: unknown) => runStub.impl!(a) };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async () => ({ status: 'ok', facts: [] }) };
});
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const BRIEF = 'Should we raise the Pro price or grow the Pro subscriber base to lift MRR?';
const candidate = {
  goal: { metric: 'MRR', operator: '>=', value: 100, unit: 'k', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Raise the Pro price', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Pro subscriber base', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'k', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'MRR', provenance: 'inferred' }],
  links: [{ from: 'Pro subscriber base', to: 'MRR', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};

let script: Array<Record<string, unknown>> = [];
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: 'c1', arguments: JSON.stringify(args) }] });

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
    if (body.text?.format?.type === 'json_schema') {
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }] }), { status: 200 });
    }
    const next = body['tool_choice'] === 'none' ? undefined : script.shift();
    return new Response(JSON.stringify(next ?? say('Here is a provisional first pass to argue with.')), { status: 200 });
  }));
}

/** The served B t2 readback once a run exists; before that, the built model with no analysis. */
function readbackOf(s: Scenario): Record<string, unknown> {
  if (!s.registered) return { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
  if (!s.ran) return { graph: s.graph, graph_hash: T2.graph_hash, analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } } };
  if (knobs.readbackAfterRun === 'stale') {
    return { graph: s.graph, graph_hash: T2.graph_hash, analysis_state: { ...T2.analysis_state, run_state: { kind: 'complete_stale', computed_at: COMPUTED_AT, cause: 'graph_changed' }, usable_for_chips: false } };
  }
  return { graph: s.graph, graph_hash: T2.graph_hash, analysis_state: T2.analysis_state, analysis_result: T2.analysis_result, analysis_ready: T2.analysis_ready };
}

async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async (req) => readbackOf(st((req.params as { id: string }).id)));
  a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const s = st((req.params as { id: string }).id);
    s.registered = true;
    s.graph = knobs.graph;
    return { registered: true, graph_hash: T2.graph_hash, model_version: { version_id: '00000000-0000-4000-8000-000000000001', version_number: 1 } };
  });
  a.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
  a.post('/orchestrate/v2/turn', async (req) => {
    const b = req.body as { scenario_id: string; chip?: { action_type?: string } };
    if (b.chip?.action_type === 'run_analysis') {
      const s = st(b.scenario_id);
      s.injectRuns += 1;
      s.ran = true;
      return { assistant_text: 'Ran.', graph_hash: T2.graph_hash, blocks: [T2.analysis_result], analysis_ready: T2.analysis_ready, analysis_state: T2.analysis_state };
    }
    return { assistant_text: 'ok', blocks: [] };
  });
  await a.register(agentV1TurnRoute);
  await a.ready();
  return a;
}

/** The ONE run orchestration, stubbed: it answers what the served run answered — a result, no analysis_state. */
function installRunStub() {
  runStub.impl = async (raw: unknown) => {
    const s = st((raw as { payload: { scenario_id: string } }).payload.scenario_id);
    s.inProcessRuns += 1;
    s.ran = true;
    return {
      outcome: 'ok', commitPerformed: true, graph: null, mayNameLeadingOption: false, analysisReady: T2.analysis_ready,
      response: { response_version: 2, assistant_text: 'Ran.', suggested_actions: [], insights: [], stage_indicator: 'analyse', blocks: [T2.analysis_result] },
    };
  };
}

type Block = Record<string, unknown> & { type?: string };
type Reply = {
  blocks?: Block[];
  graph_hash?: string;
  analysis_state?: { run_state?: { computed_at?: string } };
  _diagnostic_trace: { fast_path?: string; first_analysis?: Record<string, unknown>; coaching?: { eligible: boolean; reason?: string } };
};

let n = 0;
let SID = '';
const turn = async (app: FastifyInstance, payload: Record<string, unknown>) => {
  const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } });
  expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
  return r.json() as Reply;
};
const buildTurn = (app: FastifyInstance) => {
  script = [callTool('build_model_from_brief', { brief: BRIEF })];
  return turn(app, { message: BRIEF });
};
const coachingOf = (r: Reply) => (r.blocks ?? []).filter((b) => b.type === 'coaching');
const FIRST_PASS = 'Before relying on this first pass on Olumi\'s estimates';
const LEADER = /option in front|winner|recommend|best option|leading option/i;

describe('the automatic first analysis shows the fragile-link coaching card', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    installFetch();
    installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    n += 1; SID = `7b1e2d3c-4a5f-4e6d-8c7b-8a9f0e1d2c${String(n).padStart(2, '0')}`;
    script = [];
    knobs = { graph: READY_GRAPH, readbackAfterRun: 'current' };
  });

  it('RED: a brief that builds an admissible model → ONE automatic run, and exactly one card bound to it', async () => {
    const r = await buildTurn(app);
    expect(r._diagnostic_trace.first_analysis, 'control: the automatic first analysis ran').toMatchObject({ ran: true });
    expect(st(SID).inProcessRuns).toBe(1);
    expect(st(SID).injectRuns).toBe(0);
    const cards = coachingOf(r);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(CoachingBlockSchema.safeParse(card).success).toBe(true);
    // IDENTITY: the card the contract builds for THIS run (a stateless automatic capture) on THIS readback.
    const expected = runTurnCoaching(
      { scenario_id: SID, status: 200, analysis_ready: T2.analysis_ready, blocks: [T2.analysis_result], trigger: 'auto_first_pass' },
      { scenarioId: SID, graphHash: T2.graph_hash, analysisState: T2.analysis_state, analysisResult: T2.analysis_result },
    ).blocks[0]!;
    expect(card.block_id).toBe(expected.block_id);
    expect(card.signal_id).toBe(expected.signal_id);
    // The route's egress sanitiser (agent-v1-turn.ts, sanitiseOlumiResponseForEgress) leaves the card's words byte-identical.
    const words = (b: Record<string, unknown>) => ({ title: b.title, body: b.body, action_label: b.action_label, action_prompt: b.action_prompt });
    expect(words(card)).toEqual(words(expected as unknown as Record<string, unknown>));
    expect(String(card.signal_id).endsWith(`:${T2.graph_hash}:${COMPUTED_AT}:auto_first_pass`)).toBe(true);
    // Bound to the revision and the run the reply itself shows.
    expect(card.graph_hash_at_generation).toBe(r.graph_hash);
    expect(card.created_at).toBe(r.analysis_state?.run_state?.computed_at);
    // First-pass copy, one conversational action, leader-free on this withheld run.
    expect(String(card.body).startsWith(FIRST_PASS)).toBe(true);
    // c19-B t2's leader is withheld FOR A LIMIT, so the one card is the limit card (limit first, #70), never a link card.
    expect(String(card.signal_id).startsWith('coach:limit_unchecked:')).toBe(true);
    expect(card.action_label).toBe('What this means for my limits');
    for (const field of ['title', 'body', 'action_label', 'action_prompt'] as const) expect(String(card[field])).not.toMatch(LEADER);
    expect((r.blocks ?? []).filter((b) => b.type === 'analysis_result')).toHaveLength(1);
    expect(r._diagnostic_trace.coaching).toEqual({ eligible: true });
    expect(r._diagnostic_trace.first_analysis).toMatchObject({ coaching_blocks: 1 });
  });

  it('RED: an explicit Run on the same model → its OWN card (explicit copy, a different block_id)', async () => {
    const auto = coachingOf(await buildTurn(app))[0];
    const r = await turn(app, { message: 'Run analysis.', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
    expect(r._diagnostic_trace.fast_path).toBe('run');
    expect(st(SID).injectRuns, 'control: the explicit Run ran').toBe(1);
    const cards = coachingOf(r);
    expect(cards).toHaveLength(1);
    expect(String(cards[0]!.signal_id).endsWith(':explicit_run')).toBe(true);
    expect(String(cards[0]!.body).startsWith(FIRST_PASS)).toBe(false);
    expect(auto, 'control: the automatic card existed').toBeDefined();
    expect(cards[0]!.block_id).not.toBe(auto!.block_id);
    expect(r._diagnostic_trace.coaching).toEqual({ eligible: true });
  });

  it('RED: the readback no longer shows the run as current → no card, reason identity_mismatch', async () => {
    knobs.readbackAfterRun = 'stale';
    const r = await buildTurn(app);
    expect(st(SID).inProcessRuns, 'control: the run happened').toBe(1);
    expect(coachingOf(r)).toEqual([]);
    expect(r._diagnostic_trace.coaching).toEqual({ eligible: false, reason: 'identity_mismatch' });
  });

  it('RED: NOT admissible → no run, no card, reason no_run_this_turn', async () => {
    knobs.graph = BLOCKED_GRAPH;
    const r = await buildTurn(app);
    expect(r._diagnostic_trace.first_analysis).toMatchObject({ ran: false, reason: 'not_admissible' });
    expect(st(SID).inProcessRuns).toBe(0);
    expect(coachingOf(r)).toEqual([]);
    expect(r._diagnostic_trace.coaching).toEqual({ eligible: false, reason: 'no_run_this_turn' });
  });
});
