import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { assessRouteAdmission } from '../../../../cee/graph-readiness/canonical-readiness.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { applyExplicitEdit } from '../edit.js';
import { mapLivingModel } from '../mapper.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { F1_COARSE, F1_DEFINED } from './track2-f1-identity.fixtures.js';

const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const factor = (id: string, value: number, unit: string) => ({ ...KNOWN_ANSWER.factors[0]!, id, label: id, value, unit, ...who(`${id} is ${value} ${unit}`) });
const bakery = (): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER),
  aims: [{ ...KNOWN_ANSWER.aims[0]!, target: { ...KNOWN_ANSWER.aims[0]!.target!, value: 5000, current: 1200, unit: '£ per week' } }],
  factors: [factor('loaves', 950, 'loaves per week'), factor('price', 3, '£ per loaf'),
    { ...factor('revenue', 2850, '£ per week'), kind: 'outcome', estimate_by: 'olumi',
      defined_as: { op: 'product', of: ['loaves', 'price'], ...who('revenue is loaves times price') } }],
  options: [{ ...KNOWN_ANSWER.options[0]!, settings: [] }, { ...KNOWN_ANSWER.options[1]!, settings: [
    { ...KNOWN_ANSWER.options[1]!.settings[0]!, factor_id: 'loaves', value: 1100, unit: 'loaves per week' }] }],
  links: [{ ...KNOWN_ANSWER.links[0]!, from: 'revenue', effect: { ...KNOWN_ANSWER.links[0]!.effect, value: 1, unit: '£ per week' } }],
});
const save = (m: LivingModelT) => LivingModel.parse(JSON.parse(JSON.stringify(m)));
const edit = (m: LivingModelT, target_id: string, raw_value: number) => {
  const out = applyExplicitEdit(save(m), { kind: 'factor_value_edit', target_id, raw_value, value: 0.8 });
  if (!('model' in out)) throw new Error(out.refused);
  return save(out.model);
};
const node = (m: LivingModelT, id: string) => mapLivingModel(m).graph.nodes.find((n) => n.id === id)!;
const identity = { operation: 'product', factor_ids: ['loaves', 'price'], stated_in_brief: true };

