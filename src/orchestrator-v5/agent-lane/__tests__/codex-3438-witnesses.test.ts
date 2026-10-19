/**
 * ⛔ EVERY CODEX WITNESS ON #3438, R1–R6, AGAINST THIS HEAD (DL-3 on the Codex DL audit: close the shared quantity contract in one
 * round). Each row is the probe the round ran (outbox/CODEX-REVIEW-3438-R*-report.md; probes banked in
 * reviews/CODEX-3438-probes/), with the verdict that round demanded: a parity row equals staging's verdict, a negative is never
 * credited at any consumer, a positive is credited. Then the tolerance class, generated, at the one check, the binder, the verifier's
 * figure list, the verifier and its speaker check. SYNTHETIC wording, as the probes were.
 */
import { describe, expect, it } from 'vitest';
import { amountsWrittenIn, ceilingTheUserWroteFor, figureTheUserWrote, figureTheUserWroteFor, figureTheUserWroteSpan, linkEffectTheUserStated, quoteOfFigure,
  timesTheUserWrote, withdrawUnstatedBaselineStamps } from '../stated-by-user.js';
import { figureIsThisQuantitys } from '../quantity-identity.js';
import { figuresWritten, userStated } from '../user-statements.js';

const human = (quote: string, value: number, unit: string, quantity = 'Night shift load'): boolean =>
  userStated({ quote, form: 'point', value, unit }, { now: quote }, { quantity }).origin === 'human';
const listed = (quote: string, value: number, unit?: string): boolean => figuresWritten(quote, unit).some((f) => f.low === value && f.high === value);
/** The R6 speaker probe: the same words, then another speaker's quotation of the figure. */
const masked = (quote: string, value: number, unit: string): string => `${quote.replace(/\.$/, '')}, as our manager said: “${value} ${unit}”.`;
const LOAD = { target: ['Night shift load'], others: [] as string[] };

/** Every credit consumer R6 probed, for one figure. */
function credits(quote: string, value: number, unit: string): string[] {
  return [
    figureTheUserWrote(value, unit, quote) ? 'one check' : '',
    figureTheUserWroteSpan(value, unit, quote) !== null ? 'span' : '',
    timesTheUserWrote(value, unit, quote) > 0 ? 'times' : '',
    figureTheUserWroteFor(value, unit, quote, LOAD) ? 'binder' : '',
    figureIsThisQuantitys(quote, value, unit, LOAD, []).verdict === 'this' ? 'identity' : '',
    listed(quote, value, unit) ? 'figure list' : '',
    human(quote, value, unit) ? 'verifier' : '',
    human(masked(quote, value, unit), value, unit) ? 'speaker check' : '',
  ].filter((c) => c !== '');
}

