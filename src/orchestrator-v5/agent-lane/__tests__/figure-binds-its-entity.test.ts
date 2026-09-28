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

  it('RED (R&C #2013 B1, Paul\'s served brief + labels): "£49 to £59 per month" — the unit\'s own word names no entity', () => {
    // The brief as sent (#69 5837135232) and the served draft_graph's labels on CEE 10fbbdf; the option is "£59 AI feature launch".
    const served = ['MRR', 'Pro plan price', 'AI feature rollout coverage', 'AI feature perceived value', 'Monthly churn', 'Price resistance', 'Paying Pro subscribers'];
    const scope = (...target: string[]) => ({ target, others: served.filter((l) => !target.includes(l)) });
    const t = 'Should we increase the Pro plan price from £49 to £59 per month with the next AI feature release?';
    expect(figureTheUserWroteFor(59, 'GBP/month', t, scope('Pro plan price', '£59 AI feature launch')), 'the option level Paul typed').toBe(true);
    expect(figureTheUserWroteFor(49, 'GBP/month', t, scope('Pro plan price'))).toBe(true);
    // CONTRASTS stay false: £59 is not churn's (served unit percentage), and £20k is MRR's, not the price's.
    expect(figureTheUserWroteFor(59, 'percentage', t, scope('Monthly churn'))).toBe(false);
    expect(figureTheUserWroteFor(20000, 'GBP/month', 'Our MRR is £20,000.', scope('Pro plan price'))).toBe(false);
  });

  it('CONTROL (R&C #2013 note): "the price" without "plan" still binds, by rule 4, when the clause names no other label word', () => {
    const served = ['MRR', 'Pro plan price', 'AI feature rollout coverage', 'AI feature perceived value', 'Monthly churn', 'Price resistance', 'Paying Pro subscribers'];
    const scope = { target: ['Pro plan price', '£59 AI feature launch'], others: served.filter((l) => l !== 'Pro plan price') };
    expect(figureTheUserWroteFor(59, 'GBP/month', 'Raise the price to £59 per month.', scope)).toBe(true);
  });

  it('unit rules are the old reading\'s: "£49" is never a percentage, "4%" never a price, no text proves nothing', () => {
    expect(figureTheUserWroteFor(49, '%', 'Keep the price at £49.', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(4, 'GBP per month', 'Price rises 4%.', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(49, 'GBP per month', '', PRICE)).toBe(false);
    expect(figureTheUserWroteFor(49, 'GBP per month', undefined, PRICE)).toBe(false);
  });
});

