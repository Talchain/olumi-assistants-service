/**
 * ⭐ A CURRENT RESULT OFFERS THE PRODUCT'S OWN NEXT STEPS (Paul's staging test, 1 Oct 00:1xZ: "the chips are gone
 * (Run, pre-mortem…)"; DL #75 5922040401 + 5922121657; AIQ words 5922131997; CODEX control class 5922106400).
 *
 * Measured 0-LLM on R3's stored funding train (`accept-paul/train-2255Z`, served `5479e15e`): the brief turn and both
 * Run turns read back `run_state.kind: complete_current` with `usable_for_chips: true` and shipped
 * `suggested_actions: []`. The Run chip rightly declines on a current result, and nothing else offered a step.
 * The `analysis_state` shapes below are copied from those captures (01-brief / 06-consent1).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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

type Chip = { id: string; label: string; message: string; action_type?: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: { name: string; ok: boolean }[] } };

/** Served `5479e15e`, R3 train-2255Z 01-brief: a fresh build already analysed (leader withheld). */
const CURRENT = { run_state: { kind: 'complete_current', computed_at: '2026-09-30T22:56:35.616Z' }, usable_for_chips: true, leader_claim: { permitted: false } };
/** Same train, 06-consent1: the approved change moved the graph, so the result is stale. */
const STALE = { run_state: { kind: 'complete_stale', computed_at: '2026-09-30T22:56:49.477Z', cause: 'graph_changed' }, usable_for_chips: false };
const READY = { status: 'ready', may_run: true };
const NEXT_IDS = ['agent-next-pre-mortem', 'agent-next-what-would-change', 'agent-next-strengthen'];

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6f1e2d3c-4b5a-4e6d-9c7b-8a9f0e1d2c${String(n).padStart(2, '0')}`; };

describe('the next-step chips (live route, real loop, model stubbed)', () => {
  let app: FastifyInstance;
  let analysisState: Record<string, unknown> | undefined = CURRENT;
  let readiness: Record<string, unknown> = READY;
  let failRead = false;
  let script: Record<string, unknown>[] = [];
  let runs = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] !== 'none' && script.length > 0) return new Response(JSON.stringify({ output: [script.shift()] }), { status: 200 });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (failRead) return reply.code(500).send({ error: 'read failed' });
      return {
        graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
        graph_hash: 'h0',
        analysis_ready: readiness,
        ...(analysisState !== undefined ? { analysis_state: analysisState } : {}),
      };
    });
    // The Run button's fast path asks the conventional route for the run (as run-offer-after-approval does).
    app.post('/orchestrate/v2/turn', async (req) => {
      const body = req.body as { chip?: { action_type?: string } };
      if (body.chip?.action_type === 'run_analysis') runs += 1;
      return { assistant_text: 'ok', blocks: body.chip?.action_type === 'run_analysis' ? [{ type: 'analysis_result', data: {} }] : [], analysis_ready: readiness };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { analysisState = CURRENT; readiness = READY; failRead = false; script = []; runs = 0; nextScenario(); });

  const ask = async (message: string, extra: Record<string, unknown> = {}): Promise<Body> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, ...extra } });
    expect(res.statusCode).toBe(200);
    return res.json() as Body;
  };

  it('RED: a current result with nothing else to press offers the three next steps, plain text, in order', async () => {
    const b = await ask('What do you make of this?');
    expect(b._agent.tool_calls, 'vacuity: the answer used no tool, so no other control exists').toEqual([]);
    expect(b.suggested_actions).toEqual([
      { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me: imagine this decision went badly. What most plausibly went wrong?' },
      { id: 'agent-next-what-would-change', label: 'What would change this?', message: 'What would most likely change this result?' },
      { id: 'agent-next-strengthen', label: 'Strengthen the model', message: 'What would most strengthen this model?' },
    ]);
    for (const c of b.suggested_actions) expect(c.action_type, `${c.id} is plain text, never a typed action`).toBeUndefined();
  });

  it("RED: the Run button's turn ends on the next steps when its result reads back current (Paul: 'the Run, pre-mortem…')", async () => {
    const b = await ask('Run analysis.', { source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
    expect(runs, 'vacuity: the Run fast path really ran').toBe(1);
    expect(b.suggested_actions.map((c) => c.id)).toEqual(NEXT_IDS);
  });

  it("CONTROL: the Run button's turn whose result reads back stale offers no next steps", async () => {
    analysisState = STALE;
    const b = await ask('Run analysis.', { source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
    expect(runs).toBe(1);
    expect(b.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });

  it.each([
    ['a stale result (the approved change moved the graph)', () => { analysisState = STALE; }],
    ['a current run the canonical state does not let chips build on', () => { analysisState = { ...CURRENT, usable_for_chips: false }; }],
    ['no result yet', () => { analysisState = { run_state: { kind: 'none' }, usable_for_chips: false }; }],
    ['a readback with no analysis_state (unknown)', () => { analysisState = undefined; }],
    ['a failed readback (unknown)', () => { failRead = true; }],
  ])('CONTROL: %s → no next steps', async (_l, arrange) => {
    arrange();
    const b = await ask('What do you make of this?');
    expect(b.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });

  it('CONTROL: a proposal offered THIS turn is the step: its approval card only, no next steps beside it', async () => {
    script = [{ type: 'function_call', name: 'propose_model_change', call_id: 'p1', arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }) }];
    const b = await ask('Team size strongly drives velocity, so connect them.');
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'vacuity: a real approval was offered').toBe(true);
    expect(b.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });

  it('CONTROL: another control offered this turn (no proposal involved) is the step: never next steps beside it', async () => {
    script = [{ type: 'function_call', name: 'offer_public_research', call_id: 'r1', arguments: JSON.stringify({ query: 'seed round close rates UK 2026' }) }];
    const b = await ask('Is there public data on how often seed rounds close?');
    expect(b.suggested_actions.map((c) => c.label), 'vacuity: the research control was offered').toContain('Search the web');
    expect(b.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });

  it('CONTROL: a proposal still waiting for its yes on a LATER turn keeps the next steps away (the approval is the step)', async () => {
    script = [{ type: 'function_call', name: 'propose_model_change', call_id: 'p1', arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }) }];
    await ask('Team size strongly drives velocity, so connect them.');
    const later = await ask('Why does that matter?');
    expect(later._agent.tool_calls).toEqual([]);
    expect(later.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });

  it('a retried turn (same turn_id) replays the next steps while the result is still current, and drops them once it is stale', async () => {
    const turn_id = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const live = await ask('What do you make of this?', { turn_id });
    expect(live.suggested_actions.map((c) => c.id)).toEqual(NEXT_IDS);
    const replay = await ask('What do you make of this?', { turn_id });
    expect((replay as unknown as { _agent: { replayed?: boolean } })._agent.replayed, 'vacuity: the replay path answered').toBe(true);
    expect(replay.suggested_actions.map((c) => c.id)).toEqual(NEXT_IDS);
    analysisState = STALE;
    const staleReplay = await ask('What do you make of this?', { turn_id });
    expect(staleReplay.suggested_actions.filter((c) => NEXT_IDS.includes(c.id))).toEqual([]);
  });
});

describe('the helpers', () => {
  it('offersNextSteps: only complete_current with usable_for_chips', async () => {
    const { offersNextSteps } = await import('../../../routes/agent-v1-turn.js');
    expect(offersNextSteps(CURRENT)).toBe(true);
    expect(offersNextSteps(STALE)).toBe(false);
    expect(offersNextSteps({ ...CURRENT, usable_for_chips: false })).toBe(false);
    expect(offersNextSteps({ ...CURRENT, usable_for_chips: 'true' }), 'a string is not the canonical boolean').toBe(false);
    expect(offersNextSteps({ usable_for_chips: true })).toBe(false);
    expect(offersNextSteps(undefined)).toBe(false);
    expect(offersNextSteps(null)).toBe(false);
  });

  it('stillValidOffers: kept on a current result with nothing waiting; dropped when stale, unknown, or a proposal waits', async () => {
    const { stillValidOffers, NEXT_STEP_CHIPS } = await import('../../../routes/agent-v1-turn.js');
    const now = (analysisState: unknown, waiting: string[] = []) => ({ outstandingProposalIds: new Set(waiting), analysisReady: READY, analysisState, modelExists: true });
    expect(stillValidOffers(NEXT_STEP_CHIPS, now(CURRENT)).map((a) => a.id)).toEqual(NEXT_IDS);
    expect(stillValidOffers(NEXT_STEP_CHIPS, now(STALE))).toEqual([]);
    expect(stillValidOffers(NEXT_STEP_CHIPS, now(undefined))).toEqual([]);
    expect(stillValidOffers(NEXT_STEP_CHIPS, now(CURRENT, ['prop_x']))).toEqual([]);
    // DL P2 on #2512: Widen offered in a next step's place survives a retry on an unchanged result (3 chips stay 3).
    const { nextStepsWithWiden } = await import('../method-turn/widen-turn.js');
    const withWiden = nextStepsWithWiden(NEXT_STEP_CHIPS, true);
    expect(stillValidOffers(withWiden, now(CURRENT)).map((a) => a.id)).toEqual(withWiden.map((a) => a.id));
    expect(withWiden.map((a) => a.id)).toContain('agent-next-widen');
    expect(stillValidOffers(withWiden, now(STALE))).toEqual([]);
    expect(stillValidOffers([], now(CURRENT)), 'never offered → never replayed').toEqual([]);
  });

  it('a press is a suggestion-button turn: it can neither approve nor run (withheldToolsOf)', async () => {
    const { withheldToolsOf, NEXT_STEP_CHIPS, CHIP_TURN_WITHHELD_TOOLS } = await import('../../../routes/agent-v1-turn.js');
    for (const c of NEXT_STEP_CHIPS) {
      expect(withheldToolsOf({ kind: 'message', message: c.message, source: 'chip', chip: { id: c.id } })).toEqual(CHIP_TURN_WITHHELD_TOOLS);
    }
    expect(CHIP_TURN_WITHHELD_TOOLS).toEqual(expect.arrayContaining(['authorise_change', 'run_analysis']));
  });

  it('AIQ words: option-neutral, ≤5 words, no dash, no figure in any label', async () => {
    const { NEXT_STEP_CHIPS } = await import('../../../routes/agent-v1-turn.js');
    for (const c of NEXT_STEP_CHIPS) {
      expect(c.label.split(/\s+/).length, c.label).toBeLessThanOrEqual(5);
      expect(c.label, c.label).not.toMatch(/[‒-―−]| - /);
      expect(c.label, c.label).not.toMatch(/\d|%|£/);
      expect(`${c.label} ${c.message}`, c.id).not.toMatch(/\b(lead|leading|leader|wins?|winning|best)\b/i);
      expect(c.message, c.id).not.toMatch(/[‒-―−]/);
    }
  });
});
