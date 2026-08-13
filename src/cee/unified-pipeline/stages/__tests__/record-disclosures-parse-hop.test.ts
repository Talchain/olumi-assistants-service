/**
 * REV930D — the MIDDLE HOP the author declared unexercised, EXERCISED.
 * Scaffold copied from parse-attachment-cost-guard.test.ts, which already
 * executes runStageParse for real.
 */
import { describe, expect, it, vi } from 'vitest';
import type { StageContext } from '../../types.js';

const draftResult = {
  graph: { version: '3.0.0', nodes: [{ id: 'n1', kind: 'goal', label: 'Grow ARR' }], edges: [] },
  rationales: [],
  record_disclosures: [
    { claim_index: -1, claim_kind: 'stated_item', label: 'Keep churn under 5%', reason: 'constraint_direction_unstated' },
  ],
  topology_plan: ['a'],
  meta: { model: 'claude-sonnet-4-6', prompt_version: 'v1' },
  usage: { input_tokens: 1, output_tokens: 1 },
};

vi.mock('../../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: { model: 'claude-sonnet-4-6', name: 'anthropic', draftGraph: vi.fn().mockResolvedValue(draftResult) },
    resolution: { task: 'draft_graph', resolved_model: 'claude-sonnet-4-6', resolution_source: 'default' },
  }),
}));

const { runStageParse } = await import('../parse.js');

function makeCtx(): StageContext {
  return {
    requestId: 'rev930d-parse',
    input: { brief: 'We must keep churn under 5% while growing ARR by 15% next year.' },
    effectiveBrief: 'We must keep churn under 5% while growing ARR by 15% next year.',
    rawBody: {},
    opts: { requestStartMs: Date.now(), signal: undefined },
    earlyReturn: undefined,
    collector: undefined,
    transforms: [],
    pipelineOutcome: { warnings: [] },
    pipelineCheckpoints: [],
    riskCoefficientCorrections: [],
  } as unknown as StageContext;
}

describe('REV930D — parse hop carries record_disclosures onto StageContext', () => {
  it('REV930D-13 ctx.recordDisclosures is populated from the adapter result', async () => {
    const ctx = makeCtx();
    await runStageParse(ctx);
    console.log('REV930D-13 earlyReturn =', JSON.stringify(ctx.earlyReturn)?.slice(0, 200));
    console.log('REV930D-13 ctx.recordDisclosures =', JSON.stringify((ctx as any).recordDisclosures));
    console.log('REV930D-13 ctx.topologyPlan (CONTRAST, known-carried) =', JSON.stringify((ctx as any).topologyPlan));
    expect((ctx as any).recordDisclosures).toEqual(draftResult.record_disclosures);
  });
});