describe('PJ-E-FIG (DL CHANGES_REQUIRED on #2235): a word the target shares only with quantities that cannot hold the figure is the target\'s', () => {
  // Journey E's served quantities (journey-e-e07-draft-graph.json) plus the other new factor in the same call.
  const E07 = ['ship the new platform', 'New senior engineers hired', 'New junior engineers hired', 'Annual salary spend',
    'Senior hiring lead-time risk', 'Junior ramp-up risk', 'Budget cap breach risk', 'Incremental platform delivery…'];
  /** RIVALS: the others a £ figure could be — not the headcounts (engineers) and not the risks (likelihoods). */
  const COULD_HOLD_MONEY = ['ship the new platform', 'Annual salary spend', 'Incremental platform delivery…'];
  const scope = (target: string, sibling: string, rivals: boolean) => ({
    target: [target],
    others: [...E07, sibling],
    // The door passes its rivals AND the strict reading (`newFactorScopeIn`).
    ...(rivals ? { rivals: [...COULD_HOLD_MONEY, sibling], strict: true as const } : {}),
  });
  const UNIT = 'GBP/year per engineer';
  const SAID = 'Senior engineers cost £120k a year each and juniors £65k a year each.';

  it('RED: with rivals the user\'s OWN pairing binds (without them "senior" is shared with the headcount and the risk, and £120k was refused)', () => {
    expect(figureTheUserWroteFor(120000, UNIT, SAID, scope('Senior engineer salary', 'Junior engineer salary', false)), 'the defect').toBe(false);
    expect(figureTheUserWroteFor(120000, UNIT, SAID, scope('Senior engineer salary', 'Junior engineer salary', true))).toBe(true);
    expect(figureTheUserWroteFor(65000, UNIT, SAID, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(true);
  });

  it('CONTRAST: the swap and the limit stay refused with rivals — a word only a non-rival has still marks the figure as another\'s', () => {
    expect(figureTheUserWroteFor(65000, UNIT, SAID, scope('Senior engineer salary', 'Junior engineer salary', true))).toBe(false);
    expect(figureTheUserWroteFor(120000, UNIT, SAID, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(false);
    const budget = `${SAID.slice(0, -1)}, and our salary budget is £400k.`;
    expect(figureTheUserWroteFor(400000, UNIT, budget, scope('Senior engineer salary', 'Junior engineer salary', true)), '"budget" is the budget risk\'s word').toBe(false);
  });

  it('RED: an "and" straight after a figure starts the next item — "Seniors are £120k a year and juniors…" never reads £120k as the juniors\'', () => {
    const t = 'Seniors are £120k a year and juniors £65k a year.';
    expect(figureTheUserWroteFor(120000, UNIT, t, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(false);
    expect(figureTheUserWroteFor(120000, UNIT, t, scope('Senior engineer salary', 'Junior engineer salary', true))).toBe(true);
    expect(figureTheUserWroteFor(65000, UNIT, t, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(true);
    // CONTROL: a label word before the "and" still binds ("1 developer and 0 tech leads").
    const hiring = { target: ['Developers hired'], others: ['Tech leads hired'] };
    expect(figureTheUserWroteFor(1, 'hires', 'Backfill 1 developer and 0 tech leads.', hiring)).toBe(true);
    expect(figureTheUserWroteFor(0, 'hires', 'Backfill 1 developer and 0 tech leads.', hiring)).toBe(false);
    // Straight after the figure: no rate words in between, so only the conjunction rule keeps "juniors" off £120k.
    const bare = 'Seniors are £120k and juniors £65k.';
    expect(figureTheUserWroteFor(120000, UNIT, bare, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(false);
    expect(figureTheUserWroteFor(120000, UNIT, bare, scope('Senior engineer salary', 'Junior engineer salary', true))).toBe(true);
    expect(figureTheUserWroteFor(65000, UNIT, bare, scope('Junior engineer salary', 'Senior engineer salary', true))).toBe(true);
  });
});

/**
 * ⛔ DL RE-REVIEW OF #2235 (13:07Z 28 Sep), BLOCKING: journey E's OWN typed clarification — served with `source: composer`
 * in pj-20260927T162124Z E04 and pj-20260927T181846Z E06 — let the SWAP through the add-factor door and refused the
 * correct pairing. Three causes in the shared reading: "per senior" was read as a denominator and dropped the figure's
 * owner; £65,000 took the previous item's "senior" across the "and"; and £120,000, with no label word left, fell through
 * to "the user's, for any target". THE RULING: the door's reading is STRICT and opt-in (a); an unattributed figure among
 * two or more is refused, never credited (b); rivals decide only for an amount in the unit's own kind (F1).
 */
describe('DL #2235 re-review: the add-factor door\'s STRICT reading (opt-in; every other door reads as before)', () => {
  const E07 = ['ship the new platform', 'New senior engineers hired', 'New junior engineers hired', 'Annual salary spend',
    'Senior hiring lead-time risk', 'Junior ramp-up risk', 'Budget cap breach risk', 'Incremental platform delivery…'];
  const COULD_HOLD_MONEY = ['ship the new platform', 'Annual salary spend', 'Incremental platform delivery…'];
  const door = (target: string) => {
    const sibling = target.startsWith('Senior') ? 'Junior engineer salary' : 'Senior engineer salary';
    return { target: [target], others: [...E07, sibling], rivals: [...COULD_HOLD_MONEY, sibling], strict: true as const };
  };
  const SENIOR = 'Senior engineer salary';
  const JUNIOR = 'Junior engineer salary';

  it.each([
    ['"£120,000 … £65,000" (the served words)', 'Record them as annual salaries: £120,000 per senior engineer and £65,000 per junior engineer.'],
    ['"£120k … £65k"', 'Record them as annual salaries: £120k per senior engineer and £65k per junior engineer.'],
  ] as const)('RED: E04 %s — the swap is refused and the correct pairing binds, in both units', (_what, said) => {
    for (const unit of ['GBP/year per engineer', 'GBP/year']) {
      expect(figureTheUserWroteFor(65000, unit, said, door(SENIOR)), `swap senior 65000 (${unit})`).toBe(false);
      expect(figureTheUserWroteFor(120000, unit, said, door(JUNIOR)), `swap junior 120000 (${unit})`).toBe(false);
      expect(figureTheUserWroteFor(120000, unit, said, door(SENIOR)), `pair senior 120000 (${unit})`).toBe(true);
      expect(figureTheUserWroteFor(65000, unit, said, door(JUNIOR)), `pair junior 65000 (${unit})`).toBe(true);
      expect(figureTheUserWroteFor(99000, unit, said, door(SENIOR)), 'a figure not written').toBe(false);
    }
  });

  it('RED (b) FAIL CLOSED: two figures no label word owns are refused for EVERY target — asked, never credited', () => {
    const said = 'Record them as annual salaries: £120,000 and £65,000.';
    for (const [value, target] of [[120000, SENIOR], [65000, SENIOR], [120000, JUNIOR], [65000, JUNIOR]] as const) {
      expect(figureTheUserWroteFor(value, 'GBP/year per engineer', said, door(target)), `${value} → ${target}`).toBe(false);
    }
    // CONTROL: ONE figure no label word owns is still the user's (rule 4) — there is nothing it could be swapped with.
    expect(figureTheUserWroteFor(120000, 'GBP/year per engineer', 'Record it as £120,000.', door(SENIOR))).toBe(true);
    // CONTROL (a): opt-in — without `strict` the same two figures fall through to the user's, as every other door reads them.
    const shared = { target: [SENIOR], others: [...E07, JUNIOR] };
    expect(figureTheUserWroteFor(120000, 'GBP/year per engineer', said, shared)).toBe(true);
  });

  it('RED (F1): a bare count is never taken as a salary through the rivals — "hire 2 senior engineers" is a headcount', () => {
    expect(figureTheUserWroteFor(2, 'GBP/year per engineer', 'We will hire 2 senior engineers.', door(SENIOR))).toBe(false);
    expect(figureTheUserWroteFor(2, 'GBP/year per engineer', 'Hire 2 senior engineers and 3 juniors; seniors cost £120k.', door(SENIOR))).toBe(false);
    expect(figureTheUserWroteFor(3, 'GBP/year per engineer', 'Hire 2 senior engineers and 3 juniors; seniors cost £120k.', door(JUNIOR))).toBe(false);
    // CONTRAST: the £ amount in the same message still binds through the rivals.
    expect(figureTheUserWroteFor(120000, 'GBP/year per engineer', 'Hire 2 senior engineers and 3 juniors; seniors cost £120k.', door(SENIOR))).toBe(true);
  });

  it('RED (a) OPT-IN: another door keeps its reading — a quoted option name "Keep £49 and add…" never gives £49 to a subscriber count', () => {
    // The DL's corpus Scope B regression (8 typed messages at 0efb03f6): the option-level door's scope, `scopeIn(g, factor, option)`.
    const said = 'For "Test £54 versus £59 by customer cohort before rollout": use £54 per month as its Pro plan price. '
      + 'For "Keep £49 and add a paid AI add-on": it sets AI add-on price to £10 per month.';
    const others = ['Pro plan price', 'Monthly churn', 'MRR', 'AI add-on price', 'AI feature availability'];
    expect(figureTheUserWroteFor(49, 'GBP', said, { target: ['Pro paying subscribers', 'Keep Pro at £49'], others })).toBe(false);
  });
});
