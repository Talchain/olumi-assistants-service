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

/**
 * Paul's graph, with the cost factor in the shape the wire ACTUALLY carries
 * once the companion transform fix lands: `observed_state` holds the
 * `{value, raw_value, cap, unit}` quartet, `value = raw_value / cap`.
 *
 * ⚠ IT CARRIES A `value`, AND THAT IS LOAD-BEARING, NOT DECORATION. An earlier
 * fixture recorded `{unit, cap}` alone — a shape the schema now refuses — and
 * a candidate test written against it could only ever have checked the unit.
 */
const NODES: readonly TargetAlternativeNode[] = [
  { id: 'dac3fdc3', kind: 'risk', label: 'Budget Overrun Risk', observed_state: null },
  { id: '7809def4', kind: 'factor', label: 'Hiring and Onboarding Cost', observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '£' } },
  { id: '17456e58', kind: 'factor', label: 'Team Leadership Coverage', observed_state: null },
  { id: '2416c872', kind: 'factor', label: 'Leadership Gap Risk', observed_state: null },
  { id: 'c3636f2d', kind: 'factor', label: 'Increase Productivity', observed_state: { value: 0.8, raw_value: 0.8, cap: 1, unit: 'scale' } },
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

  it('⛔ REFUSES a candidate that matches the unit but records NO FIGURE', () => {
    // Codex CX-150: a unit match establishes notional compatibility only — not
    // amount, scale, period or quantity identity. A factor recording
    // {unit:'GBP'} and nothing else passes the unit test and is still the same
    // dead end with a different label, so it goes through the SAME
    // admissibility classifier the chosen target did.
    const nodes = NODES.map((n) =>
      n.id === '7809def4' ? { ...n, observed_state: { unit: 'GBP' } } : n,
    );
    expect(find({ nodes })).toBeNull();
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
    const nodes = [...NODES, { id: 'other', kind: 'factor', label: 'Contractor Spend', observed_state: { value: 0.3, cap: 50000, unit: 'GBP' } }];
    expect(find({ nodes })).toBeNull();
  });

  it('never proposes the node the user already chose', () => {
    const nodes = NODES.map((n) =>
      n.id === 'dac3fdc3' ? { ...n, kind: 'factor', observed_state: { value: 0.5, cap: 400000, unit: '£' } } : n,
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
    expect(text).toMatch(/say so and I will/i);
    expect(text).not.toMatch(/\bI have moved\b|\bmoved it\b/i);
  });

  it('⛔ PROMISES ONLY WHAT HOLDS ON BOTH PATHS — not "as well", not a move', () => {
    // ⚠ THIS ASSERTION HAS BEEN WRONG IN BOTH DIRECTIONS, WHICH IS THE LESSON.
    // It first pinned "I will move the limit to it" when the writer could only
    // APPEND — a test pinning a false promise. It then pinned "as well", which
    // went false the moment the correction offer went live and a confirmation
    // began MOVING the limit.
    //
    // So it now binds to the INVARIANT rather than to either wording: the
    // confirmation may move (offer armed) or append (offer absent — no graph
    // hash, or the emitter refusing the copy), and the sentence must be true on
    // BOTH paths. The only such claim is that the limit ends up on that node.
    // Which one happened is the RECEIPT's job, after the fact.
    expect(text).toMatch(/put the limit on it/i);
    expect(text).not.toMatch(/\bas well\b/i);           // would deny a move
    expect(text).not.toMatch(/\bmove\b|instead of|\bno longer\b|replace/i); // would promise removal
  });

  it('⛔ offers a CANDIDATE and does not assert checkability', () => {
    // CX-150: an earlier draft said the alternative "does" have a figure the
    // analysis can test. A shared currency does not establish that.
    expect(text).toMatch(/may be the one you meant/i);
    expect(text).not.toMatch(/\bdoes,? in\b/i);
  });
});

