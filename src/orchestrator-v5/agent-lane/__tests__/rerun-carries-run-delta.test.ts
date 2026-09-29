/**
 * ⭐ A RE-RUN ON THE AGENT ROUTE SAYS WHAT CHANGED SINCE THE LAST RUN (DL #70 5849261529: "emit `run_delta` on a
 * re-run turn as the conventional route does. The UI consumer is waiting."). The Agent's Run — the typed chip and its
 * own `run_analysis` call — goes through the SAME conventional run turn, whose finaliser builds `run_delta` from the
 * post-dispatch fact window (`buildRunDelta`). The Agent route answered from its own readback and dropped it, so a
 * re-run on this lane never showed the run-over-run consequence.
 *
 * The run turn's own block is carried — never re-derived here — and ONLY when the run it describes IS the run the
 * response shows (`bindCapturedRun`, full identity: same scenario, graph and time, and the same leader claim the delta
 * was built under). The producer's refusal reason travels the same way, inside `analysis_ready`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { buildRunDelta } from '../../coaching/build-run-delta.js';

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
const HASH = '0123456789abcdef';
const RUN_AT = '2026-09-26T20:40:00.000Z';
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

/** A run before an authorised revision and the re-run after it (the producer's own fixture shape, `build-run-delta.test.ts`). */
function runFact(computedAt: string, wins: [number, number], hash: string): HandlerFact {
  return {
    fact_type: 'run_analysis', noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: [{ option_id: 'opt_54', option_label: 'Test £54', win_probability: wins[0] }, { option_id: 'opt_59', option_label: 'Move to £59', win_probability: wins[1] }],
        meta: { seed_used: '4242', n_samples: 10_000 },
        // The same PLoT and ISL builds on both runs, so the difference is attributable to the revision (C1).
        _meta: { builds: { plot: 'plot-1', isl: 'isl-1' } },
      },
      computed_at: computedAt, graph_hash_at_run: hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    },
  } as unknown as HandlerFact;
}
const built = buildRunDelta({ priorFacts: [runFact(RUN_AT, [0.44, 0.56], HASH), runFact('2026-09-26T20:10:00.000Z', [0.61, 0.39], 'aaaaaaaaaaaaaaaa')], mayNameLeadingOption: false });
if (built.kind !== 'ok') throw new Error(`fixture: the producer refused (${built.reason})`);
const DELTA = built.delta;