describe('R1–R2: aliases, word parity, fractions and the retired scans (74 checks; staging 63d59bff verdicts)', () => {
  it('74 checks hold', () => {
    let checks = 0;
    const scope = { target: ['Night shift hours'], others: ['Day shift hours'] };
    const ALIAS: [string, string][] = [['hours per week', '45 hrs per week'], ['hours per week', '45 hours per wk'], ['minutes per day', '45 mins'],
      ['minutes per day', '45 mins per day'], ['£k', '£45k'], ['£k', '£45 thousand'], ['£k', '£45,000']];
    for (const [unit, words] of ALIAS) for (const prefix of ['Night shift is ', 'It is ']) {
      for (const [mode, s] of [['scope', scope], ['strict', { ...scope, strict: true as const }], ['named', { ...scope, requireNamed: true as const }]] as const) {
        // Staging binds every one, except an unnamed sentence where the door requires the quantity to be named.
        expect(figureTheUserWroteFor(45, unit, `${prefix}${words}.`, s), `${prefix}${words} ${mode}`).toBe(!(prefix === 'It is ' && mode === 'named'));
        checks += 1;
      }
    }
    for (const words of ['forty-five hours per week', 'forty-five hrs per week', 'forty-five mins per day']) for (const prefix of ['Night shift is ', 'It is ']) {
      const unit = words.includes('mins') ? 'minutes per day' : 'hours per week';
      const t = `${prefix}${words}.`;
      expect(figureTheUserWroteFor(45, unit, t, scope), t).toBe(figureTheUserWroteFor(45, unit, t.replace('forty-five', '45'), scope));
      checks += 1;
    }
    // The three fraction readings R2 asked for are refused by the DL-3 fail-safe ruling (R4: "3 authorised fraction refusals").
    for (const text of ['We have half a million pounds available.', 'It takes two and a half hours per week.', 'Two thirds of orders are late.']) {
      expect(amountsWrittenIn(text).filter((a) => a.kind === 'words'), text).toEqual([]);
      checks += 1;
    }
    for (const [words, n] of [['two and a half', 2.5], ['a quarter of a million', 250000], ['half a million', 500000], ['two thirds', 2 / 3]] as const) {
      for (const text of [`It is ${words} nurses.`, `Our lead said: "It is ${words} hours per week".`, `Our lead said: '${words} hours per week'.`, `Day shift is ${words} hours per week.`]) {
        expect(figureTheUserWroteFor(n, 'hours per week', text, scope), text).toBe(false);
        checks += 1;
      }
    }
    const SCANS: [string, { low: number; high: number }[]][] = [
      ['We resolve 45 tickets per week.', [{ low: 45, high: 45 }]], ['We lose 45 tickets.', [{ low: 45, high: 45 }]],
      ['Our lead said: "45 tickets per week".', [{ low: 45, high: 45 }]], ["Our lead said: '45 tickets per week'.", [{ low: 45, high: 45 }]],
      ['It ranges between £45k and £90k.', [{ low: 45000, high: 45000 }, { low: 90000, high: 90000 }, { low: 45000, high: 90000 }]],
      ['We have 12.5% churn.', [{ low: 12.5, high: 12.5 }]],
      ['Revenue was £2m on 2026-09-01, and the deadline is 45 days.', [{ low: 2000000, high: 2000000 }, { low: 2026, high: 2026 }, { low: 9, high: 9 }, { low: 1, high: 1 }, { low: 45, high: 45 }]],
    ];
    for (const [q, want] of SCANS) { expect(figuresWritten(q), q).toEqual(want); checks += 1; }
    expect(checks).toBe(74);
  });
});

describe('R2–R4: compounds, prefixes and continuations are never credited in part', () => {
  it('R2: the prefix of a compound (2) and the ordinal (1) are not the user\'s', () => {
    expect(human('We resolve a hundred and twenty tickets per week.', 100, 'tickets per week', 'weekly_tickets')).toBe(false);
    expect(human('We resolve half a million and fifty thousand tickets per week.', 500000, 'tickets per week', 'weekly_tickets')).toBe(false);
    expect(human('The a hundred and first ticket arrived.', 100, 'tickets per week', 'weekly_tickets')).toBe(false);
  });
  it('R3: 10 compounds credit no incomplete value', () => {
    const CASES: [string, number[]][] = [['two hundred and five', [205]], ['a thousand and one', [1001]], ['one and a half thousand', [1500]], ['a dozen and a half', [18]],
      ['a hundred and twenty-five', [125]], ['half a million and fifty thousand', [550000]], ['three and a quarter million', [3250000]],
      ['a hundred and twenty tickets and thirty bugs', [120, 30]], ['a hundred and twenty', [120]], ['half a million and fifty thousand', [550000]]];
    for (const [phrase, whole] of CASES) {
      const quote = `We process ${phrase} tickets per week.`;
      const values = [...new Set([...amountsWrittenIn(quote).map((a) => a.magnitude), ...whole, 100, 20, 500000, 50000, 1, 3, 0.5])];
      const incomplete = values.filter((v) => human(quote, v, 'tickets per week', 'weekly_tickets') && !whole.includes(v));
      expect(incomplete, phrase).toEqual([]);
    }
  });
  it('R3: 4 negatives are never the user\'s', () => {
    for (const [quote, value, unit] of [['It takes a hundred and twenty and a half hours per week.', 120, 'hours per week'], ['The two and a half millionth ticket arrived.', 2.5, 'tickets'],
      ['Our a hundred and first ticket arrived.', 100, 'tickets'], ['We resolve half a million and a quarter tickets per week.', 500000, 'tickets per week']] as const) {
      expect(human(quote, value, unit, 'q'), quote).toBe(false);
    }
  });
  it('R4: "plus five", ", and a quarter" and "-and-a-half" credit neither 120, 5 nor 125', () => {
    for (const quote of ['It takes a hundred and twenty plus five hours.', 'It takes a hundred and twenty, and a quarter hours.', 'It takes a hundred and twenty-and-a-half hours.']) {
      for (const v of [120, 5, 125]) expect(credits(quote, v, 'hours'), `${quote} ${v}`).toEqual([]);
    }
  });
});

