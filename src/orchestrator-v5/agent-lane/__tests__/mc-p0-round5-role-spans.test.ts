import { expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { nonEffectQuantitySpans } from '../../../cee/factor-extraction/goal-label-target.js';
import { statedEffectQuoteMatches } from '../../../cee/provenance/stated-effect.js';
const effect = 'Each 1% Price increase adds £1,200 a month to monthly recurring revenue.';
const target = 'Our target for monthly recurring revenue is £1,200 a month.';
const today = 'Monthly recurring revenue today is £1,200 a month.';
const candidate = (baseline: boolean): CandidateModel => ({
  goal: { metric: 'monthly recurring revenue', operator: '>=', value: 1200, unit: '£/month', horizon_months: 9, provenance: 'explicit', ...(baseline ? { baseline_value: 1200, baseline_known: true } : {}) },
  options: [{ label: 'Raise prices', provenance: 'explicit', changes: ['Price increase'], interventions: [{ factor_label: 'Price increase', value: 10, unit: '%', provenance: 'explicit' }] }, { label: 'Keep pricing', provenance: 'explicit', is_status_quo: true }],
  factors: [{ label: 'Price increase', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred' }],
  risks: [], outcomes: [], constraints: [],
  links: [{ from: 'Price increase', to: 'monthly recurring revenue', direction: 'positive', provenance: 'inferred', effect_amount: 1200, effect_per_source_change: 1, effect_provenance: 'inferred' }],
});
it.each([false, true])('R5-1 equal target effect-first and target-first, goal baseline 1200=%s', baseline => {
  for (const text of [baseline ? `${effect} ${today} ${target}` : `${effect} ${target}`, baseline ? `${target} ${today} ${effect}` : `${target} ${effect}`]) {
    const e = admitCandidateModel(candidate(baseline), undefined, text).edges.find(e => e.from === 'price_increase' && e.to === 'monthly_recurring_revenue')!;
    expect(e.provenance?.magnitude).toBe('user_stated');
    expect(e.provenance?.source_quote).toBe(effect);
    expect(statedEffectQuoteMatches(effect, e.provenance!.natural_effect!)).toBe(true);
    const claimed = nonEffectQuantitySpans(text, ['Price increase', 'monthly recurring revenue'], [{ label: 'monthly recurring revenue', value: 1200, unit: '£/month' }]);
    const targetAt = text.indexOf('£1,200', text.indexOf(target));
    const effectAt = text.indexOf('£1,200', text.indexOf(effect));
    expect(claimed.some(s => s.start <= targetAt && s.end > targetAt)).toBe(true);
    expect(claimed.some(s => s.start <= effectAt && s.end > effectAt)).toBe(false);
  }
});
it('R5-1 target-only sentence never earns an effect', () => {
  const e = admitCandidateModel(candidate(false), undefined, 'At a 1% Price increase, our target for monthly recurring revenue is £1,200 a month.').edges.find(e => e.to === 'monthly_recurring_revenue')!;
  expect(e.provenance?.magnitude).not.toBe('user_stated'); expect(e.provenance?.source_quote).toBeUndefined();
});
