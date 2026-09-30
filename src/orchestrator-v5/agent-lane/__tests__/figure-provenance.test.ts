/**
 * Figure provenance screen — controls on SERVED and BENCHMARKED text (AIQ #78 5914447316, 5914617046).
 *   no_source (invention) positive: served turn 1 of Paul's funding brief → £75,000; COACH-Q1 S07 (selected coach)
 *     → the compounding 5.6% and the price-rise forecast £86,700;
 *   derived_operands_not_shown (wording) positive: COACH-Q1 S12 → salary sums from the user's £120k / £65k;
 *   contrast: the served answer turn → every figure binds to the user's own words;
 *   by id: a served PC03 reply on the C10 capture → £59 binds to the option that sets it, 4% to the churn limit;
 *   engine / run / proposal / arithmetic: each binding is shown with its mutant (the source removed).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenFigureProvenance, type ScreenedFigure } from '../figure-provenance.js';

const load = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const paul = load('figure-provenance-paul-funding.json');
const c10 = load('figure-provenance-c10-pc03.json');
const q1 = load('figure-provenance-coach-q1.json').turns;
const lits = (xs: readonly ScreenedFigure[]) => xs.map((f) => f.literal);
const of = (xs: readonly ScreenedFigure[], literal: string) => xs.find((f) => f.literal === literal)?.binding;

describe('screenFigureProvenance', () => {
  it('no_source positive: the served turn-1 reply names £75,000, which no node, link, user text or step reaches', () => {
    const s = screenFigureProvenance({ text: paul.turn1.reply, userTexts: [paul.brief], graph: paul.turn1.graph });
    expect(lits(s.no_source)).toEqual(['£75,000']);
    expect(lits(s.figures)).toEqual(['£75,000']);
    expect(s.operands_not_shown).toEqual([]);
  });

  it('no_source on the selected coach: S07 compounding 5.6% and the £86,700 price-rise forecast; the shown gap and its % bind', () => {
    const t = q1['S07-D'];
    const s = screenFigureProvenance({ text: t.reply, userTexts: t.user_texts, graph: t.graph });
    expect(lits(s.no_source)).toEqual(['5.6%', '£86,700']);
    expect(of(s.figures, '£28,000')).toEqual({ source: 'arithmetic', op: '-', operands: ['£100,000', '£72,000'] });
    expect(of(s.figures, '38.9%')).toEqual({ source: 'arithmetic', op: '%', operands: ['£28,000', '£72,000'] });
  });

  it('derived_operands_not_shown positive: S12 salary sums are one step from the user\'s £120k / £65k with a named count', () => {
    const t = q1['S12-D'];
    const s = screenFigureProvenance({ text: t.reply, userTexts: t.user_texts, graph: t.graph });
    expect(s.no_source).toEqual([]);
    expect(of(s.figures, '£240,000')).toEqual({ source: 'derived_operands_not_shown', op: 'k*', operands: ['£120k', '2'] });
    expect(of(s.figures, '£260,000')).toEqual({ source: 'derived_operands_not_shown', op: 'k*', operands: ['£65k', '4'] });
    expect(of(s.figures, '£250,000')).toEqual({ source: 'derived_operands_not_shown', op: '+k*', operands: ['£120k', '2', '£65k'] });
  });

  it('a written figure chains: headroom £400k − £240,000 is one step from a figure the reply wrote down', () => {
    const t = q1['S12-B'];
    const s = screenFigureProvenance({ text: t.reply, userTexts: t.user_texts, graph: t.graph });
    expect(s.no_source).toEqual([]);
    expect(of(s.figures, '£160,000')).toEqual({ source: 'derived_operands_not_shown', op: '-', operands: ['£400k', '£240,000'] });
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
    expect(of(s.figures, '£59')).toEqual({ source: 'graph', node_id: 'features_and_pro_price', field: 'interventions.pro_plan_price.raw_value' });
    expect(of(s.figures, '4%')).toEqual({ source: 'graph', node_id: 'monthly_churn', field: 'goal_constraints.agent-lane:monthly_churn:<=.value' });
  });

  it('proposal: the gate\'s PC01 starting point binds to the proposal it put on the card, and is no_source without it', () => {
    const t = q1['PC01-gate'];
    const withCard = screenFigureProvenance({ text: t.reply, userTexts: t.user_texts, graph: t.graph, proposals: t.proposals });
    expect(withCard.unbound).toEqual([]);
    expect(of(withCard.figures, '15%')).toEqual({ source: 'proposal', proposal_id: 'gate-pc01-propose_starting_point', labelled: true });
    const bare = screenFigureProvenance({ text: 'Trial-to-Pro conversion will be 15%.', userTexts: [], graph: {}, proposals: t.proposals });
    expect(of(bare.figures, '15%')).toEqual({ source: 'proposal', proposal_id: 'gate-pc01-propose_starting_point', labelled: false });
    const without = screenFigureProvenance({ text: t.reply, userTexts: t.user_texts, graph: t.graph });
    expect(lits(without.no_source)).toContain('15%');
  });

  it('engine: the served Run summary\'s "51%" binds to the supplied win share, and is unbound without it', () => {
    const text = String(paul.answer.analysis_result.summary);
    const withEngine = screenFigureProvenance({ text, userTexts: [], graph: paul.answer.graph, analysisResult: paul.answer.analysis_result });
    expect(of(withEngine.figures, '51%')).toEqual({ source: 'engine', path: 'win_probabilities.Angel bridge outreach' });
    const without = screenFigureProvenance({ text, userTexts: [], graph: paul.answer.graph });
    expect(lits(without.unbound)).toContain('51%');
  });

  it('ignores ordinals and counts in engine output (a rank of 4 is not "4%")', () => {
    const s = screenFigureProvenance({ text: 'Churn stays below 4%.', userTexts: [], graph: {}, analysisResult: { factor_sensitivity: [{ influence_rank: 4, importance_rank: 4 }] } });
    expect(lits(s.no_source)).toEqual(['4%']);
  });

  it('run: a typed current-Run figure (#2368 SelectedRunFigure shape) binds by run hash, within the precision written', () => {
    const runFigures = [{ option_id: 'raise_pro_price_to_59', value: 90993.23628890762, measure: 'mean', run_hash: 'e7d843f951477155' }];
    const text = 'On this Run, raising the price averages £91k MRR.';
    expect(screenFigureProvenance({ text, userTexts: [], graph: {}, runFigures }).figures[0]?.binding)
      .toEqual({ source: 'run', option_id: 'raise_pro_price_to_59', measure: 'mean', run_hash: 'e7d843f951477155' });
    expect(lits(screenFigureProvenance({ text, userTexts: [], graph: {} }).no_source)).toEqual(['£91k']);
  });

  it('shown arithmetic binds; the same step unshown, split across sentences, or with an unnamed count does not', () => {
    const userTexts = [paul.answer.message];
    const shown = screenFigureProvenance({ text: 'After a month, £180k − £45k = £135k remains.', userTexts, graph: {} });
    expect(of(shown.figures, '£135k')).toEqual({ source: 'arithmetic', op: '-', operands: ['£180k', '£45k'] });
    for (const text of ['You have £180k and spend £45k, leaving £135k.', 'You have £180k and spend £45k. So £135k = what remains.', '£135k is what remains. That is £180k − £45k.']) {
      const s = screenFigureProvenance({ text, userTexts, graph: {} });
      expect(of(s.figures, '£135k')).toEqual({ source: 'derived_operands_not_shown', op: '-', operands: ['£180k', '£45k'] });
    }
    // A count must be NAMED in the sentence: £22,500 is £45k ÷ 2, but nothing here names a half.
    expect(lits(screenFigureProvenance({ text: 'Set aside £22,500 for legal fees.', userTexts, graph: {} }).no_source)).toEqual(['£22,500']);
    expect(of(screenFigureProvenance({ text: 'Half of that, £22,500, goes on legal fees.', userTexts, graph: {} }).figures, '£22,500'))
      .toEqual({ source: 'derived_operands_not_shown', op: '/k', operands: ['£45k', '2'] });
  });

  it('never throws on junk input and reports nothing to bind', () => {
    expect(screenFigureProvenance({ text: undefined as unknown as string, userTexts: [], graph: null }))
      .toEqual({ figures: [], unbound: [], no_source: [], operands_not_shown: [] });
    expect(lits(screenFigureProvenance({ text: 'Costs £5k.', userTexts: [], graph: { nodes: 'x', goal_constraints: [null] } }).no_source)).toEqual(['£5k']);
  });
});
