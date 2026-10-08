import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertingOlumiEstimate, targetTestabilityOf } from '../target-testability.js';

type Rec = Record<string, any>;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as Rec;
const pair = { from: 'ai_triage_tool_monthly_cost', to: 'monthly_support_spend' };
const estimate = (graph: Rec) => graph.edges.find((e: Rec) => e.from === pair.from && e.to === pair.to);

describe('r9 amendment (A): an estimate must convert on a route to the scored goal', () => {
  it('N1: the locally converting support-spend branch cannot reach the hours goal and still fails case (c)', () => {
    const graph = fixtures.n1;
    expect(convertingOlumiEstimate(estimate(graph), graph)).toBe(false);
    const verdict = targetTestabilityOf(graph);
    expect(verdict.kind === 'not_testable' && verdict.failures.find(f => f.case === 'c')?.links).toContainEqual(pair);
    const direct = graph.edges.find((e: Rec) => e.from === 'triage_automation_rate' && e.to === 'median_first_response_time');
    expect(convertingOlumiEstimate(direct, graph)).toBe(true);
  });

  it('a downstream conversion frame is required and a downstream placeholder keeps its own block', () => {
    const graph: Rec = { nodes: [
      { id: 'source', kind: 'factor', observed_state: { unit: 'orders', cap: 20 } },
      { id: 'middle', kind: 'factor', observed_state: { unit: '£/month', cap: 100 } },
      { id: 'goal', kind: 'goal', goal_threshold_unit: '£/month', goal_threshold_cap: 100 },
    ], edges: [
      { from: 'source', to: 'middle', strength: { mean: 1 }, provenance: { magnitude: 'olumi_estimate',
        natural_effect: { amount: 5, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: 'orders', strength_mean: 1 } } },
      { from: 'middle', to: 'goal', strength: { mean: 0.5 }, provenance: { magnitude: 'olumi_placeholder' } },
    ] };
    expect(convertingOlumiEstimate(graph.edges[0], graph)).toBe(true);
    expect(convertingOlumiEstimate(graph.edges[1], graph)).toBe(false);
    delete graph.nodes[2].goal_threshold_cap;
    expect(convertingOlumiEstimate(graph.edges[0], graph)).toBe(false);
  });

  it('an off-goal estimate keeps its local units and size when the actual scored goal changes', () => {
    const graph = structuredClone(fixtures.n1);
    graph.nodes.find((n: Rec) => n.kind === 'goal').kind = 'factor';
    const spend = graph.nodes.find((n: Rec) => n.id === pair.to);
    Object.assign(spend, { kind: 'goal', goal_threshold_unit: '£/month' });
    expect(convertingOlumiEstimate(estimate(graph), graph)).toBe(true);
    spend.goal_threshold_unit = 'hours';
    expect(convertingOlumiEstimate(estimate(graph), graph)).toBe(false);
  });
});
