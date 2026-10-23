import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LivingModel } from '../../../../schemas/living-model.js';
import { applyKernel } from '../kernel.js';
import { mapLivingModel } from '../mapper.js';
import { applyExplicitEdit } from '../edit.js';
import { quoteContainsFigure } from '../figure-authorship.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const mrr = () => LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/mrr-459f8bde-living-model.json', import.meta.url), 'utf8')));
const state = (m: ReturnType<typeof mrr>, id: string): Rec =>
  mapLivingModel(m).graph.nodes.find(n => n.id === id)!.observed_state as Rec;

describe('B3: item words and each figure retain their own author', () => {
  it('MRR459f8bde: the £50k chat correction keeps its own quote and origin through saved-window eviction and readback', () => {
    const next = mrr(), saved = mrr(), aim = next.aims.find(a => a.id === 'mrr')!;
    const brief = aim.quote!;
    saved.aims.find(a => a.id === 'mrr')!.target!.current = null;
    Object.assign(aim.target!, { current: 50000, current_source: 'user', current_quote: '£50k', said_in: null });
    const before = structuredClone(next);
    const out = applyKernel(next, [brief, '£50k'], saved, brief).model;
    expect(out.aims.find(a => a.id === 'mrr')).toMatchObject({ source: 'user', quote: brief,
      target: { current: 50000, current_source: 'user', current_quote: '£50k', said_in: 'chat' } });
    expect(state(out, 'mrr')).toMatchObject({ raw_value: 50000, source: 'user_override', extractionType: 'explicit' });
    expect(out.conditions).toEqual(saved.conditions);
    expect(out.views).toEqual(saved.views);
    const reopened = LivingModel.parse(JSON.parse(JSON.stringify(out)));
    expect(state(reopened, 'mrr')).toEqual(state(out, 'mrr'));
    const carried = applyKernel(reopened, [], reopened, brief).model;
    expect(carried).toEqual(reopened);
    expect(next).toEqual(before);
  });

  it('a false current quote cannot author a different level or spoof a chat marker, while the aim remains the person’s', () => {
    const next = structuredClone(KNOWN_ANSWER);
    Object.assign(next.aims[0]!.target!, { current: 80, current_source: 'user', current_quote: 'today we are at 70', said_in: 'chat' });
    const out = applyKernel(next, [next.aims[0]!.quote!], undefined, next.aims[0]!.quote).model;
    expect(out.aims[0]).toMatchObject({ source: 'user', target: { current: 80, current_source: 'unverified' } });
    expect(out.aims[0]!.target).not.toHaveProperty('said_in');
    expect(state(out, 'g')).not.toHaveProperty('source');
  });

  it('the real 05745055 hiring £0 failure: a £200k budget quote does not author a £0 expenditure', () => {
    // Exact development living_model supplied by the DL, not held out; the limit and qualitative item are retained.
    const next = LivingModel.parse(JSON.parse(readFileSync(new URL('./fixtures/hiring-05745055-living-model.json', import.meta.url), 'utf8')));
    const cost = next.factors.find(f => f.id === 'cost')!, quote = cost.quote!, before = structuredClone(cost);
    expect(cost).toMatchObject({ label: 'Hiring expenditure', value: 0, low: 0, high: 0, source: 'user', estimate_by: null });
    expect(quote).toBe("Our budget is £200,000, but we'd like to spend less.");
    const out = applyKernel(next, [quote]).model;
    expect(out.factors.find(f => f.id === 'cost')).toEqual({ ...before, estimate_by: 'unverified' });
    expect(state(out, 'cost')).toMatchObject({ raw_value: 0, unit: '£' });
    expect(state(out, 'cost')).not.toHaveProperty('source');
    // The same £0 is theirs when actually stated; absence of proof never turns it into an Olumi estimate.
    cost.quote = 'Hiring expenditure is £0';
    expect(applyKernel(next, [cost.quote]).model.factors.find(f => f.id === 'cost'))
      .toMatchObject({ source: 'user', value: 0, estimate_by: null });
    cost.estimate_by = 'olumi';
    expect(applyKernel(next, [cost.quote]).model.factors.find(f => f.id === 'cost')!.estimate_by).toBe('olumi');
  });

  it('all ends of a unitful figure are separately sourced, including party figures; a quote does not author added bounds', () => {
    const next = structuredClone(KNOWN_ANSWER);
    Object.assign(next.factors[0]!, { source: 'party', party: 'Ops', value: 20, low: 10, high: 30, unit: 'hours', quote: 'Ops said 20 hours' });
    const out = applyKernel(next, ['Ops said 20 hours']).model;
    expect(out.factors[0]).toMatchObject({ source: 'party', party: 'Ops', estimate_by: 'unverified', low: 10, high: 30 });
    expect(state(out, 'f').range_source).toBe('unverified');
    const setting = next.options[1]!.settings[0]!;
    Object.assign(setting, { value: 40, unit: 'hours', quote: 'push f to 1' });
    expect(applyKernel(next, [setting.quote!]).model.options[1]!.settings[0])
      .toMatchObject({ source: 'user', value: 40, estimate_by: 'unverified' });
  });

  it('a typed canvas level replaces chat provenance, while changing only the target keeps that provenance', () => {
    const next = structuredClone(KNOWN_ANSWER);
    Object.assign(next.aims[0]!.target!, { current: 70, current_source: 'user', current_quote: 'today 70', said_in: 'chat' });
    const target = applyExplicitEdit(next, { kind: 'goal_target_edit', goal_node_id: 'g', constraint_type: 'at_least', raw_value: 110, unit: 'units' });
    expect('model' in target && target.model.aims[0]!.target).toMatchObject({ current_source: 'user', current_quote: 'today 70', said_in: 'chat' });
    const canvas = applyExplicitEdit(next, { kind: 'factor_value_edit', target_id: 'g', value: 0.64, raw_value: 80, unit: 'units' });
    expect('model' in canvas && canvas.model.aims[0]!.target).toMatchObject({ current: 80, current_source: 'user' });
    if ('model' in canvas) {
      expect(canvas.model.aims[0]!.target).not.toHaveProperty('current_quote');
      expect(canvas.model.aims[0]!.target).not.toHaveProperty('said_in');
      expect(state(canvas.model, 'g').source).toBe('user_edited');
    }
  });

  it('reuses the existing amount alphabet; unrelated scales, currencies and embedded digits never supply the requested figure', () => {
    expect(quoteContainsFigure('£50k', 50000, '£ per month')).toBe(true);
    expect(quoteContainsFigure('£50k', 50, '£k')).toBe(true);
    expect(quoteContainsFigure('£50k', 0, '£')).toBe(false);
    expect(quoteContainsFigure('€50k', 50000, '£')).toBe(false);
    expect(quoteContainsFigure('FY50000', 50000, '£')).toBe(false);
    expect(quoteContainsFigure('£60k', 50000, '£')).toBe(false);
  });
});
