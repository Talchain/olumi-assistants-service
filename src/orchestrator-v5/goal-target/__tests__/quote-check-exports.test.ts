/**
 * The two quote checks T2A5 (#3002) built, exported alone so HIRING's relation and level checks reuse them: a pure
 * extraction, no caller changes. One row per rule, each with its contrast.
 */
import { describe, expect, it } from 'vitest';
import { namesBothEnds, wholeStatementIn } from '../input-claim-context.js';

const nodes = [{ id: 'price', label: 'Price' }, { id: 'mrr', label: 'MRR' }, { id: 'quality', label: 'Quality' }];

describe('wholeStatementIn: the quote is a WHOLE statement of the message', () => {
  it('a whole sentence, verbatim, is whole: alone, first, or after a full stop', () => {
    expect(wholeStatementIn('Price has a weak effect on MRR.', 'Price has a weak effect on MRR.')).toBe(true);
    expect(wholeStatementIn('Price has a weak effect on MRR. Quality is strong.', 'Price has a weak effect on MRR.')).toBe(true);
    expect(wholeStatementIn('Quality is strong. Price has a weak effect on MRR', 'Price has a weak effect on MRR')).toBe(true);
  });
  it('a fragment is not whole', () => {
    expect(wholeStatementIn('Price has a weak effect on MRR, and our evidence is strong.', 'Price has a weak effect on MRR')).toBe(false);
  });
  it('a colon keeps its speaker: the words after "Alice says:" are not whole; the full sentence is', () => {
    const message = 'Alice says: Price has a weak effect on MRR.';
    expect(wholeStatementIn(message, 'Price has a weak effect on MRR.')).toBe(false);
    expect(wholeStatementIn(message, message)).toBe(true);
  });
  it('one spelling: typographic quotes and runs of space match their plain form', () => {
    expect(wholeStatementIn('Price’s effect on MRR is  weak.', "Price's effect on MRR is weak.")).toBe(true);
  });
  it('⭐ T1 HOST P07: a person’s words in DOUBLE marks, closed after the full stop, are whole with their speaker; a sentence after them is too', () => {
    const message = 'We fit kitchens. Sam, site lead: “Crews start early only if parts arrive the day before.” He assumes the van is free.';
    expect(wholeStatementIn(message, 'Sam, site lead: “Crews start early only if parts arrive the day before.”')).toBe(true);
    expect(wholeStatementIn(message.replace(/[“”]/g, '"'), 'Sam, site lead: "Crews start early only if parts arrive the day before."')).toBe(true);
    expect(wholeStatementIn(message, 'He assumes the van is free.')).toBe(true);
    const two = 'Sam, site lead: “Crews start early only if parts arrive the day before. A late van wastes the morning.” He agrees.';
    expect(wholeStatementIn(two, 'Sam, site lead: “Crews start early only if parts arrive the day before. A late van wastes the morning.”')).toBe(true);
  });
  it('⛔ DL-3 16:14Z: speech an attribution opens with a SINGLE mark cannot be bounded (a single mark is also an apostrophe): nothing from the attribution to the paragraph end is whole', () => {
    const message = "We fit kitchens. Sam, site lead: 'Crews start early only if parts arrive the day before.' He assumes the van is free.\nWe work weekends.";
    expect(wholeStatementIn(message, "Sam, site lead: 'Crews start early only if parts arrive the day before.'")).toBe(false);
    expect(wholeStatementIn(message, 'He assumes the van is free.')).toBe(false);
    // Before the attribution, and in the next paragraph, statements are whole as ever.
    expect(wholeStatementIn(message, 'We fit kitchens.')).toBe(true);
    expect(wholeStatementIn(message, 'We work weekends.')).toBe(true);
  });
  it('CONTRAST: the quoted words without their speaker, or a quoted fragment mid-sentence, are still not whole', () => {
    const message = "We fit kitchens. Sam, site lead: 'Crews start early only if parts arrive the day before.' He assumes the van is free.";
    expect(wholeStatementIn(message, 'Crews start early only if parts arrive the day before.')).toBe(false);
    expect(wholeStatementIn(message, "'Crews start early only if parts arrive the day before.'")).toBe(false);
    expect(wholeStatementIn("Sam said 'parts first' and left.", "Sam said 'parts first'")).toBe(false);
  });
  it('⭐ SWEEP (DL-3 14:28Z; #3363 B1; DL-3 16:14Z): mark kind × terminal inside or outside the close × speaker form × lexical apostrophes × position', () => {
    const TERMINALS = ['.', '!', '?', ';'];
    const DOUBLE: readonly (readonly [string, string])[] = [['"', '"'], ['“', '”'], ['«', '»']];
    const SINGLE: readonly (readonly [string, string])[] = [["'", "'"], ['‘', '’']];
    // Attribution with and without a space before the opening mark (BUDDY-A AMEND 7: "Sam:'…'").
    const SPEAKERS = ['Sam, site lead: ', 'Sam: ', 'Sam:', 'Sam said '];
    const wrong: string[] = [];
    const check = (message: string, quote: string, expected: boolean): void => {
      if (wholeStatementIn(message, quote) !== expected) wrong.push(`${expected ? 'not whole' : 'whole'}: «${quote}» in «${message}»`);
    };
    // A contraction and a plural possessive inside the speech (BUDDY-A AMEND 6 + R2 A).
    const first = "This is only true if the users' pilot works", second = "We don't start early unless parts arrive";
    for (const t of TERMINALS) for (const outside of [false, true]) {
      const end = (words: string, close: string): string => (outside ? `${words}${close}${t}` : `${words}${t}${close}`);
      // DOUBLE marks bound the speech: only all of it, with its speaker, is whole; the sentence after it is whole too.
      for (const [open, close] of DOUBLE) for (const who of SPEAKERS) {
        const whole = `${who}${open}${first}${t} ${end(second, close)}`;
        const message = `We fit kitchens. ${whole} He agrees.`;
        check(message, whole, true);
        check(message, 'He agrees.', true);
        check(message, end(second, close), false);
        check(message, `${second}${t}`, false);
        check(message, `${who}${open}${first}${t}`, false);
        check(message, `${first}${t}`, false);
        const three = `We fit kitchens. ${who}${open}${first}${t} ${second}${t} ${end('Parts come on Mondays', close)} He agrees.`;
        check(three, `${second}${t}`, false);
        check(three, 'He agrees.', true);
        // A closed fragment with no full stop of its own is never whole.
        check(`${who}${open}parts first${close} and left.`, `${who}${open}parts first${close}`, false);
      }
      // SINGLE marks after an attribution (with or without a colon: BUDDY-A R3 A): nothing from it to the paragraph end is whole;
      // before it, and the next paragraph, are.
      for (const [open, close] of SINGLE) for (const who of SPEAKERS) {
        const whole = `${who}${open}${first}${t} ${end(second, close)}`;
        const message = `We fit kitchens. ${whole} He agrees.\nWe work weekends.`;
        for (const quote of [whole, 'He agrees.', end(second, close), `${second}${t}`, `${who}${open}${first}${t}`, `${first}${t}`]) check(message, quote, false);
        check(message, 'We fit kitchens.', true);
        check(message, 'We work weekends.', true);
      }
    }
    // BUDDY-A R2 B: a lexical apostrophe ("'27", "'90s", "Priya's", "don't") is a letter; the statement after it stays whole.
    for (const t of TERMINALS) for (const lead of ["The plan starts in '27", "Prices peaked in the '90s", "We fit kitchens in Priya's area", "We don't fit bathrooms"]) {
      check(`${lead}${t} More referrals mean more contracts signed${t}`, `More referrals mean more contracts signed${t}`, true);
    }
    // Controls: a quoted term in double marks closes before the next sentence. A unit mark with nothing open is text (BUDDY-A R3 B),
    // and paired speech after it still binds.
    check('The "fast track" option is cheaper. It saves money.', 'It saves money.', true);
    check('We use a 12" rack. More referrals mean more contracts signed.', 'More referrals mean more contracts signed.', true);
    check('We use a 12" rack. More referrals mean more contracts signed.', 'We use a 12" rack.', true);
    const inch = 'We use a 12" rack. Sam: "Crews start early. Parts arrive on Mondays." He agrees.';
    check(inch, 'Parts arrive on Mondays.', false);
    check(inch, 'Sam: "Crews start early. Parts arrive on Mondays."', true);
    check(inch, 'He agrees.', true);
    // FAIL-SAFE COST (stated): a single mark that may open speech ("the 'fast track'", "'em") leaves the rest of its paragraph unverified.
    check("The 'fast track' option is cheaper. It saves money.", 'It saves money.', false);
    check("We told 'em early. Referrals help.", 'Referrals help.', false);
    expect(wrong).toEqual([]);
  });
  it('words the message never holds, and a non-string quote, are not whole', () => {
    expect(wholeStatementIn('Please size the links.', 'Price has a weak effect on MRR.')).toBe(false);
    expect(wholeStatementIn('Price has a weak effect on MRR.', undefined)).toBe(false);
    expect(wholeStatementIn('Price has a weak effect on MRR.', '')).toBe(false);
  });
});

describe('namesBothEnds: the text names both ends of the directed link', () => {
  it('both labels named → binds; the same text does not bind a link it names one end of', () => {
    expect(namesBothEnds('Price has a weak effect on MRR.', nodes, 'price', 'mrr')).toBe(true);
    expect(namesBothEnds('Price has a weak effect on MRR.', nodes, 'quality', 'mrr')).toBe(false);
  });
  it('one named end never binds', () => {
    expect(namesBothEnds('Price is weak.', nodes, 'price', 'mrr')).toBe(false);
  });
});
