/**
 * (B4, the whole class) — every structural readiness issue ABOUT one element
 * names that element by id, on the canonical issue AND the wire blocker.
 *
 * B4 (#1936) named the option on OPTION_NOT_LINKED_TO_DECISION only. The served
 * witness on `3829c96` (#70 5841752078) showed the next one un-named at once:
 * a canvas-added option read `OPTION_NO_FACTOR_EDGES` with no `option_id`, so
 * no surface could say WHICH option needs its factors. The validator printed
 * the id into prose every time; the class is every per-node violation:
 * OPTION_NO_FACTOR_EDGES, ORPHAN_NODE and the per-node NO_PATH_TO_GOAL, for an
 * option (`option_id`) or a factor (`factor_id`).
 */
import { describe, it, expect } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../src/orchestrator/tools/analysis-ready-helper.js';
import { issuesAsWireBlockers } from '../../../../src/orchestrator-v5/compose/analysis-state-v1.js';

const edge = (from: string, to: string) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });

const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Revenue growth' },
    { id: 'decision', kind: 'decision', label: 'Headcount' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand', category: 'controllable', observed_state: { value: 0.5, cap: 1 } },
    { id: 'fac_orphan', kind: 'factor', label: 'Office rent', observed_state: { value: 0.3, cap: 1 } },
    { id: 'fac_deadend', kind: 'factor', label: 'Team morale', observed_state: { value: 0.3, cap: 1 } },
    { id: 'opt_hire', kind: 'option', label: 'Hire a marketing manager', interventions: { fac_market: 0.4 } },
    { id: 'opt_bare', kind: 'option', label: 'Wait a quarter' },
  ],
  edges: [
    edge('decision', 'opt_hire'),
    edge('decision', 'opt_bare'),
    edge('opt_hire', 'fac_market'),
    edge('fac_market', 'goal_growth'),
    // A factor with an edge but no path to the goal.
    edge('fac_market', 'fac_deadend'),
  ],
  options: [],
};

function issues() {
  const ready = buildCanonicalAnalysisReadyFromGraph(GRAPH);
  expect(ready, 'edges carry the GraphV3 edge shape, or the builder returns undefined').toBeDefined();
  return ready!.readiness_issues ?? [];
}
const scoped = (code: string) =>
  issues()
    .filter((i) => i.code === code)
    .map((i) => ({ option_id: i.option_id, option_label: i.option_label, factor_id: i.factor_id, factor_label: i.factor_label }));

describe('(B4 class) every per-element structural issue names its element', () => {
  it('OPTION_NO_FACTOR_EDGES names the option (the served gap)', () => {
    expect(scoped('OPTION_NO_FACTOR_EDGES')).toEqual([
      { option_id: 'opt_bare', option_label: 'Wait a quarter', factor_id: undefined, factor_label: undefined },
    ]);
  });

  it('ORPHAN_NODE names the factor it is about', () => {
    expect(scoped('ORPHAN_NODE')).toEqual([
      { option_id: undefined, option_label: undefined, factor_id: 'fac_orphan', factor_label: 'Office rent' },
    ]);
  });

  it('the per-node NO_PATH_TO_GOAL names the factor it is about', () => {
    expect(scoped('NO_PATH_TO_GOAL')).toContainEqual(
      { option_id: undefined, option_label: undefined, factor_id: 'fac_deadend', factor_label: 'Team morale' },
    );
  });

  it('the WIRE blockers carry the same identities', () => {
    const wire = issuesAsWireBlockers(issues());
    const ids = wire.map((b) => `${b.code}:${b.option_id ?? ''}:${b.factor_id ?? ''}`);
    expect(ids).toContain('OPTION_NO_FACTOR_EDGES:opt_bare:');
    expect(ids).toContain('ORPHAN_NODE::fac_orphan');
    expect(ids).toContain('NO_PATH_TO_GOAL::fac_deadend');
  });

  it('CONTROL: a model-wide issue names no element (nothing is invented)', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph({ ...GRAPH, nodes: GRAPH.nodes.filter((n) => n.kind !== 'goal') });
    const noGoal = (ready?.readiness_issues ?? []).filter((i) => i.code === 'NO_GOAL');
    for (const i of noGoal) {
      expect(i.option_id).toBeUndefined();
      expect(i.factor_id).toBeUndefined();
    }
  });
});
