/**
 * P0 CONTEXT (inventory output/p0-context/INVENTORY.md @ cf4ef6e6, defects 3 and 6) — the live route, 0 LLM calls.
 *
 * Defect 3: the Explain-result interpreter read the selected Run with NONE of the guard fields the Run tool gives the
 * Agent for the same Run (`goal_certainty`, `goal_chance`, `limit_checks`, the C46 `nonlinear_identity` cause), so an
 * unearned P(goal) of exactly 0 could be narrated as a certainty and a withheld leader lost its real reason.
 * Defect 6: a follow-up turn read leader permission only as the raw `analysis_state.leader_claim.permitted`, while the
 * Run turn read `claim_permissions.leader_may_be_named` (licence AND `comparative_leader`): two spellings that disagree
 * when the admission mode is not `comparative_leader`.
 *
 * Every row decodes the stubbed provider request (the bytes the model reads), and the parity rows compare it with the
 * Run tool's own output for the SAME stubbed Run. Fixture: the served W3 cold read (`520aab46`, CEE `f074916`), whose
 * goal MRR carries the price x subscribers product and whose churn limit has a ratified constraint id.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { CURRENT_MODEL_STATE_PREFIX } from '../runtime/agent-loop.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN } from '../../compose/analysis-state-v1.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';
import { readStoredGoalCertainty } from '../../tools/handlers/run-goal-certainty.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = '520aab46-9ed5-4819-9d7f-498d16603943';
const CHURN = 'agent-lane:monthly_churn:<=';
/** An UNEARNED exact 0 for the baseline option, as the producer records one: one unsized path and its sentence. */
const UNEARNED_SAY = 'Keep £49 price shows a 0% chance only because the link from Pro plan price into MRR has not been sized yet.';
const UNEARNED = [
  { option_id: 'keep_49_price', probability_of_goal: 0, earned: false,
    unsized_path: { from: 'pro_plan_price', enters_goal_through: 'pro_plan_price' }, no_break_even: 'identity_not_evaluated', say: UNEARNED_SAY },
  { option_id: 'raise_to_54', probability_of_goal: 0, earned: true },
];
const VERDICTS = { per_limit: [{ constraint_id: CHURN, state: 'estimate_only', reason: 'level_user_assumption' }], joint: { state: 'estimate_only' } };
const WITHHELD_CLAIM = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };

let read: Json = {};
const fresh = (): Json => JSON.parse(JSON.stringify(SERVED)) as Json;
/** The Run turn's own `analysis_ready`: the same admission the read carries (the turn and the read agree). */
const readyOf = (r: Json): Json => ({ status: 'ready', analysis_admission: r.analysis_admission });
const graphBody = (): Json => ({ ...read, analysis_ready: readyOf(read), current_read: {} });
const turnBody = (): Json => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
  graph_hash: read.graph_hash, blocks: [read.analysis_result], analysis_state: read.analysis_state, analysis_ready: readyOf(read) });

const rows: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** The Run tool's own output for the SAME stubbed Run: what a Run turn hands the Agent (`runAnalysis`). */
async function runToolOutput(): Promise<Json> {
  const dispatch: InternalDispatch = async (path) => path === '/orchestrate/v2/turn' ? { status: 200, json: turnBody() }
    : path.endsWith('/graph') ? { status: 200, json: graphBody() } : { status: 500, json: {} };
  return await createAgentCapabilities(dispatch, new ProposalStore())
    .runAnalysis({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'p0-ctx-run' } as never, { reason: 'the user pressed Run' } as never) as Json;
}
const GUARDS = ['claim_permissions', 'goal_certainty', 'goal_chance', 'limit_checks'] as const;
const guardsOf = (o: Json): Json => Object.fromEntries(GUARDS.map((k) => [k, o[k]]));

/** The `CURRENT MODEL STATE` developer item the model reads on an ordinary turn, parsed. */
function modelStateOf(body: Json): Json | undefined {
  const input = Array.isArray(body.input) ? body.input as Json[] : [];
  for (const item of input) {
    const text = item?.role === 'developer' && Array.isArray(item.content) ? item.content[0]?.text : undefined;
    if (typeof text === 'string' && text.startsWith(CURRENT_MODEL_STATE_PREFIX)) return JSON.parse(text.slice(CURRENT_MODEL_STATE_PREFIX.length)) as Json;
  }
  return undefined;
}

