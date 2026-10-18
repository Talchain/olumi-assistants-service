/**
 * ⭐ C5 (measured G2 Undo, 18 Oct): THE AUTOMATIC RUN AFTER A RESTORE IS COACHED KNOWING THE MODEL WAS RESTORED.
 *
 * Measured: the user pressed Undo; the restore saved atomically (its own version, mutation and "Undo: …" label); the
 * automatic Run analysed the restored value correctly, but the coaching asked the user to reconcile it with the value they
 * had just undone. The Run press carried only the Run chip, and the context packet held no restore, so the interpreter
 * could not know. The first loss is restore receipt → the Run's coaching context, not numeric persistence.
 *
 * The repair reads the EXISTING model-management head (`getCurrentVersion`) and carries it ONLY when it is bound to the
 * selected Run pair: a restore of this scenario with its own mutation and source version, whose graph is the graph read,
 * saved after the preceding Run and before this one. ⛔ A matching graph hash alone never proves a restore.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { buildRunDelta } from '../../coaching/build-run-delta.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';

const SCENARIO = '5c0e2a41-7d3b-4f6e-9a1c-2b8d4e6f0a13';
const OTHER_SCENARIO = '9f1d3b5a-2c4e-4a6b-8d0f-1e3a5c7b9d24';
const graphAt = (value: number) => ({
  nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity', observed_state: { value } }],
  edges: [{ from: 'f', to: 'g' }],
});
const GRAPH_AT_2 = graphAt(2);
const GRAPH_AT_4 = graphAt(4);
const HASH_2 = computeAnalysisAffectingGraphHash(GRAPH_AT_2 as never)!;
const HASH_4 = computeAnalysisAffectingGraphHash(GRAPH_AT_4 as never)!;
const PRIOR_AT = '2026-10-18T03:00:00.000Z';
const RUN_AT = '2026-10-18T03:02:00.000Z';
/** Supabase's own timestamp form (microseconds, offset), between the two Runs. */
const SAVED_BETWEEN = '2026-10-18T03:01:00.123456+00:00';

const RESTORE_V = 'a1b2c3d4-0000-4000-8000-000000000004';
const RESTORE_MUT = 'e5f6a7b8-0000-4000-8000-0000000000c4';
const EARLIER_V = 'a1b2c3d4-0000-4000-8000-000000000002';
const EDIT_V = 'a1b2c3d4-0000-4000-8000-000000000003';

/** The prior Run (the model at 4) and the Run after the restore (the model at 2): the producer's own fixture shape. */
function runFact(runId: string, computedAt: string, wins: [number, number], hash: string): HandlerFact {
  return {
    fact_type: 'run_analysis', noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: [{ option_id: 'opt_a', option_label: 'Option A', win_probability: wins[0] }, { option_id: 'opt_b', option_label: 'Option B', win_probability: wins[1] }],
        meta: { seed_used: '4242', n_samples: 10_000 },
        _meta: { builds: { plot: 'plot-1', isl: 'isl-1' } },
      },
      run_id: runId, computed_at: computedAt, graph_hash_at_run: hash,
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    },
  } as unknown as HandlerFact;
}
const built = buildRunDelta({ priorFacts: [runFact('run-after-restore', RUN_AT, [0.44, 0.56], HASH_2), runFact('run-at-4', PRIOR_AT, [0.61, 0.39], HASH_4)], mayNameLeadingOption: false });
if (built.kind !== 'ok') throw new Error(`fixture: the producer refused (${built.reason})`);
const DELTA = built.delta;

const STATE = { run_state: { kind: 'complete_current', computed_at: RUN_AT },
  leader_claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } };
const RESULT = { type: 'analysis_result', computed_against_hash: HASH_2, summary: 'A provisional comparison.', leading_option_id: null };

