/**
 * ⭐ THE AUTOMATIC FIRST ANALYSIS ON THE REAL AGENT ROUTE (PR-B, tests 1a-7 and 9).
 *
 * Paul's ruling (5812069638): a brief builds a model AND the existing analysis runs ONCE on it,
 * when — and only when — the admission would run it. Later edits and approvals NEVER auto-run.
 * An explicit Run ALWAYS runs.
 *
 * The real route, the real builder, the real first-analysis runner, over a stateful product
 * double. Two seams only:
 *   · the ONE run orchestration (`dispatchChipClickRunAnalysis`) is stubbed — each call is one
 *     PLoT call, and it persists the fact the real dispatcher would, stamped from the trigger it
 *     was actually handed;
 *   · the prior-facts read returns those persisted facts.
 * The explicit Run goes through the product's own `/orchestrate/v2/turn`, counted separately.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { READY_GRAPH, BLOCKED_GRAPH } from './fixtures/first-analysis-graphs.js';

type RunArgs = { payload: { turn_id: string; scenario_id: string; chip?: { id?: string; action_type?: string } }; requestId: string; autoRun?: { draftTurnId: string } };
interface Scenario {
  registered: boolean;
  graph: typeof READY_GRAPH;
  extraEdges: { from: string; to: string }[];
  revision: number;
  versions: { version_id: string; sequence: number; creation: { kind: string; mutation_id: string; source_turn_id: string } }[];
  facts: HandlerFact[];
  inProcessRuns: RunArgs[];
  injectRuns: number;
  injectRunHashes: string[];
  forwarded: number;
}
const scenarios = new Map<string, Scenario>();
const st = (sid: string): Scenario => {
  let s = scenarios.get(sid);
  if (s === undefined) {
    s = { registered: false, graph: READY_GRAPH, extraEdges: [], revision: 0, versions: [], facts: [], inProcessRuns: [], injectRuns: 0, injectRunHashes: [], forwarded: 0 };
    scenarios.set(sid, s);
  }
  return s;
};
const hashOf = (s: Scenario) => `rev-${s.revision}`;

/** Knobs, reset per test. */
let knobs: {
  graph: typeof READY_GRAPH;
  coachingHash: 'readback' | 'other';
  runStateKind: 'complete_current' | 'complete_stale';
  leaderClaim: Record<string, unknown>;
  analysisReady?: Record<string, unknown>;
} = { graph: READY_GRAPH, coachingHash: 'readback', runStateKind: 'complete_current', leaderClaim: { permitted: false, withheld_reason: 'auto_initiated' } };

const { runStub } = vi.hoisted(() => ({ runStub: { impl: null as null | ((a: unknown) => Promise<unknown>) } }));
vi.mock('../../handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, dispatchChipClickRunAnalysis: (a: unknown) => runStub.impl!(a) };
});
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPriorFactsWithReadState: async (sid: string) => ({ status: 'ok', facts: [...st(sid).facts] }) };
});

/** Durable answer rows by (scenario, turn): a same-turn_id retry takes the REAL replay path. */
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
const candidate = {
  goal: { metric: 'Delivery reliability', operator: '>=', value: 90, unit: '%', horizon_months: 6, provenance: 'explicit' },
  constraints: [],
  options: [{ label: 'Hire a tech lead', provenance: 'explicit', interventions: [] }],
  factors: [{ label: 'Team capacity', role: 'controllable', baseline_known: true, baseline_value: 5, unit: 'people', provenance: 'explicit' }],
  risks: [], outcomes: [{ label: 'Delivery reliability', provenance: 'inferred' }],
  links: [{ from: 'Team capacity', to: 'Delivery reliability', direction: 'positive', provenance: 'inferred' }],
  unknowns: [],
};