describe('P0 context — Explain carries the Run guard fields; one leader-permission spelling (live route)', () => {
  let app: FastifyInstance;
  let modelBodies: Json[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => turnBody());
    app.post('/assist/v1/scenarios/:id/graph', async () => graphBody());
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { read = fresh(); rows.length = 0; modelBodies = []; });

  type First = { suggested_actions: { id: string }[]; _agent: { session_id: string } };
  const run = async (): Promise<First> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as First;
  };
  const explainPayload = async (): Promise<Json> => {
    const first = await run();
    const chip = first.suggested_actions.find((c) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first.suggested_actions)).toBeDefined();
    const second = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id } } });
    expect(second.statusCode, second.body).toBe(200);
    expect(modelBodies).toHaveLength(1);
    const ctx = explanationContext(modelBodies[0]!.input);
    expect(ctx, JSON.stringify(modelBodies[0]!.input)).toBeDefined();
    return ctx as Json;
  };
  const followUpState = async (): Promise<Json> => {
    const first = await run();
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: 'What should I look at next?' } });
    expect(next.statusCode, next.body).toBe(200);
    const states = modelBodies.map(modelStateOf).filter((s): s is Json => s !== undefined);
    expect(states.length, 'control: the follow-up model call carries CURRENT MODEL STATE').toBeGreaterThan(0);
    return states[0]!;
  };

  it('D3-a: Explain on a current Run with an UNEARNED P(goal)=0 carries that option’s goal_certainty sentence', async () => {
    // Fixture control: the published contract accepts the stored decisions (else every reader says `unchecked`).
    expect(readStoredGoalCertainty(UNEARNED)).toHaveLength(2);
    read.analysis_goal_certainty = UNEARNED;
    const ctx = await explainPayload();
    // Precondition (the hazard): the selected result still shows the bare exact 0 for that option.
    const resultRow = (ctx.result.enrichment.option_comparison as Json[]).find((r) => r.option_id === 'keep_49_price');
    expect(resultRow?.probability_of_goal).toBe(0);
    const options = (ctx.goal_certainty?.options ?? []) as Json[];
    const unearned = options.find((o) => o.option_id === 'keep_49_price');
    expect(unearned, JSON.stringify(ctx.goal_certainty)).toEqual({ option: 'Keep £49 price', option_id: 'keep_49_price', earned: false, say: UNEARNED_SAY });
    expect(options.find((o) => o.option_id === 'raise_to_54')).toEqual({ option: 'Raise to £54', option_id: 'raise_to_54', probability_of_goal: 0, earned: true });
    expect(typeof ctx.goal_certainty.note).toBe('string');
  });

  it('D3-a parity: the Explain payload’s guard fields equal the Run tool’s for the same Run', async () => {
    read.analysis_goal_certainty = UNEARNED;
    const tool = await runToolOutput();
    expect(tool.goal_certainty?.options, 'control: the Run tool carries BOUND goal_certainty decisions here').toHaveLength(2);
    expect(guardsOf(await explainPayload())).toEqual(guardsOf(tool));
  });

  it('D3-b: a withheld-leader Explain carries the C46 product cause and the per-limit checks', async () => {
    read.analysis_state.leader_claim = WITHHELD_CLAIM;
    delete read.analysis_identity_evaluated_node_ids;
    read.analysis_limit_verdicts = VERDICTS;
    const ctx = await explainPayload();
    expect(ctx.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.claim_permissions.nonlinear_identity?.reason, JSON.stringify(ctx.claim_permissions)).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(ctx.claim_permissions.nonlinear_identity.say).toContain('MRR');
    expect((ctx.limit_checks?.limits ?? []).map((l: Json) => [l.constraint_id, l.state])).toEqual([[CHURN, 'estimate_only']]);
    const tool = await runToolOutput();
    expect(tool.claim_permissions.nonlinear_identity, 'control: the Run tool carries the cause here').toBeDefined();
    expect(guardsOf(ctx)).toEqual(guardsOf(tool));
  });

  it('D3-b CONTROL: a product the Run’s engine evaluated is not said as a cause (the same read’s evaluated ids are passed)', async () => {
    read.analysis_state.leader_claim = WITHHELD_CLAIM;
    expect(read.analysis_identity_evaluated_node_ids).toEqual(['mrr']);
    const ctx = await explainPayload();
    expect(ctx.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.claim_permissions.nonlinear_identity).toBeUndefined();
  });

  it('D6-a: admission mode is not comparative_leader and leader_claim.permitted is true — the follow-up says leader_may_be_named false, as the Run turn does', async () => {
    read.analysis_admission = { ...read.analysis_admission, permitted_analysis_mode: 'exploratory' };
    expect(read.analysis_state.leader_claim.permitted).toBe(true);
    const tool = await runToolOutput();
    expect(tool.claim_permissions.leader_may_be_named).toBe(false);
    const state = await followUpState();
    // The raw spelling still says permitted: true; the one governing spelling says no.
    expect(state.analysis.leader_claim.permitted).toBe(true);
    expect(state.analysis.claim_permissions, JSON.stringify(state.analysis)).toEqual({ leader_may_be_named: false, permitted_analysis_mode: 'exploratory' });
    expect(state.analysis.claim_permissions.leader_may_be_named).toBe(tool.claim_permissions.leader_may_be_named);
  });

  it('D6-b CONTROL: comparative_leader and permitted — leader_may_be_named true on both the Run turn and the follow-up', async () => {
    expect(read.analysis_admission.permitted_analysis_mode).toBe('comparative_leader');
    const tool = await runToolOutput();
    expect(tool.claim_permissions.leader_may_be_named).toBe(true);
    const state = await followUpState();
    expect(state.analysis.claim_permissions).toEqual({ leader_may_be_named: true, permitted_analysis_mode: 'comparative_leader' });
  });
});
