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
      // The DECLARED spellings, one each, so the fixture cannot drift back
      // to matching the code instead of the contract.
      { id: PRICE, kind: 'factor', label: 'Plan Price', prior: { distribution: 'uniform', range_min: 0, range_max: 100 } },
      { id: CHURN, kind: 'factor', label: 'Churn Rate', range: { min: 0, max: 0.2 } },
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

/**
 * FOUND BY A LIVE RUN, NOT BY REVIEW.
 *
 * Two identical four-turn conversations at temperature 0 diverged here. One
 * asked the user what range churn runs over; the other converted "churn went
 * from 3% to 4.4%" into 0.47 and offered it as the user's own figure. The
 * prompt forbids inventing a number, and the prompt was obeyed once out of
 * twice — so the rule moved out of the prompt and into this refusal.
 */
describe('a factor with no range cannot take an effect', () => {
  function graphWithoutRange(): EffectGraph {
    return {
      nodes: [
        { id: DECISION, kind: 'decision', label: 'Question' },
        { id: OPT, kind: 'option', label: 'Increase Price for New Customers Only' },
        { id: PRICE, kind: 'factor', label: 'Plan Price' },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
  }

  it('refuses, because "a share of the range" has no referent', () => {
    const r = setOptionEffect({ graph: graphWithoutRange(), optionId: OPT, factorId: PRICE, value: 0.47 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
  });

  it('names the next move and forbids the conversion the model tried to make', () => {
    const r = setOptionEffect({ graph: graphWithoutRange(), optionId: OPT, factorId: PRICE, value: 0.47 });
    if (r.ok) throw new Error('expected a refusal');
    expect(r.refusal.message).toContain('has no range set');
    expect(r.refusal.message).toContain('lowest and highest values');
    expect(r.refusal.message).toContain('Do not convert figures into a share yourself');
  });

  it('CONTRAST: the same call with a range present succeeds — the guard is about the range, not the value', () => {
    const r = setOptionEffect({ graph: graph(), optionId: OPT, factorId: PRICE, value: 0.47 });
    expect(r.ok).toBe(true);
  });

  it('a partial range is not a range — one bound alone cannot normalise anything', () => {
    const half = {
      nodes: [
        { id: OPT, kind: 'option', label: 'O' },
        { id: PRICE, kind: 'factor', label: 'Plan Price', range: { range_min: 0 } },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
    const r = setOptionEffect({ graph: half, optionId: OPT, factorId: PRICE, value: 0.5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
  });
});

/**
 * ⛔ THE FIXTURE USED TO MATCH THE CODE INSTEAD OF THE CONTRACT, and that is
 * how the range guard shipped reading `range.range_min` — a combination
 * declared in NO schema. `PriorSchema` is `{distribution, range_min,
 * range_max}`; the separate `range` field is `{min, max}`. The guard written
 * to stop the model inventing a number therefore refused EVERY REAL FACTOR.
 *
 * Every case here is derived from the schema declarations, not from the
 * implementation, and the last one is the control that would have caught it.
 */
describe('the range is read from the shapes REAL factors carry', () => {
  /**
   * ⛔ THE FIXTURE USED TO ENCODE MY MODEL OF THE PRODUCER, NOT THE PRODUCER,
   * and that is how this read was wrong TWICE — first against a combination
   * no schema declares, then against the schemas, which `GraphStateIngress`
   * being `.passthrough()` meant were never the whole story.
   *
   * Every shape below comes from THREE REAL CAPTURES of the deployed product
   * (13 factor nodes). `range` appeared on ZERO of them; `prior` on one.
   *
   * ⚠ SHAPES ONLY. Every digit here is invented — this repository is public
   * and the captures carry real business figures.
   */
  function factorWith(extra: Record<string, unknown>): EffectGraph {
    return {
      nodes: [
        { id: OPT, kind: 'option', label: 'O' },
        { id: PRICE, kind: 'factor', label: 'Plan Price', ...extra },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
  }
  const call = (g: EffectGraph) => setOptionEffect({ graph: g, optionId: OPT, factorId: PRICE, value: 0.5 });

  it('accepts scale_frame — the producer\'s own normalisation basis, 6 of 13 captured factors', () => {
    // Captured shape: raw_value / scale_frame === observed_state.value, which
    // held in 6 of 6 cases carrying one.
    expect(call(factorWith({
      scale_frame: 40,
      observed_state: { value: 0.25, raw_value: 10, unit: 'units per week', source: 'cee_inference' },
    })).ok).toBe(true);
  });

  it('accepts an already-normalised scale factor — 5 of 13 captured factors', () => {
    expect(call(factorWith({
      observed_state: { value: 0.3, unit: 'scale', source: 'cee_inference' },
      display_value: '0.3 scale',
    })).ok).toBe(true);
  });

  it('accepts a genuinely STATED prior — 1 of 13 captured factors', () => {
    expect(call(factorWith({
      prior: { distribution: 'uniform', range_min: 0, range_max: 0.4 },
      display_value: '0% to 40%',
    })).ok).toBe(true);
  });

  it('accepts the declared range.{min,max}, unseen in captures but in the contract', () => {
    expect(call(factorWith({ range: { min: 0, max: 10 } })).ok).toBe(true);
  });

  it('⛔ REFUSES an ignorance prior — U(0,1) means nobody has said', () => {
    // buildUnquantifiedPrior() writes exactly this. Accepting it would let an
    // effect be set against a range no human stated — the fabrication this
    // guard exists to prevent, arriving through the guard.
    const r = call(factorWith({
      prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true },
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
    expect(r.refusal.message).toContain('placeholder range that nobody has stated');
    expect(r.refusal.message).toContain('do not treat the placeholder as if it were their answer');
  });

  it('CONTROL: the spelling this reader used to REQUIRE is not what makes a factor usable', () => {
    // `range.{range_min,range_max}` is declared nowhere and appeared in zero
    // captures. If this ever passes, the original bug is back.
    const r = call(factorWith({ range: { range_min: 0, range_max: 10 } }));
    expect(r.ok).toBe(false);
  });

  it('still refuses a factor carrying none of them', () => {
    expect(call(factorWith({})).ok).toBe(false);
    expect(call(factorWith({ observed_state: { value: 0.3, unit: 'scale' }, scale_frame: 0 })).ok).toBe(true);
  });

  it('a half prior is not a range', () => {
    expect(call(factorWith({ prior: { distribution: 'uniform', range_min: 0 } })).ok).toBe(false);
  });
});

describe('a declared CAP is a stated basis too — the omission had a measured cost', () => {
  /**
   * ⛔ THE CENSUS THIS TOOL WAS BUILT FROM LISTED WHAT THREE CAPTURES CARRIED,
   * AND `cap` WAS NOT AMONG THEM — so it was never read. Simulated over 555
   * real factors by the Core lane: **242 refused `factor_has_no_range`, and 94
   * of those carry a positive `observed_state.cap`.** Nearly a fifth of every
   * refusal this tool makes was a capability loss rather than a guard.
   *
   * ⛔ AND THIS IS NOT THE cap/frame CONFLATION — that distinction is RULED in
   * three modules (`schemas/graph.ts:420-435`, `projector.ts:1307`,
   * `set-factor-value.ts:538-543`, the last citing trap 21 by name): a cap
   * divides AND CLAMPS and exempts the factor from the analysis baseline gate;
   * a frame divides with neither and is a property of the whole magnitude set.
   *
   * What makes reading both safe HERE is that `bounds` is a PRESENCE check and
   * nothing else — it never divides, clamps or converts. The question is "is
   * there ANY stated basis against which a share is meaningful?", and a cap is
   * one.
   *
   * ⚠ Shapes only. Every digit is invented; this repository is public.
   */
  function capFactor(observed: Record<string, unknown>): EffectGraph {
    return {
      nodes: [
        { id: OPT, kind: 'option', label: 'O' },
        { id: PRICE, kind: 'factor', label: 'Plan Price', observed_state: observed },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
  }
  const call = (g: EffectGraph) => setOptionEffect({ graph: g, optionId: OPT, factorId: PRICE, value: 0.5 });

  it('ACCEPTS a factor whose only stated basis is a positive cap', () => {
    const r = call(capFactor({ value: 0.3, unit: 'GBP', cap: 100000 }));
    expect(r.ok, 'a declared cap is a basis a share can be measured against').toBe(true);
  });

  it('⚠ STILL REFUSES a ZERO cap — the modal value in the estate, and not a basis', () => {
    // `cap === 0` occurs 247 times and cannot denominate anything. It must keep
    // failing the presence test, never yield `{ lo: 0, hi: 0 }`.
    const r = call(capFactor({ value: 0.3, unit: 'GBP', cap: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
  });

  it('⚠ STILL REFUSES a negative or non-finite cap', () => {
    for (const cap of [-5, Number.NaN, Number.POSITIVE_INFINITY, '100000']) {
      const r = call(capFactor({ value: 0.3, unit: 'GBP', cap }));
      expect(r.ok, `cap ${String(cap)} is not a basis`).toBe(false);
    }
  });

  it('CONTRAST: a factor with NO basis at all is still refused — the guard is intact', () => {
    // Without this twin, the acceptance above is consistent with a gate that
    // simply stopped refusing.
    const r = call(capFactor({ value: 0.3, unit: 'GBP' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
  });

  it("the producer's own basis still takes precedence where both are present", () => {
    // Order has no behavioural consequence today — `bounds` is presence-only —
    // but it is asserted so that a future change which makes it arithmetic
    // cannot quietly reverse which basis is named.
    const both = {
      nodes: [
        { id: OPT, kind: 'option', label: 'O' },
        { id: PRICE, kind: 'factor', label: 'Plan Price', scale_frame: 50000,
          observed_state: { value: 0.3, unit: 'GBP', cap: 100000 } },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
    expect(call(both).ok).toBe(true);
  });
});

describe('SUPERSEDED — the schema-derived reading, kept only as a control', () => {
  function factorWith(extra: Record<string, unknown>): EffectGraph {
    return {
      nodes: [
        { id: OPT, kind: 'option', label: 'O' },
        { id: PRICE, kind: 'factor', label: 'Plan Price', ...extra },
      ],
      edges: [{ from: OPT, to: PRICE }],
    } as unknown as EffectGraph;
  }
  const call = (g: EffectGraph) => setOptionEffect({ graph: g, optionId: OPT, factorId: PRICE, value: 0.5 });

  it('accepts PriorSchema — prior.{range_min, range_max}', () => {
    expect(call(factorWith({ prior: { distribution: 'uniform', range_min: 0, range_max: 10 } })).ok).toBe(true);
  });

  it('accepts the range field — range.{min, max}', () => {
    expect(call(factorWith({ range: { min: 0, max: 10 } })).ok).toBe(true);
  });

  it('CONTROL: refuses range.{range_min, range_max} — the spelling no schema declares', () => {
    // This is the exact shape the guard used to REQUIRE. It must not be the
    // thing that makes a factor usable, or the bug is back.
    const r = call(factorWith({ range: { range_min: 0, range_max: 10 } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.reason).toBe('factor_has_no_range');
  });

  it('still refuses a factor with no bounds at all under either spelling', () => {
    const r = call(factorWith({}));
    expect(r.ok).toBe(false);
  });

  it('a half range under either spelling is not a range', () => {
    expect(call(factorWith({ prior: { distribution: 'uniform', range_min: 0 } })).ok).toBe(false);
    expect(call(factorWith({ range: { min: 0 } })).ok).toBe(false);
  });
});
