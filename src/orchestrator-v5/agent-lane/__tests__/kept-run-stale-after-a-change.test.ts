/**
 * ⭐ THE KEPT RUN SAYS WHEN THE MODEL HAS MOVED PAST IT (AI Quality ruling, #70 5859279825 + 5859288025, part (a)).
 *
 * C1 keeps the latest run's output in the Agent's history for 24 turns, and every approval since changes the model it
 * describes. The route stores each turn's history AFTER its final readback (`readBackState`) and hands that readback's
 * canonical verdict to the prune, so a run the model has moved past is stored `stale: true` with a one-line note —
 * before the NEXT request is built. Hash spaces: the verdict and the readback's own `analysis_result` stamp decide;
 * the readback's wire `graph_hash` is the RAW compare-and-set base, not the stamp's canonical projection.
 *
 * Driven through the REAL route with the served A02 run (`served-pj-a02-run.json`, a WITHHELD run): Run chip → propose
 * (one model call) → approve chip (zero) → a typed question, whose request is captured at the provider boundary.
 * CONTROL: Run chip → a typed question with no edit carries the run unmarked — which also proves the route hands the
 * prune a readback at all (with none, it fails closed and marks the run unconfirmed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';

const EDITED_SCENARIO = '9c4e6a31-5d7f-4e80-a1b2-4c6d8e0f2a3b';
const UNEDITED_SCENARIO = 'ad5f7b42-6e80-4f91-b2c3-5d7e9f1a3b4c';
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

const served = JSON.parse(readFileSync(new URL('./fixtures/served-pj-a02-run.json', import.meta.url), 'utf8')) as {
  analysis_result: { computed_against_hash: string }; analysis_ready: unknown; analysis_state: Record<string, unknown>;
};
const STAMP = served.analysis_result.computed_against_hash;
// A link is proposed only with the band the user typed THIS turn (#70 5845493088).
const TYPED_BAND = 'Team size strongly drives velocity, so connect them.';
const RE_RANKING = /confidence|near_tie|goal_fit|separation|alternative_winner|win_probabilit|sensitivity|evpi|enrichment/i;

type Item = { type?: string; name?: string; call_id?: string; output?: string };
const keysOf = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keysOf)
  : v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

describe('the kept run is marked stale in the request after a change, and not without one', () => {
  let app: FastifyInstance;
  /** What the provider was sent, request by request. */
  const requests: { input: Item[] }[] = [];
  /** The next model outputs, in order; an empty queue answers in words. */
  const script: unknown[][] = [];
  /** Per scenario: has a run completed, and the links the approvals added (any link = the model moved). */
  const ran = new Set<string>();
  const edges = new Map<string, { from: string; to: string }[]>();
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      requests.push({ input: (JSON.parse(String(init?.body ?? '{}')) as { input?: Item[] }).input ?? [] });
      const output = script.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis cannot name an option yet.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    // The graph read: the run's own verdict and result while nothing has changed; stale with no result once a link lands.
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const id = (req.params as { id: string }).id;
      const held = edges.get(id) ?? [];
      const moved = held.length > 0;
      return {
        graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: held },
        // The wire hash is the RAW base: deliberately never the stamp, so only the canonical verdict can clear the run.
        graph_hash: `raw${held.length}`,
        ...(!ran.has(id) ? {}
          : moved ? { analysis_state: { ...served.analysis_state, run_state: { kind: 'complete_stale', computed_at: '2026-09-27T18:20:03.050Z', cause: 'graph_changed' }, requires_rerun: true } }
            : { analysis_state: served.analysis_state, analysis_result: served.analysis_result }),
      };
    });
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; scenario_id?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) edges.set(String(b.scenario_id), [...(edges.get(String(b.scenario_id)) ?? []), { from: b.event.from, to: b.event.to }]);
      if (b.chip?.action_type === 'run_analysis') {
        ran.add(String(b.scenario_id));
        return { assistant_text: 'ran', blocks: [served.analysis_result], analysis_ready: served.analysis_ready, analysis_state: served.analysis_state };
      }
      return { assistant_text: 'Added.' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
    // The route module's first import can take over a minute on a loaded machine.
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const turn = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', ...payload } });
  const runChip = async (scenario_id: string) => {
    const r = await turn({ scenario_id, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path, 'control: the Run chip took its fast path').toBe('run');
  };
  /** The run's output in the LAST request, parsed, and whether its call is still beside it. */
  const carriedRun = () => {
    const input = requests[requests.length - 1]!.input;
    const runCall = input.find((i) => i.type === 'function_call' && i.name === 'run_analysis');
    expect(runCall, 'the run call is in the request').toBeDefined();
    const output = input.find((i) => i.type === 'function_call_output' && i.call_id === runCall!.call_id)?.output;
    expect(output, 'the run output is beside its call (valid input)').toBeTypeOf('string');
    return JSON.parse(String(output)) as { stale?: unknown; stale_note?: unknown; result?: { computed_against_hash?: unknown } };
  };

  it('RED: Run → propose → approve chip → the next request carries the run marked stale, still paired and still withheld-safe', async () => {
    await runChip(EDITED_SCENARIO);
    script.push([{
      type: 'function_call', name: 'propose_model_change', call_id: 'c_link',
      arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }),
    }]);
    const proposed = (await turn({ scenario_id: EDITED_SCENARIO, message: TYPED_BAND })).json() as { suggested_actions: { id: string; message: string }[]; _agent: { tool_calls: { name: string; proposal_id?: string }[] } };
    const proposalId = proposed._agent.tool_calls.find((c) => c.name === 'propose_model_change')?.proposal_id;
    expect(proposalId, 'control: a real proposal was made').toMatch(/^prop_/);
    // The run is still current in the propose turn's own request: nothing has changed yet.
    expect(carriedRun().stale, 'control: before the edit the run is unmarked').toBeUndefined();
    const approve = proposed.suggested_actions.find((a) => a.id === `agent-approve-proposal:${proposalId}`)!;
    expect(approve, 'the approve chip was offered').toBeDefined();
    const clicked = (await turn({ scenario_id: EDITED_SCENARIO, message: approve.message, source: 'chip', chip: { id: approve.id } })).json() as { _diagnostic_trace: { fast_path?: string } };
    expect(clicked._diagnostic_trace.fast_path).toBe('approve');
    expect(edges.get(EDITED_SCENARIO), 'control: the approval changed the model').toHaveLength(1);

    await turn({ scenario_id: EDITED_SCENARIO, message: 'What does the run say now?' });
    const kept = carriedRun();
    expect(kept.stale, 'the model moved after the run').toBe(true);
    expect(String(kept.stale_note)).toMatch(/changed since this run/);
    expect(kept.result?.computed_against_hash, 'still stamped with the hash it was computed against').toBe(STAMP);
    expect(keysOf(kept).filter((k) => RE_RANKING.test(k) && k !== 'decision_sensitivity'), 'a withheld run keeps nothing that re-ranks').toEqual([]);
  });

  it('CONTROL: Run → a typed question with no edit carries the run unmarked', async () => {
    await runChip(UNEDITED_SCENARIO);
    await turn({ scenario_id: UNEDITED_SCENARIO, message: 'What does the run say?' });
    const kept = carriedRun();
    expect(kept.stale, 'the readback selected this very run').toBeUndefined();
    expect(kept.stale_note).toBeUndefined();
    expect(kept.result?.computed_against_hash).toBe(STAMP);
  });
});