/** A saved version row as `getCurrentVersion` returns it (`model-management/types.ts` ModelVersionRecord). */
const versionRow = (over: Record<string, unknown> = {}) => ({
  id: RESTORE_V, scenario_id: SCENARIO, owner_user_id: 'owner-1', version_number: 4,
  graph_identity_hash: 'f'.repeat(64), hash_algorithm: 'sha256', identity_projection_version: '1',
  identity_normaliser_version: '1', graph_schema_version: '1', analysis_affecting_hash: 'e'.repeat(64),
  mutation_id: RESTORE_MUT, parent_version_id: EDIT_V, root_version_id: EARLIER_V, actor_kind: 'known', authored_by: 'owner-1',
  creation_kind: 'restore', source_version_id: EARLIER_V, source_turn_id: null, label: 'Undo: Edit Capacity', provenance: null,
  restored_from_version_id: EARLIER_V, created_at: SAVED_BETWEEN, graph: GRAPH_AT_2,
  ...over,
});

let head: unknown;
const headReads: string[] = [];
vi.mock('../../model-management/index.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  getModelManagementService: () => ({
    getCurrentVersion: async (scenarioId: string) => { headReads.push(scenarioId); return head; },
  }),
}));
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

/** The Agent's own tool outputs, as its next provider call receives them. */
function toolOutputs(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (item?.type !== 'function_call_output' || typeof item.output !== 'string') return [];
    try { return [JSON.parse(item.output) as Record<string, unknown>]; } catch { return []; }
  });
}

