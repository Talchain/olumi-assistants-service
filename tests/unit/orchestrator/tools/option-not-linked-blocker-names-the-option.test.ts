/**
 * (B4) — #70 (B): "blockers with affected entity ids". A structural
 * OPTION_NOT_LINKED_TO_DECISION blocker must name WHICH option, so the Agent,
 * the chat and the Panel can say "link <option> to the decision" instead of a
 * model-wide "Set up your model". The validator knew the option (it printed it
 * into prose) but `structuralIssue(code, ordinal)` dropped it.
 */
import { describe, it, expect } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../../src/orchestrator/tools/analysis-ready-helper.js';
import { issuesAsWireBlockers } from '../../../../src/orchestrator-v5/compose/analysis-state-v1.js';

const GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Revenue growth' },
    { id: 'decision', kind: 'decision', label: 'Headcount' },
    { id: 'fac_market', kind: 'factor', label: 'Market demand', category: 'controllable', observed_state: { value: 0.5, cap: 1 } },
    { id: 'opt_hire', kind: 'option', label: 'Hire a marketing manager', interventions: { fac_market: 0.4 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold headcount', interventions: { fac_market: 0.1 } },
  ],
  edges: [{ from: 'decision', to: 'opt_hold', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  options: [],
};

const PRECONDITION_NOTE = 'edges carry the GraphV3 edge shape, or the builder returns undefined';

describe('(B4) OPTION_NOT_LINKED_TO_DECISION names the option it is about', () => {
  it('PRECONDITION — the fixture parses, so the builder returns a verdict', () => {
    expect(buildCanonicalAnalysisReadyFromGraph(GRAPH), PRECONDITION_NOTE).toBeDefined();
  });

  it('the readiness issue carries option_id + option_label for EXACTLY the unlinked option', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(GRAPH)!;
    const unlinked = (ready.readiness_issues ?? []).filter((i) => i.code === 'OPTION_NOT_LINKED_TO_DECISION');
    expect(unlinked.map((i) => [i.option_id, i.option_label])).toEqual([['opt_hire', 'Hire a marketing manager']]);
  });

  it('the WIRE blocker carries the same option identity', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(GRAPH)!;
    const wire = issuesAsWireBlockers(ready.readiness_issues).filter((b) => b.code === 'OPTION_NOT_LINKED_TO_DECISION');
    expect(wire.map((b) => b.option_id)).toEqual(['opt_hire']);
  });

  it('CONTROL: a linked option yields no such blocker', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph({ ...GRAPH, edges: [...GRAPH.edges, { from: 'decision', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] })!;
    expect((ready.readiness_issues ?? []).filter((i) => i.code === 'OPTION_NOT_LINKED_TO_DECISION')).toEqual([]);
  });
});
