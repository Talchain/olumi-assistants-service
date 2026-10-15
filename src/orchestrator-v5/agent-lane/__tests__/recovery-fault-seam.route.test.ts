/**
 * ⭐ THE RECOVERY FAULT SEAM (`recovery-fault-seam.ts`; DL 20:10Z 15 Oct, Paul's A6 served recovery proof). Armed only on a
 * POSITIVELY identified staging process, with `CEE_RECOVERY_FAULT_SEAM=on`, by a request naming its own scenario and a point.
 * Here: the gate (impossible in production, off by default, bound to the scenario) and the `after_run` window through the live
 * route: the Run is recorded once, and the turn ends before its answer row, as a crash there would. The write windows
 * (`before_write`, `after_write`) are proven on the stateful writer harness (`agent-writer-doors-seam.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPressToolResponse } from './fixtures/run-press-model.js';
import { armedRecoveryFault, RECOVERY_FAULT_FIELD } from '../recovery-fault-seam.js';

const SCENARIO = '3c2f1e0d-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const OTHER = '3c2f1e0d-9b8a-4c7d-8e6f-5a4b3c2d1e99';
const HASH = 'b'.repeat(16);
const AT = '2026-10-15T22:00:00.000Z';
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'opt_a', kind: 'option', label: 'Raise prices' }, { id: 'opt_b', kind: 'option', label: 'Hold prices' }], edges: [] };
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const BLOCK = { type: 'analysis_result', summary: 'Comparison on the current model.', leading_option_id: null,
  win_probabilities: { opt_a: 0.5, opt_b: 0.5 }, computed_against_hash: HASH, enrichment: { analysis_status: 'ok' } };
const STATE = { run_state: { kind: 'complete_current', computed_at: AT }, readiness: { status: 'ready', blockers: [] },
  leader_claim: { permitted: true, separation: 'separated' }, robustness: {}, usable_for_prose: true, usable_for_chips: true,
  usable_for_followup: true, requires_rerun: false, blocked_unusable: false, contradictions: [] };

const ENV_KEYS = ['OLUMI_ENV', 'RENDER_SERVICE_NAME', 'NODE_ENV', 'CEE_RECOVERY_FAULT_SEAM'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const setEnv = (e: Partial<Record<typeof ENV_KEYS[number], string>>) => {
  for (const k of ENV_KEYS) { if (k === 'NODE_ENV') continue; delete process.env[k]; }
  for (const [k, v] of Object.entries(e)) process.env[k] = v;
};
const restoreEnv = () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
const armed = (point = 'after_run', sid = SCENARIO) => ({ [RECOVERY_FAULT_FIELD]: { scenario_id: sid, point } });

describe('the recovery fault seam is impossible in production and off by default', () => {
  afterEach(restoreEnv);
  const inert: [string, Partial<Record<typeof ENV_KEYS[number], string>>][] = [
    ['production by OLUMI_ENV', { OLUMI_ENV: 'prod', CEE_RECOVERY_FAULT_SEAM: 'on' }],
    ['production by Render service name', { RENDER_SERVICE_NAME: 'olumi-assistants-service', CEE_RECOVERY_FAULT_SEAM: 'on' }],
    ['NODE_ENV=production only (cannot tell staging from production)', { NODE_ENV: 'production', CEE_RECOVERY_FAULT_SEAM: 'on' }],
    ['staging with the switch unset', { OLUMI_ENV: 'staging' }],
    ['staging with the switch not exactly "on"', { OLUMI_ENV: 'staging', CEE_RECOVERY_FAULT_SEAM: 'true' }],
    ['local/test', { CEE_RECOVERY_FAULT_SEAM: 'on' }],
  ];
  it.each(inert)('INERT: %s', (_name, env) => {
    setEnv(env);
    if (env.NODE_ENV !== undefined) process.env.NODE_ENV = env.NODE_ENV;
    try {
      expect(armedRecoveryFault(armed(), SCENARIO)).toBeUndefined();
    } finally { if (env.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV; }
  });
  it('ARMED only on a positively identified staging process with the switch on, for its own scenario and a known point', () => {
    setEnv({ RENDER_SERVICE_NAME: 'olumi-assistants-service-staging', CEE_RECOVERY_FAULT_SEAM: 'on' });
    expect(armedRecoveryFault(armed('after_run'), SCENARIO)).toBe('after_run');
    expect(armedRecoveryFault(armed('before_write'), SCENARIO)).toBe('before_write');
    expect(armedRecoveryFault(armed('after_write'), SCENARIO)).toBe('after_write');
    expect(armedRecoveryFault(armed('after_write'), OTHER), 'CONTRAST: the request is for another scenario').toBeUndefined();
    expect(armedRecoveryFault(armed('after_write', OTHER), SCENARIO), 'CONTRAST: named for another scenario').toBeUndefined();
    expect(armedRecoveryFault(armed('kill_process'), SCENARIO), 'CONTRAST: an unknown point').toBeUndefined();
    expect(armedRecoveryFault({}, SCENARIO), 'CONTRAST: nothing asked').toBeUndefined();
  });
});

const rows: Record<string, unknown>[] = [];
let runs = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('after_run on the live route: the Run is recorded once, and the turn ends before its answer row', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => runPressToolResponse(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      ?? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      runs += 1;
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH, blocks: [BLOCK],
        analysis_state: STATE, analysis_ready: READY };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
      analysis_state: STATE, analysis_result: BLOCK, current_read: { run_state: { kind: 'complete_current', computed_at: AT },
        computed_against_hash: HASH, current_analysis_hash: HASH, figures: [], run_id: 'run_seam_1' } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals(); restoreEnv();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; runs = 0; setEnv({ OLUMI_ENV: 'staging', CEE_RECOVERY_FAULT_SEAM: 'on' }); });
  afterEach(restoreEnv);

  const runPress = (extra: Record<string, unknown> = {}) => {
    const turnId = randomUUID();
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: turnId, scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' }, ...extra,
    } }).then((res) => ({ res, turnId }));
  };

  it('⭐ RED: armed after_run → the Run ran once, the turn is interrupted (503 RECOVERY_FAULT_INJECTED), and NO answer row was written', async () => {
    const { res, turnId } = await runPress(armed('after_run'));
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json()).toEqual({ error: 'RECOVERY_FAULT_INJECTED', point: 'after_run' });
    expect(runs, 'the Run happened before the interruption, once').toBe(1);
    expect(rows.filter((r) => r.turn_id === turnId), 'no answer row for the interrupted turn').toEqual([]);
  });

  it('CONTRAST: the same press with the switch off runs and answers as normal (one Run, one answer row)', async () => {
    delete process.env.CEE_RECOVERY_FAULT_SEAM;
    const { res, turnId } = await runPress(armed('after_run'));
    expect(res.statusCode, res.body).toBe(200);
    expect(runs).toBe(1);
    expect(rows.filter((r) => r.turn_id === turnId)).toHaveLength(1);
  });

  it('CONTRAST: armed for ANOTHER scenario, or for a write point, the Run press answers as normal', async () => {
    for (const extra of [armed('after_run', OTHER), armed('after_write'), armed('before_write')]) {
      const { res, turnId } = await runPress(extra);
      expect(res.statusCode, `${JSON.stringify(extra)}: ${res.body.slice(0, 200)}`).toBe(200);
      expect(rows.filter((r) => r.turn_id === turnId)).toHaveLength(1);
    }
    expect(runs).toBe(3);
  });
});
