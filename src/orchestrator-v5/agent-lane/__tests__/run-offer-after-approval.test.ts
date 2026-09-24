/**
 * ⭐ THE EXPLICIT RUN AFTER AN OPENAI APPROVAL (RC #63; Codex 5805970015: "served Agent
 * approval calls approvalChipsFor after authorise_change and that helper returns no chips").
 *
 * Fast path 2 applies the approved values and — by design — runs nothing. Without an offer
 * the user had no Run to press on the Agent route. After a change, and ONLY when the
 * canonical readiness in the SAME response admits a run, the reply offers one typed Run chip;
 * clicking it takes fast path 3. Nothing runs implicitly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// A fresh scenario per case: proposals are identified per scenario, and a re-proposed link
// on the same one would replay as already applied.
let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
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

type Chip = { id: string; label: string; message: string; action_type?: string };

describe('the explicit Run is offered after a change the canonical readiness admits', () => {
  let app: FastifyInstance;
  let edges: { from: string; to: string }[] = [];
  let readiness: Record<string, unknown> = {};
  let runs = 0;
  let modelBodies: Record<string, unknown>[] = [];
  let proposeNext = true;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      if (body['tool_choice'] !== 'none' && proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: `c${modelBodies.length}`,
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'It moves velocity.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
      analysis_ready: readiness,
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      if (b.chip?.action_type === 'run_analysis') runs += 1;
      return { assistant_text: 'ok', blocks: b.chip?.action_type === 'run_analysis' ? [{ type: 'analysis_result', data: {} }] : [], analysis_ready: readiness };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; runs = 0; modelBodies = []; proposeNext = true; nextScenario(); });

  /** Propose (one Agent turn), then approve through the typed chip (fast path 2). */
  async function proposeThenApprove(): Promise<{ suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } }> {
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?' } });
    const approve = (t1.json() as { suggested_actions: Chip[] }).suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'the control: a real proposal was offered').toBeDefined();
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: approve!.message, source: 'chip', chip: { id: approve!.id } } });
    expect(t2.statusCode).toBe(200);
    return t2.json() as { suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } };
  }

  it('RED: approval applied and the canonical readiness admits a run → ONE typed Run chip, and nothing ran', async () => {
    readiness = { status: 'needs_user_input', may_run: true };
    const b = await proposeThenApprove();
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([
      expect.objectContaining({ id: 'agent-run-analysis', label: 'Run analysis', action_type: 'run_analysis' }),
    ]);
    expect(runs, 'the offer runs nothing').toBe(0);
  });

  it('the offered chip, echoed as the UI sends it, takes fast path 3 — one run, one interpreting call', async () => {
    readiness = { status: 'ready', may_run: true };
    const b = await proposeThenApprove();
    const run = b.suggested_actions.find((c) => c.action_type === 'run_analysis')!;
    modelBodies = [];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: run.message, source: 'chip', chip: { id: run.id, action_type: run.action_type },
    } });
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBe('run');
    expect(runs).toBe(1);
    expect(modelBodies.map((m) => m['tool_choice'])).toEqual(['none']);
  });

  it.each([
    ['may_run false wins over a ready status', { status: 'ready', may_run: false }],
    ['may_run false', { status: 'needs_user_input', may_run: false }],
    ['no may_run and not ready', { status: 'needs_user_input' }],
  ])('CONTRAST: %s → no Run offered', async (_l, r) => {
    readiness = r;
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('CONTRAST: a turn that changed nothing is not offered a Run, even when a run is admitted', async () => {
    readiness = { status: 'ready', may_run: true };
    proposeNext = false; // the Agent just answers
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does this model say?' } });
    expect((r.json() as { suggested_actions: Chip[] }).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('the admission rule, exactly: may_run decides when present; status only when it is absent', async () => {
    const { admitsRunOffer, typedRunOf, RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
    expect(admitsRunOffer({ status: 'ready' })).toBe(true);
    expect(admitsRunOffer({ status: 'ready', may_run: false })).toBe(false);
    expect(admitsRunOffer({ status: 'blocked', may_run: true })).toBe(true);
    expect(admitsRunOffer(undefined)).toBe(false);
    expect(typedRunOf({ kind: 'message', chip: { id: RUN_OFFER_CHIP.id } }), 'the id alone is recognised').toBe(true);
    expect(typedRunOf({ kind: 'message', chip: { id: 'agent-approve-proposal:prop_abc123' } })).toBe(false);
  });
});
