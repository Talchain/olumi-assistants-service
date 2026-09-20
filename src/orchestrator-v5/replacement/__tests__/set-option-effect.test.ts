/**
 * `set_option_effect` — the operation whose absence ended the 11:52:49Z turn.
 *
 * The fixture reproduces the SHAPE of that session's graph (a pricing model
 * with an option linked to a price factor). Digits are invented; only the
 * structure is taken from the capture, because both repositories are public.
 */

import { describe, expect, it } from 'vitest';

import { setOptionEffect, type EffectGraph } from '../set-option-effect.js';

const OPT = 'opt_new_customers_only';
const PRICE = 'fac_plan_price';
const CHURN = 'fac_churn_rate';
const DECISION = 'dec_question';

function graph(): EffectGraph {
  return {
    nodes: [
      { id: DECISION, kind: 'decision', label: 'Question' },
      { id: OPT, kind: 'option', label: 'Increase Price for New Customers Only' },
      { id: PRICE, kind: 'factor', label: 'Plan Price' },
      { id: CHURN, kind: 'factor', label: 'Churn Rate' },
    ],
    edges: [
      { from: DECISION, to: OPT },
      { from: OPT, to: PRICE },
    ],
  } as unknown as EffectGraph;
}

describe('the write the last session could not make', () => {
  it('accepts an option effect on a factor the option is linked to', () => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, value: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.operations).toHaveLength(1);
    expect(r.operations[0]?.path).toBe(`/nodes/${OPT}/data/interventions/${PRICE}`);
    expect(r.operations[0]?.value).toEqual({ value: 1 });
    expect(r.summary).toContain('Increase Price for New Customers Only');
    expect(r.summary).toContain('Plan Price');
  });

  it('returns operations WITHOUT applying them — consent comes between the tool and the graph', () => {
    const g = graph();
    const before = JSON.stringify(g);
    setOptionEffect({ graph: g, optionId: OPT, factorId: PRICE, value: 0.6 });
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('refusals name what to do next', () => {
  it('refuses a factor the option does not affect, and says what it DOES affect', () => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: CHURN, value: 0.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_not_linked_to_option');
    expect(r.refusal.message).toContain('would not reach the comparison');
    expect(r.refusal.message).toContain('Plan Price');
    if (r.refusal.reason !== 'factor_not_linked_to_option') return;
    expect(r.refusal.linkable.map((f) => f.id)).toEqual([PRICE]);
  });

  it('an option that affects nothing is told it needs a link first, not given a node list', () => {
    const g = graph();
    const isolated = { ...g, edges: [{ from: DECISION, to: OPT }] } as unknown as EffectGraph;
    const r = setOptionEffect({ graph: isolated, optionId: OPT, factorId: PRICE, value: 0.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.message).toContain('needs a link to a factor first');
    // The failure being replaced offered every node in the graph, including the
    // decision node called "Question". Nothing here does that.
    expect(r.refusal.message).not.toContain('Question');
  });

  it('refuses a target that is not an option, and says the operation is a different one', () => {
    const r = setOptionEffect({ graph: graph(), optionId: PRICE, factorId: CHURN, value: 0.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('target_is_not_an_option');
    expect(r.refusal.message).toContain('different operation');
  });

  it('refuses an unknown option and an unknown factor distinctly', () => {
    const a = setOptionEffect({ graph: graph(), optionId: 'nope', factorId: PRICE, value: 0.5 });
    const b = setOptionEffect({ graph: graph(), optionId: OPT, factorId: 'nope', value: 0.5 });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.refusal.reason).toBe('unknown_option');
    if (!b.ok) expect(b.refusal.reason).toBe('unknown_factor');
  });
});

describe('the value is bounded, and the tool never invents one', () => {
  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (v) => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, value: v });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('value_out_of_range');
  });

  it.each([0, 0.5, 1])('accepts the boundary and mid value %s', (v) => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, value: v });
    expect(r.ok).toBe(true);
  });
});