describe('R5–R6: every consumer, the speaker check and the positives', () => {
  const NEGATIVES: [string, number, string][] = [
    ['Night shift load is a hundred and twenty tickets.', 100, 'tickets'],
    ['Night shift load is half a million and fifty thousand hours.', 500000, 'hours'],
    ['Night shift load is a hundred and twenty and a half hours.', 120, 'hours'],
    ['Night shift load is the two and a half millionth ticket.', 2.5, 'tickets'],
    ['Night shift load is a hundred and twenty plus five hours.', 120, 'hours'],
    ['Night shift load is a hundred and twenty  , and a quarter hours.', 120, 'hours'],
    ['Night shift load is a hundred and twenty-and-a-half hours.', 120, 'hours'],
    ['Night shift load is a hundred and twenty-odd hours.', 120, 'hours'],
    ['Night shift load is a hundred and twenty give or take five hours.', 120, 'hours'],
    ['Night shift load is a hundred and twenty give or take five hours.', 5, 'hours'],
    ['Night shift load is a hundred and twenty give or take five engineers.', 120, 'engineers'],
    ['Night shift load is a hundred and twenty give or take five engineers.', 5, 'engineers'],
  ];
  it.each(NEGATIVES)('NEGATIVE "%s" credits %d at no consumer', (quote, value, unit) => {
    expect(credits(quote, value, unit)).toEqual([]);
  });
  it.each([
    ['It is forty-five hours per week.', 45, 'hours per week'],
    ['We have seventy support tickets.', 70, 'tickets'],
    ['We charge £59.', 59, 'GBP'],
  ])('POSITIVE "%s" is credited at every consumer', (quote, value, unit) => {
    expect(credits(quote, value, unit)).toEqual(['one check', 'span', 'times', 'binder', 'identity', 'figure list', 'verifier', 'speaker check']);
  });
  it('R1: "Night shift load is 45 hrs per week" binds, as on staging', () => {
    expect(credits('Night shift load is 45 hrs per week.', 45, 'hours per week')).toEqual(expect.arrayContaining(['one check', 'binder', 'figure list', 'speaker check']));
  });
});

/**
 * ⛔ THE TOLERANCE CLASS, generated (DL-3 class rule on Codex R6): value × tolerance shape × form × unit. Neither the value nor the
 * tolerance is credited at any consumer. A deadline after a value ("resolve 120 tickets within 5 hours") is no tolerance and keeps
 * its figure; "within" reads as a tolerance only joined to the value it bounds ("within 5 of 120 hours").
 */
