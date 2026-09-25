/**
 * ⭐ PAUL'S RULING, ON THE AGENT'S OWN PERMISSION (programme-docs#38 5576895511, 7 Sep: "caveat, not
 * withhold"). A run that SEPARATES its options, is entitled, and whose admission is `quantified_provisional`
 * (every estimate still machine-authored) may name its leader — qualified as provisional. The wire gate
 * already implements this arm (`leading-option-wire-enforcement.ts`, separable-provisional:
 * PERMIT-WITH-CAVEAT). The Agent's typed permission must say the same thing, or the chat withholds beside a
 * result that separates the options: the incoherence Paul flagged. Every other population is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { claimPermissionsFrom, describeFirstAnalysisForAgent } from '../first-analysis.js';

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
/** The measured sentence (AI Quality, 25 Sep: qualified 4/4 vs 3/4 without it, 0/8 recommendations). */
const PROVISIONAL_RULE = 'If it also carries `provisional: true`, that separation rests on Olumi\'s own starting estimates: you may say which option the comparison separates only as a provisional finding on those estimates, in the same sentence, never as a recommendation or the best choice, and keep any condition the run could not check.';

const ready = (mode: string) => ({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: mode } });

/** RC's first control (#63 5826599698): the served hiring S3 shape — an EXPLICIT Run on `92b1bf8`. */
const S3_STATE = { leader_claim: { permitted: true, separation: 'separated' } };
const REQUESTED = { requested: true } as const;

describe('claim_permissions follows "caveat, not withhold" for a separable provisional REQUESTED run', () => {
  it('RED: the served hiring S3 shape on an explicit Run → the leader may be named, marked provisional', () => {
    const p = claimPermissionsFrom(S3_STATE, ready('quantified_provisional'), REQUESTED);
    expect(p.leader_may_be_named).toBe(true);
    expect(p.provisional, 'the Agent is told to qualify it').toBe(true);
  });
  it('CONTROL: a separated comparative_leader is named and is NOT marked provisional (requested or not)', () => {
    for (const run of [REQUESTED, {}]) {
      const p = claimPermissionsFrom(S3_STATE, ready('comparative_leader'), run);
      expect(p.leader_may_be_named).toBe(true);
      expect(p.provisional).toBeUndefined();
    }
  });
  it('CONTROL: a true near tie, an unknown separation, a withheld entitlement or a lower admission still withholds', () => {
    expect(claimPermissionsFrom({ leader_claim: { permitted: true, separation: 'near_tie' } }, ready('quantified_provisional'), REQUESTED).leader_may_be_named).toBe(false);
    expect(claimPermissionsFrom({ leader_claim: { permitted: true } }, ready('quantified_provisional'), REQUESTED).leader_may_be_named).toBe(false);
    expect(claimPermissionsFrom({ leader_claim: { permitted: false, separation: 'separated', withheld_reason: 'constraint_verdict_withheld' } }, ready('quantified_provisional'), REQUESTED).leader_may_be_named).toBe(false);
    expect(claimPermissionsFrom(S3_STATE, ready('structural_only'), REQUESTED).leader_may_be_named).toBe(false);
  });
  it('RED (v2 would pass it): the AUTOMATIC first run keeps the unrequested policy — the same shape is NOT named', () => {
    expect(claimPermissionsFrom(S3_STATE, ready('quantified_provisional')).leader_may_be_named).toBe(false);
    const told = describeFirstAnalysisForAgent({ ran: true } as never, {
      analysisState: S3_STATE, analysisResult: { summary: 'first pass' }, analysisAdmission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' },
    }) as { claim_permissions?: { leader_may_be_named?: boolean; provisional?: true } };
    expect(told.claim_permissions?.leader_may_be_named).toBe(false);
    expect(told.claim_permissions?.provisional).toBeUndefined();
  });
});

describe('the Agent is told how to use `provisional` (the flag is worded, not merely carried)', () => {
  let app: FastifyInstance;
  let bodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Provisionally, on these estimates, A separates.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }],
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: true, separation: 'separated' } },
      analysis_ready: { status: 'ready', options: [], blockers: [], analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional' } } }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Growth' }], edges: [] }, graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: true, separation: 'separated' } } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the explicit Run\u2019s interpreting call carries the provisional wording rule', async () => {
    bodies = [];
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '6b2d8f3a-1c4e-4f5a-9b7c-2d3e4f5a6b7c', message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });
    expect(bodies).toHaveLength(1);
    expect(String(bodies[0]!['instructions'])).toContain(PROVISIONAL_RULE);
    // …and the run it interprets carries the provisional permission, read from the run's own verdict.
    const out = (bodies[0]!['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
    const run = JSON.parse(String(out?.output ?? '{}')) as { claim_permissions?: { leader_may_be_named?: boolean; provisional?: true } };
    expect(run.claim_permissions).toMatchObject({ leader_may_be_named: true, provisional: true });
  });
});
