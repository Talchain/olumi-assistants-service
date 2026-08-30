import { describe, expect, it } from 'vitest';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { DraftRecordSetWire, projectDraftRecords } from '../../draft/records/seam.js';
import { replayRecordSet } from '../../draft/records/replay.js';
import { transformGraphToV3 } from '../../transforms/schema-v3.js';
import { adoptFactorEstimates, markUnresolved, type BasisReference } from '../adopt.js';
import { parseFactorEstimates } from '../estimate-response.js';
import { factorSnapshot, requiredFactorInputs, selectQuantificationGaps } from '../select.js';
import type { FactorEstimate } from '../types.js';
import { diagnostic, factorQuantificationCorpus, figureRich, insufficientInformation, liveRecordsFigureRichControl, suppliedValueControl } from './fixtures/corpus.js';

const target = 'fac_availability';
const options = (graph: GraphV3T): Record<string, unknown>[] => graph.nodes
  .filter(n => n.kind === 'option').map(n => ({ id: n.id, interventions: n.interventions ?? {} }));
const selection = (graph = figureRich.graph) => selectQuantificationGaps(graph, requiredFactorInputs(graph, options(graph)));
const basis: BasisReference[] = figureRich.sources.map(source => ({
  id: source.id, text: source.quote, kind: 'brief_context',
  factor_ids: source.id.startsWith('availability_') ? [target] : source.id === 'parking' ? ['fac_parking'] : ['fac_churn'],
}));
// Deliberately injected syntax/transport control, NOT semantic support for the
// snapshot-plus-daily-variation pairing; the live unknown oracle rejects it.
const estimate = (overrides: Partial<FactorEstimate> = {}): FactorEstimate => ({
  factor_id: target, estimate_type: 'estimated', value: 0.75, std: 0.05,
  reasoning: '15 available agents divided by 20 scheduled agents gives .75 today; the brief reports daily available-share standard deviation .05 from the attendance log on the same scale. This remains an Olumi inference from supplied context, not independently verified evidence.',
  basis: ['availability_counts', 'availability_uncertainty'], ...overrides,
} as FactorEstimate);
const decoded = (value: unknown, ids = [target]) => {
  const parsed = parseFactorEstimates({ estimates: [value] }, ids);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.estimates;
};

describe('factor quantification corpus and actual records entry', () => {
  it.each(factorQuantificationCorpus)('$id is a canonical graph and actual records wire shape with exact source spans', item => {
    expect(GraphV3.safeParse(item.graph).success).toBe(true);
    expect(DraftRecordSetWire.safeParse(item.records).success).toBe(true);
    expect(projectDraftRecords(item.records, item.brief).ok).toBe(true);
    for (const source of item.sources) expect(item.brief.slice(source.start, source.end)).toBe(source.quote);
    for (const variant of item.variants ?? []) expect(GraphV3.safeParse(variant.graph).success).toBe(true);
  });

  it('the viable records control retains the stated baseline before gap-fill, with a separate missing factor', async () => {
    const fixture = liveRecordsFigureRichControl;
    const replay = await replayRecordSet(fixture.records, { brief: fixture.brief });
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.reason);
    const canonical = GraphV3.parse(transformGraphToV3(replay.graph as Parameters<typeof transformGraphToV3>[0]).graph);
    const protectedNode = canonical.nodes.find(n => n.label === fixture.protected_label);
    const missingNode = canonical.nodes.find(n => n.label === fixture.missing_label);
    expect(protectedNode?.observed_state).toMatchObject({ value: 0.12, source: 'brief_extraction' });
    expect(missingNode).toBeDefined();
    expect(missingNode?.observed_state).toBeUndefined();
    expect(canonical.nodes.filter(n => n.kind === 'option')).toHaveLength(2);
  });
});

