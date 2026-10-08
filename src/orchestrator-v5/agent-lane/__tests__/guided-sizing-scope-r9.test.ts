import { describe, expect, it } from 'vitest';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { bindGuidedSizing, guidedSizingActions, guidedSizingForRun, guidedSizingSentence } from '../guided-sizing.js';

type Json = Record<string, any>;
const CODE = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const SINGLE = "Not shown. This link still needs a size. Set it to see a range for your goal.";
function fixture(count: number, includeExcluded = false): { graph: Json; run: Json } {
  const graph: Json = { nodes: [
    { id: 'scored', kind: 'option', label: 'Scored', interventions: { x: { value: 2 } } },
    { id: 'excluded', kind: 'option', label: 'Excluded', interventions: { z: { value: 2 } } },
    { id: 'x', kind: 'factor', label: 'X', observed_state: { value: 1, raw_value: 1, unit: 'hours' } },
    { id: 'z', kind: 'factor', label: 'Z', observed_state: { value: 1, raw_value: 1, unit: '£/month' } },
    { id: 'goal', kind: 'goal', label: 'Goal', goal_threshold: 0.5, goal_threshold_raw: 5,
      goal_threshold_unit: 'hours', goal_threshold_operator: '>=', observed_state: { baseline: 1, value: 1, raw_value: 1, unit: 'hours' } },
  ], edges: [
    { from: 'scored', to: 'x', strength: { mean: 1, std: 0.01 } },
    { from: 'excluded', to: 'z', strength: { mean: 1, std: 0.01 } },
    { from: 'x', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } },
    { from: 'z', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } },
  ] };
  const acceptable_links = [{ from: 'x', to: 'goal' }];
  if (count === 2) {
    graph.nodes.push({ id: 'y', kind: 'factor', label: 'Y', observed_state: { value: 1, unit: 'hours' } });
    graph.nodes[0].interventions.y = { value: 2 };
    graph.edges.push({ from: 'scored', to: 'y', strength: { mean: 1, std: 0.01 } },
      { from: 'y', to: 'goal', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } });
    acceptable_links.push({ from: 'y', to: 'goal' });
  }
  const option_ids = includeExcluded ? ['scored', 'excluded'] : ['scored'];
  return { graph, run: { enrichment: { option_comparison: option_ids.map(option_id => ({ option_id, status: 'computed' })),
    inference_warnings: [{ code: CODE, message: SINGLE, acceptable_links, option_ids }] } } };
}

describe('GUIDED PATH r9 one scoped draft for words and controls', () => {
  it('r9 scope RED: one scored placeholder plus an excluded non-converting link retains the single-link words and no hook', () => {
    const { graph, run } = fixture(1);
    const draft = guidedSizingForRun(run, graph);
    expect(draft).toBeUndefined();
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(SINGLE.replace(/^Not shown\.\s*/u, ''));
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain('1 links');
    const actions = guidedSizingActions(draft, graph);
    expect(actions).toEqual([]);
    expect(bindGuidedSizing(draft, actions, { graph_hash: '0123456789abcdef', run_key: 'selected' })).toBeUndefined();
  });

  it('r9 N=1 contrast: a scored conversion carve-out retains its press and hook but never the multi-link header', () => {
    const { graph, run } = fixture(1, true);
    const draft = guidedSizingForRun(run, graph);
    expect(draft?.total).toBe(1);
    expect(draft?.links).toHaveLength(2);
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(SINGLE.replace(/^Not shown\.\s*/u, ''));
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain('1 links');
    const actions = guidedSizingActions(draft, graph);
    expect(actions).toHaveLength(2);
    expect(bindGuidedSizing(draft, actions, { graph_hash: '0123456789abcdef', run_key: 'selected' })?.links).toHaveLength(2);
  });

  it('r9 N=2 contrast: scored placeholders alone feed the words, presses and hook', () => {
    const { graph, run } = fixture(2);
    const draft = guidedSizingForRun(run, graph);
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(guidedSizingSentence(2));
    expect(draft?.links.map(l => [l.from, l.to])).toEqual([['x', 'goal'], ['y', 'goal']]);
    const actions = guidedSizingActions(draft, graph);
    const hook = bindGuidedSizing(draft, actions, { graph_hash: '0123456789abcdef', run_key: 'selected' });
    expect(actions.map(a => a.parameters)).toEqual([{ from: 'x', to: 'goal' }, { from: 'y', to: 'goal' }]);
    expect(hook?.links.map(l => l.press.parameters)).toEqual(actions.map(a => a.parameters));
  });
});
