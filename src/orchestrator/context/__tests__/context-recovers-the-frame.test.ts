/**
 * ⭐⭐ THE CONTEXT RECOVERS A MEANING THAT WAS ALREADY DERIVABLE.
 *
 * MEASURED ON A LIVE CAPTURE (Paul's manual test, 18 Sep 2026). Three options
 * carried interventions 0.59 / 0.54 / 0.49 against `Pro Plan Price`
 * `{value: 0.49, raw_value: 49, unit: "£"}`. `buildInterventionSummary`'s
 * bare-number branch told the model each lever's **real-world meaning was not
 * established** — while the response beside it rendered "£59".
 *
 * ⛔ AND THE BAND WAS AN ARTEFACT OF THE 0.5 BOUNDARY. `qualitativeBand` splits
 * at 0.25/0.5/0.75, so 0.49 -> Moderate, 0.54 -> High, 0.59 -> High: the two
 * RAISE options shared a band and the BASELINE differed, on a £5 axis. That is
 * the shape the model was asked to reason over.
 *
 * ⚠ WHY THE OLD CLAUSE WAS NOT SIMPLY WRONG. It is correct for the case its own
 * ruling considered — a bare scalar whose target factor carries nothing to
 * interpret it against, where "a bare 1/0 establishes NEITHER a binary NOR an
 * ordinal reading". That grounding fixture carries no `observed_state` at all.
 * The captured case is the one the ruling never saw: the factor carries a
 * framed pair. So this narrows the clause to the cell it was written for
 * rather than removing it.
 *
 * ⚠ SCOPE, STATED SO IT CANNOT BE ROUNDED UP: this asserts what the FUNCTION
 * emits. It is NOT a witness that the string reached the model — the capture
 * contains no assembled prompt, and `budget.ts` may drop `intervention_summary`
 * under context pressure. That remains unmeasured and is not claimed here.
 */

import { describe, expect, it } from 'vitest';

import { compactGraph } from '../graph-compact.js';

function graphWithPricedOptions(
  observedState: Record<string, unknown> | undefined,
  opts: { readonly raiseEntry?: number; readonly storedFrame?: number } = {},
) {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Reach £20k MRR' },
      { id: 'dec_1', kind: 'decision', label: 'Pricing decision' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Pro Plan Price',
        ...(observedState ? { observed_state: observedState } : {}),
        ...(opts.storedFrame !== undefined ? { scale_frame: opts.storedFrame } : {}),
      },
      {
        id: 'opt_raise',
        kind: 'option',
        label: 'Raise to £59',
        interventions: { fac_price: opts.raiseEntry ?? 0.59 },
      },
      { id: 'opt_hold', kind: 'option', label: 'Hold at £49', interventions: { fac_price: 0.49 } },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_raise', strength: { mean: 1, std: 0.01 }, exists_probability: 1 },
      { from: 'fac_price', to: 'goal_1', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9 },
    ],
  } as never;
}

const summaryFor = (g: unknown, optionId: string): string | undefined => {
  const compact = compactGraph(g as never) as unknown as {
    nodes: Array<{ id: string; intervention_summary?: string }>;
  };
  return compact.nodes.find((n) => n.id === optionId)?.intervention_summary;
};

describe('the context recovers the frame when the factor carries one', () => {
  it('RECOVERS: a framed pair turns 0.59 into the native magnitude', () => {
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.49, raw_value: 49, unit: '£' }),
      'opt_raise',
    );
    expect(s, 'no intervention summary was emitted at all — this probe is blind').toBeDefined();
    // 0.59 x frame 100. Bound by IDENTITY to the recovered magnitude, never by
    // a substring another number could satisfy (CLAUDE.md trap 19).
    expect(s).toContain('59 £');
    // …and the model value is KEPT beside it. Replacing one with the other
    // would hide which number the graph actually holds.
    expect(s).toContain('model value 0.59');
    // The clause that was wrong for this cell must be gone.
    expect(s).not.toContain('real-world meaning not established');
  });

  it('⚠ NO FLOAT DIRT: 0.59 x 100 must not print as 58.99999999999999', () => {
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.49, raw_value: 49, unit: '£' }),
      'opt_raise',
    );
    expect(s).not.toMatch(/\d\.\d{6,}/);
  });

  it('FAILS CLOSED: no observed_state leaves the honest clause exactly as it was', () => {
    // The discriminating half of the pair. Without this, the change could have
    // replaced the clause unconditionally and the test above would still pass —
    // which is the ruling this narrows, not removes.
    const s = summaryFor(graphWithPricedOptions(undefined), 'opt_raise');
    expect(s).toContain('real-world meaning not established');
    expect(s).toContain('model value 0.59');
  });

  it('FAILS CLOSED: an uncorroborated pair (no raw_value) recovers nothing', () => {
    // `recoverScaleFrame` requires raw > value > 0. A value with no raw_value
    // cannot prove a frame, and inventing one here is the exact fabrication the
    // no-cap doctrine (projector.ts) exists to prevent.
    const s = summaryFor(graphWithPricedOptions({ value: 0.59, unit: '£' }), 'opt_raise');
    expect(s).toContain('real-world meaning not established');
  });
});

