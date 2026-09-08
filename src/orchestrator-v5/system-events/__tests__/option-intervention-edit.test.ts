import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { linkedFactorsOf } from '../../routing/option-effect-write.js';
import { mergeInterventionSources } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { prepareOptionInterventionEdit, applyOptionInterventionEdit,
  optionInterventionPostimageIsScoped } from '../option-intervention-edit.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const intervention = (value: number) => ({ value, source: 'cee_hypothesis',
  target_match: { node_id: 'factor', match_type: 'exact_id', confidence: 'high' } });
function graph() {
  return GraphV3.parse({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Service quality' },
      { id: 'option', kind: 'option', label: 'Pilot', interventions: { factor: intervention(0.2) } },
      { id: 'other_option', kind: 'option', label: 'Pilot', interventions: { factor: intervention(0.7) } },
      { id: 'factor', kind: 'factor', label: 'Coverage', observed_state: { value: 0.5, baseline: 0.4,
        source: 'user_override' } },
      { id: 'other_factor', kind: 'factor', label: 'Coverage', observed_state: { value: 0.6 } },
    ],
    edges: [['option', 'factor'], ['other_option', 'factor'], ['factor', 'goal']].map(([from, to]) => ({
      from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
    })),
    goal_constraints: [{ constraint_id: 'limit', node_id: 'factor', operator: '<=', value: 10,
      label: 'Coverage limit', provenance: 'explicit', unit: '%', value_frame: 'level' }],
  });
}
function prepare(g = graph(), overrides: Partial<Parameters<typeof prepareOptionInterventionEdit>[0]> = {}) {
  return prepareOptionInterventionEdit({ persistedGraph: g, optionId: 'option', factorId: 'factor',
    modelValue: 0.3, expectedGraphHash: computeAnalysisAffectingGraphHash(g)!, ...overrides });
}

