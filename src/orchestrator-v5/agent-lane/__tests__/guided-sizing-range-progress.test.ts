import { describe, expect, it } from 'vitest';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { goalChanceRangeOf, withGoalChanceRange, type GoalChanceRangeInputs } from '../../goal-target/goal-chance-range.js';
import { guidedSizingProgress, guidedSizingReplyText, guidedSizingSentence } from '../guided-sizing.js';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';

type Json = Record<string, any>;
const OPTION = 'raise';
const GOAL = 'revenue';
const COUNT_ONLY = '2 more to go.';
const RANGE_LINE = '2 more to go; with 1 left, Olumi can show a range.';

/** Authoritative post-commit graph: one recorded size and two remaining placeholders. */
function postSizing(): { graph: Json; run: Json; inputs: GoalChanceRangeInputs } {
  const graph: Json = { nodes: [
    { id: OPTION, kind: 'option', label: 'Raise price', interventions: { price: 0.7 } },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, unit: '£', cap: 100 } },
    { id: 'volume', kind: 'factor', label: 'Volume', observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, unit: 'subscribers', cap: 100 } },
    { id: GOAL, kind: 'goal', label: 'Revenue', goal_direction: '>=', goal_threshold: 0.8,
      goal_threshold_raw: 800, goal_threshold_unit: '£', goal_threshold_frame: 'level',
      observed_state: { value: 0.5, baseline: 0.5, raw_value: 500, unit: '£', cap: 1000 } },
  ], edges: [
    { from: OPTION, to: 'price', strength: { mean: 1, std: 0.01 }, provenance: { source: 'user_specified' } },
    { from: 'price', to: 'volume', strength: { mean: 0.5, std: 0.1 }, provenance: { magnitude: 'olumi_placeholder' }, defaulted: true },
    { from: 'volume', to: GOAL, strength: { mean: 0.5, std: 0.1 }, provenance: { magnitude: 'olumi_placeholder' }, defaulted: true },
  ] };
  const goalPaths = unsizedLeaderGoalPaths(graph, [OPTION]);
  const block = { drivers: [{ kind: 'link_strength', quantity_id: `volume->${GOAL}`, from: 'volume', to: GOAL,
    status: 'resolved', spread: 0.4, p_goal_if_low: 0.234, p_goal_if_high: 0.876, n_low: 4000, n_high: 40 }] };
  const inputs: GoalChanceRangeInputs = { driversByOption: new Map([[OPTION, block]]), goalPaths, plotWithheld: false, goalId: GOAL };
  const enrichment = withGoalChanceRange({ option_comparison: [{ option_id: OPTION, probability_of_goal_drivers: block }],
    inference_warnings: [placeholderGoalWarning(graph, goalPaths, 'GOAL_FIGURES_PLACEHOLDER_PATH')] }, graph, inputs);
  return { graph, run: { input_snapshot: { goal_node_id: GOAL }, enrichment }, inputs };
}

describe('r13 P2(b): range promise uses G0 on the authoritative post-sizing graph', () => {
  it('CONTROL: G0 really licenses the range before the clause is offered', () => {
    const { graph, run, inputs } = postSizing();
    expect(goalChanceRangeOf(run.enrichment, graph, OPTION, inputs)).not.toBeNull();
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe(RANGE_LINE);
    expect(guidedSizingReplyText(guidedSizingProgress(graph, run)?.draft).guided).toContain('Give a rough strength for each to see the chance.');
  });

  it('without retained driver evidence the countdown makes no range promise', () => {
    const { graph, run } = postSizing();
    delete run.enrichment.option_comparison[0].probability_of_goal_drivers;
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe(COUNT_ONLY);
    expect(guidedSizingProgress(graph)?.progress_line).toBe(COUNT_ONLY);
  });

  it('a newly untestable comparator on the post-sizing graph bars the earlier range', () => {
    const { graph, run, inputs } = postSizing();
    const goal = graph.nodes.find((n: Json) => n.id === GOAL);
    goal.goal_direction = '<'; delete goal.goal_threshold;
    expect(targetTestabilityOf(graph)).toMatchObject({ kind: 'not_testable', failures: expect.arrayContaining([
      expect.objectContaining({ code: 'comparator_unscorable' }),
    ]) });
    expect(goalChanceRangeOf(run.enrichment, graph, OPTION, inputs)).toBeNull();
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe(COUNT_ONLY);
    const draft = guidedSizingProgress(graph, run)!.draft;
    expect(guidedSizingReplyText(draft).guided).toBe(guidedSizingSentence(draft, false));
    expect(guidedSizingReplyText(draft).guided).not.toContain('Give a rough strength');
  });

  it('a non-converting estimate remains a blocker after the two placeholders are sized', () => {
    const { graph, run, inputs } = postSizing();
    graph.edges.push({ from: 'price', to: GOAL, strength: { mean: 0.2, std: 0.1 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
    const verdict = targetTestabilityOf(graph);
    expect(verdict.kind === 'not_testable' && verdict.failures.flatMap(f => f.links ?? []))
      .toEqual(expect.arrayContaining([{ from: 'price', to: GOAL }]));
    const sized = structuredClone(graph);
    for (const edge of sized.edges as Json[]) if (edge.provenance?.magnitude === 'olumi_placeholder') {
      const goalEnd = edge.to === GOAL;
      edge.provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: {
        amount: goalEnd ? 5 : 0.5, amount_unit: goalEnd ? '£' : 'subscribers',
        per_source_change: 1, per_source_change_unit: goalEnd ? 'subscribers' : '£', strength_mean: edge.strength.mean,
      } };
      delete edge.defaulted;
    }
    expect(targetTestabilityOf(sized)).toMatchObject({ kind: 'not_testable', failures: [
      expect.objectContaining({ code: 'goal_path_unsized', links: [{ from: 'price', to: GOAL }] }),
    ] });
    // G0 can expose conditional groups now; that does not prove the remaining band permits the promised recovery.
    expect(goalChanceRangeOf(run.enrichment, graph, OPTION, inputs)).not.toBeNull();
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe(COUNT_ONLY);
    const draft = guidedSizingProgress(graph, run)!.draft;
    expect(guidedSizingReplyText(draft).guided).toBe(guidedSizingSentence(draft, false));
    expect(guidedSizingReplyText(draft).guided).not.toContain('Give a rough strength');
  });

  it('dirty driver evidence bars the promise despite a stale licensed-range carrier', () => {
    const { graph, run, inputs } = postSizing();
    run.enrichment.option_comparison[0].probability_of_goal_drivers.invalid_rows_dropped = 1;
    expect(goalChanceRangeOf(run.enrichment, graph, OPTION, inputs)).toBeNull();
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe(COUNT_ONLY);
  });
});
