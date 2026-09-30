/**
 * Figure provenance screen — controls on SERVED text (AIQ #78 5914447316).
 *   positive: served turn 1 of Paul's funding brief → £75,000 is the ONE unbound figure;
 *   contrast: the served answer turn → every figure binds to the user's own words;
 *   by id: a served PC03 reply on the C10 capture → £59 binds to the option that sets it, 4% to the churn limit;
 *   engine/run/arithmetic: each binding is shown with its mutant (the source removed ⇒ UNBOUND).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenFigureProvenance } from '../figure-provenance.js';

const paul = JSON.parse(readFileSync(join(__dirname, 'fixtures/figure-provenance-paul-funding.json'), 'utf8'));
const c10 = JSON.parse(readFileSync(join(__dirname, 'fixtures/figure-provenance-c10-pc03.json'), 'utf8'));

describe('screenFigureProvenance', () => {
  it('positive control: the served turn-1 reply names £75,000, which no node, link or user text holds', () => {
    const s = screenFigureProvenance({ text: paul.turn1.reply, userTexts: [paul.brief], graph: paul.turn1.graph });
    expect(s.unbound.map((f) => f.literal)).toEqual(['£75,000']);
    expect(s.figures.map((f) => f.literal)).toEqual(['£75,000']);
  });

  it('contrast: the served answer turn repeats only figures the user stated', () => {
    const s = screenFigureProvenance({ text: paul.answer.reply, userTexts: [paul.brief, paul.answer.message], graph: paul.answer.graph });
    expect(s.figures.length).toBeGreaterThanOrEqual(4);
    expect(s.unbound).toEqual([]);
    expect(s.figures.every((f) => f.binding.source === 'user')).toBe(true);
  });

  it('binds stored figures by id: £59 to the option that sets the price, 4% to the churn limit', () => {
    const s = screenFigureProvenance({ text: c10.reply, userTexts: [c10.message], graph: c10.graph });
    expect(s.unbound).toEqual([]);
    expect(s.figures.find((f) => f.literal === '£59')?.binding)
      .toEqual({ source: 'graph', node_id: 'features_and_pro_price', field: 'interventions.pro_plan_price.raw_value' });
    expect(s.figures.find((f) => f.literal === '4%')?.binding)
      .toEqual({ source: 'graph', node_id: 'monthly_churn', field: 'goal_constraints.agent-lane:monthly_churn:<=.value' });
  });

  it('engine: the served Run summary\'s "51%" binds to the supplied win share, and is UNBOUND without it', () => {
    const text = String(paul.answer.analysis_result.summary);
    const withEngine = screenFigureProvenance({ text, userTexts: [], graph: paul.answer.graph, analysisResult: paul.answer.analysis_result });
    expect(withEngine.figures.find((f) => f.literal === '51%')?.binding).toEqual({ source: 'engine', path: 'win_probabilities.Angel bridge outreach' });
    const without = screenFigureProvenance({ text, userTexts: [], graph: paul.answer.graph });
    expect(without.unbound.map((f) => f.literal)).toContain('51%');
  });

  it('ignores ordinals and counts in engine output (a rank of 4 is not "4%")', () => {
    const s = screenFigureProvenance({ text: 'Churn stays below 4%.', userTexts: [], graph: {}, analysisResult: { factor_sensitivity: [{ influence_rank: 4, importance_rank: 4 }] } });
    expect(s.unbound.map((f) => f.literal)).toEqual(['4%']);
  });

  it('run: a typed current-Run figure (#2368 SelectedRunFigure shape) binds by run hash, within the precision written', () => {
    const runFigures = [{ option_id: 'raise_pro_price_to_59', value: 90993.23628890762, measure: 'mean', run_hash: 'e7d843f951477155' }];
    const text = 'On this Run, raising the price averages £91k MRR.';
    expect(screenFigureProvenance({ text, userTexts: [], graph: {}, runFigures }).figures[0]?.binding)
      .toEqual({ source: 'run', option_id: 'raise_pro_price_to_59', measure: 'mean', run_hash: 'e7d843f951477155' });
    expect(screenFigureProvenance({ text, userTexts: [], graph: {} }).unbound.map((f) => f.literal)).toEqual(['£91k']);
  });

  it('arithmetic: shown one-step arithmetic on bound operands in the same sentence binds; hidden or split does not', () => {
    const userTexts = [paul.answer.message];
    const shown = screenFigureProvenance({ text: 'After a month, £180k − £45k = £135k remains.', userTexts, graph: {} });
    expect(shown.figures.find((f) => f.literal === '£135k')?.binding).toEqual({ source: 'arithmetic', op: '-', operands: ['£180k', '£45k'] });
    const noOperator = screenFigureProvenance({ text: 'You have £180k and spend £45k, leaving £135k.', userTexts, graph: {} });
    expect(noOperator.unbound.map((f) => f.literal)).toEqual(['£135k']);
    const split = screenFigureProvenance({ text: 'You have £180k and spend £45k. So £135k = what remains.', userTexts, graph: {} });
    expect(split.unbound.map((f) => f.literal)).toEqual(['£135k']);
    const later = screenFigureProvenance({ text: '£135k is what remains. That is £180k − £45k.', userTexts, graph: {} });
    expect(later.unbound.map((f) => f.literal)).toEqual(['£135k']);
  });

  it('never throws on junk input and reports nothing to bind', () => {
    expect(screenFigureProvenance({ text: undefined as unknown as string, userTexts: [], graph: null })).toEqual({ figures: [], unbound: [] });
    expect(screenFigureProvenance({ text: 'Costs £5k.', userTexts: [], graph: { nodes: 'x', goal_constraints: [null] } }).unbound.map((f) => f.literal)).toEqual(['£5k']);
  });
});
