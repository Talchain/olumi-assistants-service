/**
 * Shared Data row 1 follow-up (served witness on CEE f297748, #72 5883308747, step L3): the SAME number set explicitly
 * on Olumi's estimate makes it the user's — the owner moves, the analysis revision moves (schemas 0.62.0 hashes
 * `observed_state.source`) and the last Run goes STALE. The receipt said `noop: true` and the reply said "Monthly churn
 * rate is already set to 3%." with no staleness line: a receipt for a write that DID happen, narrated as one that did not.
 *
 * The write is unchanged. The receipt and the reply now agree with the persisted bytes: `noop: false`, status
 * `applied`, "… is now recorded as your figure: 3%." and, after a Run, the standard staleness sentence.
 * Contrast in the same file: a confirm-as-is (review) and the user's own figure re-sent stay true no-ops.
 * Mutant (run by hand): drop the owner term from `noop` → the first two rows go RED.
 */
import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../factor-value-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const SCENARIO_ID = '61818bed-9b5d-4154-9c28-eed5cc40bf1d';
const TARGET = 'monthly_churn_rate';

function servedGraph(source = 'cee_inference'): Record<string, unknown> {
  return {
    goal_node_id: 'mrr',
    nodes: [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: TARGET, kind: 'factor', label: 'Monthly churn rate', observed_state: { unit: '%', value: 0.03, source, raw_value: 3 } },
      { id: 'o-hold', kind: 'option', label: 'Hold price' },
    ],
    edges: [{ from: TARGET, to: 'mrr', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' }],
  };
}

/** A successful prior Run, so the reply owes the user the staleness sentence when the revision moves. */
const PRIOR_RUN = { fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: SCENARIO_ID, leading_option_id: 'o-hold', summary: 's', graph_hash_at_run: 'a'.repeat(64) } };

function edit(event: Record<string, unknown>, persistedGraph: unknown) {
  const payload = { kind: 'system_event', scenario_id: SCENARIO_ID, turn_id: '88888888-8888-4888-8888-888888888888', stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: TARGET, field: 'value', ...event } } as unknown as SystemEventTurnPayload;
  return applyFactorValueEdit({ payload, event: payload.event as never, requestId: 'req-owner', persistedGraph, priorFacts: [PRIOR_RUN] } as never);
}

const factOf = (r: { handlerFacts: readonly unknown[] }) => r.handlerFacts.find((f) => (f as { fact_type?: string }).fact_type === 'set_factor_value') as
  { noop: boolean; result: { status: string } } | undefined;

describe('an owner-only write (the same number, made the user\'s) is receipted and said as the write it is', () => {
  it('RED: the receipt is `applied`, not a no-op — the analysis revision moved', async () => {
    const base = servedGraph();
    const r = await edit({ intent: 'set', value: 3 }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(computeAnalysisAffectingGraphHash(r.mutatedGraph as never)).not.toBe(computeAnalysisAffectingGraphHash(base as never));
    const fact = factOf(r);
    expect(fact, JSON.stringify(r.handlerFacts)).toBeDefined();
    expect(fact!.noop).toBe(false);
    expect(fact!.result.status).toBe('applied');
  });

  it('RED: the reply says whose figure it now is and that the last Run is stale — never "already set"', async () => {
    const r = await edit({ intent: 'set', value: 3 }, servedGraph());
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    const text = String(r.response.assistant_text);
    expect(text).toMatch(/Monthly churn rate is now recorded as your figure: 3%\./);
    expect(text).toMatch(/This makes the last analysis stale\./);
    expect(text).not.toMatch(/already set/);
  });

  it('CONTROL: a confirm-as-is (review) stays a true no-op — owner kept, hash identical', async () => {
    const base = servedGraph();
    const r = await edit({ value: 3 }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(computeAnalysisAffectingGraphHash(r.mutatedGraph as never)).toBe(computeAnalysisAffectingGraphHash(base as never));
    expect(String(r.response.assistant_text)).not.toMatch(/now recorded as your figure|stale/);
  });

  it('CONTROL: the user\'s own figure re-sent with `set` is still a no-op ("already set", nothing stale)', async () => {
    const base = servedGraph('user_override');
    const r = await edit({ intent: 'set', value: 3 }, base);
    expect(r.kind).toBe('mutated');
    if (r.kind !== 'mutated') return;
    expect(computeAnalysisAffectingGraphHash(r.mutatedGraph as never)).toBe(computeAnalysisAffectingGraphHash(base as never));
    expect(String(r.response.assistant_text)).toMatch(/already set to 3%/);
    expect(String(r.response.assistant_text)).not.toMatch(/stale/);
  });
});
