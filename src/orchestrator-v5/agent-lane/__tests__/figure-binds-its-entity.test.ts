/**
 * ⛔ A FIGURE IS THE USER'S FOR AN ENTITY ONLY WHERE THEY WROTE IT ABOUT THAT ENTITY (ChatGPT #70 5845853364:
 * numeric grounding binds figure + entity + unit + source context). Labels are Paul's stored graph's
 * (`paul-cbd15f83`): a price in "GBP per month", MRR as the goal, monthly churn, and his options.
 *
 * Each RED row pairs the entity-bound reading with `figureTheUserWrote` on the same words: the old reading accepts the
 * figure for ANY entity, so every "not the user's" row below is a figure it would have recorded as theirs.
 */
import { describe, it, expect } from 'vitest';
import { figureTheUserWrote, figureTheUserWroteFor, userWordsOf } from '../stated-by-user.js';

// The QUANTITIES (factors and the goal): `scopeIn` never lists options or the decision as other entities.
const LABELS = ['Pro plan price', 'Monthly recurring revenue (MRR)', 'Monthly churn'];
const scopeOf = (...target: string[]) => ({ target, others: LABELS.filter((l) => !target.includes(l)) });
const PRICE = scopeOf('Pro plan price');
const MRR = scopeOf('Monthly recurring revenue (MRR)');
const CHURN = scopeOf('Monthly churn');

describe('a figure written about ANOTHER entity is never this one\'s (the old reading accepted it for any)', () => {
  it('RED: "Our MRR is £12,000." → £12,000 is MRR\'s, never the Pro plan price\'s', () => {
    const t = 'Our MRR is £12,000.';
    expect(figureTheUserWrote(12000, 'GBP per month', t), 'the old reading accepts it for the price').toBe(true);
    expect(figureTheUserWroteFor(12000, 'GBP per month', t, PRICE)).toBe(false);
    expect(figureTheUserWroteFor(12000, 'GBP per month', t, MRR)).toBe(true);
  });

  it('RED: two figures in one sentence, each about its own entity, bind clause by clause', () => {
    const t = 'Raise the Pro plan price to £59, and our MRR is £12,000 today.';
    expect(figureTheUserWroteFor(59, 'GBP per month', t, PRICE)).toBe(true);
    expect(figureTheUserWroteFor(12000, 'GBP per month', t, PRICE)).toBe(false);
    expect(figureTheUserWroteFor(12000, 'GBP per month', t, MRR)).toBe(true);
    expect(figureTheUserWroteFor(59, 'GBP per month', t, MRR)).toBe(false);
  });

  it('RED: one clause, two figures, each beside its own entity ("backfills 1 developer and hires 0 tech leads")', () => {
    const hiring = ['Developers hired', 'Tech leads hired', 'Onboarding workload'];
    const scope = (t: string) => ({ target: [t, 'Maintain current staffing'], others: hiring.filter((l) => l !== t) });
    const t = 'Carrying on backfills 1 developer and hires 0 tech leads.';
    expect(figureTheUserWrote(0, 'hires', t), 'the old reading accepts 0 for developers').toBe(true);
    expect(figureTheUserWroteFor(1, 'hires', t, scope('Developers hired'))).toBe(true);
    expect(figureTheUserWroteFor(0, 'hires', t, scope('Developers hired'))).toBe(false);
    expect(figureTheUserWroteFor(0, 'hires', t, scope('Tech leads hired'))).toBe(true);
    expect(figureTheUserWroteFor(1, 'hires', t, scope('Tech leads hired'))).toBe(false);
  });

  it('RED: "Churn is 4% a month." → 4% is churn\'s; as MRR growth it is not the user\'s', () => {
    const t = 'Churn is 4% a month.';
    expect(figureTheUserWrote(4, '%', t)).toBe(true);
    expect(figureTheUserWroteFor(4, 'percent per month', t, CHURN)).toBe(true);
    expect(figureTheUserWroteFor(4, '%', t, MRR)).toBe(false);
  });
});

describe('a figure the user wrote about THIS entity, or about nothing named, stays theirs', () => {
  it('CONTROL: "Test £54 vs £59." names no entity → both figures are the user\'s for the price', () => {
    const t = 'Test £54 vs £59.';
    expect(figureTheUserWroteFor(54, 'GBP per month', t, PRICE)).toBe(true);
    expect(figureTheUserWroteFor(59, 'GBP per month', t, PRICE)).toBe(true);
  });

  it('CONTROL: an option-level figure named by its OPTION ("the cohort test is £54 on Pro plan price") is the option\'s', () => {
    const t = 'The cohort test is £54 on Pro plan price.';
    expect(figureTheUserWroteFor(54, 'GBP per month', t, scopeOf('Pro plan price', 'Cohort test'))).toBe(true);
  });

  it('CONTROL: earlier typed words still count (userWordsOf), bound clause by clause', () => {
    const t = userWordsOf(['Our MRR is £12,000.'], 'Add an option at £57.');
    expect(figureTheUserWroteFor(57, 'GBP per month', t, PRICE)).toBe(true);
    expect(figureTheUserWroteFor(12000, 'GBP per month', t, PRICE)).toBe(false);
  });

  it('a word shared by the target\'s and another entity\'s labels ("monthly") decides nothing on its own', () => {
    // "monthly" is in both churn's and MRR's labels: the clause names neither decisively, and no OTHER word either.
    expect(figureTheUserWroteFor(4, '%', 'It is 4% monthly.', CHURN)).toBe(true);
    // …but a decisive word for the other entity (MRR) makes it MRR's, not churn's.
    expect(figureTheUserWroteFor(4, '%', 'Monthly MRR growth is 4%.', CHURN)).toBe(false);
  });

  it('the figure is about the entity BEFORE it when none follows it: "price from £49 to £59 to lift MRR" is the price\'s', () => {
    const t = 'Raise the Pro plan price from £49 to £59 to lift MRR';
    expect(figureTheUserWroteFor(59, 'GBP per month', t, PRICE)).toBe(true);
    expect(figureTheUserWroteFor(49, 'GBP per month', t, PRICE)).toBe(true);
    expect(figureTheUserWroteFor(59, 'GBP per month', t, MRR)).toBe(false);
  });

  it('unit rules are the old reading\'s: "£49" is never a percentage, "4%" never a price, no text proves nothing', () => {
    expect(figureTheUserWroteFor(49, '%', 'Keep the price at £49.', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(4, 'GBP per month', 'Price rises 4%.', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(49, 'GBP per month', '', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(49, 'GBP per month', undefined, PRICE)).toBe(false);
  });
});
