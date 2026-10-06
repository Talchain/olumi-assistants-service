/**
 * Red-team F2 (#87 6007779166): the ask's own answer must card. A one-sentence answer about a hyphenated "no-…" label,
 * in the ask's own unit ("% of appointments"), was refused three ways in turn:
 *   1. NEGATOR read "no" in "no-shows" / "No-show charge" as a denial;
 *   2. "of appointments", the AMOUNT unit's own denominator, was read as another quantity;
 *   3. "no-shows" could never be NAMED next to "No-show charge" (every word of it is the other end's).
 * Each row binds by the exact outcome; every pass row has a refusal twin that stays refused.
 */
import { describe, it, expect } from 'vitest';
import { linkEffectTheUserStated, linkEffectQuoteContextMiss, bandTheUserWrote, directionTheWordsSay } from '../stated-by-user.js';

const scope = (quantities: string[]) => ({ quantities, link_selected: false }) as never;
const DENTAL = ['No-show charge', 'no-shows', 'Patient dissatisfaction from charges', 'Appointment awareness'];
const said = (q: string, source: string, target: string, amountUnit: string, perUnit: string, amount = 0.05, quantities?: string[]) =>
  linkEffectTheUserStated(q, { amount, amount_unit: amountUnit, per_source_change: 1, per_source_change_unit: perUnit },
    { source, target }, scope(quantities ?? [source, target])) ?? 'BINDS';

describe('the red team\'s two dental answers card, in the ask\'s own unit', () => {
  const A1 = 'Through patient dissatisfaction, each £1 rise in the no-show charge raises no-shows by about 0.05 percentage points of appointments.';
  const A2 = 'A £1 per missed appointment rise in No-show charge would raise no-shows by about 0.05% of appointments that way.';
  it.each([
    ['A1', A1, '£'], ['A1', A1, '£ per missed appointment'],
    ['A2', A2, '£'], ['A2', A2, '£ per missed appointment'],
  ])('%s per %s → BINDS', (_n, q, perUnit) => {
    expect(said(q, 'No-show charge', 'no-shows', '% of appointments', perUnit, 0.05, DENTAL)).toBe('BINDS');
  });
});

describe('NEGATOR: a hyphenated compound is a word, not a denial', () => {
  // A unit with no "of" isolates the NEGATOR from the denominator rule.
  it.each([
    ['target "no-shows"', 'A £1 rise in Late fee would raise no-shows by about 2 per week.', 'Late fee', 'no-shows'],
    ['source "No-show charge"', 'A £1 rise in No-show charge would raise missed visits by about 2 per week.', 'No-show charge', 'missed visits'],
    ['target "non-renewals" (never a negator: control)', 'A £1 rise in Late fee would raise non-renewals by about 2 per week.', 'Late fee', 'non-renewals'],
    // Not an end label, so masking cannot hide it: only the hyphen rule keeps this from reading as a denial.
    ['a hyphenated word outside both labels ("no-show patients")', 'A £1 rise in Late fee, for no-show patients, would raise cancellations by about 2 per week.', 'Late fee', 'cancellations'],
  ])('%s → BINDS', (_n, q, source, target) => {
    expect(said(q, source, target, 'per week', '£', 2)).toBe('BINDS');
  });

  it.each([
    ['"no change"', 'A £1 rise in Late fee would make no change to cancellations, about 0.05% of appointments.'],
    ['"does not move"', 'A £1 rise in Late fee does not move cancellations by 0.05% of appointments.'],
    ['"no effect"', 'A £1 rise in Late fee has no effect on cancellations, 0.05% of appointments.'],
    ['"No-one" (a hyphenated negator)', 'No-one thinks a £1 rise in Late fee raises cancellations by 0.05% of appointments.'],
    ['"no-one" mid-sentence', 'A £1 rise in Late fee raises cancellations by 0.05% of appointments, says no-one.'],
  ])('deny twin %s → denied', (_n, q) => {
    expect(said(q, 'Late fee', 'cancellations', '% of appointments', '£')).toBe('denied');
  });

  it('a quoted answer\'s own sentence is not denied by a hyphenated label (quote context)', () => {
    const user = 'A £1 rise in No-show charge would raise no-shows by about 0.05% of appointments.';
    expect(linkEffectQuoteContextMiss('raise no-shows by about 0.05% of appointments', user)).toBeNull();
    expect(linkEffectQuoteContextMiss('raise cancellations by 0.05%', 'I do not think a £1 rise would raise cancellations by 0.05%.')).toBe('denied');
  });
});

describe('NEGATOR outside the ends\' own labels', () => {
  it('a negator word inside an end\'s whole label is its name → BINDS', () => {
    expect(said('A £1 rise in Late fee would raise Not paid invoices by about 3 per month.', 'Late fee', 'Not paid invoices', 'per month', '£', 3)).toBe('BINDS');
  });
  it('twin: the same sentence with a denial outside the label → denied', () => {
    expect(said('I do not think a £1 rise in Late fee would raise Not paid invoices by about 3 per month.', 'Late fee', 'Not paid invoices', 'per month', '£', 3)).toBe('denied');
  });
});

