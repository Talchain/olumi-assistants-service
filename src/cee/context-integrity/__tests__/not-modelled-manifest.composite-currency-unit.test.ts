/**
 * C47 (#70 (B), "the canonical read says only true things"). Paul's £20k MRR goal
 * was stored with `goal_threshold_unit: 'GBP MRR'`, and the read route's
 * `not_modelled` listed £20k as ABSENT beside a Model tab showing
 * "Target 20,000 GBP MRR". Cause: `readUnit('GBP MRR')` is `plain`, so a money
 * literal could never match the goal carrier. A composite unit that is a
 * currency plus recognised qualifiers (MRR, per month, /month, (GBP)) must read
 * as that currency; anything else stays plain.
 */
import { describe, it, expect } from 'vitest';
import { deriveNotModelledManifest } from '../not-modelled-manifest.js';
import { readCurrencyUnitWithQualifiers } from '../../provenance/stated-amounts.js';

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, ' +
  'should we increase the Pro plan price from £49 to £59 per month with the next AI feature release?';

function graphWithGoalUnit(unit: string) {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'Monthly recurring revenue', goal_threshold_raw: 20000,
        goal_threshold_unit: unit, goal_threshold: 0.8, goal_threshold_cap: 25000 },
      { id: 'dec', kind: 'decision', label: 'Pro plan price' },
    ],
    edges: [],
  };
}

function verdictOf20k(unit: string) {
  const m = deriveNotModelledManifest(BRIEF, graphWithGoalUnit(unit) as never) as unknown as {
    quantities: { items: Array<{ literal: string; verdict: string; matched_node_id: string | null }> };
  };
  return m.quantities.items.find((i) => i.literal === '£20k')!;
}

describe('C47 — a goal figure stored in a composite currency unit is IN the model', () => {
  it.each(['GBP MRR', 'MRR (GBP)', '£/month', 'GBP per month', '£ MRR'])(
    '£20k with goal unit %j → in_model, anchored to the goal',
    (unit) => {
      expect(verdictOf20k(unit)).toMatchObject({ verdict: 'in_model', matched_node_id: 'goal_mrr' });
    },
  );

  it('CONTROL: the plain currency unit already matched (unchanged)', () => {
    expect(verdictOf20k('£')).toMatchObject({ verdict: 'in_model', matched_node_id: 'goal_mrr' });
  });

  it.each(['customers', 'GBP widgets', 'users per month'])(
    'STRICT: unit %j is not a currency — £20k stays absent',
    (unit) => {
      expect(verdictOf20k(unit).verdict).toBe('absent');
    },
  );
});

describe('readCurrencyUnitWithQualifiers', () => {
  it('reads the currency and magnitude through recognised qualifiers', () => {
    expect(readCurrencyUnitWithQualifiers('GBP MRR')).toMatchObject({ kind: 'currency', currencyCode: 'GBP', multiplier: 1 });
    expect(readCurrencyUnitWithQualifiers('£k per month')).toMatchObject({ kind: 'currency', currencyCode: 'GBP', multiplier: 1000 });
    expect(readCurrencyUnitWithQualifiers('MRR (USD)')).toMatchObject({ kind: 'currency', currencyCode: 'USD' });
  });
  it('leaves anything with an unrecognised word plain', () => {
    expect(readCurrencyUnitWithQualifiers('GBP widgets')).toMatchObject({ kind: 'plain' });
    expect(readCurrencyUnitWithQualifiers('users per month')).toMatchObject({ kind: 'plain' });
  });
});
