/**
 * GO(A) — the cell to ask about when a money limit could not be checked.
 *
 * ⭐ THE FIXTURE IS PAUL'S REAL CAPTURE, not a hand-written shape. Session
 * `82f31082-6c38-47be-9550-cf465d0b7d4b`, CEE `952187a`, 15 Sep 2026: the saved
 * constraint `Hiring Cost <= 200000 GBP` and the three options' actual unitless
 * interventions on that factor (`0`, `0.85`, `0.7`). A fixture written from the
 * author's own head would encode the author's model of the producer rather than
 * the producer (trap 16-inverse).
 */
import { describe, expect, it } from 'vitest';

import { decideOptionCostAsk } from '../decide-option-cost-ask.js';
import type { OptionCostAskNode, OptionCostAskOption } from '../decide-option-cost-ask.js';

/** The captured constraint, verbatim from the bundle's `goal_constraints`. */
const CAPTURED_CONSTRAINT = {
  node_id: '85dd1a1d',
  unit: 'GBP',
  label: 'Budget limit',
};

/** The captured graph's factor nodes. */
const CAPTURED_NODES: readonly OptionCostAskNode[] = [
  { id: '85dd1a1d', kind: 'factor', label: 'Hiring Cost' },
  { id: '943110e8', kind: 'factor', label: 'Developer Headcount Added' },
];

/**
 * The captured OPTION ENTRIES — a different object from a graph node, and the
 * only carrier of `raw_interventions`. Values verbatim from the bundle.
 */
const CAPTURED_OPTIONS: readonly OptionCostAskOption[] = [
  {
    id: 'opt_status_quo',
    label: 'Status Quo: Keep Current Team',
    interventions: { '85dd1a1d': 0, '943110e8': 0 },
  },
  {
    id: 'opt_two_devs',
    label: 'Two Developers',
    interventions: { '85dd1a1d': 0.85, '943110e8': 0.8 },
  },
  {
    id: 'opt_tech_lead',
    label: 'Hire a Tech Lead',
    interventions: { '85dd1a1d': 0.7 },
  },
];

const ask = (over: Partial<Parameters<typeof decideOptionCostAsk>[0]> = {}) =>
  decideOptionCostAsk({
    notDecisionGrade: true,
    ratified: [CAPTURED_CONSTRAINT],
    nodes: CAPTURED_NODES,
    options: CAPTURED_OPTIONS,
    ...over,
  });

describe('decideOptionCostAsk — the captured defect', () => {
  it('asks the first participating option for its cost in the limit’s own unit', () => {
    expect(ask()).toEqual({
      option_id: 'opt_status_quo',
      option_label: 'Status Quo: Keep Current Team',
      factor_id: '85dd1a1d',
      factor_label: 'Hiring Cost',
      unit: 'GBP',
      constraint_label: 'Budget limit',
    });
  });

  it('binds the target by IDENTITY, not by label — a same-labelled factor is not the referent', () => {
    // Discriminating pair (trap 19): the constraint names 85dd1a1d. A second
    // node carrying the SAME LABEL under a different id must not be selected.
    const withTwin = ask({
      nodes: [{ id: 'fac_other', kind: 'factor', label: 'Hiring Cost' }, ...CAPTURED_NODES],
    });
    expect(withTwin?.factor_id).toBe('85dd1a1d');
  });

  it('moves to the NEXT cell once the first records a native value', () => {
    const options = CAPTURED_OPTIONS.map((o) =>
      o.id === 'opt_status_quo' ? { ...o, raw_interventions: { '85dd1a1d': 0 } } : o,
    );
    expect(ask({ options })?.option_id).toBe('opt_two_devs');
  });
});

describe('decideOptionCostAsk — every refusal is a decision not to guess', () => {
  it('asks NOTHING when the producer did not withhold', () => {
    // The precondition control. Without this the suite could not tell "asks
    // correctly" from "asks always".
    expect(ask({ notDecisionGrade: false })).toBeNull();
  });

  it('⚠ asks NOTHING when the target is an OUTCOME — the reverted #1225 inversion', () => {
    // An outcome or goal carries no stored quantity PRECISELY BECAUSE ISL
    // derives it. #1225 shipped a gate that fired hardest exactly there
    // (20/20 outcome and goal nodes) and was reverted as a release blocker.
    // Asking options for a native outcome value would repeat it.
    const nodes: OptionCostAskNode[] = [{ id: '85dd1a1d', kind: 'outcome', label: 'Cost Efficiency' }];
    const options: OptionCostAskOption[] = [
      { id: 'opt_a', label: 'A', interventions: { '85dd1a1d': 0.7 } },
    ];
    expect(ask({ nodes, options })).toBeNull();
  });

  it('asks NOTHING when two money limits are live — which cell is ambiguous', () => {
    expect(
      ask({ ratified: [CAPTURED_CONSTRAINT, { node_id: '943110e8', unit: 'USD', label: 'Other cap' }] }),
    ).toBeNull();
  });

  it('asks NOTHING for a ratio unit — there is no separate native figure', () => {
    for (const unit of ['%', 'fraction', 'Percent', 'RATIO']) {
      expect(ask({ ratified: [{ ...CAPTURED_CONSTRAINT, unit }] })).toBeNull();
    }
  });

  it('asks NOTHING when the row carries no identity or no unit', () => {
    expect(ask({ ratified: [{ ...CAPTURED_CONSTRAINT, node_id: null }] })).toBeNull();
    expect(ask({ ratified: [{ ...CAPTURED_CONSTRAINT, unit: null }] })).toBeNull();
  });

  it('asks NOTHING when every participating option already records a native value', () => {
    const options = CAPTURED_OPTIONS.map((o) => ({ ...o, raw_interventions: { '85dd1a1d': 1 } }));
    expect(ask({ options })).toBeNull();
  });

  it('skips an option that does not participate in the factor at all', () => {
    // A non-participating option has nothing to restate — asking it for a cost
    // on a factor it does not touch would invent a relationship.
    const options: OptionCostAskOption[] = [
      { id: 'opt_untouched', label: 'Untouched', interventions: { '943110e8': 1 } },
      { id: 'opt_real', label: 'Real', interventions: { '85dd1a1d': 0.7 } },
    ];
    expect(ask({ options })?.option_id).toBe('opt_real');
  });
});
