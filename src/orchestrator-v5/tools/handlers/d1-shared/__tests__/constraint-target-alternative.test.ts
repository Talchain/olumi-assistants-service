/**
 * Naming the target that CAN carry a limit, when the chosen one cannot.
 *
 * ⭐ THE FIXTURE IS PAUL'S REAL 16 SEP GRAPH (session `1dd2133d`), node ids
 * verbatim. He said "that's all we have to spend on hiring resources this
 * year"; the £200,000 limit was written against `dac3fdc3` — "Budget Overrun
 * Risk", kind risk, observed_state null — while "Hiring and Onboarding Cost"
 * (`7809def4`) sat in the same graph.
 */
import { describe, expect, it } from 'vitest';

import {
  findConstraintTargetAlternative,
  formatConstraintTargetAlternative,
  type TargetAlternativeNode,
} from '../constraint-target-alternative.js';

/** Paul's graph. The cost factor carries a unit once the scale is recorded. */
const NODES: readonly TargetAlternativeNode[] = [
  { id: 'dac3fdc3', kind: 'risk', label: 'Budget Overrun Risk', observed_state: null },
  { id: '7809def4', kind: 'factor', label: 'Hiring and Onboarding Cost', observed_state: { unit: '£', cap: 250000 } },
  { id: '17456e58', kind: 'factor', label: 'Team Leadership Coverage', observed_state: null },
  { id: '2416c872', kind: 'factor', label: 'Leadership Gap Risk', observed_state: null },
  { id: 'c3636f2d', kind: 'factor', label: 'Increase Productivity', observed_state: { unit: 'scale', cap: 1 } },
];

const find = (over: Partial<Parameters<typeof findConstraintTargetAlternative>[0]> = {}) =>
  findConstraintTargetAlternative({
    chosenIsCheckable: false,
    chosenNodeId: 'dac3fdc3',
    constraintUnit: 'GBP',
    nodes: NODES,
    ...over,
  });

describe('findConstraintTargetAlternative — the captured case', () => {
  it('⭐ names the cost factor for a GBP limit written against a risk', () => {
    expect(find()).toEqual({ nodeId: '7809def4', label: 'Hiring and Onboarding Cost', unit: '£' });
  });

  it('⭐ matches £ against GBP — symbol and code are one unit', () => {
    // The constraint row carries the code; the factor carries the symbol.
    expect(find({ constraintUnit: '£' })?.nodeId).toBe('7809def4');
  });

  it('⛔ matches on RECORDED UNIT, never on the label', () => {
    // "label bound the metric" is a removed escape hatch (CEE #1328) with a
    // standing instruction never to re-add it. Strip the unit and the
    // cost-shaped label must NOT be enough.
    const nodes = NODES.map((n) =>
      n.id === '7809def4' ? { ...n, observed_state: null } : n,
    );
    expect(find({ nodes })).toBeNull();
  });
});

describe('findConstraintTargetAlternative — refusals', () => {
  it('says nothing when the chosen target is fine', () => {
    expect(find({ chosenIsCheckable: true })).toBeNull();
  });

  it('says nothing when the constraint carries no unit to match on', () => {
    expect(find({ constraintUnit: null })).toBeNull();
    expect(find({ constraintUnit: '   ' })).toBeNull();
  });

  it('⛔ REFUSES on two candidates — the question is open, so it must be asked', () => {
    const nodes = [...NODES, { id: 'other', kind: 'factor', label: 'Contractor Spend', observed_state: { unit: 'GBP' } }];
    expect(find({ nodes })).toBeNull();
  });

  it('never proposes the node the user already chose', () => {
    const nodes = NODES.map((n) =>
      n.id === 'dac3fdc3' ? { ...n, kind: 'factor', observed_state: { unit: '£' } } : n,
    );
    // Both now carry £; the chosen one is excluded, leaving exactly one.
    expect(find({ nodes })?.nodeId).toBe('7809def4');
  });

  it('ignores an outcome or goal — the engine derives those', () => {
    const nodes: TargetAlternativeNode[] = [
      { id: 'g1', kind: 'goal', label: 'Goal', observed_state: { unit: '£' } },
      { id: 'o1', kind: 'outcome', label: 'Outcome', observed_state: { unit: '£' } },
    ];
    expect(find({ nodes })).toBeNull();
  });

  it.each(['%', 'percent', 'scale', 'ratio', 'months', 'FTE'])(
    '⛔ REFUSES to name an alternative for a %s limit — notation is not quantity',
    (unit) => {
      // My first cut matched ANY shared unit and, run against the 14 Sep churn
      // fixture, named a different factor for a `%` limit. Churn percent and
      // margin percent are different things that share a symbol. A currency
      // DOES identify the quantity kind; a ratio does not. The existing suite
      // caught this, which is why the rule is pinned here.
      const nodes = [
        { id: 'a', kind: 'factor', label: 'Churn Rate', observed_state: { unit } },
        { id: 'b', kind: 'factor', label: 'Margin', observed_state: { unit } },
      ];
      expect(find({ constraintUnit: unit, nodes })).toBeNull();
    },
  );

  it('ignores a factor whose unit is a different quantity', () => {
    // 'scale' is not money. Without this the productivity factor would match.
    expect(find({ nodes: NODES.filter((n) => n.id !== '7809def4') })).toBeNull();
  });
});

describe('formatConstraintTargetAlternative', () => {
  const text = formatConstraintTargetAlternative({
    chosenLabel: 'Budget Overrun Risk',
    alternative: { nodeId: '7809def4', label: 'Hiring and Onboarding Cost', unit: '£' },
  });

  it('names the cause, not just the symptom', () => {
    expect(text).toContain('Budget Overrun Risk');
    expect(text).toContain('Hiring and Onboarding Cost');
  });

  it('⛔ ASKS rather than moving the limit', () => {
    // Re-targeting a user's limit on a unit match would be the confident
    // wrongness the admissibility check exists to prevent.
    expect(text).toMatch(/say the word/i);
    expect(text).not.toMatch(/\bI have moved\b|\bmoved it\b/i);
  });
});