const CLAIM = { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' };
const STATE = { run_state: { kind: 'complete_current', computed_at: RUN_AT }, leader_claim: CLAIM };
const RESULT = { type: 'analysis_result', computed_against_hash: HASH, summary: 'A provisional comparison.', leading_option_id: null };
const PARTICIPATION = [{ option_id: 'suggested', state: 'excluded_olumi_proposed' }];

describe('a re-run on the Agent route carries the run turn\'s run_delta, bound to the run it shows', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let interpreterSaw: Record<string, unknown> | undefined;
  /** What the conventional run turn answered (the producer's block, or its refusal reason). */
  let runTurn: 'delta' | 'first_run' | 'blocked' = 'delta';
  /** What the final readback shows: the same run, a newer one, or a result for another graph. */
  let readback: 'same' | 'newer_run' | 'other_graph' = 'same';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelCalls += 1;
      // What the one interpreter call (tool_choice 'none') is given: the run's tool output, as the model reads it.
      if (body['tool_choice'] === 'none') {
        // The LAST tool output is this turn's run; earlier ones are the scenario's history.
        const out = [...((body['input'] ?? []) as { type?: string; output?: string }[])].reverse().find((i) => i.type === 'function_call_output');
        interpreterSaw = out?.output !== undefined ? JSON.parse(out.output) as Record<string, unknown> : undefined;
      }
      if (body['tool_choice'] !== 'none' && modelCalls === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis', call_id: 'c1', arguments: JSON.stringify({ reason: 'asked' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the result turns on Capacity.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      if (runTurn === 'blocked') {
        return { response_version: 2, assistant_text: 'I can\'t run the analysis yet.', suggested_actions: [], insights: [], graph_hash: HASH,
          blocks: [], analysis_ready: { status: 'blocked', options: [], blockers: [{ code: 'NO_PATH_TO_GOAL' }] } };
      }
      return {
        response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH,
        blocks: [RESULT], analysis_state: STATE,
        analysis_ready: { status: 'ready', options: [], blockers: [], ...(runTurn === 'first_run' ? { run_delta_absence_reason: 'insufficient_runs' } : {}) },
        ...(runTurn === 'delta' ? { run_delta: DELTA } : {}),
      };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: HASH,
      // The served graph read states readiness for the graph it returns (the carrier the reason rides in).
      analysis_ready: { status: 'ready', options: [], blockers: [], goal_node_id: 'g' },
      analysis_state: readback === 'newer_run' ? { ...STATE, run_state: { kind: 'complete_current', computed_at: '2026-09-26T20:41:00.000Z' } } : STATE,
      analysis_result: readback === 'other_graph' ? { ...RESULT, computed_against_hash: 'fedcba9876543210' } : RESULT,
      analysis_option_participation: PARTICIPATION,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelCalls = 0; interpreterSaw = undefined; runTurn = 'delta'; readback = 'same'; });

  const pressRun = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } });
  type Body = { run_delta?: unknown; analysis_ready?: Record<string, unknown>; _diagnostic_trace?: { fast_path?: string } };

  it('CONTROL: the fixture delta is the producer\'s own, valid under the contract', () => {
    expect(RunDeltaSchema.safeParse(DELTA).success).toBe(true);
  });

  it('RED: the typed Run on a re-run → the response carries the run turn\'s run_delta, exactly', async () => {
    const r = await pressRun();
    expect(r.statusCode).toBe(200);
    const b = r.json() as Body;
    expect(b._diagnostic_trace?.fast_path).toBe('run');
    expect(b.run_delta).toEqual(DELTA);
    // The run turn gave no refusal reason, so none is carried (Canonical #2039 N1: never invent one).
    expect(b.analysis_ready?.run_delta_absence_reason).toBeUndefined();
  });

  it('RED (served 263dbd5, 053159Z/15): the interpreter is GIVEN the same run_delta the user is shown — no "no delta supplied"', async () => {
    const b = (await pressRun()).json() as Body;
    expect(b.run_delta).toEqual(DELTA);
    const cs = interpreterSaw?.canonical_state as Record<string, unknown> | undefined;
    expect(cs?.run_delta, 'the one interpreter call reads the delta the wire carries').toEqual(DELTA);
  });

  it('RED: a first run → the interpreter is given the producer\'s reason, not a delta', async () => {
    runTurn = 'first_run';
    await pressRun();
    const cs = interpreterSaw?.canonical_state as Record<string, unknown> | undefined;
    expect(cs?.run_delta).toBeUndefined();
    expect(cs?.run_delta_absence_reason).toBe('insufficient_runs');
  });

  it('CONTRAST (the same guard as the wire): the readback shows a NEWER run → the interpreter is given neither', async () => {
    readback = 'newer_run';
    const b = (await pressRun()).json() as Body;
    expect('run_delta' in b).toBe(false);
    const cs = interpreterSaw?.canonical_state as Record<string, unknown> | undefined;
    expect(cs, 'PRECONDITION: the interpreter call happened and read canonical state').toBeDefined();
    expect(cs?.run_delta).toBeUndefined();
    expect(cs?.run_delta_absence_reason).toBeUndefined();
  });

  it('binds participation to the executed Run, never lends a same-hash newer Run fact to its interpretation', async () => {
    await pressRun();
    expect(interpreterSaw?.option_participation).toEqual(PARTICIPATION);
    expect((interpreterSaw?.canonical_state as Record<string, unknown> | undefined)?.option_participation).toBeUndefined();

    readback = 'newer_run';
    await pressRun();
    expect(interpreterSaw?.option_participation).toBeUndefined();
    expect((interpreterSaw?.canonical_state as Record<string, unknown> | undefined)?.option_participation).toBeUndefined();
  });

  it('RED: the Agent\'s own run_analysis call (the user asked in words) carries it the same way', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run it again please' } });
    const b = r.json() as Body;
    expect(b._diagnostic_trace?.fast_path).toBeUndefined();
    expect(b.run_delta).toEqual(DELTA);
  });

  it('RED: a first run → no delta, and the producer\'s reason ("only run once") reaches the user\'s analysis_ready', async () => {
    runTurn = 'first_run';
    const b = (await pressRun()).json() as Body;
    expect('run_delta' in b).toBe(false);
    expect(b.analysis_ready?.run_delta_absence_reason).toBe('insufficient_runs');
    // It rides in the READBACK's own analysis_ready: that readback's freshness stamp is still on it.
    expect(b.analysis_ready?.current_graph_hash).toBe(HASH);
  });

  it('CONTRAST: the readback shows a NEWER run than the one this turn ran → neither the delta nor its reason', async () => {
    readback = 'newer_run';
    const b = (await pressRun()).json() as Body;
    expect('run_delta' in b).toBe(false);
    runTurn = 'first_run';
    const c = (await pressRun()).json() as Body;
    expect(c.analysis_ready?.run_delta_absence_reason).toBeUndefined();
  });

  it('CONTRAST: the readback\'s result is for another graph (the model changed after the run) → no delta', async () => {
    readback = 'other_graph';
    expect('run_delta' in ((await pressRun()).json() as Body)).toBe(false);
  });

  it('CONTRAST: a Run that was refused (nothing ran) → no delta and no reason', async () => {
    runTurn = 'blocked';
    const b = (await pressRun()).json() as Body;
    expect('run_delta' in b).toBe(false);
    expect(b.analysis_ready?.run_delta_absence_reason).toBeUndefined();
  });
});
