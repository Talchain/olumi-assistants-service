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
import { readCurrencyUnitWithQualifiers, totalUnitOfPerUnitPrice } from '../stated-amounts.js';
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

describe('the unit of a TOTAL of a per-unit price (#70 5853114059, served 263dbd5)', () => {
  it('RED: the per-unit denominator goes, the period stays — in either spelling', () => {
    expect(totalUnitOfPerUnitPrice('GBP/subscriber/month')).toBe('GBP/month');
    expect(totalUnitOfPerUnitPrice('GBP per seat per month')).toBe('GBP per month');
    expect(totalUnitOfPerUnitPrice('£/seat')).toBe('£');
    // MG B1: a numbered period is kept — only the per-unit noun goes.
    expect(totalUnitOfPerUnitPrice('GBP per subscriber per 12 months')).toBe('GBP per 12 months');
    expect(totalUnitOfPerUnitPrice('GBP (per seat) per month')).toBe('GBP per month');
  });

  it('CONTRAST: a unit with no per-unit word, or that is not money, is returned as it is', () => {
    expect(totalUnitOfPerUnitPrice('GBP/month')).toBe('GBP/month');
    expect(totalUnitOfPerUnitPrice('GBP per month')).toBe('GBP per month');
    expect(totalUnitOfPerUnitPrice('GBP per 12 months')).toBe('GBP per 12 months');
    expect(totalUnitOfPerUnitPrice('GBP per subscriber-month')).toBe('GBP per subscriber-month');
    expect(totalUnitOfPerUnitPrice('GBP widgets')).toBe('GBP widgets');
    expect(totalUnitOfPerUnitPrice('subscribers/month')).toBe('subscribers/month');
    // A currency denominator is an exchange rate, never a per-unit count: kept as written.
    expect(totalUnitOfPerUnitPrice('GBP per USD')).toBe('GBP per USD');
  });
});
