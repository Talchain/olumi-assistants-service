import { describe, expect, it } from 'vitest';
import { readinessViewOf, treatedAsZeroLine } from '../readiness-view.js';
import { readStatedEventRisk } from '../../routing/stated-event-risk.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

// A fixture graph (a wire-shaped object, not a parsed GraphV3), typed loosely so a row can corrupt one block.
function graph(event: boolean): { nodes: Array<Record<string, any>>; edges: Array<Record<string, unknown>> } {
  const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
  return {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Staffing' },
      { id: 'goal', kind: 'goal', label: 'Delivery' },
      { id: 'capacity', kind: 'factor', label: 'Capacity', category: 'controllable', observed_state: { value: 0.5 } },
      { id: 'opt_a', kind: 'option', label: 'Contractors', interventions: { capacity: { value: 0.8 } } },
      { id: 'opt_b', kind: 'option', label: 'Training', interventions: { capacity: { value: 0.6 } } },
      { id: 'risk_dev', kind: 'risk', label: 'Key developer might leave',
        ...(event ? { event_risk: readStatedEventRisk('10–30% within 6 months')!.event_risk } : {}) },
    ],
    edges: [edge('decision', 'opt_a'), edge('decision', 'opt_b'), edge('opt_a', 'capacity'), edge('opt_b', 'capacity'),
      edge('capacity', 'goal'), edge('risk_dev', 'goal')],
  };
}
describe('event-risk zero-treatment authority boundary', () => {
  it('ER-1b-event: occurrence is drawn and does not need a level today', () => {
    const view = readinessViewOf(graph(true));
    expect(view.may_run).toBe(true);
    expect.soft(view.treated_as_zero ?? []).not.toContain('Key developer might leave');
    expect.soft(treatedAsZeroLine(view)).toBeNull();
  });
  it('ER-1b-control: ordinary unvalued root keeps the current sentence', () => {
    const view = readinessViewOf(graph(false));
    expect(view.may_run).toBe(true);
    expect(view.treated_as_zero).toEqual(['Key developer might leave']);
    expect(treatedAsZeroLine(view)).toBe('No figure is set for "Key developer might leave" yet, so the analysis treats it as zero. How likely or how large is it today?');
  });
  it('ER-1b-authority: only a valid event block exempts the root from unvalued_roots', () => {
    const unvaluedRoots = (g: unknown) => assessCanonicalAnalysisReadiness(g).analysisReady?.unvalued_roots ?? [];
    const expected = [{ node_id: 'risk_dev', label: 'Key developer might leave', kind: 'risk', treated_as: 'zero' }];
    expect(unvaluedRoots(graph(true))).toEqual([]);
    expect(unvaluedRoots(graph(false))).toEqual(expected);
    const malformed = graph(true);
    malformed.nodes.find((node) => node.id === 'risk_dev')!.event_risk!.occurrence.p_low = 0.9;
    expect(unvaluedRoots(malformed)).toEqual(expected);
  });
});
