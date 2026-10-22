import { describe, expect, it } from 'vitest';
import { tool } from '@openai/agents';
import { BuildModelParams } from '../../tools/draft-tool.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { evaluatedIdentityCarriers } from '../../../admission/identity-evaluations.js';
import { applyExplicitEdit } from '../edit.js';
import { applyKernel } from '../kernel.js';
import { diffLivingModels } from '../diff.js';
import { F1_DEFINED } from './track2-f1-identity.fixtures.js';
import { mapLivingModel } from '../mapper.js';

const who = (quote: string) => ({ source: 'user' as const, party: null, quote });
const model = (): LivingModelT => ({
  aims: [{ id: 'profit', text: 'Reach at least £40 weekly profit', status: 'current',
    ...who('Profit is £30 today and we need at least £40 weekly'),
    defined_as: { op: 'sum', of: ['revenue', 'costs'], subtract: ['costs'], ...who('profit is revenue minus costs') },
    target: { quantity: 'weekly profit', comparator: '>=', value: 40, low: null, high: null, unit: '£ per week',
      by_when: null, period_months: null, baseline: null, current: 30, current_source: null,
      current_unit: null, change_kind: null, source: null } }],
  factors: [
    { id: 'revenue', label: 'Revenue', kind: 'factor', value: 100, unit: '£ per week', ...who('revenue is £100 per week'),
      estimate_by: null, low: null, high: null, defined_as: null, limit: null },
    { id: 'costs', label: 'Costs', kind: 'factor', value: 70, unit: '£ per week', ...who('costs are £70 per week'),
      estimate_by: null, low: null, high: null, defined_as: null, limit: null },
  ],
  options: [
    { id: 'hold', label: 'Carry on', status: 'feasible', settings: [], developed_from: null, ...who('carry on') },
    { id: 'grow', label: 'Raise revenue', status: 'feasible', developed_from: null, ...who('raise revenue to £120 per week'),
      settings: [{ factor_id: 'revenue', value: 120, unit: '£ per week', low: null, high: null, estimate_by: null, ...who('raise revenue to £120 per week') }] },
  ],
  links: [], risks: [], conditions: [], views: [], history: [],
});
const save = (m: LivingModelT) => LivingModel.parse(JSON.parse(JSON.stringify(m)));

describe('profit is revenue minus costs, through saved model, mapping and edits', () => {
  it('saved/readback definition reaches GraphV3 with the minus and a calculable target', () => {
    const before = save(model());
    const mapped = mapLivingModel(before);
    const graph = GraphV3.parse({ ...mapped.graph, living_model: before });
    expect(graph.nodes.find((n) => n.id === 'profit')!.nonlinear_identity)
      .toMatchObject({ operation: 'sum', factor_ids: ['revenue', 'costs'], subtract: ['costs'], stated_in_brief: true });
    expect(graph.nodes.find((n) => n.id === 'profit')!.goal_threshold).toBeDefined();
    expect(mapped.withheld).toEqual([]);
    expect(mapped.graph.edges.find((e) => e.from === 'costs' && e.to === 'profit'))
      .toMatchObject({ effect_direction: 'negative', provenance: { definitional: true } });
    expect(save(before)).toEqual(before);
  });

  it('a missing current profit is derived as 30, with the minus visible and authorship retained', () => {
    const m = model(); m.aims[0]!.target!.current = null;
    const mapped = mapLivingModel(save(m));
    expect(mapped.graph.nodes.find((n) => n.id === 'profit')!.observed_state).toMatchObject({ raw_value: 30 });
    expect(mapped.assumed.some((a) => a.text.includes(' − '))).toBe(true);
    expect(m.aims[0]!.defined_as!.source).toBe('user');
  });

  it('a later cost edit and cold model read keep subtraction, not a stale 30 or an added 180', () => {
    const before = save(model());
    const out = applyExplicitEdit(before, { kind: 'factor_value_edit', target_id: 'costs', raw_value: 80, value: .8 });
    if (!('model' in out)) throw Error(out.refused);
    const after = save(out.model);
    expect(after.aims[0]!.defined_as).toEqual(before.aims[0]!.defined_as);
    expect(mapLivingModel(after).graph.nodes.find((n) => n.id === 'profit')!.observed_state).toMatchObject({ raw_value: 20 });
  });

  it('a mismatched total is withheld; a fabricated plus sign is never inferred', () => {
    const m = model(); m.aims[0]!.target!.current = 170;
    expect(mapLivingModel(save(m)).withheld).toContainEqual({ id: 'profit', reason: 'identity_inconsistent' });
  });

  it.each([
    { subtract: ['missing'] }, { subtract: ['costs', 'costs'] }, { subtract: [] },
    { op: 'product', subtract: ['costs'] },
  ])('rejects malformed subtraction rather than dropping it: %j', (patch) => {
    const m = model(); Object.assign(m.aims[0]!.defined_as!, patch);
    expect(LivingModel.safeParse(m).success).toBe(false);
  });

  it('the native strict tool offers a nullable subtraction list; legacy sums keep their saved shape', () => {
    const sent = JSON.stringify(tool({ name: 'build_model_from_brief', description: 'd', parameters: BuildModelParams, execute: async () => '' }).parameters);
    expect(sent).toContain('Sum only: ids from of whose values are subtracted');
    expect(sent).toContain('Null for an all-positive sum or a product');
    const m = model(); delete m.aims[0]!.defined_as!.subtract;
    m.aims[0]!.target!.current = 170;
    expect(save(m).aims[0]!.defined_as).not.toHaveProperty('subtract');
    m.aims[0]!.defined_as!.subtract = null;
    expect(LivingModel.safeParse(m).success).toBe(true);
  });

  it('an all-positive evaluation does not attest the signed definition', () => {
    const nodes = mapLivingModel(save(model())).graph.nodes;
    const evaluation = { node_id: 'profit', operation: 'sum', factor_ids: ['revenue', 'costs'], evaluated: true };
    expect(evaluatedIdentityCarriers(nodes, [evaluation]).has('profit')).toBe(false);
    expect(evaluatedIdentityCarriers(nodes, [{ ...evaluation, subtract: ['costs'] }]).has('profit')).toBe(true);
  });
});


