// ============================================================================
// 0.79 SD-1 Slice R — the writer's pure core: record what THIS Run's turn delivered, bound to THIS Run, or nothing.
// ============================================================================
import { describe, expect, it } from 'vitest';
import { maximalCoachingBlock, maximalReviewCardBlock } from '@talchain/schemas/fixtures';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';

import { runDeliveryFactFor, type RunDeliveryInput } from '../run-delivery-fact.js';

const HASH = 'a'.repeat(16);
const AT = '2026-10-06T07:00:00.000Z';
const CARD = { ...(maximalReviewCardBlock as Record<string, unknown>), body: 'Most of this result rests on a single factor.' };
const COACH = { ...(maximalCoachingBlock as Record<string, unknown>), action_prompt: 'Argue the case against the single factor this result rests on.' };
const RESULT_BLOCK = { type: 'analysis_result', summary: 'Comparison on the current model.' };
const ranThisTurn = { ok: true, mutated: false, ran: true, run_identity: { scenario_id: 's', graph_hash_at_run: HASH, computed_at: AT } };

const input = (over: Partial<RunDeliveryInput> = {}): RunDeliveryInput => ({
  sentBody: {
    blocks: [RESULT_BLOCK, CARD, COACH],
    analysis_ready: { status: 'ready', options: [{ option_id: 'opt_a', label: 'Raise prices', status: 'ready', interventions: { fac_price: 60 }, extra: 'not recorded' }] },
  },
  toolResults: [ranThisTurn],
  currentRun: { runId: 'run_1', graphHashAtRun: HASH, computedAt: AT },
  licence: 'withheld',
  graph: { nodes: [{ id: 'opt_a', kind: 'option', label: 'Raise prices' }] },
  analysisReady: undefined,
  ...over,
});

describe('0.79 · runDeliveryFactFor', () => {
  it('⭐ RED: records ONE run_delivery for this Run — the sent Phase 3 blocks verbatim, in order, and the sent options', () => {
    const out = runDeliveryFactFor(input());
    expect(out.kind).toBe('recorded');
    if (out.kind !== 'recorded') return;
    const fact = HandlerFactSchema.parse(out.fact);
    expect(fact.fact_type).toBe('run_delivery');
    expect(out.record.run_id).toBe('run_1');
    expect(out.record.graph_hash).toBe(HASH);
    expect(out.record.phase3_blocks).toStrictEqual([CARD, COACH]);
    expect(out.record.analysis_ready_options).toStrictEqual([{ option_id: 'opt_a', label: 'Raise prices', status: 'ready', interventions: { fac_price: 60 } }]);
  });

  it.each([
    ['no Run this turn', { toolResults: [] }, 'no_run_this_turn'],
    ['a Run that did not run (refused)', { toolResults: [{ ...ranThisTurn, ran: false }] }, 'no_run_this_turn'],
    ['a Run result with no identity', { toolResults: [{ ok: true, mutated: false, ran: true }] }, 'no_run_this_turn'],
    ['no current Run on the readback', { currentRun: undefined }, 'run_not_current'],
    ['an EARLIER Run current (same graph, another computed_at)', { currentRun: { runId: 'run_0', graphHashAtRun: HASH, computedAt: '2026-10-05T07:00:00.000Z' } }, 'not_this_turns_run'],
    ['a current Run over another graph', { currentRun: { runId: 'run_0', graphHashAtRun: 'b'.repeat(16), computedAt: AT } }, 'not_this_turns_run'],
    ['a block the contract refuses', { sentBody: { blocks: [{ ...CARD, block_id: 'not-a-uuid' }] } }, 'record_refused'],
    ['a leader claim under a withheld licence', { sentBody: { blocks: [{ ...COACH, action_prompt: 'Raise prices leads on the current model.' }] } }, 'outside_licence'],
  ])('%s → nothing recorded (%s)', (_name, over, reason) => {
    expect(runDeliveryFactFor(input(over as Partial<RunDeliveryInput>))).toStrictEqual({ kind: 'omitted', reason });
  });

  it('CONTROL: the same leader claim under a PERMITTED licence is recorded (the reader would serve it)', () => {
    const out = runDeliveryFactFor(input({ licence: 'permitted', sentBody: { blocks: [{ ...COACH, action_prompt: 'Raise prices leads on the current model.' }] } }));
    expect(out.kind).toBe('recorded');
  });

  it('the LAST run with an identity is this turn\'s Run (an earlier tool call in the same turn is not)', () => {
    const earlier = { ...ranThisTurn, run_identity: { scenario_id: 's', graph_hash_at_run: 'c'.repeat(16), computed_at: '2026-10-06T06:00:00.000Z' } };
    expect(runDeliveryFactFor(input({ toolResults: [earlier, ranThisTurn] })).kind).toBe('recorded');
    expect(runDeliveryFactFor(input({ toolResults: [ranThisTurn, earlier] }))).toStrictEqual({ kind: 'omitted', reason: 'not_this_turns_run' });
  });

  it('a body with no Phase 3 blocks records an EMPTY delivery — "this Run showed none" is a positive record', () => {
    const out = runDeliveryFactFor(input({ sentBody: { blocks: [RESULT_BLOCK] } }));
    expect(out.kind).toBe('recorded');
    if (out.kind === 'recorded') expect(out.record.phase3_blocks).toStrictEqual([]);
  });
});
