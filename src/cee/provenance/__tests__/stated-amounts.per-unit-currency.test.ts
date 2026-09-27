/**
 * A PRICE PER SEAT IS MONEY (MG construction sweep, 27 Sep; served CEE e7d28fd).
 *
 * The drafter stores a per-unit price as "GBP per seat per month" / "GBP per subscriber per month". The composite reader
 * accepted only rate/metric qualifiers after the currency, so the denominator word ("seat") made the whole unit `plain`:
 * "What I was given" said the pricing brief's stated £40 was absent (served pricing-2), and 1 of 74 served drafts of Paul's
 * own brief said the same of £49. One word directly after "per" (or "/") is the rate's DENOMINATOR, not a second thing;
 * anything else still leaves the unit plain ("GBP widgets"), and two currencies are still ambiguous.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readCurrencyUnitWithQualifiers } from '../stated-amounts.js';
import { deriveNotModelledManifest } from '../../context-integrity/not-modelled-manifest.js';

describe('a per-unit price is money', () => {
  it('RED: per seat / per subscriber rates read as the currency', () => {
    expect(readCurrencyUnitWithQualifiers('GBP per seat per month')).toMatchObject({ kind: 'currency', currencyCode: 'GBP' });
    expect(readCurrencyUnitWithQualifiers('GBP per subscriber per month')).toMatchObject({ kind: 'currency', currencyCode: 'GBP' });
    expect(readCurrencyUnitWithQualifiers('£/seat/month')).toMatchObject({ kind: 'currency' });
  });
  it('CONTRAST: a noun that is not a denominator stays plain; two currencies stay ambiguous', () => {
    expect(readCurrencyUnitWithQualifiers('GBP widgets').kind).toBe('plain');
    expect(readCurrencyUnitWithQualifiers('GBP per USD').kind).toBe('plain');
  });
  it('CONTROL: the rate qualifiers already read are unchanged', () => {
    expect(readCurrencyUnitWithQualifiers('GBP per month')).toMatchObject({ kind: 'currency', currencyCode: 'GBP' });
    expect(readCurrencyUnitWithQualifiers('GBP MRR')).toMatchObject({ kind: 'currency', currencyCode: 'GBP' });
  });
  it('RED (served pricing-2): "What I was given" finds the brief\'s £40 per-seat price in the model', () => {
    const f = JSON.parse(readFileSync(new URL('../../context-integrity/__tests__/fixtures/served-per-seat-price-pricing-2.json', import.meta.url), 'utf8'));
    const m = deriveNotModelledManifest(f.brief, f.graph);
    expect(m.quantities?.items.find((i) => i.literal === '£40')?.verdict).toBe('in_model');
  });
});