describe('signed definitions survive the shared kernel', () => {
  it('canonicalises minus-part ids along with the parts, before deriving profit or mapping edges', () => {
    const m = model();
    m.factors[0]!.id = 'Revenue'; m.factors[1]!.id = 'Costs';
    m.aims[0]!.defined_as!.of = ['Revenue', 'Costs'];
    m.aims[0]!.defined_as!.subtract = ['Costs'];
    m.aims[0]!.target!.current = null;
    m.options[1]!.settings[0]!.factor_id = 'Revenue';
    const words = [...m.aims, ...m.factors, ...m.options, ...m.options.flatMap((o) => o.settings),
      m.aims[0]!.defined_as!].map((x) => x.quote!).filter(Boolean);
    const out = applyKernel(save(m), words);
    expect(out.relabelled).toEqual([]);
    expect(out.model.aims[0]!.defined_as).toMatchObject({ of: ['revenue', 'costs'], subtract: ['costs'], source: 'user' });
    const mapped = mapLivingModel(save(out.model));
    const graph = GraphV3.parse({ ...mapped.graph, living_model: out.model });
    expect(mapped.withheld).toEqual([]);
    expect(graph.nodes.find((n) => n.id === 'profit')).toMatchObject({
      observed_state: { raw_value: 30 },
      nonlinear_identity: { operation: 'sum', factor_ids: ['revenue', 'costs'], subtract: ['costs'] },
    });
    expect(graph.edges.find((e) => e.from === 'costs' && e.to === 'profit'))
      .toMatchObject({ effect_direction: 'negative', provenance: { definitional: true } });
  });

  it('a native null echo on old definitions changes only the edited price and preserves saved authorship', () => {
    const saved = save(F1_DEFINED);
    const edit = save(saved);
    const price = edit.factors.find((f) => f.id === 'price')!;
    price.value = 45; price.quote = 'Each pays £45 a month';
    const control = applyKernel(save(edit), [price.quote], saved);
    for (const item of [...edit.aims, ...edit.factors]) if (item.defined_as) item.defined_as.subtract = null;
    const echoed = applyKernel(save(edit), [price.quote], saved);
    expect(echoed).toEqual(control);
    expect(echoed.relabelled).toEqual([]);
    expect(diffLivingModels(saved, save(echoed.model)).map(({ kind, id, change }) => ({ kind, id, change })))
      .toEqual([{ kind: 'factor', id: 'price', change: 'change' }]);
    expect(echoed.model.aims[0]!.defined_as).toEqual(saved.aims[0]!.defined_as);
    expect(echoed.model.factors.find((f) => f.id === 'total')!.defined_as)
      .toEqual(saved.factors.find((f) => f.id === 'total')!.defined_as);
  });
});
