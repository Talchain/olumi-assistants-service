import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertingOlumiEstimate, scoredGoalIdOf, targetTestabilityOf } from '../target-testability.js';
import { bindGuidedSizing, guidedSizingActions, guidedSizingForRun, guidedSizingFromWarning } from '../../agent-lane/guided-sizing.js';

type Rec = Record<string, any>;
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/target-testability-20260930.json', import.meta.url), 'utf8')) as Rec;
const pair = { from: 'ai_triage_tool_monthly_cost', to: 'monthly_support_spend' };
const estimate = (graph: Rec) => graph.edges.find((e: Rec) => e.from === pair.from && e.to === pair.to);

describe('r9 amendment (A): an estimate must convert on a route to the scored goal', () => {
  it('r10: two goal orders retain the scored hours goal and the same conversion, verdict and guided answers', () => {
    const graph = structuredClone(fixtures.n1);
    graph.goal_node_id = 'median_first_response_time';
    const spend = graph.nodes.find((n: Rec) => n.id === pair.to);
    Object.assign(spend, { kind: 'goal', goal_threshold_unit: '£/month' });
    graph.nodes = [spend, ...graph.nodes.filter((n: Rec) => n !== spend)];
    const answers = (g: Rec) => {
      expect(convertingOlumiEstimate(estimate(g), g, g.goal_node_id)).toBe(false);
      const direct = g.edges.find((e: Rec) => e.from === 'triage_automation_rate' && e.to === g.goal_node_id);
      expect(convertingOlumiEstimate(direct, g, g.goal_node_id)).toBe(true);
      const verdict = targetTestabilityOf(g);
      expect(verdict).toMatchObject({ kind: 'not_testable', goal_id: g.goal_node_id });
      expect(verdict.kind === 'not_testable' && verdict.failures.find(f => f.case === 'c')?.links).toContainEqual(pair);
      const draft = guidedSizingFromWarning({ code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' }, g);
      expect(draft?.scored_goal_id).toBe(g.goal_node_id);
      const unselected = { ...g };
      delete unselected.goal_node_id;
      expect(targetTestabilityOf(unselected, undefined, g.goal_node_id)).toEqual(verdict);
      const warning = { code: 'GOAL_FIGURES_TARGET_NOT_TESTABLE' };
      expect(guidedSizingForRun({ input_snapshot: { goal_node_id: g.goal_node_id },
        enrichment: { inference_warnings: [warning] } }, unselected)).toEqual(draft);
      expect(guidedSizingForRun({ enrichment: { inference_warnings: [warning,
        { code: 'GOAL_CHANCE_LICENSED', goal_node_id: g.goal_node_id }] } }, unselected)).toEqual(draft);
      const actions = guidedSizingActions(draft, g);
      expect(actions.map(a => a.parameters)).toContainEqual(pair);
      expect(actions.map(a => a.parameters)).not.toContainEqual({ from: direct.from, to: direct.to });
      // A later graph selection cannot substitute another goal for this draft's conversion reader.
      expect(guidedSizingActions(draft, { ...g, goal_node_id: pair.to })).toEqual(actions);
      expect(bindGuidedSizing(draft, actions, { graph_hash: '0123456789abcdef', run_key: 'hours-run' }))
        .not.toHaveProperty('scored_goal_id');
      return { verdict, draft, actions };
    };
    const spendFirst = answers(graph);
    graph.nodes.reverse();
    expect(answers(graph)).toEqual(spendFirst);
  });

  it('requires the scored identity and never guesses among multiple goals', () => {
    const graph = structuredClone(fixtures.n1);
    Object.assign(graph.nodes.find((n: Rec) => n.id === pair.to), { kind: 'goal', goal_threshold_unit: '£/month' });
    expect(scoredGoalIdOf(graph)).toBeUndefined();
    expect(targetTestabilityOf(graph)).toEqual({ kind: 'no_goal' });
    expect(convertingOlumiEstimate(estimate(graph), graph, undefined)).toBe(false);
    expect(convertingOlumiEstimate(estimate(graph), graph, pair.to)).toBe(true);
    expect(convertingOlumiEstimate(estimate(graph), graph, 'median_first_response_time')).toBe(false);
  });

  it('N1: the locally converting support-spend branch cannot reach the hours goal and still fails case (c)', () => {
    const graph = fixtures.n1;
    expect(convertingOlumiEstimate(estimate(graph), graph, scoredGoalIdOf(graph))).toBe(false);
    const verdict = targetTestabilityOf(graph);
    expect(verdict.kind === 'not_testable' && verdict.failures.find(f => f.case === 'c')?.links).toContainEqual(pair);
    const direct = graph.edges.find((e: Rec) => e.from === 'triage_automation_rate' && e.to === 'median_first_response_time');
    expect(convertingOlumiEstimate(direct, graph, scoredGoalIdOf(graph))).toBe(true);
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
    expect(convertingOlumiEstimate(graph.edges[0], graph, scoredGoalIdOf(graph))).toBe(true);
    expect(convertingOlumiEstimate(graph.edges[1], graph, scoredGoalIdOf(graph))).toBe(false);
    delete graph.nodes[2].goal_threshold_cap;
    expect(convertingOlumiEstimate(graph.edges[0], graph, scoredGoalIdOf(graph))).toBe(false);
  });

  it('an off-goal estimate keeps its local units and size when the actual scored goal changes', () => {
    const graph = structuredClone(fixtures.n1);
    graph.nodes.find((n: Rec) => n.kind === 'goal').kind = 'factor';
    const spend = graph.nodes.find((n: Rec) => n.id === pair.to);
    Object.assign(spend, { kind: 'goal', goal_threshold_unit: '£/month' });
    expect(convertingOlumiEstimate(estimate(graph), graph, scoredGoalIdOf(graph))).toBe(true);
    spend.goal_threshold_unit = 'hours';
    expect(convertingOlumiEstimate(estimate(graph), graph, scoredGoalIdOf(graph))).toBe(false);
  });
});
