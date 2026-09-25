/**
 * ⛔ A SUGGESTION-BUTTON CLICK CARRIES NO CONSENT TO WRITE OR TO RUN.
 *
 * A coaching card's action (V5CoachingBlock → ActionChip → sendChip) arrives as an ordinary
 * `kind:'message'` with a chip id such as `evidence-apply-<ms>`. It is neither the typed approval
 * chip nor the typed Run, so it reaches the Agent loop — which, before this guard, was offered
 * `authorise_change` and `run_analysis` like any typed message. Measured at CEE 8428207 through this
 * route with a scripted model (#63 5819380376): a surprise Run (runs:1), a same-turn propose-and-
 * authorise (commits:1), and an EARLIER turn's proposal authorised on the click (commits:1).
 * `ProposalStore.authorise` checks the proposal, not that the user approved it this turn.
 *
 * The guard (RC 5819467504 §2): on a chip-initiated message whose chip is neither the approval chip
 * nor the Run chip, the Agent runs with `authorise_change` and `run_analysis` WITHHELD — not offered
 * to the model, and refused at dispatch if named anyway. The click stays useful: every read and
 * proposal tool is still there, and a proposal made on the click still gets its approve chip.
 *
 * Controls pin the guard's scope: a composer message still authorises, and the typed Run still runs.
 * The model is a fetch stub (no provider, no network).
 */
import { randomUUID } from 'node:crypto';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/** One scenario per test: the route's proposal and history state is per scenario, and a shared one made the tests order-dependent. */
let SCENARIO = randomUUID();
const ACTION_PROMPT = "Talk me through what would change if the link from Team size to Velocity were weaker or stronger. Don't change the model or re-run anything yet.";
const coachingClick = () => ({ kind: 'message', scenario_id: SCENARIO, source: 'chip', message: ACTION_PROMPT, chip: { id: `evidence-apply-${Date.now()}` } });

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

type Body = Record<string, unknown> & { input?: unknown[]; tools?: { name: string }[] };
type Step = (body: Body) => unknown[];
const say = (text: string): Step => () => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const call = (name: string, args: (b: Body) => Record<string, unknown>): Step => (b) => [{ type: 'function_call', name, call_id: `c_${name}_${Math.random().toString(36).slice(2, 8)}`, arguments: JSON.stringify(args(b)) }];
const lastProposalId = (b: Body): string => {
  const outs = (b.input ?? []).filter((i) => (i as { type?: string }).type === 'function_call_output') as { output: string }[];
  for (let k = outs.length - 1; k >= 0; k--) { const id = (JSON.parse(outs[k]!.output) as { proposal_id?: string }).proposal_id; if (id) return id; }
  return 'none';
};

type ToolCall = { name: string; ok: boolean; mutated: boolean; proposal_id?: string; refusal?: string };
type R = { _diagnostic_trace: { fast_path?: string; exit_path?: string; tools_called: string[] }; _agent: { tool_calls: ToolCall[]; mutated: boolean }; suggested_actions?: { id: string }[] };

