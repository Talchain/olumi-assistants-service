import { describe, expect, it } from 'vitest';
import { buildCanonicalAnalysisReadyFromGraph } from '../analysis-ready-helper.js';

function graph(optionCount: number) {
  const options = Array.from({ length: optionCount }, (_, i) => ({ id: `option_${i}`, kind: 'option', label: `Option ${i}`,
    interventions: { staff: { value: i + 1, source: 'brief_extraction' } } }));
  return { schema_version: 'cee-v3', goal_node_id: 'goal', nodes: [
    { id: 'goal', kind: 'goal', label: 'Capacity' },
    ...(optionCount > 0 ? [{ id: 'decision', kind: 'decision', label: 'Staffing' },
      { id: 'staff', kind: 'factor', label: 'Staff', category: 'controllable', observed_state: { value: 1, source: 'brief_extraction' } }] : []),
    // A level the Run can place needs its range: a bare 10 with none is refused at the Run (`baseline_scale_unresolved`).
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 10, cap: 20, source: 'brief_extraction' } },
    ...options,
  ], edges: [
    ...(optionCount > 0 ? [{ from: 'staff', to: 'goal' }] : []),
    ...options.flatMap(o => [{ from: 'decision', to: o.id }, { from: o.id, to: 'staff' }]),
    { from: 'budget', to: 'goal' },
  ].map(edge => ({ strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', ...edge })) };
}

describe('readiness after policy-only blockers are removed', () => {
  it.each([0, 1])('%i options cannot report ready or permit Run', count => {
    const ready = buildCanonicalAnalysisReadyFromGraph(graph(count))!;
    expect(ready.readiness_issues?.map(issue => issue.code)).toEqual(count === 0
      ? ['UNREACHABLE_CONTROLLABLE_FACTOR'] : ['FEWER_THAN_TWO_OPTIONS', 'UNREACHABLE_CONTROLLABLE_FACTOR']);
    expect(ready.status).not.toBe('ready');
    expect(ready.may_run).toBe(false);
    expect(ready.analysis_admission?.structurally_analysable).toBe(false);
  });
  it('two eligible options retain the ready, permitted control', () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(graph(2))!;
    expect(ready.readiness_issues?.map(issue => issue.code)).toEqual(['UNREACHABLE_CONTROLLABLE_FACTOR']);
    expect(ready.status).toBe('ready');
    expect(ready.may_run).toBe(true);
    expect(ready.analysis_admission?.structurally_analysable).toBe(true);
  });
});