describe('explicit option-intervention preparation — existing canonical operation chain', () => {
  it('writes only the identified intervention through real parser/applier/encoder; preserves baseline and limit', () => {
    const before = graph();
    const pristine = clone(before);
    const result = prepare(before);
    expect(result.kind).toBe('prepared');
    if (result.kind !== 'prepared') throw new Error('Expected prepared operation');
    const operations = parseEditGraphResponse(JSON.stringify({ operations: [result.operation],
      removed_edges: [], warnings: [], coaching: null })).operations as PatchOperation[];
    expect(operations).toHaveLength(1);
    expect(operations[0]?.path).toBe('option');
    const applied = applyPatchOperations(before, operations);
    const encoded = encodeOptionInterventionsForEdit(applied, new Set(['option']));
    expect(encoded.unresolvedOptionIds).toEqual([]);
    // The applier deliberately returns structural nodes/edges only. Production
    // merges that result onto the persisted base before projecting for commit.
    // Omitting this real seam would falsely report a lost success constraint.
    const merged = mergeAppliedGraphForPersistence({ appliedGraph: encoded.graph,
      persistedBase: before, ingressBase: before, scenarioId: 'scenario', requestId: 'edit' });
    const after = GraphV3.parse(clone(projectGraphForPersistence(merged)));
    expect(after.nodes.find(n => n.id === 'option')?.interventions?.factor).toMatchObject({
      value: 0.3, source: 'user_specified', target_match: { node_id: 'factor' },
    });
    expect(after.nodes.filter(n => n.id !== 'option')).toEqual(pristine.nodes.filter(n => n.id !== 'option'));
    expect(after.goal_constraints).toEqual(pristine.goal_constraints);
    expect(after.edges).toEqual(pristine.edges);
    expect(before).toEqual(pristine);
    expect(computeAnalysisAffectingGraphHash(after)).not.toBe(computeAnalysisAffectingGraphHash(pristine));
  });

  it('is identity-bound rather than label-bound and refuses an unlinked same-label neighbour', () => {
    expect(prepare(graph()).kind).toBe('prepared');
    expect(prepare(graph(), { factorId: 'other_factor' })).toMatchObject({ kind: 'refused' });
  });

  it('refuses stale expected state; the exact same input on its current state prepares', () => {
    const g = graph();
    const oldHash = computeAnalysisAffectingGraphHash(g)!;
    g.nodes.find(n => n.id === 'factor')!.observed_state!.value = 0.6;
    expect(prepare(g, { expectedGraphHash: oldHash })).toMatchObject({ kind: 'refused' });
    expect(prepare(g).kind).toBe('prepared');
  });

  it('does not relabel an unchanged AI estimate as newly supplied user data', () => {
    const g = graph();
    const before = clone(g);
    expect(prepare(g, { modelValue: 0.2 })).toEqual({ kind: 'unchanged' });
    expect(g).toEqual(before);
    expect(g.nodes.find(n => n.id === 'option')?.interventions?.factor.source).toBe('cee_hypothesis');
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses invalid model-scale value %s without preparing a mutation', value => {
    expect(prepare(graph(), { modelValue: value })).toMatchObject({ kind: 'refused' });
  });

  it('refuses duplicate canonical identity, wrong semantic role and missing graph', () => {
    const duplicate = graph();
    duplicate.nodes.push(clone(duplicate.nodes.find(n => n.id === 'option')!));
    expect(prepare(duplicate)).toMatchObject({ kind: 'refused' });
    expect(prepare(graph(), { optionId: 'factor' })).toMatchObject({ kind: 'refused' });
    expect(prepare(graph(), { persistedGraph: null })).toMatchObject({ kind: 'refused' });
  });

  it('never preserves an existing intervention match that names a different factor', () => {
    const g = graph();
    g.nodes.find(n => n.id === 'option')!.interventions!.factor.target_match.node_id = 'other_factor';
    expect(prepare(g)).toMatchObject({ kind: 'refused' });
  });

  it.each([0, 1])('prepares the exact model-scale endpoint %s without clamping', value => {
    const result = prepare(graph(), { modelValue: value });
    expect(result.kind).toBe('prepared');
    if (result.kind !== 'prepared') throw new Error('Expected prepared operation');
    expect(result.operation.value).toEqual({ value });
  });

  it.each(['reverse', 'bidirected', 'parallel'] as const)('preserves the existing %s option-factor identity-link semantics', kind => {
    const g = graph();
    const edge = g.edges[0]!;
    if (kind === 'reverse') [edge.from, edge.to] = [edge.to, edge.from];
    if (kind === 'bidirected') edge.edge_type = 'bidirected';
    if (kind === 'parallel') g.edges.push(clone(edge));
    const linked = linkedFactorsOf(g, 'option').some(factor => factor.id === 'factor');
    expect(linked).toBe(kind !== 'reverse');
    expect(prepare(g).kind).toBe(linked ? 'prepared' : 'refused');
  });

  it('keeps sanctioned persisted zero sigma and its hash unchanged during preparation', () => {
    const g = graph();
    g.edges[0]!.strength.std = 0;
    const before = clone(g);
    expect(GraphV3.safeParse(g).success).toBe(false);
    expect(prepare(g).kind).toBe('prepared');
    expect(g).toEqual(before);
    expect(computeAnalysisAffectingGraphHash(g)).toBe(computeAnalysisAffectingGraphHash(before));
  });

  it('prepares a missing exact cell without borrowing the factor baseline or success limit', () => {
    const g = graph();
    delete g.nodes.find(n => n.id === 'option')!.interventions!.factor;
    const result = prepare(g);
    expect(result.kind).toBe('prepared');
    if (result.kind !== 'prepared') throw new Error('Expected prepared operation');
    expect(result.operation.value).toEqual({ value: 0.3 });
    expect(result.operation.path).toBe('/nodes/option/data/interventions/factor');
  });

  it('rejects malformed existing provenance rather than silently replacing it with user authority', () => {
    const g = graph();
    g.nodes.find(n => n.id === 'option')!.interventions!.factor.source = 'user_override';
    expect(prepare(g)).toMatchObject({ kind: 'refused', reason: 'invalid_existing_intervention' });
  });

  it.each(['nested', 'slash'] as const)('never reports unchanged from a stale top-level cell when %s source wins', carrier => {
    const g = graph();
    const option = g.nodes.find(n => n.id === 'option')!;
    // These are intentionally raw legacy fields, not declared NodeV3 fields.
    if (carrier === 'nested') Object.assign(option, { data: { interventions: { factor: intervention(0.3) } } });
    else Object.assign(option, { 'data/interventions/factor': intervention(0.3) });
    expect(mergeInterventionSources(option)?.factor).toBe(0.3);
    expect(option.interventions!.factor.value).toBe(0.2);
    expect(prepare(g, { modelValue: 0.2 })).toMatchObject({ kind: 'refused' });
    expect(prepare(graph(), { modelValue: 0.2 })).toEqual({ kind: 'unchanged' });
  });
});

function canonicalGraph() {
  return projectGraphForPersistence({ ...graph(), options: [] as unknown[],
    metadata: { preserved: 'canonical context' } });
}
function apply(g = canonicalGraph()) {
  return applyOptionInterventionEdit({ persistedGraph: g, optionId: 'option', factorId: 'factor',
    modelValue: 0.3, expectedGraphHash: computeAnalysisAffectingGraphHash(g)!,
    scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', requestId: 'internal-effect',
    freshness: 'none', hasExistingAnalysis: false });
}
const target = { optionId: 'option', factorId: 'factor', modelValue: 0.3 };

