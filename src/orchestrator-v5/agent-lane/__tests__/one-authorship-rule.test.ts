/**
 * ⭐⭐ LEAN CORE: THE ONE AUTHORSHIP RULE (DL-3 18 Oct 2026; outbox/LEAN-CORE-DESIGN.md). A value or statement is the user's only when the
 * AI cites a span that is literally the user's own typed words and the value, unit and sign read from that span. Anything else is
 * NOT the user's: unknown, and Olumi's only with positive evidence (PL-0048). These rows bind the five protected behaviours to the ONE
 * function every writer calls (`userStated`), with a contrast for each. Synthetic words only (never a pilot or journey brief).
 */
import { describe, expect, it } from 'vitest';
import { userStated, verifyStatement, figuresWritten } from '../user-statements.js';

const SUBJECT = { quantity: 'level', node_id: 'fac_1' };
const texts = (...messages: string[]) => ({ now: messages[messages.length - 1], conversation: messages.join('\n'), messages });

describe('the one rule: whose value it is', () => {
  it('1. a typed figure the AI quotes is the user\'s, with the span as quote and the whole line as source', () => {
    const v = userStated({ quote: 'about 40 orders a day', value: 40, unit: 'orders a day' },
      texts('Right now we ship about 40 orders a day from the one depot.'), SUBJECT);
    expect(v).toMatchObject({ origin: 'human', unitIsUsers: true,
      statement: { speaker: 'user', quote: 'about 40 orders a day', source: 'Right now we ship about 40 orders a day from the one depot.',
        form: 'point', low: 40, high: 40, unit: 'orders a day', reading: 'olumi' } });
  });

  it('2. an AI-only figure is never "you said": unknown source, and Olumi\'s only on positive evidence (never a host search of the user\'s text)', () => {
    const t = texts('Right now we ship about 40 orders a day from the one depot.');
    // The figure IS in the user's text, but the AI cited no span: the host does not go looking for it.
    expect(userStated({ value: 40, unit: 'orders a day' }, t, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'no_quote' });
    expect(userStated({ quote: 'about 40 orders a day', value: 45 }, t, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'figure_not_in_quote' });
    expect(userStated({ quote: 'about 45 orders a day', value: 45 }, t, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'statement_not_found' });
    // Olumi's ONLY where the writer declares its own estimate through the existing carrier (PL-0048 1).
    expect(userStated({ value: 45 }, t, SUBJECT, { ownEstimate: true })).toMatchObject({ origin: 'ai', refusal: 'no_quote' });
    // CONTRAST: the same quote and figure as row 1 is theirs.
    expect(userStated({ quote: 'about 40 orders a day', value: 40 }, t, SUBJECT).origin).toBe('human');
  });

  it('3. a quoted third party is not the user: words inside another speaker\'s quotation marks, or the user reporting Olumi\'s claim', () => {
    const quoted = texts('Our ops lead told me: “Returns will drop to 3% once the new labels ship.” I am less sure.');
    expect(userStated({ quote: 'Returns will drop to 3% once the new labels ship.', value: 3 }, quoted, SUBJECT).origin).toBe('unknown');
    const reported = texts('You suggested returns would drop to 3%. Is that right?');
    expect(userStated({ quote: 'returns would drop to 3%', value: 3 }, reported, SUBJECT).origin).toBe('unknown');
    // Quoting the report WITH its speaker does not make the speaker's figure the user's (#3389 probe P2)…
    const whole = 'Our ops lead told me: “Returns will drop to 3% once the new labels ship.”';
    expect(userStated({ quote: whole, value: 3 }, quoted, SUBJECT).origin).toBe('unknown');
    // …though the report itself, as words with no figure of the user's, is theirs to have typed, speaker kept in the quote.
    expect(userStated({ quote: whole, form: 'describes' }, quoted, SUBJECT)).toMatchObject({ origin: 'human', statement: { quote: whole } });
    // CONTRAST: the user's own figure in their own words.
    expect(userStated({ quote: 'returns are 5% today', value: 5 }, texts('I think returns are 5% today.'), SUBJECT).origin).toBe('human');
  });

  it('4. a typed range keeps both ends, and its unit only where the span writes it after the figure', () => {
    const t = texts('Each courier costs between £400 and £650 a week, depending on the route.');
    expect(userStated({ quote: 'between £400 and £650 a week', low: 400, high: 650, unit: '£' }, t, SUBJECT))
      .toMatchObject({ origin: 'human', unitIsUsers: true, statement: { form: 'range', low: 400, high: 650, unit: '£' } });
    // ⛔ A figure the span writes in ANOTHER unit is never the user's figure in the AI's unit (#3356 R1 B1: −4 kg from "4 and 6 lb").
    expect(userStated({ quote: 'between 4 and 6 lb a day', low: 4, high: 6, unit: 'kg a day' }, texts('Waste is between 4 and 6 lb a day.'), SUBJECT))
      .toMatchObject({ origin: 'unknown', refusal: 'figure_not_in_quote' });
    expect(userStated({ quote: 'between $400 and $650 a week', low: 400, high: 650, unit: '£' }, texts('Each courier costs between $400 and $650 a week.'), SUBJECT).origin).toBe('unknown');
    expect(userStated({ quote: 'Churn is 30% a month', value: 30, unit: 'people' }, texts('Churn is 30% a month.'), SUBJECT).origin).toBe('unknown');
    expect(userStated({ quote: 'funding of even £250,000', value: 250000, unit: 'customers' }, texts('If I could secure funding of even £250,000, I would hire.'), SUBJECT).origin).toBe('unknown');
    // CONTRAST: the same figures in the AI's unit are theirs, unit included…
    expect(userStated({ quote: 'between 4 and 6 kg a day', low: 4, high: 6, unit: 'kg a day' }, texts('Waste is between 4 and 6 kg a day.'), SUBJECT))
      .toMatchObject({ origin: 'human', unitIsUsers: true, statement: { low: 4, high: 6, unit: 'kg a day' } });
    // …and with NO unit written, the figures are theirs and the AI's unit stays Olumi's reading.
    const bare = userStated({ quote: 'between 4 and 6 a day', low: 4, high: 6, unit: 'kg a day' }, texts('Waste is between 4 and 6 a day.'), SUBJECT);
    expect(bare).toMatchObject({ origin: 'human', unitIsUsers: false, statement: { low: 4, high: 6 } });
    expect(bare.origin === 'human' && bare.statement.unit).toBeUndefined();
    // A money unit's own scale letter reads the written amount: "£54k" is 54 in £k.
    expect(userStated({ quote: 'a budget of £54k', value: 54, unit: '£k' }, texts('We have a budget of £54k this year.'), SUBJECT))
      .toMatchObject({ origin: 'human', unitIsUsers: true, statement: { low: 54, high: 54, unit: '£k' } });
  });

  it('5. a withdrawn guess is not re-credited; retained words of unknown origin stay unknown', () => {
    const guess = 'My guess is churn is 6% a month.';
    expect(userStated({ quote: guess, value: 6 }, texts(guess, 'I withdraw my earlier estimates, I really do not know.'), SUBJECT).origin).toBe('unknown');
    // CONTRAST: a later message that keeps them.
    expect(userStated({ quote: guess, value: 6 }, texts(guess, 'I do not withdraw my estimates.'), SUBJECT).origin).toBe('human');
    expect(userStated({ quote: guess, value: 6 }, { now: 'Fine.', conversation: 'Fine.', unverified: guess }, SUBJECT))
      .toMatchObject({ origin: 'unknown', refusal: 'origin_unknown' });
  });

  it('5b. a span the user\'s CORRECTION retired is not re-credited by a later literal match; a kept span and a later message still count', () => {
    const guess = 'Churn is roughly 5% a month.', fix = 'Ignore the 5% churn I gave, I have no real figure.';
    const corrected = { correction: fix, kept: [] };
    expect(userStated({ quote: guess, value: 5 }, texts(guess, fix, 'Thanks.'), SUBJECT, { current: corrected }).origin).toBe('unknown');
    // CONTRAST: with no correction on the subject, the same words are theirs.
    expect(userStated({ quote: guess, value: 5 }, texts(guess, 'Thanks.'), SUBJECT).origin).toBe('human');
    // CONTRAST: a NEW statement after the correction is theirs.
    const later = 'Actually churn is 4% a month now.';
    expect(userStated({ quote: later, value: 4 }, texts(guess, fix, later), SUBJECT, { current: corrected }).origin).toBe('human');
    // CONTRAST: a span the correction explicitly KEPT stays theirs.
    expect(userStated({ quote: guess, value: 5 }, texts(guess, fix, 'Thanks.'), SUBJECT, { current: { correction: fix, kept: [guess] } }).origin).toBe('human');
  });

  it('a span cut from inside a line never drops the bound the user wrote on its figure; the bound kept is theirs', () => {
    const t = texts('Hiring takes at least 7 months here.');
    expect(userStated({ quote: '7 months', value: 7, form: 'point', unit: 'months' }, t, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'statement_not_found' });
    // CONTRAST: the span with its bound, read as the bound, is theirs; the complete line stays the source.
    expect(userStated({ quote: 'at least 7 months', value: 7, form: 'lower_bound', unit: 'months' }, t, SUBJECT))
      .toMatchObject({ origin: 'human', statement: { form: 'lower_bound', low: 7, source: 'Hiring takes at least 7 months here.' } });
    // CONTRAST: a bound on the SAME figure in another sentence of the line is not this span's bound.
    const line = texts('We need attendance of at least 55% by March. A manager thinks more staff could add between 40 and 55 points.');
    expect(userStated({ quote: 'A manager thinks more staff could add between 40 and 55 points.', low: 40, high: 55 }, line, SUBJECT).origin).toBe('human');
  });

  it('sign reads from the span: a net loss states its negative; a gross count never does', () => {
    expect(userStated({ quote: 'we are losing a net 15 members a month', value: -15 }, texts('Honestly we are losing a net 15 members a month.'), SUBJECT).origin).toBe('human');
    expect(userStated({ quote: 'we lose 15 members a month', value: -15 }, texts('Honestly we lose 15 members a month.'), SUBJECT).origin).toBe('unknown');
  });

  it('the door and construction verify through the same span check (verifyStatement)', () => {
    const rules = { subject: SUBJECT, unit: '', forms: ['point'] as const, figuresIn: figuresWritten };
    const brief = 'We have an urgent launch date, but the team spends 25% of its time on fixes.';
    expect(verifyStatement({ quote: 'the team spends 25% of its time on fixes', form: 'point', value: 25 }, { now: brief }, { ...rules, forms: ['point'] }))
      .toMatchObject({ kind: 'verified', statement: { source: brief, low: 25 } });
    expect(verifyStatement({ quote: 'the team spends 30% of its time on fixes', form: 'point', value: 30 }, { now: brief }, { ...rules, forms: ['point'] }).kind).toBe('refused');
  });
});