describe('the amount unit\'s own denominator is the unit, never another quantity', () => {
  it('"0.05% of appointments" with unit "% of appointments" → BINDS', () => {
    expect(said('A £1 rise in Late fee would raise cancellations by about 0.05% of appointments.', 'Late fee', 'cancellations', '% of appointments', '£')).toBe('BINDS');
  });
  it.each([
    ['partial overlap: "% of appointments booked online"', 'A £1 rise in Late fee would raise cancellations by about 0.05% of appointments booked online.', '% of appointments'],
    ['"% of revenue" on a unit of "% of appointments"', 'A £1 rise in Late fee would raise cancellations by about 0.05% of revenue.', '% of appointments'],
    ['a unit with no denominator ("percentage points")', 'A £1 rise in Late fee would raise cancellations by about 0.05 percentage points of appointments.', 'percentage points'],
  ])('%s → figure_of_another_quantity', (_n, q, unit) => {
    expect(said(q, 'Late fee', 'cancellations', unit, '£')).toBe('figure_of_another_quantity');
  });
  it('net-margin twin: "0.5 percentage points of net margin" on "gross margin" stays refused', () => {
    expect(said('A £1 rise in Late fee would raise gross margin by about 0.5 percentage points of net margin.', 'Late fee', 'gross margin', 'percentage points', '£', 0.5))
      .toBe('figure_of_another_quantity');
  });
});

describe('an end whose every word is the other end\'s is named only outside the other\'s mentions', () => {
  it('"…in the no-show charge raises no-shows…" names both → BINDS', () => {
    expect(said('Each £1 rise in the no-show charge raises no-shows by about 0.05% of appointments.', 'No-show charge', 'no-shows', '% of appointments', '£', 0.05, DENTAL)).toBe('BINDS');
  });
  it('twin: "…in No-show charge would raise them…" never names "no-shows" → end_not_named', () => {
    expect(said('A £1 rise in No-show charge would raise them by about 0.05% of appointments.', 'No-show charge', 'no-shows', '% of appointments', '£', 0.05, DENTAL)).toBe('end_not_named');
  });
});

describe('Integrator twins (#87 RT6-J3): plural/case variants, a label mentioned twice, identical labels', () => {
  it('(a) "no-show charges" … "No-Shows" on labels "No-show charges" / "no-shows" → BINDS', () => {
    expect(said('A £1 rise in no-show charges would raise No-Shows by about 0.05% of appointments.', 'No-show charges', 'no-shows', '% of appointments', '£')).toBe('BINDS');
  });
  it('(a) twin: a plural mention of the label "No-show charge" does not name "no-shows" → end_not_named', () => {
    expect(said('A £1 rise in NO-SHOW CHARGES would raise them by about 0.05% of appointments.', 'No-show charge', 'no-shows', '% of appointments', '£')).toBe('end_not_named');
  });
  it('(b) "no-shows" only between two mentions of "No-show charge" → BINDS', () => {
    expect(said('A £1 rise in No-show charge would raise no-shows by about 0.05% of appointments, through the No-show charge itself.', 'No-show charge', 'no-shows', '% of appointments', '£')).toBe('BINDS');
  });
  it('(b) twin: nothing between the two mentions names "no-shows" → end_not_named', () => {
    expect(said('A £1 rise in No-show charge would raise them by about 0.05% of appointments, through the No-show charge itself.', 'No-show charge', 'no-shows', '% of appointments', '£')).toBe('end_not_named');
  });
  it.each([
    ['"Revenue" / "revenue"', 'Revenue', 'revenue'],
    ['"Revenue" / "Revenues"', 'Revenue', 'Revenues'],
  ])('(c) ends identical in words, %s → end_not_named, never a guess', (_n, source, target) => {
    expect(said('A £1 rise in Revenue would raise revenue by about 3 per month.', source, target, 'per month', '£', 3)).toBe('end_not_named');
  });
});

describe('every other NEGATOR reader reads a hyphenated "no-" word as a word (the class, not only the link binder)', () => {
  it.each([
    ['band (readingAt)', () => bandTheUserWrote('strong', 'No-show charge strongly raises no-shows.'), true],
    ['band twin: a denial', () => bandTheUserWrote('strong', 'No-show charge does not strongly raise no-shows.'), false],
    ['direction', () => directionTheWordsSay('raises no-shows'), 'positive'],
    ['direction twin: a denial', () => directionTheWordsSay('never raises no-shows'), null],
  ])('%s', (_n, read, want) => {
    expect(read()).toBe(want);
  });
});
