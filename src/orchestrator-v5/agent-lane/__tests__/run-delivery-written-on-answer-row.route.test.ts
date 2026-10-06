/**
 * 0.79 SD-1 Slice R — THE WRITER, through the live route (DL #87 option A; `writer-after-prod-0.79`).
 *
 * A Run chip on the agent lane: the internal dispatch commits the Run, the lane composes the reply from its readback, and
 * the ANSWER row now records what that reply delivered as a `run_delivery` fact, bound to the Run this turn made
 * (`current_read.run_id`, CEE #2654). The recorded Phase 3 blocks are the reply's own, byte for byte.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { maximalReviewCardBlock } from '@talchain/schemas/fixtures';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';

const SCENARIO = '7b0e4c2a-1d3f-4e5a-9b6c-8d7e6f5a4b3d';
const HASH = 'a'.repeat(16);
const AT = '2026-10-06T07:00:00.000Z';
const RUN_ID = 'run_writer_1';
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'opt_a', kind: 'option', label: 'Raise prices' }, { id: 'opt_b', kind: 'option', label: 'Hold prices' }], edges: [] };
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
// Bound to the Run's graph, as the lane requires (`bindRunBlocksToReadback`: graph_hash_at_generation === readback hash).
const CARD = { ...(maximalReviewCardBlock as Record<string, unknown>), body: 'Most of this result rests on a single factor.', graph_hash_at_generation: HASH };
const BLOCK = {
  type: 'analysis_result', summary: 'Comparison on the current model.', leading_option_id: null,
  win_probabilities: { opt_a: 0.5, opt_b: 0.5 }, computed_against_hash: HASH,
  enrichment: { analysis_status: 'ok', option_comparison: [
    { option_id: 'opt_a', option_label: 'Raise prices', win_probability: 0.5, outcome_mean: 0.5 },
    { option_id: 'opt_b', option_label: 'Hold prices', win_probability: 0.5, outcome_mean: 0.5 },
  ] },
};
const stateAt = (computedAt: string) => ({
  run_state: { kind: 'complete_current', computed_at: computedAt },
  readiness: { status: 'ready', blockers: [] }, leader_claim: { permitted: true, separation: 'separated' },
  robustness: {}, usable_for_prose: true, usable_for_chips: true, usable_for_followup: true,
  requires_rerun: false, blocked_unusable: false, contradictions: [],
});

/** What the readback's current_read says: by default, the Run this turn made. */
let readComputedAt = AT;
let readRunId: string | undefined = RUN_ID;
const rows: Record<string, unknown>[] = [];
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

describe('0.79 · the agent answer row records what the Run\'s turn delivered (live route)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: HASH, blocks: [BLOCK, CARD], analysis_state: stateAt(AT), analysis_ready: READY }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
      analysis_state: stateAt(readComputedAt), analysis_result: BLOCK,
      current_read: { run_state: { kind: 'complete_current', computed_at: readComputedAt }, computed_against_hash: HASH,
        current_analysis_hash: HASH, figures: [], ...(readRunId !== undefined ? { run_id: readRunId } : {}) } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { rows.length = 0; readComputedAt = AT; readRunId = RUN_ID; });

  const run = async () => {
    const turnId = randomUUID();
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: turnId, scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(res.statusCode, res.body).toBe(200);
    const answer = rows.find((r) => r.turn_id === turnId);
    expect(answer, 'the answer row was written').toBeDefined();
    return { body: res.json() as { blocks?: Array<Record<string, unknown>> }, facts: (answer!.handler_facts ?? []) as unknown[] };
  };
  const phase3Of = (blocks: Array<Record<string, unknown>> = []) =>
    blocks.filter((b) => ['review_card', 'coaching', 'evidence', 'exercise'].includes(String(b.type)));

  it('⭐ RED: a Run turn\'s answer row carries ONE run_delivery for this Run, with the reply\'s Phase 3 blocks byte for byte', async () => {
    const { body, facts } = await run();
    const delivered = phase3Of(body.blocks);
    expect(delivered.length, `vacuity: the reply delivered Phase 3 blocks: ${JSON.stringify(body.blocks?.map((b) => b.type))}`).toBeGreaterThan(0);
    expect(facts).toHaveLength(1);
    const parsed = HandlerFactSchema.parse(facts[0]);
    expect(parsed.fact_type).toBe('run_delivery');
    if (parsed.fact_type !== 'run_delivery') return;
    expect(parsed.result.run_id).toBe(RUN_ID);
    expect(parsed.result.record.graph_hash).toBe(HASH);
    expect(JSON.stringify(parsed.result.record.phase3_blocks)).toBe(JSON.stringify(delivered));
  });

  it('the current Run is NOT this turn\'s (an earlier Run, another computed_at) → nothing recorded (CONTROL: the RED row above)', async () => {
    readComputedAt = '2026-10-05T07:00:00.000Z';
    const { facts } = await run();
    expect(facts).toStrictEqual([]);
  });

  it('the read names no Run → nothing recorded', async () => {
    readRunId = undefined;
    const { facts } = await run();
    expect(facts).toStrictEqual([]);
  });

  it('a turn that ran nothing writes its row exactly as before (no facts)', async () => {
    const turnId = randomUUID();
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: turnId, scenario_id: SCENARIO, message: 'What matters most here?' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(rows.find((r) => r.turn_id === turnId)?.handler_facts).toStrictEqual([]);
  });
});