describe('option-intervention candidate — target-only final persisted postimage', () => {
  it('uses the existing referee/apply/projection and fact producer, changing only the cell and its mirror', () => {
    const before = canonicalGraph();
    const original = clone(before);
    const result = apply(before);
    expect(result.kind).toBe('candidate');
    if (result.kind !== 'candidate') throw new Error(JSON.stringify(result));
    expect(before).toEqual(original);
    expect(result.graph.nodes.find(n => n.id === 'option')!.interventions!.factor).toMatchObject({
      value: 0.3, source: 'user_specified' });
    expect(result.graph.nodes.filter(n => n.id !== 'option')).toEqual(before.nodes.filter(n => n.id !== 'option'));
    expect(result.graph.goal_constraints).toEqual(before.goal_constraints);
    expect(result.graph.edges).toEqual(before.edges);
    expect(result.graph.metadata).toEqual(before.metadata);
    expect(result.graph.options).not.toEqual(before.options);
    expect(optionInterventionPostimageIsScoped(before, result.graph, target)).toBe(true);
    expect(result.handlerFact).toMatchObject({ fact_type: 'edit_graph', noop: false,
      result: { status: 'applied', operations_count: 1, edit_kind: 'option_configuration' } });
    expect(result.analysisGraphHash).toBe(computeAnalysisAffectingGraphHash(result.graph));
  });

  it('creates a missing exact cell without requiring or touching another quantity', () => {
    const before = canonicalGraph();
    delete before.nodes.find(n => n.id === 'option')!.interventions;
    before.options = [];
    const canonical = projectGraphForPersistence(before);
    const result = apply(canonical);
    expect(result.kind).toBe('candidate');
    if (result.kind !== 'candidate') throw new Error(JSON.stringify(result));
    expect(optionInterventionPostimageIsScoped(canonical, result.graph, target)).toBe(true);
  });

  it.each([0, -0.2])('leaves raw persisted sigma %s untouched when the existing referee holds its strict candidate', std => {
    const before = canonicalGraph();
    before.edges[0]!.strength.std = std;
    const original = clone(before);
    const result = apply(before);
    // Preparation accepts the sanctioned raw persisted representation, but
    // the inherited live referee's candidate builder uses strict GraphV3.
    // This carrier must not floor canonical bytes or bypass that authority.
    expect(result).toEqual({ kind: 'refused', reason: 'mutation_held' });
    expect(before).toEqual(original);
  });

  it('refuses an unrelated legacy normalization rather than laundering it by projecting both sides', () => {
    const before = canonicalGraph();
    Object.assign(before.nodes.find(n => n.id === 'other_option')!, {
      data: { interventions: { factor: { value: 0.9 } } },
    });
    const original = clone(before);
    expect(apply(before).kind).toBe('refused');
    expect(before).toEqual(original);
  });

  it.each(['baseline', 'constraint', 'sibling', 'target-label', 'edges', 'metadata', 'wrong-value', 'wrong-origin'] as const)(
    'rejects an actually mutated %s postimage with an unchanged positive twin', field => {
      const before = canonicalGraph();
      const result = apply(before);
      if (result.kind !== 'candidate') throw new Error(JSON.stringify(result));
      const mutant = clone(result.graph);
      if (field === 'baseline') mutant.nodes.find(n => n.id === 'factor')!.observed_state!.value = 0.9;
      if (field === 'constraint') mutant.goal_constraints![0]!.value = 20;
      if (field === 'sibling') mutant.nodes.find(n => n.id === 'other_option')!.interventions!.factor.value = 0.9;
      if (field === 'target-label') mutant.nodes.find(n => n.id === 'option')!.label = 'Unexpected rename';
      if (field === 'edges') mutant.edges.reverse();
      if (field === 'metadata') mutant.metadata = { preserved: 'changed' };
      if (field === 'wrong-value') mutant.nodes.find(n => n.id === 'option')!.interventions!.factor.value = 0.8;
      if (field === 'wrong-origin') mutant.nodes.find(n => n.id === 'option')!.interventions!.factor.source = 'cee_hypothesis';
      expect(mutant).not.toEqual(result.graph);
      expect(optionInterventionPostimageIsScoped(before, mutant, target)).toBe(false);
      expect(optionInterventionPostimageIsScoped(before, result.graph, target)).toBe(true);
    });
});
