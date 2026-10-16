/**
 * ⭐ THE RECOVERY FAULT SEAM (`recovery-fault-seam.ts`; DL 20:10Z 15 Oct, Paul's A6 served recovery proof). Armed only on a
 * POSITIVELY identified staging process, with `CEE_RECOVERY_FAULT_SEAM=on`, by a request naming its own scenario and a point.
 * Here: the gate (impossible in production, off by default, bound to the scenario) and the `after_run` window through the live
 * route: the Run is recorded once, and the turn ends before its answer row, as a crash there would. The write windows
 * (`before_write`, `after_write`) are proven on the stateful writer harness (`agent-writer-doors-seam.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
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

const ENV_KEYS = ['OLUMI_ENV', 'RENDER_SERVICE_NAME', 'NODE_ENV', 'CEE_RECOVERY_FAULT_SEAM', 'OLUMI_DEPLOYMENT'] as const;
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
    // BUDDY-A #3262 B1: the declared production deployment never arms, whatever its environment label says.
    ['the declared production deployment labelled staging', { OLUMI_DEPLOYMENT: 'production', OLUMI_ENV: 'staging', CEE_RECOVERY_FAULT_SEAM: 'on' }],
    ['the declared production deployment with a staging Render name', { OLUMI_DEPLOYMENT: 'production', RENDER_SERVICE_NAME: 'olumi-assistants-service-staging', CEE_RECOVERY_FAULT_SEAM: 'on' }],
  ];
  it.each(inert)('INERT: %s', (_name, env) => {
    setEnv(env);
    if (env.NODE_ENV !== undefined) process.env.NODE_ENV = env.NODE_ENV;
    try {
      expect(armedRecoveryFault(armed(), SCENARIO)).toBeUndefined();
    } finally { if (env.NODE_ENV !== undefined) process.env.NODE_ENV = saved.NODE_ENV; }
  });
  it('ARMED only on a positively identified staging process with the switch on, for its own scenario and a known point', () => {
    // Control for B1: a genuine staging deployment (declared staging, or no deployment declared) still arms.
    setEnv({ OLUMI_DEPLOYMENT: 'staging', OLUMI_ENV: 'staging', CEE_RECOVERY_FAULT_SEAM: 'on' });
    expect(armedRecoveryFault(armed('after_write'), SCENARIO)).toBe('after_write');
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
let selectedRun = '';
let hideFact = false;
let interpretations = 0;
let holdInterpretation: { entered: () => void; wait: Promise<void> } | undefined;
const nativeTurnIds: string[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => {
    const prior = rows.find(r => r.turn_id === row.turn_id);
    if (prior) return { id: String(row.turn_id), replayedPriorTurn: true, priorTurnConflict: prior.request_hash !== row.request_hash };
    rows.push({ ...row, id: row.turn_id, user_message: row.userMessage ?? null, assistant_message: row.assistantMessage ?? null }); return { id: String(row.turn_id) };
  }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async (ids: readonly string[]) => hideFact ? [] : rows.filter(r => ids.includes(String(r.id))).flatMap(r => (r.handler_facts ?? []) as HandlerFact[])),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('after_run on the live route: the Run is recorded once, and the turn ends before its answer row', () => {
  let app: FastifyInstance;
  let wait: { totalMs: number; everyMs: number };
  let savedWait: number;
  let savedEvery: number;
  const freshApp = async () => {
    const { agentV1TurnRoute, AGENT_TURN_CLAIM_WAIT } = await import('../../../routes/agent-v1-turn.js');
    wait = AGENT_TURN_CLAIM_WAIT; savedWait = wait.totalMs; savedEvery = wait.everyMs; wait.totalMs = 100; wait.everyMs = 1;
    const fresh = Fastify({ logger: false });
    fresh.post('/orchestrate/v2/turn', async req => {
      runs += 1;
      const body = req.body as { turn_id: string };
      nativeTurnIds.push(body.turn_id);
      selectedRun = randomUUID();
      const fact = RunAnalysisHandlerFactSchema.parse({ fact_type: 'run_analysis', fact_version: 1, noop: false,
        result: { scenario_id: SCENARIO, run_id: selectedRun, graph_hash_at_run: HASH, computed_at: AT,
          leading_option_id: null, summary: BLOCK.summary, win_probabilities: BLOCK.win_probabilities, enrichment: BLOCK.enrichment } });
      await store.append({ turn_id: body.turn_id, request_hash: 'native-run', handler_facts: [fact] });
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH, blocks: [BLOCK],
        analysis_state: STATE, analysis_ready: READY };
    });
    fresh.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
      analysis_state: STATE, analysis_result: BLOCK, current_read: { run_state: { kind: 'complete_current', computed_at: AT },
        computed_against_hash: HASH, current_analysis_hash: HASH, figures: [], run_id: selectedRun } }));
    await fresh.register(agentV1TurnRoute);
    await fresh.ready();
    return fresh;
  };
  const coldReopen = async () => {
    await app.close(); vi.resetModules(); app = await freshApp();
  };
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (Array.isArray(body.tools) && body.tools.length === 0 && body.tool_choice === 'none') {
        interpretations += 1;
        const hold = holdInterpretation; holdInterpretation = undefined;
        if (hold !== undefined) { hold.entered(); await hold.wait; }
      }
      return runPressToolResponse(body) ?? new Response(JSON.stringify({ output: [{ type: 'message', content: [
        { type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await freshApp();
  }, 60_000);
  afterAll(async () => {
    wait.totalMs = savedWait; wait.everyMs = savedEvery; await app.close(); vi.unstubAllGlobals(); restoreEnv();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; runs = 0; selectedRun = ''; hideFact = false; interpretations = 0; holdInterpretation = undefined; nativeTurnIds.length = 0; setEnv({ OLUMI_ENV: 'staging', CEE_RECOVERY_FAULT_SEAM: 'on' }); });
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


  const retry = (turnId: string, extra: Record<string, unknown> = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { turn_id: turnId, scenario_id: SCENARIO, message: 'Run the analysis', source: 'retry', ...extra } });

  it('after_run → same operation chipless retry recovers its Run and appends one answer; another retry replays it', async () => {
    const { res, turnId } = await runPress(armed());
    expect(res.statusCode).toBe(503);
    const originalRun = selectedRun;
    const recovered = await retry(turnId);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(runs).toBe(1); expect(selectedRun).toBe(originalRun);
    const answers = rows.filter(r => r.turn_id === turnId);
    expect(answers).toHaveLength(1);
    expect(String(answers[0]!.request_hash)).toContain('#chip:'); // Never reclassify button words as human authorship.
    expect(recovered.json().blocks.some((b: { type: string }) => b.type === 'analysis_result')).toBe(true);
    const replay = await retry(turnId);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().assistant_text).toBe(recovered.json().assistant_text);
    expect(runs).toBe(1); expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1);
  });

  it('the served same-request resend keeps chip/source/id, recovers one useful answer and survives a cold route reopen', async () => {
    const { res, turnId } = await runPress(armed());
    expect(res.statusCode).toBe(503);
    const original = selectedRun;
    await coldReopen();
    const recovered = await runPress({ turn_id: turnId });
    expect(recovered.res.statusCode, recovered.res.body).toBe(200);
    expect(recovered.res.json().assistant_text).toContain('The result depends on the assumptions in your model.');
    expect(recovered.res.json().blocks).toContainEqual(BLOCK);
    expect(rows.find(r => r.turn_id === turnId)?.assistant_message).toBe(recovered.res.json().assistant_text);
    expect(selectedRun).toBe(original); expect(runs).toBe(1);
    expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1);
    const before = interpretations;
    await coldReopen();
    const replay = await runPress({ turn_id: turnId });
    expect(replay.res.statusCode, replay.res.body).toBe(200);
    expect(replay.res.json().assistant_text).toBe(recovered.res.json().assistant_text);
    expect(interpretations).toBe(before); expect(runs).toBe(1);
    expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1);
  });

  it('two concurrent retries recover one recorded Run and return the one committed answer', async () => {
    const { turnId } = await runPress(armed());
    const before = interpretations;
    const replies = await Promise.all([retry(turnId), retry(turnId)]);
    expect(interpretations - before, 'concurrent duplicate waits/reads: one recovered interpretation').toBe(1);
    expect(replies.map(r => r.statusCode)).toEqual([200, 200]);
    expect(replies[0]!.json().assistant_text).toBe(replies[1]!.json().assistant_text);
    expect(runs).toBe(1); expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1);
  });

  it('a concurrent original Run owns its in-flight answer: duplicate waits and reads, without recovery interpretation', async () => {
    let release!: () => void;
    let entered!: () => void;
    const atInterpretation = new Promise<void>(r => { entered = r; });
    holdInterpretation = { entered, wait: new Promise<void>(r => { release = r; }) };
    const turnId = randomUUID();
    const original = runPress({ turn_id: turnId });
    await atInterpretation;
    let duplicateSettled = false;
    const duplicate = retry(turnId).then(r => { duplicateSettled = true; return r; });
    try {
      await vi.waitFor(() => expect(store.readCommittedTurn.mock.calls.filter(c => c[1] === turnId).length).toBeGreaterThan(2));
      expect(duplicateSettled).toBe(false);
      expect(interpretations).toBe(1); expect(runs).toBe(1);
      expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(0);
    } finally { release(); }
    const [a, b] = await Promise.all([original, duplicate]);
    expect(a.res.statusCode, a.res.body).toBe(200); expect(b.statusCode, b.body).toBe(200);
    expect(b.json().assistant_text).toBe(a.res.json().assistant_text);
    expect(interpretations).toBe(1); expect(runs).toBe(1);
    expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1);
  });

  it('an answer append failure releases only the active request: a further retry recovers from durable Run proof', async () => {
    const { turnId } = await runPress(armed());
    const append = store.append.getMockImplementation()!;
    store.append.mockImplementation(async row => {
      if (row.turn_id === turnId) throw new Error('answer storage unavailable');
      return append(row);
    });
    try {
      const failedAppend = await retry(turnId);
      expect(failedAppend.statusCode, failedAppend.body).toBe(200);
      expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(0); expect(runs).toBe(1);
    } finally { store.append.mockImplementation(append); }
    const recovered = await retry(turnId);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(1); expect(runs).toBe(1);
  });

  it.each(['foreign selected Run', 'missing own fact'])('%s cannot recover or execute science again', async reason => {
    const { turnId } = await runPress(armed());
    if (reason === 'foreign selected Run') selectedRun = randomUUID(); else hideFact = true;
    const recovered = await retry(turnId);
    expect(recovered.statusCode, recovered.body).toBe(409);
    expect(recovered.json().error).toBe('TURN_OUTCOME_UNKNOWN');
    expect(runs).toBe(1); expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(0);
  });

  it('a deliberate fresh Run on the same revision remains a second operation; changed message on the old id refuses', async () => {
    const { turnId } = await runPress(armed());
    const foreignChip = await retry(turnId, { source: 'chip_click', chip: { action_type: 'get_canonical_state' } });
    expect(foreignChip.statusCode).toBe(409); expect(foreignChip.json().error).toBe('TURN_ID_REUSED');
    const bad = await retry(turnId, { message: 'Another request' });
    expect(bad.statusCode).toBe(409); expect(bad.json().error).toBe('TURN_ID_REUSED');
    const fresh = await runPress();
    expect(fresh.res.statusCode, fresh.res.body).toBe(200);
    expect(runs).toBe(2); expect(new Set(nativeTurnIds).size).toBe(2);
    expect(rows.filter(r => r.turn_id === fresh.turnId)).toHaveLength(1);
    expect(rows.filter(r => r.turn_id === turnId)).toHaveLength(0);
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