/**
 * ⭐⭐ IS THE CANDIDATE ACTUALLY SCORABLE? (Codex CX-255)
 *
 * A unit match and a recorded figure make a node look like a good target and
 * do not make it a scorable one. PLoT refuses to score a constraint whose
 * sample frame it cannot anchor, silently — `constraints_status:
 * 'unavailable'`, no exception. Offering such a node is an actionable-looking
 * dead end, which is the exact failure this module exists to stop.
 *
 * ⚠ I FIRST REPORTED THAT PLoT REJECTS EVERY NON-ROOT TARGET. That was FALSE:
 * I relayed a lane's sentence rather than reading the function. Non-root is the
 * THIRD test and two routes return before it, so a blanket refusal would have
 * suppressed legitimate offers. These arms pin the real order, derived at
 * `plot-lite-service` staging `d68d4ffb`.
 *
 * ⛔ SUFFICIENT, NEVER COMPLETE. The unit gate, the range gate and the
 * temporal drop can each still suppress afterwards, so nothing here asserts
 * "the analysis will check it" — only that a node it REFUSES would certainly
 * not have been scored.
 */
describe('the candidate must be SCORABLE, not merely measured', () => {
  const MEASURED = { value: 0.6, raw_value: 150000, cap: 250000, unit: '£' };
  const nodes = (over: Partial<TargetAlternativeNode> = {}) => [
    { id: 'dac3fdc3', kind: 'risk', label: 'Budget Overrun Risk', observed_state: null },
    { id: '7809def4', kind: 'factor', label: 'Hiring and Onboarding Cost', observed_state: MEASURED, ...over },
  ];
  const findWith = (over: Record<string, unknown>) =>
    findConstraintTargetAlternative({
      chosenIsCheckable: false, chosenNodeId: 'dac3fdc3', constraintUnit: 'GBP',
      nodes: nodes(), ...over,
    } as never);

  it('⭐ MEASURED ROOT: no incoming edges — offered', () => {
    expect(findWith({ edges: [] })?.nodeId).toBe('7809def4');
  });

  it('⛔ UNANCHORED NON-ROOT: a directed incoming edge — NOT offered', () => {
    expect(findWith({ edges: [{ from: 'f-other', to: '7809def4', edge_type: 'directed' }] })).toBeNull();
  });

  it('⭐ a BIDIRECTED edge does not un-root it — those are stripped from the forward model', () => {
    expect(findWith({ edges: [{ from: 'f-other', to: '7809def4', edge_type: 'bidirected' }] })?.nodeId)
      .toBe('7809def4');
  });

  it('⭐⭐ an OPTION link does not un-root it — PLoT strips option nodes before the engine', () => {
    // Counting UI intervention links as causal parents would make almost every
    // factor read as unanchored and silence the offer entirely.
    const withOption = [...nodes(), { id: 'opt1', kind: 'option', label: 'Hire' }];
    expect(findWith({
      nodes: withOption,
      edges: [{ from: 'opt1', to: '7809def4', edge_type: 'directed' }],
    })?.nodeId).toBe('7809def4');
  });

  it('⭐ ATTESTED DELTA anchors a non-root — route 1 returns before the root test', () => {
    expect(findWith({
      nodes: nodes({ goal_threshold_frame: 'delta' }),
      edges: [{ from: 'f-other', to: '7809def4', edge_type: 'directed' }],
    })?.nodeId).toBe('7809def4');
  });

  it('⭐ PINNED BY EVERY OPTION anchors a non-root — route 2 returns before the root test', () => {
    expect(findWith({
      edges: [{ from: 'f-other', to: '7809def4', edge_type: 'directed' }],
      options: [
        { interventions: { '7809def4': { value: 0.4 } } },
        { interventions: { '7809def4': { value: 0.7 } } },
      ],
    })?.nodeId).toBe('7809def4');
  });

  it('⛔ pinned by SOME options is not pinned by every option', () => {
    expect(findWith({
      edges: [{ from: 'f-other', to: '7809def4', edge_type: 'directed' }],
      options: [
        { interventions: { '7809def4': { value: 0.4 } } },
        { interventions: { 'somewhere-else': { value: 0.7 } } },
      ],
    })).toBeNull();
  });

  it('⛔ an EMPTY option list pins nothing — [].every() is true and would anchor everything', () => {
    expect(findWith({
      edges: [{ from: 'f-other', to: '7809def4', edge_type: 'directed' }],
      options: [],
    })).toBeNull();
  });
});
