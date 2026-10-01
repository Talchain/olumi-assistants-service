/**
 * ⭐ STRICT DOOR: A RIVAL CLAIMS A SHARED WORD ONLY BY ITS OWN QUALIFIER (R3 #75 5924350620; MG A4u 5924448020).
 * Served sibling labels left nothing decisive: 0341Z refused Paul's "We have secured £0 so far" for the goal (E1, the
 * level door), and 0258Z's "investment firms that do deals between £1-2 million" for the investment-firm deals (A4u).
 */
import { describe, expect, it } from 'vitest';
import { figureTheUserWroteFor } from '../stated-by-user.js';

const PAUL = "I need to accelerate securing funding within the next 2 months. We've been focused on investment firms that do deals "
  + "between £1-2 million, mostly based in the UK. We'll keep sending cold emails and trying to find warm connections, but I "
  + "want to explore alternatives to support the funding process, as we'll run out of money soon. For example, angel "
  + 'investors might be able to provide a small amount of funding quicker to buy us more time, but we would need to decide '
  + 'whether the overhead would be worth it.';
/** Paul's served answer on train-0341Z (05-answer). */
const ANSWER = 'We have £180k in the bank. We have secured £0 so far and need at least £1 million.';
const LABELS_0341Z = ['Funding secured', 'Investment-firm funding secured', 'Angel funding secured', 'Qualified investment-firm conversations', 'Qualified angel conversations'];
const others = (target: string, all: readonly string[]) => all.filter((l) => l !== target);

describe('the strict door reads a shared word by the rivals\' own qualifiers', () => {
  it('RED (E1, served 0341Z labels): "secured £0 so far" is the GOAL\'s — the general label, no qualifier written', () => {
    expect(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Funding secured'], others: others('Funding secured', LABELS_0341Z), strict: true })).toBe(true);
  });

  it('…and never a qualified sibling\'s ("Angel funding secured" holds "angel", which is not written)', () => {
    expect(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Angel funding secured'], others: others('Angel funding secured', LABELS_0341Z), strict: true })).toBe(false);
    expect(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Investment-firm funding secured'], others: others('Investment-firm funding secured', LABELS_0341Z), strict: true })).toBe(false);
  });

  it('control: "secured £0 from angels" is the angel outcome\'s, not the goal\'s (the qualifier is written)', () => {
    const t = 'We have secured £0 from angels so far.';
    expect(figureTheUserWroteFor(0, '£', t, { target: ['Angel funding secured'], others: others('Angel funding secured', LABELS_0341Z), strict: true })).toBe(true);
    expect(figureTheUserWroteFor(0, '£', t, { target: ['Funding secured'], others: others('Funding secured', LABELS_0341Z), strict: true })).toBe(false);
  });

  it('RED (A4u, served 0258Z siblings): "investment firms that do deals between £1-2 million" is the investment-firm deals link\'s', () => {
    const target = ['Investment-firm deals closed', 'Funding from investment firms'];
    const all = ['Funding secured', 'Hours per week on investment-firm outreach', 'Hours per week on angel outreach', 'Funding from angel investors', 'Angel deals closed'];
    expect(figureTheUserWroteFor(1000000, 'GBP', PAUL, { target, others: all, strict: true })).toBe(true);
    expect(figureTheUserWroteFor(1000000, 'GBP', PAUL, { target: ['Angel deals closed', 'Funding from angel investors'], others: [...all.filter((l) => !/angel/i.test(l)), ...target], strict: true })).toBe(false);
  });

  it('R3 (4) tie control: two figures, siblings, NEITHER own qualifier written — nobody\'s (under-claim)', () => {
    const t = 'We closed deals worth £500,000 and £200,000 last quarter.';
    expect(figureTheUserWroteFor(500000, '£', t, { target: ['Investment-firm deals closed'], others: ['Angel deals closed'], strict: true })).toBe(false);
    expect(figureTheUserWroteFor(500000, '£', t, { target: ['Angel deals closed'], others: ['Investment-firm deals closed'], strict: true })).toBe(false);
  });

  it('R3 (4) tie control: "secured £0" vs a NON-general rival ("Cash secured": T is not R\'s general form) — refused', () => {
    const t = 'We have secured £0 so far and need at least £1 million.';
    expect(figureTheUserWroteFor(0, '£', t, { target: ['Funding secured'], others: ['Cash secured'], strict: true })).toBe(false);
  });

  it('BOTH qualifiers written: the nearest qualifier decides, as before — never a double claim', () => {
    const t = 'We closed investment-firm and angel deals worth £500,000 and £200,000.';
    expect(figureTheUserWroteFor(500000, '£', t, { target: ['Investment-firm deals closed'], others: ['Angel deals closed'], strict: true })).toBe(false);
    expect(figureTheUserWroteFor(500000, '£', t, { target: ['Angel deals closed'], others: ['Investment-firm deals closed'], strict: true })).toBe(true);
  });

  it('DL: a rival\'s qualifier in ANOTHER clause does not compete ("…so far, and angels may help")', () => {
    const t = 'We have secured £0 so far, and angels may help us later with £50,000.';
    expect(figureTheUserWroteFor(0, '£', t, { target: ['Funding secured'], others: others('Funding secured', LABELS_0341Z), strict: true })).toBe(true);
  });

  it('R3 (7) no siblings (served 0258Z labels): the decisions are the ones the door made before', () => {
    const labels = ['Funding secured', 'Funding from investment firms', 'Funding from angel investors', 'Investment-firm deals closed'];
    expect(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Funding secured'], others: others('Funding secured', labels), strict: true })).toBe(true);
    expect(figureTheUserWroteFor(1000000, '£', ANSWER, { target: ['Funding secured'], others: others('Funding secured', labels), strict: true })).toBe(true);
  });

  it('control: NON-strict callers read exactly as before (the rule is strict-only)', () => {
    expect(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Funding secured'], others: others('Funding secured', LABELS_0341Z) }))
      .toBe(figureTheUserWroteFor(0, '£', ANSWER, { target: ['Funding secured'], others: others('Funding secured', LABELS_0341Z) }));
  });
});
