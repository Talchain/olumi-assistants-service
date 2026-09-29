/**
 * ⛔ THE LICENCE FOR A SILENT PRODUCT (AIQ 5891286280 + 5891385320; R3's phrase classes 5891270716; DL hold 5891050797).
 *
 * One row per phrase class, on the RATE's own figure (£49) and the count's own noun (subscriber). Classes 1–5 license a
 * silent MRR = price × subscribers; 6–10 get the card; every miss must fall to the card, never to a silent product.
 */
import { describe, it, expect } from 'vitest';
import { perItemLicence, unitsCompose } from '../reconciling-product.js';

const lic = (brief: string, count = 1500) => perItemLicence(brief, 49, 'subscriber', count);
const PAUL = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. '
  + 'Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

describe('licensed: the brief binds the rate figure to the count\'s own item (classes 1–5)', () => {
  it.each([
    ['1a per N', 'Our Pro plan is £49 per subscriber. We have 1,500 subscribers and £75k MRR.'],
    ['1b per N per month', 'Our Pro plan is £49 per subscriber per month. We have 1,500 subscribers.'],
    ['1c per N a month', 'Our Pro plan is £49 per subscriber a month. We have 1,500 subscribers.'],
    ['1d a month per N', 'Our Pro plan is £49 a month per subscriber. We have 1,500 subscribers.'],
    ['2a /N', 'Pricing is £49/subscriber. We have 1,500 subscribers.'],
    ['2b /N/month', 'Pricing is £49/subscriber/month. We have 1,500 subscribers.'],
    ['2c / N', 'Pricing is £49 / subscriber. We have 1,500 subscribers.'],
    ['3a each N pays', 'Each subscriber pays £49 a month. We have 1,500 subscribers.'],
    ['3b every N pays', 'Every subscriber pays £49. We have 1,500 subscribers.'],
    ['4 a range binds both figures', 'Should we raise the Pro price from £49 to £59 per subscriber a month? We have 1,500 subscribers.'],
    ['5a an adjective the count shares', 'Pro is £49 per paying subscriber. We have 1,500 paying subscribers.'],
    ['5b an adjective against a bare count', 'Pro is £49 per paying subscriber. We have 1,500 subscribers.'],
    ['plural noun', 'Pro is £49 per subscribers a month. We have 1,500 subscribers.'],
  ])('%s → licensed', (_c, brief) => {
    expect(lic(brief)).toBe(true);
  });
  it('4 (the range\'s other figure is bound too)', () => {
    expect(perItemLicence('Should we raise the Pro price from £49 to £59 per subscriber a month?', 59, 'subscriber')).toBe(true);
  });
});

describe('the card: no licence, or unsure (classes 6–10 and AIQ\'s refinements)', () => {
  it.each([
    ['6 Paul\'s own brief', PAUL],
    ['6a a month', 'Our Pro plan is £49 a month. We have 1,500 subscribers.'],
    ['6b per month', 'Our Pro plan is £49 per month. We have 1,500 subscribers.'],
    ['6c monthly', 'Our Pro plan is £49 monthly. We have 1,500 subscribers.'],
    ['7a another noun (no synonyms)', 'Our Pro plan is £49 per user. We have 1,500 subscribers.'],
    ['7b another noun', 'Our Pro plan is £49 per seat a month. We have 1,500 subscribers.'],
    ['8 the phrase sits on ANOTHER figure', 'Support costs £5 per subscriber. Our Pro plan is £49 a month. We have 1,500 subscribers.'],
    ['9a negated', 'Our Pro plan is £49 a month, not per subscriber. We have 1,500 subscribers.'],
    ['9b hypothetical', 'If we charged £49 per subscriber, we would have £73,500 MRR. We have 1,500 subscribers.'],
    ['9c denied', 'We don\'t charge £49 per subscriber. We have 1,500 subscribers.'],
    ['10a unlisted "for each"', 'Our Pro plan is £49 for each subscriber. We have 1,500 subscribers.'],
    ['10b unlisted "each" after', 'Subscribers pay £49 each. We have 1,500 subscribers.'],
    ['10c unlisted "a N"', 'Our Pro plan is £49 a subscriber. We have 1,500 subscribers.'],
    ['AIQ known under-claim', 'We have 1,500 subscribers paying £49 a month.'],
    ['far binding (another sentence)', 'Our Pro plan is £49 a month. Subscribers each pay that. We have 1,500 subscribers.'],
    ['per N-month (AIQ (3): card, not silent)', 'Our Pro plan is £49 per subscriber-month. We have 1,500 subscribers.'],
    ['AIQ (1) modifiers disagree', 'Pro is £49 per active subscriber. We have 1,500 paying subscribers.'],
    ['a different figure only', 'Our Pro plan is £59 per subscriber. We have 1,500 subscribers.'],
  ])('%s → no licence', (_c, brief) => {
    expect(lic(brief)).toBe(false);
  });
});

describe('the binding is to the RATE\'s figure (R3\'s mutant pair)', () => {
  const on49 = 'Pro is £49 per subscriber a month; support is £5 a month. We have 1,500 subscribers.';
  const moved = 'Pro is £49 a month; support is £5 per subscriber a month. We have 1,500 subscribers.';
  it('"per subscriber" on £49 → licensed', () => expect(lic(on49)).toBe(true));
  it('the same words moved onto £5 → no licence', () => expect(lic(moved)).toBe(false));
});

describe('AIQ 5891385320 (3): a per-N-month rate composes, so it is card-eligible, never "don\'t compose"', () => {
  it('£ per subscriber-month × subscribers → confirm (the card), not proof and not no', () => {
    const c = unitsCompose('GBP/month', 'MRR', { unit: 'GBP per subscriber-month', label: 'Price' }, { unit: 'subscribers', label: 'Subscribers' });
    expect(c.kind).toBe('confirm');
  });
  it('control: £ per subscriber per month × subscribers → proof by units (the licence then decides)', () => {
    const c = unitsCompose('GBP/month', 'MRR', { unit: 'GBP per subscriber per month', label: 'Price' }, { unit: 'subscribers', label: 'Subscribers' });
    expect(c.kind).toBe('proof');
  });
  it('class 11 stays: a yearly rate against a monthly goal → no', () => {
    const c = unitsCompose('GBP/month', 'MRR', { unit: 'GBP per subscriber per year', label: 'Price' }, { unit: 'subscribers', label: 'Subscribers' });
    expect(c.kind).toBe('no');
  });
});