describe('a chip click that is not the approval or the Run withholds authority from the Agent', () => {
  let app: FastifyInstance;
  let script: Step[] = [];
  let modelBodies: Body[] = [];
  let runs = 0;
  let commits = 0;
  let edges: { from: string; to: string }[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Body;
      modelBodies.push(body);
      const step = script.shift() ?? say('Here is what that link does in the current model.');
      return new Response(JSON.stringify({ output: step(body) }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'f2', kind: 'factor', label: 'Morale' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) { edges = [...edges, { from: b.event.from, to: b.event.to }]; commits += 1; return { assistant_text: 'Added.' }; }
      if (b.chip?.action_type === 'run_analysis') { runs += 1; return { assistant_text: 'ran', graph_hash: `h${edges.length}`, blocks: [{ type: 'analysis_result', data: {} }], analysis_ready: { status: 'ready', options: [], blockers: [] } }; }
      return { assistant_text: 'ok' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); });
  beforeEach(() => { script = []; modelBodies = []; runs = 0; commits = 0; edges = []; SCENARIO = randomUUID(); });

  const send = async (payload: Record<string, unknown>): Promise<R> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as R;
  };
  const offeredOn = (i: number): string[] => (modelBodies[i]?.tools ?? []).map((t) => t.name);

  it('the click reaches the Agent loop with every read and proposal tool, and WITHOUT authorise_change or run_analysis', async () => {
    const b = await send(coachingClick());
    expect(b._diagnostic_trace.exit_path).toBe('agent_lane_v1');
    expect(b._diagnostic_trace.fast_path).toBeUndefined();
    expect(modelBodies.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < modelBodies.length; i++) {
      expect(offeredOn(i)).not.toContain('authorise_change');
      expect(offeredOn(i)).not.toContain('run_analysis');
    }
    expect(offeredOn(0)).toEqual(expect.arrayContaining(['get_canonical_state', 'propose_model_change', 'propose_assumptions']));
    expect(b._agent.tool_calls).toEqual([]);
  });

  it('a model that names run_analysis on the click anyway → refused at dispatch; nothing runs', async () => {
    script = [call('run_analysis', () => ({ reason: 'to see the effect of the link' })), say('I did not re-run it.')];
    const b = await send(coachingClick());
    expect(runs).toBe(0);
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'run_analysis', ok: false, mutated: false, refusal: 'withheld_on_chip_turn' })]);
    expect(b._agent.mutated).toBe(false);
  });

  it('propose AND authorise in the same click turn → nothing written; the proposal still gets its approve chip', async () => {
    script = [
      call('propose_model_change', () => ({ from_label: 'Morale', to_label: 'Velocity', direction: 'positive', rationale: 'x' })),
      call('authorise_change', (b) => ({ proposal_id: lastProposalId(b) })),
      say('I have proposed it; approve it if you want it.'),
    ];
    const b = await send(coachingClick());
    expect(commits).toBe(0);
    expect(b._agent.mutated).toBe(false);
    expect(b._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_model_change', true], ['authorise_change', false]]);
    expect(b._agent.tool_calls[1]).toEqual(expect.objectContaining({ refusal: 'withheld_on_chip_turn', mutated: false }));
    expect((b.suggested_actions ?? []).some((a) => a.id.startsWith('agent-approve-proposal'))).toBe(true);
  });

  it('a proposal outstanding from an EARLIER turn, authorised on the click → nothing written', async () => {
    script = [call('propose_model_change', () => ({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'x' })), say('Shall I add it?')];
    const t1 = await send({ kind: 'message', scenario_id: SCENARIO, agent_session_id: `sess-g4-${SCENARIO}`, message: 'Should team size drive velocity?' });
    const pid = t1._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(pid, 'control: a real proposal is outstanding').toMatch(/^prop_/);
    script = [call('authorise_change', () => ({ proposal_id: pid })), say('Not applied.')];
    const b = await send({ ...coachingClick(), agent_session_id: `sess-g4-${SCENARIO}` });
    expect(commits).toBe(0);
    expect(b._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'withheld_on_chip_turn' }));
  });

  it('CONTROL (scope): the same earlier-turn authorisation from a COMPOSER message still writes', async () => {
    script = [call('propose_model_change', () => ({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'x' })), say('Shall I add it?')];
    const t1 = await send({ kind: 'message', scenario_id: SCENARIO, agent_session_id: `sess-c1-${SCENARIO}`, message: 'Should team size drive velocity?' });
    const pid = t1._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(pid).toMatch(/^prop_/);
    script = [call('authorise_change', () => ({ proposal_id: pid })), say('Applied.')];
    const b = await send({ kind: 'message', scenario_id: SCENARIO, agent_session_id: `sess-c1-${SCENARIO}`, source: 'composer', message: 'Yes, add it.' });
    expect(offeredOn(modelBodies.length - 1)).toContain('authorise_change');
    expect(commits).toBe(1);
    expect(b._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
  });

  it('CONTROL (scope): the typed Run chip still runs', async () => {
    const b = await send({ kind: 'message', scenario_id: SCENARIO, source: 'chip_click', message: 'Run the analysis', chip: { action_type: 'run_analysis' } });
    expect(b._diagnostic_trace.fast_path).toBe('run');
    expect(runs).toBe(1);
  });
});