/**
 * ⛔⛔ THE THREE CASES AN INDEPENDENT SEAT MEASURED, EACH OF WHICH THIS CHANGE
 * GOT WRONG BEFORE THEY FOUND IT.
 *
 * The original recovery multiplied ANY finite `entry` by the frame and read the
 * pair directly. Measured on both arms by the reviewer:
 *
 *   framed pair {0.49,49,£} + intervention 59   ->  "Pro Plan Price=5900 £"
 *   framed pair              + intervention 1.2 ->  "Pro Plan Price=120 £"
 *   stored frame 500000 CONTRADICTING {0.5,50000} -> "Pro Plan Price=59000 £"
 *
 * A £59 lever described to the model as £5,900, **with the honest hedge
 * deleted** — worse than declaring it unknown, because a model can hedge a raw
 * number it was handed and cannot hedge a magnitude we asserted.
 */
describe('the frame is applied only where it means something', () => {
  it('⛔ an OUT-OF-UNIT intervention keeps the honest clause — no magnitude asserted', () => {
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.49, raw_value: 49, unit: '£' }, { raiseEntry: 59 }),
      'opt_raise',
    );
    expect(s).toContain('real-world meaning not established');
    expect(s, 'a £59 lever was described as £5,900').not.toContain('5900');
  });

  it('⛔ ASTRIDE 1 — the pinned shape — is refused too', () => {
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.49, raw_value: 49, unit: '£' }, { raiseEntry: 1.2 }),
      'opt_raise',
    );
    expect(s).toContain('real-world meaning not established');
    expect(s).not.toContain('120');
  });

  it('⛔ a STORED FRAME the pair CONTRADICTS is refused, because the owner refuses it', () => {
    // `resolveScaleFrame` returns undefined for a stored frame its pair
    // contradicts (pinned in `stored-scale-frame-edit.test.ts`). Reading the
    // pair directly computed 0.59 x 100000 and stated it — the context speaking
    // confidently about the one node class the owner declines to speak about.
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.5, raw_value: 50_000 }, { storedFrame: 500_000 }),
      'opt_raise',
    );
    expect(s).toContain('real-world meaning not established');
    expect(s).not.toContain('59000');
  });

  it('⭐ CONTRAST: a stored frame with NO pair now WORKS — the case this change exists for', () => {
    // The missed best case. `projector.ts` writes `scale_frame` on every framed
    // factor but the PAIR only when a baseline exists, so a factor with option
    // interventions and no stated baseline carries a frame and no pair. The
    // pair-only read did nothing for it; the owner handles it.
    const s = summaryFor(
      graphWithPricedOptions(undefined, { storedFrame: 100 }),
      'opt_raise',
    );
    expect(s, 'a stored frame with no pair is still unrecovered').toContain('model value 0.59');
    expect(s).not.toContain('real-world meaning not established');
  });

  it('⭐ CONTRAST: the in-unit case STILL recovers — the guard is not refusing everything', () => {
    // Without this, a change that refused every entry would pass all four arms
    // above while destroying the feature.
    const s = summaryFor(
      graphWithPricedOptions({ value: 0.49, raw_value: 49, unit: '£' }),
      'opt_raise',
    );
    expect(s).toContain('59 £');
  });
});
