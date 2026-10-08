import { describe, expect, it } from 'vitest';
import { GOAL_HORIZON_NOT_TESTED, untestedHorizonLine, untestedHorizonLineForCells, withUntestedHorizonWarning } from '../decision-input-ask.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';

// One shown chance (the cell kinds untestedHorizonLineForCells counts).
const FIGURE = [{ kind: 'figure' }] as never;

const GOAL_ID = 'mrr';
const CARRIER_ID = 'pro_subscribers_at_month_12';

function b1Graph() {
  return {
    nodes: [
      { id: GOAL_ID, kind: 'goal', label: 'MRR', goal_direction: '>=', goal_threshold_raw: 20000,
        goal_horizon_months: 12, nonlinear_identity: { operation: 'product',
          factor_ids: ['pro_price', CARRIER_ID], stated_in_brief: true } },
      { id: CARRIER_ID, kind: 'outcome', label: 'Pro subscribers at month 12',
        nonlinear_identity: { operation: 'accumulation',
          factor_ids: ['pro_subscribers_today', 'monthly_pro_churn', 'new_pro_subscribers_per_month'],
          horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
      ...['pro_price', 'pro_subscribers_today', 'monthly_pro_churn', 'new_pro_subscribers_per_month']
        .map(id => ({ id, kind: 'factor', label: id, nonlinear_identity: undefined })),
    ],
    edges: [],
  };
}

type Graph = ReturnType<typeof b1Graph>;
const node = (graph: Graph, id: string) => graph.nodes.find(n => n.id === id)!;

describe('the goal horizon is tested by its confirmed accumulation carrier', () => {
  it('R1: B1 confirmed product and month-12 carrier → no A7 or Run warning', () => {
    const graph = b1Graph();
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(untestedHorizonLine(graph, { besideChance: true })).toBeNull();
    // Chat reads the cells: neither the chance-free nor the beside-a-chance form is owed.
    expect(untestedHorizonLineForCells(graph, [])).toBeNull();
    expect(untestedHorizonLineForCells(graph, FIGURE)).toBeNull();
    const envelope = { inference_warnings: [] };
    expect(withUntestedHorizonWarning(envelope, graph)).toBe(envelope);
    expect(envelope.inference_warnings).not.toContainEqual(expect.objectContaining({ code: GOAL_HORIZON_NOT_TESTED }));
  });

  it.each([
    { row: 'R2(a): unconfirmed goal product', change: (graph: Graph) => { node(graph, GOAL_ID).nonlinear_identity!.stated_in_brief = false; } },
    { row: 'R2(b): carrier month 6 against goal month 12', change: (graph: Graph) => { node(graph, CARRIER_ID).nonlinear_identity!.horizon_months = 6; } },
    { row: 'R2(c): unconfirmed carrier', change: (graph: Graph) => { node(graph, CARRIER_ID).nonlinear_identity!.stated_in_brief = false; } },
    { row: 'R2(d): plain product without a carrier', change: (graph: Graph) => { delete node(graph, CARRIER_ID).nonlinear_identity; } },
  ])('$row → withhold, with no retired horizon disclaimer', ({ change }) => {
    const graph = b1Graph();
    change(graph);
    expect(untestedHorizonLine(graph)).toMatch(/within 12 months\.$/);
    expect(goalHorizonVerdict(graph)).toBe('withhold');
    expect(untestedHorizonLineForCells(graph, [])).toBeNull();
    expect(untestedHorizonLineForCells(graph, FIGURE)).toBeNull();
    expect(withUntestedHorizonWarning({}, graph)).toEqual({});
  });

  it('R2(e): withdrawn accumulation on a held-H graph cannot restore the retired warning', () => {
    const graph = b1Graph();
    expect(untestedHorizonLine(graph)).toBeNull();
    expect(withUntestedHorizonWarning({}, graph, [], true)).toEqual({});
  });
});
