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
import { validateGraphStructure } from '../../../../src/orchestrator/graph-structure-validator.js';
import { GraphV3 } from '../../../../src/schemas/cee-v3.js';

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

  // ⭐ DL ruling 21 Oct (structure class): in readiness an unwired or dead-end factor is CONTEXT (kept, said, never a block),
  // so readiness raises no issue for it. The chat-edit gate (the validator with no flag) still refuses both, by name.
  const gate = (code: string) => validateGraphStructure(GraphV3.parse(GRAPH)).violations.filter((v) => v.code === code)
    .map((v) => ({ factor_id: v.factor_id, factor_label: v.factor_label }));

  it('ORPHAN_NODE names the factor it is about (the chat-edit gate); readiness reads it as context, never an issue', () => {
    expect(gate('ORPHAN_NODE')).toEqual([{ factor_id: 'fac_orphan', factor_label: 'Office rent' }]);
    expect(scoped('ORPHAN_NODE')).toEqual([]);
  });

  it('the per-node NO_PATH_TO_GOAL names the factor it is about (the chat-edit gate); readiness reads it as context', () => {
    expect(gate('NO_PATH_TO_GOAL')).toContainEqual({ factor_id: 'fac_deadend', factor_label: 'Team morale' });
    expect(scoped('NO_PATH_TO_GOAL').filter((i) => i.factor_id === 'fac_deadend')).toEqual([]);
  });

  it('the WIRE blockers carry the same identities', () => {
    const wire = issuesAsWireBlockers(issues());
    const ids = wire.map((b) => `${b.code}:${b.option_id ?? ''}:${b.factor_id ?? ''}`);
    expect(ids).toContain('OPTION_NO_FACTOR_EDGES:opt_bare:');
    expect(ids.filter((id) => /^(ORPHAN_NODE|NO_PATH_TO_GOAL)::fac_(orphan|deadend)$/.test(id)), 'context is never a structural wire blocker').toEqual([]);
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
