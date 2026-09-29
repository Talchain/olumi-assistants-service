/**
 * "BY 1 SUBSCRIBERS" (AI Conversation #70 5852012649): served on Paul's first reply (UI d1a77faa, CEE 5668902), in the
 * open questions: "Olumi estimated that raising "Pro paying subscribers" by 1 subscribers raises "MRR" by 49 GBP per
 * month". A change of exactly one says its unit's head noun in the singular; any other amount keeps the unit as written.
 */
import { describe, expect, it } from 'vitest';

import { sizeLink, type MagnitudeNode } from '../link-effect.js';

const mrr: MagnitudeNode = {
  label: 'MRR', kind: 'goal', goal_threshold_cap: 25000, goal_threshold_unit: 'GBP per month', option_levels: [],
};
const counted = (label: string, unit: string): MagnitudeNode => ({
  label, kind: 'factor', observed_state: { value: 0.2, raw_value: 400, cap: 2000, unit, source: 'cee_inference', extractionType: 'inferred' },
  option_levels: [],
});
const subscribers = counted('Pro paying subscribers', 'subscribers');
// +49 GBP/month per subscriber on these frames is not representable, so the statement is asked back in the question.
const asked = (per: number, source: MagnitudeNode, amount = 49 * per): string =>
  sizeLink({ direction: 'positive', effect_amount: amount, effect_per_source_change: per, user_stated: false }, source, mrr).question ?? '';

describe('a change of exactly one is said in the singular', () => {
  it('RED (served): "by 1 subscriber", never "by 1 subscribers"', () => {
    const q = asked(1, subscribers);
    expect(q).toContain('raising "Pro paying subscribers" by 1 subscriber raises "MRR"');
    expect(q).not.toMatch(/by 1 subscribers/);
  });

  it('CONTROL: any other amount keeps the plural ("by 2 subscribers")', () => {
    expect(asked(2, subscribers)).toContain('by 2 subscribers raises');
  });

  it('the head noun is the word before "per" or "/": "1 enterprise customer per AE per 12 months", "1 hire/month"', () => {
    expect(asked(1, counted('AE productivity', 'enterprise customers per AE per 12 months')))
      .toContain('by 1 enterprise customer per AE per 12 months raises');
    expect(asked(1, counted('Hiring pace', 'hires/month'))).toContain('by 1 hire/month raises');
  });

  it('FAIL-SAFE: a plural it cannot undo is left as written, never a made-up word', () => {
    expect(asked(1, counted('Deliveries', 'deliveries'))).toContain('by 1 deliveries raises');
    expect(asked(1, counted('Boxes', 'boxes'))).toContain('by 1 boxes raises');
    expect(asked(1, counted('Status', 'status'))).toContain('by 1 status raises');
  });

  it('CONTRAST: a unit with no plural is unchanged ("by 1 GBP per month")', () => {
    expect(asked(1, counted('Pro plan price', 'GBP per month'))).toContain('by 1 GBP per month raises');
  });
});