describe('C5: the Run after a restore is coached with the bound restore occurrence; a matching hash alone never proves one', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let interpreterSaw: Record<string, unknown> | undefined;
  let agentToolOutputs: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelCalls += 1;
      if (body['tool_choice'] === 'none') interpreterSaw = explanationContext(body['input']);
      else agentToolOutputs.push(...toolOutputs(body['input']));
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
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH_2,
      blocks: [RESULT], analysis_state: STATE, analysis_ready: { status: 'ready', options: [], blockers: [] }, run_delta: DELTA,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: GRAPH_AT_2, graph_hash: HASH_2,
      analysis_ready: { status: 'ready', options: [], blockers: [], goal_node_id: 'g' },
      analysis_state: STATE, analysis_result: RESULT, current_read: { run_delta: DELTA },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    modelCalls = 0; interpreterSaw = undefined; agentToolOutputs = []; headReads.length = 0;
    head = { status: 'ok', value: versionRow() };
  });

  /** The canvas's automatic Run after a committed change reaches CEE as a Run press (only the chip, no restore pointer). */
  const pressRun = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
  } });
  /** What the interpreter's context holds, after proving the call happened, read the head, and had a comparison to coach. */
  const interpreterContext = async (): Promise<Record<string, unknown>> => {
    const r = await pressRun();
    expect(r.statusCode).toBe(200);
    const cs = interpreterSaw?.canonical_state as Record<string, unknown> | undefined;
    expect(cs, 'PRECONDITION: the interpreter call happened and read canonical state').toBeDefined();
    expect(cs!.rerun_record ?? (cs!.analysis as { run_delta?: unknown } | undefined)?.run_delta,
      'PRECONDITION: the pair has a comparison to coach').toBeDefined();
    return cs!;
  };
  /** A contrast's absence counts only when the existing head WAS read for this scenario (the binding refused it, not a skip). */
  const refusedAfterReading = (cs: Record<string, unknown>) => {
    expect(headReads, 'PRECONDITION: the existing model-management head was read for THIS scenario').toContain(SCENARIO);
    expect(cs.restore_between_runs).toBeUndefined();
  };

  it('CONTROL: the fixture is a re-run pair (4 → 2) whose endpoints are the two Runs', () => {
    expect(HASH_2).not.toBe(HASH_4);
    expect(DELTA.endpoints?.prior.computed_at).toBe(PRIOR_AT);
    expect(DELTA.endpoints?.current.computed_at).toBe(RUN_AT);
    expect(DELTA.endpoints?.current.run_id).toBe('run-after-restore');
  });

  it('RED→GREEN: a committed restore 4 → 2, then the automatic Run → the interpreter receives the restore occurrence, by identity', async () => {
    const cs = await interpreterContext();
    expect(cs.restore_between_runs).toEqual({
      version_id: RESTORE_V, version_number: 4, mutation_id: RESTORE_MUT, restored_version_id: EARLIER_V,
      label: 'Undo: Edit Capacity',
      run_id: DELTA.endpoints!.current.run_id, preceding_run_id: DELTA.endpoints!.prior.run_id,
    });
  });

  it('RED→GREEN (caller 2 of 2): the Agent\'s own run_analysis output carries the same occurrence in run_comparison', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run it again please' } });
    expect(r.statusCode).toBe(200);
    const comparison = agentToolOutputs.map((o) => o.run_comparison as Record<string, unknown> | undefined).find((c) => c !== undefined);
    expect(comparison, 'PRECONDITION: the Run output carried its comparison').toBeDefined();
    expect(comparison!.restore_between_runs).toMatchObject({ version_id: RESTORE_V, mutation_id: RESTORE_MUT,
      restored_version_id: EARLIER_V, run_id: DELTA.endpoints!.current.run_id });
  });

  it('CONTRAST (a): an ordinary manual edit back to 2 (same graph, same hash, saved between the Runs) carries NO restore', async () => {
    head = { status: 'ok', value: versionRow({ creation_kind: 'committed_mutation', source_version_id: null,
      restored_from_version_id: null, label: 'Edit Capacity', id: EDIT_V }) };
    refusedAfterReading(await interpreterContext());
  });

  it('CONTRAST (b): a stale or replayed restore receipt (saved before the preceding Run) carries none', async () => {
    head = { status: 'ok', value: versionRow({ created_at: '2026-10-18T02:59:00.000000+00:00' }) };
    refusedAfterReading(await interpreterContext());
  });

  it('CONTRAST (b): a restore saved after the selected Run (its head does not match this Run) carries none', async () => {
    head = { status: 'ok', value: versionRow({ created_at: '2026-10-18T03:03:00.000000+00:00' }) };
    refusedAfterReading(await interpreterContext());
  });

  it('CONTRAST (b): a foreign restore (another scenario\'s version) carries none', async () => {
    head = { status: 'ok', value: versionRow({ scenario_id: OTHER_SCENARIO }) };
    refusedAfterReading(await interpreterContext());
  });

  it('CONTRAST (b): a restore whose graph is not the graph read (the model at 4) carries none', async () => {
    head = { status: 'ok', value: versionRow({ graph: GRAPH_AT_4 }) };
    refusedAfterReading(await interpreterContext());
  });

  it('CONTRAST (b): an unreadable head carries none, and the Run is still coached', async () => {
    head = { status: 'error', error: { code: 'store_error', recoverable: true, message: 'unavailable' } };
    refusedAfterReading(await interpreterContext());
  });

  it('(c): a Redo keeps its own identity and its own label', async () => {
    head = { status: 'ok', value: versionRow({ id: 'a1b2c3d4-0000-4000-8000-000000000005', version_number: 5,
      mutation_id: 'e5f6a7b8-0000-4000-8000-0000000000c5', source_version_id: EDIT_V, restored_from_version_id: EDIT_V,
      label: 'Redo: Edit Capacity' }) };
    expect((await interpreterContext()).restore_between_runs).toEqual({
      version_id: 'a1b2c3d4-0000-4000-8000-000000000005', version_number: 5, mutation_id: 'e5f6a7b8-0000-4000-8000-0000000000c5',
      restored_version_id: EDIT_V, label: 'Redo: Edit Capacity',
      run_id: DELTA.endpoints!.current.run_id, preceding_run_id: DELTA.endpoints!.prior.run_id,
    });
  });

  it('(c): a second restore with no gesture label keeps its own identity and carries no label (never an inferred Undo)', async () => {
    head = { status: 'ok', value: versionRow({ id: 'a1b2c3d4-0000-4000-8000-000000000006', version_number: 6,
      mutation_id: 'e5f6a7b8-0000-4000-8000-0000000000c6', label: null }) };
    const occurrence = (await interpreterContext()).restore_between_runs as Record<string, unknown>;
    expect(occurrence).toEqual({
      version_id: 'a1b2c3d4-0000-4000-8000-000000000006', version_number: 6, mutation_id: 'e5f6a7b8-0000-4000-8000-0000000000c6',
      restored_version_id: EARLIER_V, run_id: DELTA.endpoints!.current.run_id, preceding_run_id: DELTA.endpoints!.prior.run_id,
    });
    expect(occurrence).not.toHaveProperty('label');
  });
});