describe('the requested science operation admits gaps; degree only orders admitted gaps', () => {
  const cutPathGraph = (): GraphV3T => ({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: 'root', kind: 'factor', label: 'Missing root baseline', category: 'external' },
      { id: 'direct', kind: 'factor', label: 'Intervened descendant', category: 'controllable' },
      { id: 'other', kind: 'factor', label: 'Other lever', category: 'controllable' },
      { id: 'a', kind: 'option', label: 'Option A', interventions: { direct: 0, other: 0.2 } },
      { id: 'b', kind: 'option', label: 'Option B', interventions: { direct: { value: 1 }, other: 0.8 } },
    ],
    edges: [['root', 'direct'], ['direct', 'goal'], ['other', 'goal'], ['a', 'direct'], ['b', 'direct']].map(([from, to]) => ({ from: from!, to: to!, strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' })),
  });

  it('selects no upstream root when every retained option cuts its only path with a downstream intervention', () => {
    const graph = cutPathGraph();
    const requirements = requiredFactorInputs(graph, options(graph), 'goal');
    expect(requirements).toEqual([]);
    expect(selectQuantificationGaps(graph, requirements).eligible).toEqual([]);
  });

  it('attributes an upstream baseline only to the retained option whose path is not cut', () => {
    const graph = cutPathGraph();
    graph.nodes.find(node => node.id === 'b')!.interventions = { other: 0.8 };
    const requirements = requiredFactorInputs(graph, options(graph), 'goal');
    expect(requirements).toEqual([{ factor_id: 'root', operation: 'isl.factor_baseline_sampling', option_ids: ['b'], target_id: 'goal', impact: 'unassessed' }]);
    expect(selectQuantificationGaps(graph, requirements).eligible.map(gap => gap.factor_id)).toEqual(['root']);
  });

  it('still selects the root when an alternate uncut path reaches the goal', () => {
    const graph = cutPathGraph();
    graph.edges.push({ from: 'root', to: 'goal', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
    expect(requiredFactorInputs(graph, options(graph), 'goal').find(req => req.factor_id === 'root')?.option_ids).toEqual(['a', 'b']);
  });

  it.each(['0.6', NaN, Infinity, { value: '0.6' }])('does not treat a nonnumeric or nonfinite intervention %j as a causal cut', value => {
    const graph = cutPathGraph();
    const suppliedOptions = options(graph).map(option => option.id === 'b' ? { ...option, interventions: { direct: value, other: 0.8 } } : option);
    expect(requiredFactorInputs(graph, suppliedOptions, 'goal').find(req => req.factor_id === 'root')?.option_ids).toEqual(['b']);
  });

  it('excludes a high-degree factor disconnected from the selected goal', () => {
    const requirements = requiredFactorInputs(figureRich.graph, options(figureRich.graph));
    expect(requirements.map(r => r.factor_id)).toContain(target);
    expect(requirements.map(r => r.factor_id)).not.toContain('fac_parking');
    const picked = selection();
    expect(picked.gaps.map(g => g.factor_id)).toEqual([target]);
    expect(picked.gaps[0]?.requirement).toMatchObject({ impact: 'unassessed', operation: 'isl.factor_baseline_sampling' });
  });

  it('needs no baseline when every retained option overrides it, including numeric zero', () => {
    const allOverride = options(figureRich.graph).map((item, index) => ({ ...item, interventions: { ...item.interventions as Record<string, unknown>, [target]: index === 0 ? 0 : { value: 0.9 } } }));
    expect(requiredFactorInputs(figureRich.graph, allOverride).some(r => r.factor_id === target)).toBe(false);
  });

  it('names only the retained option that actually reads the baseline', () => {
    const oneReads = options(figureRich.graph).map((item, index) => index === 0 ? item : { ...item, interventions: { ...item.interventions as Record<string, unknown>, [target]: 0.9 } });
    const requirement = requiredFactorInputs(figureRich.graph, oneReads).find(r => r.factor_id === target);
    expect(requirement?.option_ids).toEqual(['opt_current']);
    expect(selectQuantificationGaps(figureRich.graph, requirement ? [requirement] : []).gaps).toHaveLength(1);
  });

  it('does not create a comparison input for an open diagnostic problem', () => {
    expect(requiredFactorInputs(diagnostic.graph, [])).toEqual([]);
    expect(selectQuantificationGaps(diagnostic.graph, []).gaps).toEqual([]);
    expect(diagnostic.graph.nodes.some(n => n.kind === 'option')).toBe(false);
  });
});

describe('adoption rechecks authority, snapshot and scoped support', () => {
  it('transports an injected parsed estimate without changing user values; semantic support is assessed separately', () => {
    const before = structuredClone(figureRich.graph);
    const output = adoptFactorEstimates(before, selection(before).gaps, decoded(estimate()), basis);
    expect(output.estimated).toEqual([target]);
    expect(output.rejected).toEqual([]);
    expect(output.graph.nodes.find(n => n.id === target)?.observed_state).toMatchObject({ value: 0.75, std: 0.05, source: 'cee_inference', reasoning: { context_basis: ['availability_counts', 'availability_uncertainty'] } });
    expect(output.graph.nodes.filter(n => n.id !== target)).toEqual(before.nodes.filter(n => n.id !== target));
    expect(output.graph.edges).toEqual(before.edges);
    expect(before).toEqual(figureRich.graph);
  });

  it('preserves a range as a range rather than manufacturing its midpoint', () => {
    // Representation mechanics with explicit controlled distribution support;
    // the figure-rich brief itself does not justify a uniform distribution.
    const rangeBasis: BasisReference = { id: 'uniform_schedule', text: 'For this controlled case, the staffing rota samples tomorrow\'s available share uniformly between .65 and .85.', kind: 'model_context', factor_ids: [target] };
    const range: FactorEstimate = { factor_id: target, estimate_type: 'estimated', distribution: 'uniform', range_min: 0.65, range_max: 0.85, reasoning: 'The controlled rota rule explicitly assigns equal density to shares between .65 and .85.', basis: ['uniform_schedule'] };
    const output = adoptFactorEstimates(figureRich.graph, selection().gaps, decoded(range), [rangeBasis]);
    expect(output.estimated).toEqual([target]);
    expect(output.graph.nodes.find(n => n.id === target)).toMatchObject({ prior: { distribution: 'uniform', range_min: 0.65, range_max: 0.85, source: 'cee_inference' } });
    expect(output.graph.nodes.find(n => n.id === target)?.observed_state).toBeUndefined();
  });

  it.each(['point', 'range', 'unknown', 'operational_unknown'] as const)('preserves the existing percentage frame through %s adoption', form => {
    const graph = structuredClone(figureRich.graph);
    graph.nodes.find(n => n.id === target)!.prior = {
      prior_is_unquantified: true, source: 'cee_repair', unit: '%', cap: 100, declared_scale: 'unit_interval',
    };
    const gaps = selection(graph).gaps;
    expect(gaps[0]).toMatchObject({ unit: '%', scale: { cap: 100, declared_scale: 'unit_interval' } });
    const answer: FactorEstimate = form === 'range'
      ? { factor_id: target, estimate_type: 'estimated', distribution: 'uniform', range_min: 0.65, range_max: 0.85,
        reasoning: 'Controlled equal-density schedule on the declared share scale.', basis: ['availability_counts'] }
      : form === 'unknown'
        ? { factor_id: target, estimate_type: 'unknown', reasoning: 'Known scale alone does not establish a quantity.', basis: [] }
        : estimate();
    const output = form === 'operational_unknown' ? markUnresolved(graph, gaps, new Set())
      : adoptFactorEstimates(graph, gaps, decoded(answer), basis).graph;
    const node = GraphV3.parse(JSON.parse(JSON.stringify(output))).nodes.find(n => n.id === target)!;
    const carrier = form === 'point' ? node.observed_state : node.prior;
    expect(carrier).toMatchObject({ unit: '%', cap: 100, declared_scale: 'unit_interval' });
    if (form === 'point') expect(carrier).toMatchObject({ value: 0.75, raw_value: 75, std: 0.05, source: 'cee_inference' });
    if (form === 'unknown' || form === 'operational_unknown') {
      expect(carrier).toMatchObject({ prior_is_unquantified: true });
      for (const key of ['value', 'std', 'distribution', 'range_min', 'range_max']) expect(carrier).not.toHaveProperty(key);
    }
  });

  it.each([
    { value: 75, std: 5 },
    { distribution: 'uniform', range_min: 65, range_max: 85 },
  ])('refuses raw-scale payload %j on a declared unit interval rather than silently converting it', quantity => {
    const graph = structuredClone(figureRich.graph);
    graph.nodes.find(n => n.id === target)!.prior = {
      prior_is_unquantified: true, source: 'cee_repair', unit: '%', cap: 100, declared_scale: 'unit_interval',
    };
    const answer = { ...estimate(), ...quantity };
    if ('distribution' in quantity) { delete (answer as Record<string, unknown>).value; delete (answer as Record<string, unknown>).std; }
    const output = adoptFactorEstimates(graph, selection(graph).gaps, decoded(answer), basis);
    expect(output.rejected).toEqual([{ factor_id: target, reason: 'outside_declared_scale' }]);
    expect(output.graph).toEqual(graph);
  });

  it.each(['raw_count', 'ratio'] as const)('does not apply cap normalisation to declared %s values', declared_scale => {
    const graph = structuredClone(figureRich.graph);
    graph.nodes.find(n => n.id === target)!.prior = {
      prior_is_unquantified: true, source: 'cee_repair', cap: 100, declared_scale,
    };
    const output = adoptFactorEstimates(graph, selection(graph).gaps, decoded(estimate({ value: 75, std: 5 })), basis);
    expect(output.estimated).toEqual([target]);
    const point = output.graph.nodes.find(n => n.id === target)?.observed_state;
    expect(point).toMatchObject({ value: 75, std: 5, cap: 100, declared_scale });
    expect(point).not.toHaveProperty('raw_value');
  });

  it.each(['raw_count', 'ratio'] as const)('enforces the existing shared lower bound for declared %s', declared_scale => {
    const graph = structuredClone(figureRich.graph);
    graph.nodes.find(n => n.id === target)!.prior = { prior_is_unquantified: true, source: 'cee_repair', declared_scale };
    const output = adoptFactorEstimates(graph, selection(graph).gaps, decoded(estimate({ value: -1 })), basis);
    expect(output.rejected).toEqual([{ factor_id: target, reason: 'outside_declared_scale' }]);
    expect(output.graph).toEqual(graph);
  });

  it.each(suppliedValueControl.variants ?? [])('$id is not made writable by a stale unknown marker', variant => {
    const graph = structuredClone(variant.graph);
    const requirements = requiredFactorInputs(graph, [{ id: 'candidate_a', interventions: {} }]);
    const selected = selectQuantificationGaps(graph, requirements);
    expect(selected.gaps).toEqual([]);
    expect(selected.protected_ids).toEqual(['fac_churn']);
    expect(selected.unresolved_origin).toEqual(variant.id.startsWith('unattributed') ? ['fac_churn'] : []);
    // Adversarial selector output bypasses selection; adoption must still refuse.
    const request = { ...selection().gaps[0]!, factor_id: 'fac_churn', snapshot: factorSnapshot(graph) };
    const output = adoptFactorEstimates(graph, [request], decoded(estimate({ factor_id: 'fac_churn' }), ['fac_churn']), [{ ...basis[0]!, id: 'availability_counts', factor_ids: ['fac_churn'] }]);
    expect(output.rejected).toEqual([{ factor_id: 'fac_churn', reason: 'protected_quantity' }]);
    expect(output.graph).toEqual(graph);
    expect(markUnresolved(graph, [request], new Set())).toEqual(graph);
  });

  it('rejects a result if a user changed the model during the model call', () => {
    const gaps = selection().gaps;
    const edited = structuredClone(figureRich.graph);
    edited.nodes.find(n => n.id === 'fac_churn')!.observed_state!.value = 0.24;
    const output = adoptFactorEstimates(edited, gaps, decoded(estimate()), basis);
    expect(output.estimated).toEqual([]);
    expect(output.rejected).toEqual([{ factor_id: target, reason: 'stale_or_unrequested' }]);
    expect(output.graph).toEqual(edited);
  });

  it('still succeeds with an unrelated pre-selection model change', () => {
    const changed = structuredClone(figureRich.graph);
    changed.nodes.find(n => n.id === 'fac_parking')!.label = 'Parking demand renamed';
    const output = adoptFactorEstimates(changed, selection(changed).gaps, decoded(estimate()), basis);
    expect(output.estimated).toEqual([target]);
    expect(output.graph.nodes.find(n => n.id === 'fac_parking')?.label).toBe('Parking demand renamed');
  });

  it.each(['invented_staffing_report', 'parking'])('rejects a plausible number backed by %s', reference => {
    const output = adoptFactorEstimates(figureRich.graph, selection().gaps, decoded(estimate({ basis: [reference] })), basis);
    expect(output.rejected).toEqual([{ factor_id: target, reason: 'missing_or_irrelevant_basis' }]);
    expect(output.estimated).toEqual([]);
    expect(output.graph).toEqual(figureRich.graph);
  });

  it('preserves unsupported estimation as numeric-free unknown', () => {
    const fixture = insufficientInformation;
    const gaps = selectQuantificationGaps(fixture.graph, requiredFactorInputs(fixture.graph, options(fixture.graph))).gaps;
    expect(gaps.map(g => g.factor_id)).toContain('fac_conversion');
    const refusal: FactorEstimate = { factor_id: 'fac_conversion', estimate_type: 'unknown', reasoning: 'No audience definition, campaign history or observed conversion supports a rate.', basis: [] };
    const output = adoptFactorEstimates(fixture.graph, gaps, decoded(refusal, ['fac_conversion']), []);
    expect(output.unknown).toEqual(['fac_conversion']);
    const node = output.graph.nodes.find(n => n.id === 'fac_conversion');
    expect(node?.prior).toMatchObject({ prior_is_unquantified: true, source: 'cee_inference' });
    expect(node?.prior).not.toHaveProperty('range_min');
    expect(node?.prior).not.toHaveProperty('range_max');
    expect(node?.observed_state).toBeUndefined();
    expect(output.graph.nodes.filter(n => n.id !== 'fac_conversion')).toEqual(fixture.graph.nodes.filter(n => n.id !== 'fac_conversion'));
  });

  it('operationally missing output is unresolved without fabricated model reasoning', () => {
    const updated = markUnresolved(figureRich.graph, selection().gaps, new Set());
    const node = updated.nodes.find(n => n.id === target);
    expect(node?.prior).toEqual({ prior_is_unquantified: true, source: 'cee_repair' });
    expect(node?.observed_state).toBeUndefined();
    expect(updated.nodes.find(n => n.id === 'fac_churn')).toEqual(figureRich.graph.nodes.find(n => n.id === 'fac_churn'));
  });
});

describe('broken estimator output cannot masquerade as successful quantification', () => {
  it.each([
    { factor_id: target, estimate_type: 'estimated', value: 0.75, reasoning: '15 out of 20', basis: ['availability_counts'] },
    { factor_id: target, estimate_type: 'estimated', value: 0.75, std: 0.05, reasoning: '', basis: ['availability_counts'] },
    { factor_id: target, estimate_type: 'estimated', value: 0.75, std: 0.05, reasoning: 'A plausible number', basis: [] },
    { factor_id: target, estimate_type: 'unknown', value: 0.75, reasoning: 'Cannot justify a number', basis: [] },
  ])('rejects incomplete or contradictory output %# while its structurally valid counterpart parses', invalid => {
    expect(parseFactorEstimates({ estimates: [invalid] }, [target]).ok).toBe(false);
    expect(parseFactorEstimates({ estimates: [estimate()] }, [target]).ok).toBe(true);
  });
});