describe('the tolerance class: neither the value nor its tolerance is a standalone figure', () => {
  const VALUES: [string, number][] = [['twenty', 20], ['20', 20], ['a hundred and twenty', 120], ['120', 120]];
  const TOLERANCES: [string, number][] = [['five', 5], ['5', 5]];
  const SHAPES = [(v: string, t: string) => `${v} give or take ${t}`, (v: string, t: string) => `${v}, give or take ${t}`,
    (v: string, t: string) => `${v} (give or take ${t})`,
    (v: string, t: string) => `${v} give or take about ${t}`, (v: string, t: string) => `${v} or so ${t}`,
    (v: string, t: string) => `${v} plus or minus ${t}`, (v: string, t: string) => `${v} ± ${t}`, (v: string, t: string) => `${v} +/- ${t}`,
    (v: string, t: string) => `within ${t} of ${v}`];
  const UNITS: [string, string][] = [['hours', 'hours'], ['hours per week', 'hours'], ['engineers', 'engineers'], ['people', 'engineers']];
  it('generated: no consumer credits either figure', () => {
    let rows = 0;
    for (const [v, value] of VALUES) for (const [t, tol] of TOLERANCES) for (const shape of SHAPES) for (const [unit, noun] of UNITS) {
      const quote = `Night shift load is ${shape(v, t)} ${noun} this week.`;
      for (const n of [value, tol]) expect(credits(quote, n, unit), `${n} ${unit} | ${quote}`).toEqual([]);
      rows += 1;
    }
    expect(rows).toBe(VALUES.length * TOLERANCES.length * SHAPES.length * UNITS.length);
  });
  it('"ten 5-hour shifts": the count and the length are one expression', () => {
    expect(credits('Night shift load is ten 5-hour shifts.', 5, 'hours')).toEqual([]);
    expect(credits('Night shift load is ten 5-hour shifts.', 10, 'shifts')).toEqual([]);
  });
  it.each([
    ['a deadline after a value', 'We resolve 120 tickets within 5 hours.', 5, 'hours'],
    ['the value of a deadline sentence', 'We resolve 120 tickets within 5 hours.', 120, 'tickets'],
    ['a length with no count before it', 'Night shifts are 5-hour shifts.', 5, 'hours'],
    ['a range in digits keeps its own grammar', 'Night shifts take between 20 and 30 hours.', 30, 'hours'],
    ['the first amount names a unit word', 'Hire two engineers or maybe five analysts.', 2, 'engineers'],
    ['two statements joined by "and" (the capacity brief)', 'Hire a specialist to take support capacity to 3 specialists and resolve 100 tickets per week.', 100, 'tickets per week'],
    ['the first of them', 'Hire a specialist to take support capacity to 3 specialists and resolve 100 tickets per week.', 3, 'specialists'],
    ['two options joined by "or"', 'Hire 2 seniors or recruit 4 juniors.', 4, 'juniors'],
    ['a lead hedge on the next figure is no tolerance', 'In 2024, around 400 customers renewed.', 400, 'customers'],
    ['a line break separates two statements', 'Night shift load is 20\n5 hours of overtime are normal.', 5, 'hours'],
  ])('CONTROL %s: "%s" credits %d', (_case, quote, value, unit) => {
    expect(credits(quote, value, unit)).toContain('one check');
  });
});


/**
 * ⛔ A RANGE'S END IS NEVER CREDITED ALONE (DL-3, from C5's generated property on a trial merge with #3445: "two to three users"
 * credited 3, because "three users" is a complete span). On #3438 a range with an end in words gives nothing; the range class
 * (#3445) reads it as its two ends. Generated: end forms × connectors; the property is C5's (two true ends or nothing, at the
 * figure list's points and at the one check), without the scales, which are #3445's.
 */
describe("C5's range property: two true ends or nothing, never one end alone", () => {
  const ENDS = { digits: ['2', '3'], words: ['two', 'three'] } as const;
  const JOINS = [(a: string, b: string) => `${a} to ${b}`, (a: string, b: string) => `${a} or ${b}`, (a: string, b: string) => `${a} \u2013 ${b}`,
    (a: string, b: string) => `between ${a} and ${b}`];
  const bothOrNothing = (got: readonly number[]): boolean => got.length === 0 || [...got].sort((x, y) => x - y).join() === '2,3';
  it('the witness: "two to three users" credits nothing at any consumer; "three users" alone credits 3', () => {
    for (const v of [2, 3]) expect(credits('We expect two to three users.', v, 'users'), String(v)).toEqual([]);
    expect(credits('We expect three users.', 3, 'users')).toEqual(['one check', 'span', 'times', 'binder', 'identity', 'figure list', 'verifier', 'speaker check']);
  });
  it('generated: every form and connector gives both ends or nothing', () => {
    let rows = 0;
    for (const low of ['digits', 'words'] as const) for (const high of ['digits', 'words'] as const) for (const join of JOINS) {
      // "between two and three" reads as one sum in the base grammar: #3445's (Codex R3 on #3438, non-blocking), not this property.
      if (low === 'words' && high === 'words' && join('a', 'b').startsWith('between')) continue;
      const text = `We expect ${join(ENDS[low][0], ENDS[high][1])} users.`;
      const points = [...new Set(figuresWritten(text, 'users').filter((f) => f.low === f.high).map((f) => f.low))];
      expect(bothOrNothing(points), `${text} ${JSON.stringify(points)}`).toBe(true);
      expect(bothOrNothing([2, 3].filter((v) => figureTheUserWrote(v, 'users', text))), `${text} one check`).toBe(true);
      rows += 1;
    }
    expect(rows).toBe(2 * 2 * JOINS.length - 1);
  });
  // C5 on 577c89c7: the low end's own scale word ("2 thousand") was read as a number word joined to the high end, so the high end was
  // refused and 2000 stood alone. Both true ends, or nothing.
  it.each(['We expect 2 thousand \u2013 3 thousand users.', 'We expect between 2 thousand and 3 thousand users.', 'We expect 2 thousand to 3 thousand users.'])(
    'C5 witness "%s": both ends at their scale, or nothing', (text) => {
      const both = (got: readonly number[]): boolean => got.length === 0 || [...got].sort((x, y) => x - y).join() === '2000,3000';
      const points = [...new Set(figuresWritten(text, 'users').filter((f) => f.low === f.high).map((f) => f.low))];
      expect(both(points), JSON.stringify(points)).toBe(true);
      expect(both([2000, 3000].filter((v) => figureTheUserWrote(v, 'users', text))), 'one check').toBe(true);
    });
});