/** What the conversation model does, one entry per conversation call; then it just answers. */
let script: Array<Record<string, unknown>> = [];
let modelBodies: Record<string, unknown>[] = [];
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const callTool = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${modelBodies.length}`, arguments: JSON.stringify(args) }] });

function installFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> & { text?: { format?: { type?: string } } };
    if (body.text?.format?.type === 'json_schema') {
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate) }] }] }), { status: 200 });
    }
    modelBodies.push(body);
    const next = body['tool_choice'] === 'none' ? undefined : script.shift();
    return new Response(JSON.stringify(next ?? say('Here is where the model stands.')), { status: 200 });
  }));
}

/** The product double: the internal routes the Agent dispatches to, per scenario. */
async function buildApp(): Promise<FastifyInstance> {
  vi.resetModules();
  const { registrationTurnId } = await import('../../graph-registration/registration-identity.js');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const a = Fastify({ logger: false });
  a.post('/assist/v1/scenarios/:id/graph', async (req) => {
    const s = st((req.params as { id: string }).id);
    if (!s.registered) return { graph: { nodes: [], edges: [] }, graph_hash: 'empty' };
    const H = hashOf(s);
    const ran = s.facts.some((f) => (f.result as { graph_hash_at_run?: unknown }).graph_hash_at_run === H) || s.injectRunHashes.includes(H);
    return {
      graph: { ...s.graph, edges: [...s.graph.edges, ...s.extraEdges] },
      graph_hash: H,
      analysis_state: ran
        ? { run_state: knobs.runStateKind === 'complete_current' ? { kind: 'complete_current', computed_at: '2026-09-24T18:00:00.000Z' } : { kind: 'complete_stale', computed_at: '2026-09-24T18:00:00.000Z', cause: 'graph_changed' }, leader_claim: knobs.leaderClaim, usable_for_prose: true, usable_for_chips: knobs.runStateKind === 'complete_current' }
        : { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'no_analysis' } },
      ...(ran && knobs.runStateKind === 'complete_current' ? { analysis_result: { type: 'analysis_result', summary: 'A provisional first pass.', computed_against_hash: H } } : {}),
      ...(knobs.analysisReady !== undefined ? { analysis_ready: knobs.analysisReady } : {}),
    };
  });
  a.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    const sid = (req.params as { id: string }).id;
    const s = st(sid);
    const b = req.body as { operation_id?: string };
    const turnId = registrationTurnId(sid, b.operation_id);
    const prior = s.versions.find((v) => v.creation.source_turn_id === turnId);
    s.registered = true;
    s.graph = knobs.graph;
    if (prior !== undefined) return { registered: true, replayed: true, graph_hash: hashOf(s), model_version: { version_id: prior.version_id, version_number: prior.sequence } };
    s.revision += 1;
    const v = { version_id: `00000000-0000-4000-8000-00000000000${s.versions.length + 1}`, sequence: s.versions.length + 1, creation: { kind: 'initial', mutation_id: 'm', source_turn_id: turnId } };
    s.versions.push(v);
    return { registered: true, graph_hash: hashOf(s), model_version: { version_id: v.version_id, version_number: v.sequence } };
  });
  a.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: [...st((req.params as { id: string }).id).versions].reverse(), next_cursor: null }));
  a.post('/orchestrate/v2/turn', async (req) => {
    const b = req.body as { kind?: string; scenario_id: string; chip?: { action_type?: string }; event?: { kind?: string; from?: string; to?: string } };
    const s = st(b.scenario_id);
    if (b.chip?.action_type === 'run_analysis') {
      s.injectRuns += 1;
      s.injectRunHashes.push(hashOf(s));
      return { assistant_text: 'Ran.', blocks: [{ type: 'analysis_result', summary: 'x' }], analysis_ready: { status: 'ready' }, analysis_state: { leader_claim: knobs.leaderClaim } };
    }
    if (b.kind === 'system_event') {
      s.forwarded += 1;
      if (b.event?.kind === 'structural_add_edge') { s.extraEdges.push({ from: b.event.from!, to: b.event.to! }); s.revision += 1; }
      return { assistant_text: 'Updated the model.', graph_hash: hashOf(s) };
    }
    return { assistant_text: 'ok', blocks: [] };
  });
  await a.register(agentV1TurnRoute);
  await a.ready();
  return a;
}

/** The stubbed run orchestration: one PLoT call per invocation; persists the stamped fact. */
function installRunStub() {
  runStub.impl = async (raw: unknown) => {
    const args = raw as RunArgs;
    const s = st(args.payload.scenario_id);
    s.inProcessRuns.push(args);
    const H = hashOf(s);
    s.facts.push({
      fact_type: 'run_analysis', fact_id: `f${s.facts.length}`, fact_version: 1, noop: false,
      result: {
        scenario_id: args.payload.scenario_id, graph_hash_at_run: H, summary: 'x',
        enrichment: args.autoRun !== undefined ? { run_provenance: { initiated_by: 'auto_post_draft', provisional: true, draft_turn_id: args.autoRun.draftTurnId } } : {},
      },
    } as unknown as HandlerFact);
    const coachingHash = knobs.coachingHash === 'readback' ? H : 'some-other-revision';
    return {
      outcome: 'ok', commitPerformed: true, graph: null, mayNameLeadingOption: false, analysisReady: { status: 'ready' },
      response: {
        response_version: 2, assistant_text: 'Ran.', suggested_actions: [], insights: [], stage_indicator: 'analyse',
        blocks: [
          { type: 'analysis_result', summary: 'the run’s own copy' },
          {
            type: 'review_card', block_id: '11111111-2222-4333-8444-555555555555', signal_id: 'evidence_priority:x', created_at: '2026-09-24T18:00:00.000Z',
            source_handler: 'run_analysis', graph_hash_at_generation: coachingHash, card_kind: 'evidence_priority',
            title: 'Where evidence would help most', body: 'Delivery reliability carries the most uncertainty.', target_refs: [], priority_rank: 10,
          },
        ],
      },
    };
  };
}

type Chip = { id: string; label: string; message: string; action_type?: string };
type Body = {
  assistant_text: string;
  suggested_actions: Chip[];
  blocks?: { type: string; summary?: string }[];
  _diagnostic_trace: { fast_path?: string; first_analysis?: Record<string, unknown> };
  _agent: { replayed?: boolean; tool_calls: { name: string }[] };
};

let n = 0;
let SID = '';
const nextScenario = () => { n += 1; SID = `6a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
const turn = async (app: FastifyInstance, payload: Record<string, unknown>) => {
  const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, ...payload } });
  expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
  return r.json() as Body;
};
const buildTurn = (app: FastifyInstance, extra: Record<string, unknown> = {}) => {
  script = [callTool('build_model_from_brief', { brief: BRIEF })];
  return turn(app, { message: BRIEF, ...extra });
};
const RUN_CHIP_ID = 'agent-run-analysis';