describe('a canvas level edit keeps admitted definitions and supersedes stale totals', () => {
  it('RED→GREEN: saved bakery → price edit → mapper → persistence/readiness keeps the outcome and both edges', () => {
    const before = save(bakery());
    expect(node(before, 'revenue').nonlinear_identity).toEqual(identity);
    const after = edit(before, 'price', 3.2);
    const mapped = mapLivingModel(after);
    expect(node(after, 'revenue').nonlinear_identity).toEqual(identity);
    expect(node(after, 'revenue').kind).toBe('outcome');
    expect(node(after, 'revenue').observed_state).toMatchObject({ raw_value: 3040 });
    for (const from of ['loaves', 'price']) expect(mapped.graph.edges.filter((e) => e.from === from && e.to === 'revenue')).toHaveLength(1);
    const persisted = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: after }));
    expect(assessRouteAdmission(persisted).readiness_issues.filter((i) => ['ORPHAN_NODE', 'NO_PATH_TO_GOAL'].includes(i.code))).toEqual([]);
    expect(mapped.withheld).toEqual([]);
    expect(after.factors[2]!.defined_as).toEqual(before.factors[2]!.defined_as);
    expect(after.history).toContainEqual({ id: 'revenue', change: 'superseded', old: JSON.stringify(before.factors[2]), quote: null });
    expect(node(after, 'revenue').observed_state).not.toHaveProperty('source');
    expect(node(after, 'price').observed_state).toMatchObject({ raw_value: 3.2, source: 'user_edited' });
    expect(before.factors[2]!.value).toBe(2850);
  });

  it('no edit and same-value confirmation leave the complete model and graph unchanged', () => {
    const before = save(bakery());
    expect(save(before)).toEqual(before);
    expect(edit(before, 'price', 3)).toEqual(before);
    expect(mapLivingModel(edit(before, 'price', 3))).toEqual(mapLivingModel(before));
  });

  it('editing the defined total itself keeps today’s inconsistent-total behaviour', () => {
    const after = edit(bakery(), 'revenue', 2900);
    expect(after.factors[2]).toMatchObject({ value: 2900, source: 'user', estimate_by: null });
    expect(mapLivingModel(after).withheld).toContainEqual({ id: 'revenue', reason: 'identity_inconsistent' });
    expect(node(after, 'revenue').nonlinear_identity).toBeUndefined();
  });

  it('NEGATIVE: an unrelated figure equal to the old price neither inherits the edit nor its authorship', () => {
    const before = bakery();
    before.factors.push({ ...factor('fee', 3, '£'), source: 'unverified', quote: null });
    const after = edit(before, 'price', 3.2);
    expect(after.factors[3]).toEqual(before.factors[3]);
    expect(after.history.map((h) => h.id)).toEqual(['revenue']);
  });

  it('NEGATIVE: a pre-existing contradictory total is not repaired or re-authored by a part edit', () => {
    const before = bakery();
    before.factors[2]!.value = 2800;
    const after = edit(before, 'price', 3.2);
    expect(after.factors[2]).toEqual(before.factors[2]);
    expect(after.history).toEqual([]);
    expect(mapLivingModel(after).withheld).toContainEqual({ id: 'revenue', reason: 'identity_inconsistent' });
  });

  it('a defined goal keeps its identity, with its new level worked out rather than credited to the person', () => {
    const before = save(F1_COARSE);
    const after = edit(before, 'price', 42);
    expect(after.aims[0]!.target).toMatchObject({ current: null, current_source: null, value: 6500 });
    expect(node(after, 'rev').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['total', 'price'], stated_in_brief: true });
    expect(node(after, 'rev').observed_state).toMatchObject({ raw_value: 6300 });
    expect(node(after, 'rev').observed_state).not.toHaveProperty('source');
    expect(after.aims[0]!.source).toBe(before.aims[0]!.source);
    expect(after.history).toContainEqual({ id: 'rev', change: 'superseded', old: JSON.stringify(before.aims[0]), quote: null });
  });

  it('a nested goal the existing derivation cannot size stays held by name, with its definition and edges intact', () => {
    const after = edit(F1_DEFINED, 'uk', 120);
    const mapped = mapLivingModel(after);
    expect(node(after, 'rev').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['total', 'price'], stated_in_brief: true });
    expect(mapped.withheld).toContainEqual({ id: 'rev', reason: 'goal_level_unknown' });
    for (const from of ['total', 'price']) expect(mapped.graph.edges.filter((e) => e.from === from && e.to === 'rev')).toHaveLength(1);
  });

  it('second brief: a customer sum feeding a revenue product follows edited parts in dependency order', () => {
    const before = save(F1_DEFINED);
    before.factors.push({ ...factor('revenue', 6000, '£'), label: 'Monthly revenue', defined_as: before.aims[0]!.defined_as });
    before.aims[0]!.defined_as = null;
    before.links = [{ ...KNOWN_ANSWER.links[0]!, from: 'revenue', to: 'rev',
      effect: { ...KNOWN_ANSWER.links[0]!.effect, value: 1, unit: '£' } }];
    expect(mapLivingModel(before).withheld).toEqual([]);
    const after = edit(before, 'uk', 120);
    expect(after.factors.find((f) => f.id === 'total')).toMatchObject({ value: 170, source: 'unverified', quote: null });
    expect(node(after, 'revenue').observed_state).toMatchObject({ raw_value: 6800 });
    expect(node(after, 'revenue').nonlinear_identity).toEqual({ operation: 'product', factor_ids: ['total', 'price'], stated_in_brief: true });
    expect(mapLivingModel(after).withheld).toEqual([]);
    expect(after.aims[0]!.source).toBe(before.aims[0]!.source);
  });
});