/**
 * ⛔ EVERY CREDIT READER OF THE ONE MODULE READS THE SAME ELIGIBILITY (Codex #3438 R7: the add-factor quote read a raw match).
 * The quoted sentence, a brief's baseline, a ceiling and a link's stated size credit only a standalone, complete amount; the
 * same text with the figure written alone is credited. (The add-factor door's real path is agent-add-factor-door-seam.)
 */
describe('every credit reader: the quote, the baseline, the ceiling and the link size', () => {
  it('the quote for a figure to confirm: never a tolerance, an operand or a range end; the figure alone is quoted', () => {
    for (const [text, value, unit] of [['Night shift load is 20 ± 5 hours.', 5, 'hours'], ['Night shift load is a hundred and twenty give or take five hours.', 120, 'hours'],
      ['Night shift load is two to three users.', 3, 'users']] as const) expect(quoteOfFigure(value, unit, text), text).toBeNull();
    expect(quoteOfFigure(5, 'hours', 'Night shift load is 5 hours.')).toBe('Night shift load is 5 hours.');
  });
  const stamped = (brief: string, raw: number) => withdrawUnstatedBaselineStamps([{ kind: 'factor', label: 'Night shift engineers',
    observed_state: { source: 'brief_extraction', raw_value: raw, value: raw, unit: 'engineers' } }], brief)[0]!.observed_state as { source: string };
  it.each([
    ['digits', 'We run 20 ± 5 night shift engineers.', 5],
    ['words', 'We run twenty give or take five night shift engineers.', 5],
  ])('a brief\'s baseline in %s: a tolerance is Olumi\'s, never the user\'s', (_form, brief, raw) => {
    expect(stamped(brief, raw).source).toBe('cee_inference');
  });
  it('CONTROL a baseline written alone stays the user\'s', () => {
    expect(stamped('We run 5 night shift engineers.', 5).source).toBe('brief_extraction');
  });
  it('a ceiling: an operand of a joined expression is no ceiling; the figure alone is', () => {
    expect(ceilingTheUserWroteFor(20, 'hours', 'Keep night shift load to at most 20 plus or minus 5 hours.')).toBe(false);
    expect(ceilingTheUserWroteFor(20, 'hours', 'Keep night shift load to at most 20 hours.')).toBe(true);
  });
  it('a link\'s stated size: a tolerance is never the size; the size alone is', () => {
    const scope = { quantities: ['Additional specialists', 'Resolved tickets'], link_selected: false, target_units: ['tickets per week'],
      target_unitless: false, source_unitless: false } as never;
    const ends = { source: 'Additional specialists', target: 'Resolved tickets' };
    const size = (amount: number) => ({ amount, amount_unit: 'tickets per week', per_source_change: 1, per_source_change_unit: 'specialists' });
    expect(linkEffectTheUserStated('Each additional specialist resolves 20 ± 5 tickets per week.', size(5), ends, scope)).not.toBeNull();
    expect(linkEffectTheUserStated('Each additional specialist resolves 20 tickets per week.', size(20), ends, scope)).toBeNull();
  });
});