describe('the Agent route runs the first analysis itself, once', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    installFetch();
    installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    nextScenario();
    script = []; modelBodies = [];
    knobs = { graph: READY_GRAPH, coachingHash: 'readback', runStateKind: 'complete_current', leaderClaim: { permitted: false, withheld_reason: 'auto_initiated' } };
  });

  it('RED: a brief that builds an admissible model → ONE run, recorded for witnesses, and NO Run chip (test 9)', async () => {
    const b = await buildTurn(app);
    expect(b._agent.tool_calls.map((c) => c.name)).toEqual(['build_model_from_brief']);
    expect(st(SID).inProcessRuns, 'exactly one PLoT call').toHaveLength(1);
    expect(st(SID).injectRuns, 'and not a second one through the turn route').toBe(0);
    expect(b._diagnostic_trace.first_analysis).toMatchObject({ ran: true });
    expect(b.suggested_actions.some((c) => c.id === RUN_CHIP_ID), 'no Run offered over the run that just happened').toBe(false);
    // The readback's result is the authority, shown once.
    expect((b.blocks ?? []).filter((x) => x.type === 'analysis_result')).toEqual([expect.objectContaining({ summary: 'A provisional first pass.' })]);
  });

  it('RED: NOT admissible → 0 PLoT calls, one server sentence naming what is missing, and a repair chip (test 3)', async () => {
    knobs.graph = BLOCKED_GRAPH;
    const b = await buildTurn(app);
    expect(st(SID).inProcessRuns).toHaveLength(0);
    expect(st(SID).injectRuns).toBe(0);
    expect(b._diagnostic_trace.first_analysis).toMatchObject({ ran: false, reason: 'not_admissible' });
    const { resolveRunAdmission } = await import('../../tools/handlers/analysis-ready-core.js');
    const missing = resolveRunAdmission(BLOCKED_GRAPH).blockedNextStep!;
    expect(b.assistant_text, 'server-authored, whatever the model said').toContain(missing);
    expect(b.suggested_actions.map((c) => c.id)).toContain('agent-suggest-what-it-needs');
  });

  it('RED: a retry of the SAME turn_id replays — still exactly one run (test 1a)', async () => {
    const T = '0f1e2d3c-4b5a-4968-8776-655443322110';
    await buildTurn(app, { turn_id: T });
    expect(st(SID).inProcessRuns).toHaveLength(1);
    const calls = modelBodies.length;
    script = [];
    const again = await turn(app, { message: BRIEF, turn_id: T });
    expect(again._agent.replayed, 'the real replay path').toBe(true);
    expect(st(SID).inProcessRuns, 'a replay runs nothing').toHaveLength(1);
    expect(modelBodies.length - calls).toBe(0);
  });

  it('RED: an explicit Run on unchanged content RUNS (+1 PLoT call) and never consults the construction (test 2)', async () => {
    await buildTurn(app);
    expect(st(SID).inProcessRuns).toHaveLength(1);
    const b = await turn(app, { message: 'Run analysis.', source: 'chip', chip: { id: RUN_CHIP_ID, action_type: 'run_analysis' } });
    expect(b._diagnostic_trace.fast_path).toBe('run');
    expect(st(SID).injectRuns, 'the explicit Run ran').toBe(1);
    expect(st(SID).inProcessRuns, 'and it was not the automatic path').toHaveLength(1);
    expect(b._diagnostic_trace.first_analysis).toBeUndefined();
  });

  it('RED: an approval (fast path 2) and a forwarded canvas edit run NOTHING (test 4)', async () => {
    await buildTurn(app);
    script = [callTool('propose_model_change', { from_label: 'Option A', to_label: 'Outcome', direction: 'positive', rationale: 'It moves the outcome directly.' })];
    const proposed = await turn(app, { message: 'Should Option A drive the outcome directly?' });
    const approve = proposed.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'control: a real proposal was offered').toBeDefined();
    const approved = await turn(app, { message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(approved._diagnostic_trace.fast_path).toBe('approve');
    expect(st(SID).extraEdges, 'control: the approval really applied').toHaveLength(1);
    const edit = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SID, turn_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', stage: 'frame', event: { kind: 'factor_value_edit', target_id: 'fac_delivery', value: 0.5 } } });
    expect(edit.statusCode).toBe(200);
    expect(st(SID).forwarded).toBeGreaterThanOrEqual(2);
    expect(st(SID).inProcessRuns, 'only the construction’s own first analysis').toHaveLength(1);
    expect(st(SID).injectRuns).toBe(0);
  });

  it('RED: the Agent is no longer told to run the analysis after an approval, and is told how the first analysis works (test 4)', async () => {
    await buildTurn(app);
    const instructions = String(modelBodies[0]!['instructions']);
    expect(instructions).not.toContain('After authorise_change applies values or option levels, call run_analysis in the SAME turn');
    expect(instructions).not.toContain('After build_model_from_brief, do NOT call run_analysis on the same turn. A newly built model has no values yet');
    expect(instructions).toContain('first_analysis');
    // Leader narration follows the typed permission — never unconditional.
    expect(instructions).not.toContain('say which option leads in this model and how firmly.');
    expect(instructions).toContain('leader_may_be_named');
  });

  it('RED: a leader named in prose on a turn whose typed claim is withheld is edited at the wire (test 6)', async () => {
    await buildTurn(app);
    const prose = 'Option A is the leading option in this model, and fairly firmly.';
    script = [say(prose)];
    const b = await turn(app, { message: 'What does the analysis say?' });
    expect((b.blocks ?? []).some((x) => x.type === 'analysis_result'), 'control: an analysis-bearing turn').toBe(true);
    expect(b.assistant_text).not.toContain('Option A is the leading option');
  });

  it('RED: the TYPED claim alone withholds — permitted:false under a comparative_leader admission is still edited (test 6)', async () => {
    // The admission would license a leader, and `separation_unavailable` is a "did not look" reason the gate
    // does NOT narrow on (`leaderClaimReasonKind` → not_evaluated) — so only `leader_claim.permitted` can
    // be what withholds it here.
    knobs.leaderClaim = { permitted: false, withheld_reason: 'separation_unavailable' };
    knobs.analysisReady = { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
    await buildTurn(app);
    script = [say('Option A is the leading option in this model, and fairly firmly.')];
    const b = await turn(app, { message: 'What does the analysis say?' });
    expect(b.assistant_text).not.toContain('Option A is the leading option');
  });

  it('PERMIT-WINS: permitted:true with comparative_leader leaves the prose byte-identical (test 6)', async () => {
    knobs.leaderClaim = { permitted: true, separation: 'separated' };
    knobs.analysisReady = { status: 'ready', may_run: true, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
    await buildTurn(app);
    const prose = 'Option A is the leading option in this model, and fairly firmly.';
    script = [say(prose)];
    const b = await turn(app, { message: 'What does the analysis say?' });
    expect(b.assistant_text).toBe(prose);
  });
});

describe('RED: no time left in the proxy budget → skip, say so, offer Run (test 5)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    installFetch();
    installRunStub();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    // 40 s budget − 10 s headroom − the first-analysis reserve: the deadline is already behind us.
    process.env.BROWSER_PROXY_TIMEOUT_MS = '40000';
    app = await buildApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; delete process.env.BROWSER_PROXY_TIMEOUT_MS; });
  beforeEach(() => {
    nextScenario();
    script = []; modelBodies = [];
    knobs = { graph: READY_GRAPH, coachingHash: 'readback', runStateKind: 'complete_current', leaderClaim: { permitted: false } };
  });

  it('RED: 0 PLoT calls, reason no_time, one sentence, and the Run chip', async () => {
    const b = await buildTurn(app);
    expect(st(SID).inProcessRuns).toHaveLength(0);
    expect(b._diagnostic_trace.first_analysis).toMatchObject({ ran: false, reason: 'no_time' });
    expect(b.suggested_actions.filter((c) => c.id === RUN_CHIP_ID)).toEqual([expect.objectContaining({ action_type: 'run_analysis' })]);
    const { firstAnalysisSentence } = await import('../first-analysis.js');
    expect(b.assistant_text).toContain(firstAnalysisSentence({ ran: false, reason: 'no_time' })!);
  });
});
