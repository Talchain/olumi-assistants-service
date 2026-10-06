/**
 * 0.79 SD-1 Slice R — THE WRITER on a GUIDANCE answer row, through the live route (DL #87 option A; `writer-after-prod-0.79`).
 *
 * 28% of Run answers carry guidance (DL, 6 Oct: 101/361). Such an answer is written through the SQL wrapper
 * `append_agent_answer_with_guidance`, which admits ONE run_delivery from migration 20261006070522. A DB still on the
 * older body refuses the whole row; the route then retries once without the delivery, so the answer is never the cost.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { maximalReviewCardBlock } from '@talchain/schemas/fixtures';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import { StateCommitFailedError } from '../../session/store.js';

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
/** What the DB says to an append: nothing (written), or the error it raises (nothing written). */
let refuse: (row: Record<string, unknown>) => Error | undefined = () => undefined;
const OLD_WRAPPER = (row: Record<string, unknown>) => (row.agent_guidance !== undefined && (row.handler_facts as unknown[]).length > 0
  // The store's own wording for the 20261004142707 body's refusal.
  ? new StateCommitFailedError('append_agent_answer_with_guidance RPC failed: guidance requires a final non-graph Agent answer', { rpc_code: 'P0001' })
  : undefined);
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => {
    const err = refuse(row);
    if (err !== undefined) throw err;
    rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) };
  }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
// Every answer in this file carries guidance.
vi.mock('../turn-context/guidance-history.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  guidanceOnAnswer: () => ({ version: 1, entries: { 'RC-WIDEN': { status: 'offered', state_key_hash: 'a'.repeat(64) } } }),
}));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('0.79 · a guidance answer row records the run_delivery too, and never loses the answer for it (live route)', () => {
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
  beforeEach(() => { rows.length = 0; readComputedAt = AT; readRunId = RUN_ID; refuse = () => undefined; store.append.mockClear(); });

  const run = async () => {
    const turnId = randomUUID();
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: turnId, scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { blocks?: Array<Record<string, unknown>>; _agent?: { durability?: string } };
    const attempts = store.append.mock.calls.map(([row]) => row as Record<string, unknown>).filter((r) => r.turn_id === turnId);
    return { body, answer: rows.find((r) => r.turn_id === turnId), attempts };
  };
  const factsOf = (row: Record<string, unknown> | undefined) => (row?.handler_facts ?? []) as unknown[];
  const phase3Of = (blocks: Array<Record<string, unknown>> = []) =>
    blocks.filter((b) => ['review_card', 'coaching', 'evidence', 'exercise'].includes(String(b.type)));

  it('⭐ RED: a Run turn whose answer carries GUIDANCE writes ONE row with its guidance AND this Run\'s run_delivery', async () => {
    const { body, answer, attempts } = await run();
    expect(answer?.agent_guidance, 'precondition: the guidance mock reached the answer row').toBeDefined();
    expect(attempts).toHaveLength(1);
    expect(factsOf(answer)).toHaveLength(1);
    const fact = HandlerFactSchema.parse(factsOf(answer)[0]);
    expect(fact.fact_type).toBe('run_delivery');
    if (fact.fact_type !== 'run_delivery') return;
    expect(fact.result.run_id).toBe(RUN_ID);
    const delivered = phase3Of(body.blocks);
    expect(delivered.length, 'vacuity: the reply delivered Phase 3 blocks').toBeGreaterThan(0);
    expect(JSON.stringify(fact.result.record.phase3_blocks)).toBe(JSON.stringify(delivered));
  });

  it('⭐ a DB on the OLDER wrapper refuses the delivery → the answer is retried ONCE without it, and is durable', async () => {
    refuse = OLD_WRAPPER;
    const { body, answer, attempts } = await run();
    expect(attempts.map(factsOf).map((f) => f.length), 'precondition: the first attempt carried the delivery and was refused').toStrictEqual([1, 0]);
    expect(answer?.agent_guidance).toBeDefined();
    expect(factsOf(answer)).toStrictEqual([]);
    expect(body._agent?.durability).toBe('recorded');
  });

  it('CONTROL: the same refusal on an answer that carried NO delivery is not retried (nothing to drop)', async () => {
    refuse = (row) => (row.agent_guidance !== undefined ? OLD_WRAPPER({ ...row, handler_facts: [{}] }) : undefined);
    const turnId = randomUUID();
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: turnId, scenario_id: SCENARIO, message: 'What matters most here?' } });
    expect(res.statusCode, res.body).toBe(200);
    const attempts = store.append.mock.calls.map(([row]) => row as Record<string, unknown>).filter((r) => r.turn_id === turnId);
    expect(attempts.map(factsOf), 'precondition: a guidance answer with no delivery').toStrictEqual([[]]);
    expect(attempts[0]!.agent_guidance).toBeDefined();
    expect((res.json() as { _agent?: { durability?: string } })._agent?.durability).toBe('not_recorded');
  });

  it('CONTROL: any OTHER failure is not retried — the answer is reported not recorded, exactly as before', async () => {
    refuse = (row) => (row.agent_guidance !== undefined ? new StateCommitFailedError('append_agent_answer_with_guidance RPC failed: connection reset') : undefined);
    const { body, answer, attempts } = await run();
    expect(attempts).toHaveLength(1);
    expect(answer).toBeUndefined();
    expect(body._agent?.durability).toBe('not_recorded');
  });
});
