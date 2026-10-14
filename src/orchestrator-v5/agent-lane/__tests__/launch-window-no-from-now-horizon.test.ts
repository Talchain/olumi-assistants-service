/**
 * ⭐ SCIENCE (AIE MA3; DL 16:43Z 14 Oct, from session 4's diagnosis of risk-occurrence.ts:115): construction stamped
 * `goal_horizon_months: 3` on marketing's goal from "within the first 3 months". That count reads as three months FROM NOW;
 * the goal's reading is the three months AFTER LAUNCH. Two windows: the risk-occurrence window became a conflict, its card
 * was never offered, and the Run stayed blocked. A launch-window goal holds its period in its reading; nothing else.
 *
 * Corpus: the served marketing goal (`tests/fixtures/marketing-withheld-once/run-08.json`, its construction-time fields)
 * and Paul's L20 sentence verbatim, through the real `holdStatedGoalAttributes` (construction's one stamping site).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holdStatedGoalAttributes } from '../stated-by-user.js';
import { riskOccurrenceWindowMonths } from '../risk-occurrence.js';

type Rec = Record<string, any>;
const F = JSON.parse(readFileSync('tests/fixtures/marketing-withheld-once/run-08.json', 'utf8')) as Rec;
const L20 = 'I have two goals: For our new feature launch to be successful, we need to have a conversion rate of over 15% and secure 20 new customers within the first 3 months.';
const { goal_horizon_months: _held, ...goalAtConstruction } = (F.graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const drafted = { operator: '>', horizon_months: 3, provenance: 'explicit', unit: '%', baseline_value: null };
const nodesWith = (goal: Rec): Rec[] => [goal, ...(F.graph.nodes as Rec[]).filter((n) => n.kind !== 'goal')];
const goalOf = (nodes: Rec[]): Rec => nodes.find((n) => n.kind === 'goal')!;

describe('a goal read over the window from launch never gets a from-now horizon at construction', () => {
  it('RED: L20 on the served launch reading → no goal_horizon_months; the period counts as held (no "within 3 months?" question)', () => {
    const out = holdStatedGoalAttributes(nodesWith(goalAtConstruction), drafted, L20);
    expect(out.horizon.status).toBe('attested');
    expect(goalOf(out.nodes)).not.toHaveProperty('goal_horizon_months');
    expect(out.held.horizon).toBe(true);
  });

  it('RED: with no from-now count beside it, the launch reading is the one risk window (3 months), not a conflict', () => {
    const out = holdStatedGoalAttributes(nodesWith(goalAtConstruction), drafted, L20);
    expect(riskOccurrenceWindowMonths({ nodes: out.nodes, edges: F.graph.edges })).toBe(3);
    // As served (the count stamped beside the launch reading): a conflict, no window.
    expect(riskOccurrenceWindowMonths({ nodes: nodesWith({ ...goalAtConstruction, goal_horizon_months: 3 }), edges: F.graph.edges })).toBeUndefined();
  });

  it('CONTROL: the same goal read from TODAY keeps the stamped three months, exactly as before', () => {
    const today = { ...goalAtConstruction, goal_target_basis: { ...goalAtConstruction.goal_target_basis, reference: 'today' } };
    const out = holdStatedGoalAttributes(nodesWith(today), drafted, L20);
    expect(goalOf(out.nodes).goal_horizon_months).toBe(3);
    expect(out.held.horizon).toBe(true);
  });
});
