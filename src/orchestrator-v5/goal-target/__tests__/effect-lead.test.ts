/**
 * ⭐ S2 THE LEAD BEFORE AN OPTION'S EFFECT IS FULL (DL boundary ruling 21:43Z 14 Oct): the user's start and onboarding, read from
 * their own whole statements on S2's contract, become the ONE lead L that the window's scale k reads (`capacityRatioScale`).
 */
import { describe, expect, it } from 'vitest';
import { effectLeadFromStatements, effectLeadWords, readOnboarding, savedEffectLead } from '../effect-lead.js';
import { capacityRatioScale } from '../event-by-date-share.js';

const OPTION = 'hire_tech_lead';
const SAID = 'She could start in 2 months, and onboarding takes about a month.';
const now = (t: string) => ({ now: t });

describe('the lead from the user’s own words: start + onboarding, on the S2 contract', () => {
  it('RED→GREEN: one sentence holds both → L = 3 months, each figure with whose it is; k reads it (hand: 1 + 0.13·(6−3)/6)', () => {
    const v = effectLeadFromStatements(now(SAID), OPTION, [SAID]);
    expect(v.kind).toBe('read');
    if (v.kind !== 'read') return;
    expect({ low: v.lead.lead_low, high: v.lead.lead_high }).toEqual({ low: 3, high: 3 });
    expect(v.lead.lead_reading).toEqual({ start: { low: 2, high: 2, role: 'stated' }, onboarding: { low: 1, high: 1, role: 'derived' },
      assumption: 'full_effect_after_onboarding' });
    expect(v.lead.lead_statements.map((s) => [s.subject, s.form, s.low, s.high, s.quote, s.speaker, s.reading])).toEqual([
      [{ quantity: 'effect_start', option_id: OPTION }, 'point', 2, 2, SAID, 'user', 'olumi'],
      [{ quantity: 'onboarding', option_id: OPTION }, 'point', 1, 1, SAID, 'user', 'olumi']]);
    expect(capacityRatioScale(1.13, 6, v.lead.lead_low, v.lead.lead_high)).toBeCloseTo(1 + 0.13 * (6 - 3) / 6, 12);
    expect(effectLeadWords(v.lead)).toBe('Full effect 3 months from now: your start in 2 months, then your onboarding of about 1 month '
      + '(Olumi’s reading of your words). Olumi assumes the change is fully in place once onboarding ends.');
    expect(savedEffectLead({ capacity_ratio: 1.13, ...v.lead })).toEqual(v.lead);
  });

  it('two messages, weeks converted (Olumi’s reading), a part they did not give is Olumi’s, a range stays theirs (k fails closed)', () => {
    const start = 'He can start in 3 months.', onboard = 'Onboarding usually takes two weeks.';
    const v = effectLeadFromStatements({ now: onboard, conversation: start }, OPTION, [start, onboard]);
    expect(v).toMatchObject({ kind: 'read', lead: { lead_low: 3.46, lead_high: 3.46,
      lead_reading: { start: { low: 3, role: 'stated' }, onboarding: { low: 0.46, role: 'derived' } } } });
    const bed = 'It would take about a month to bed in.';
    const only = effectLeadFromStatements(now(bed), OPTION, [bed]);
    expect(only).toMatchObject({ kind: 'read', lead: { lead_low: 1, lead_high: 1, lead_reading: { start: { low: 0, high: 0, role: 'olumi_estimate' } } } });
    if (only.kind === 'read') expect(effectLeadWords(only.lead)).toContain('starting now (Olumi’s assumption)');
    const range = 'She could start in 2 to 3 months.';
    const r = effectLeadFromStatements(now(range), OPTION, [range]);
    expect(r).toMatchObject({ kind: 'read', lead: { lead_low: 2, lead_high: 3, lead_reading: { start: { low: 2, high: 3, role: 'stated' } } } });
    if (r.kind === 'read') expect(capacityRatioScale(1.13, 6, r.lead.lead_low, r.lead.lead_high)).toBeNull();
    expect(readOnboarding('onboarding takes one to two months')).toEqual({ low: 1, high: 2, derived: false });
  });

  it('CONTRASTS: a bound, unverified or partial words, two starts, or nothing readable prepare nothing, each with its reason', () => {
    const within = 'She could start within 2 months.';
    expect(effectLeadFromStatements(now(within), OPTION, [within])).toMatchObject({ kind: 'refused', refusal: 'lead_is_a_bound' });
    expect(effectLeadFromStatements({ now: 'Yes.', unverified: SAID }, OPTION, [SAID])).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
    // Not her literal words ("in two months"). A literal span of the sentence is the user's under the confirmed lean-core widening.
    expect(effectLeadFromStatements(now(SAID), OPTION, ['start in two months, and onboarding takes about a month.']))
      .toMatchObject({ kind: 'refused', refusal: 'lead_not_stated' });
    const two = 'We launch in 6 months, and she starts in 2 months.';
    expect(effectLeadFromStatements(now(two), OPTION, [two])).toMatchObject({ kind: 'refused', refusal: 'lead_unclear' });
    const none = 'She is very experienced.';
    expect(effectLeadFromStatements(now(none), OPTION, [none])).toMatchObject({ kind: 'refused', refusal: 'lead_unclear' });
    expect(savedEffectLead({ capacity_ratio: 1.13, lead_low: 0, lead_high: 0 })).toBeUndefined();
  });
});
