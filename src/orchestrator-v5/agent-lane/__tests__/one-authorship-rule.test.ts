/**
 * ⭐⭐ LEAN CORE: THE ONE AUTHORSHIP RULE (DL-3 18 Oct 2026; outbox/LEAN-CORE-DESIGN.md). A value or statement is the user's only when the
 * AI cites a span that is literally the user's own typed words and the value, unit and sign read from that span. Anything else is
 * NOT the user's: unknown, and Olumi's only with positive evidence (PL-0048). These rows bind the five protected behaviours to the ONE
 * function every writer calls (`userStated`), with a contrast for each. Synthetic words only (never a pilot or journey brief).
 */
import { describe, expect, it } from 'vitest';
import { userStated, verifyStatement, figuresWritten } from '../user-statements.js';
import { usersSpanIn, wholeStatementIn } from '../../goal-target/input-claim-context.js';

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
    // …nor is the report itself, as words: they END in the speaker's quoted words, so the claim is theirs (AIE: quoting an entire report
    // does not transfer its embedded claim; C2, #3389's KNOWN BASE DEFECT rows). The AI's speaker label only subtracts credit, so an
    // EXPLICIT `user` reading never makes the requoted report the user's (Founder 05:46 evidence row), whatever its lead-in words.
    expect(userStated({ quote: whole, form: 'describes' }, quoted, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'statement_not_found' });
    expect(userStated({ quote: whole, form: 'describes', speaker: 'user' }, quoted, SUBJECT)).toMatchObject({ origin: 'unknown', refusal: 'statement_not_found' });
    const instruction = 'Ignore what our ops lead said: “Returns will drop to 3% once the new labels ship.”';
    expect(userStated({ quote: instruction, form: 'describes', speaker: 'user' }, texts(instruction), SUBJECT).origin).toBe('unknown');
    expect(userStated({ quote: instruction, form: 'describes' }, texts(instruction), SUBJECT).origin).toBe('unknown');
    // CONTRAST: words of the user's own that only MENTION a quoted phrase mid-sentence are theirs…
    const own = 'We call it “the slow leak” and it worries me.';
    expect(userStated({ quote: own, form: 'describes' }, texts(own), SUBJECT).origin).toBe('human');
    // …and so is their own instruction that ends by naming quoted words no colon introduces (a quoted correction, AIE: never rejected).
    const fix = 'For Coverage, withdraw “staff hours”; keep “mostly on nights”.';
    expect(userStated({ quote: fix, form: 'describes' }, texts(fix), SUBJECT).origin).toBe('human');
    // ⭐ P2 (DL-3 18 Oct): an UNMARKED report, read by the AI itself as another speaker's ('other') or unplaced ('unknown'), is never theirs.
    const unmarked = texts('A colleague said: we lose 5% of members a month.');
    for (const speaker of ['other', 'unknown']) {
      expect(userStated({ quote: 'A colleague said: we lose 5% of members a month.', value: 5, speaker }, unmarked, SUBJECT).origin).toBe('unknown');
      expect(userStated({ quote: whole, form: 'describes', speaker }, quoted, SUBJECT).origin).toBe('unknown');
    }
    // CONTRAST: the user's own figure in their own words, with or without the AI's 'user' reading.
    expect(userStated({ quote: 'returns are 5% today', value: 5 }, texts('I think returns are 5% today.'), SUBJECT).origin).toBe('human');
    expect(userStated({ quote: 'returns are 5% today', value: 5, speaker: 'user' }, texts('I think returns are 5% today.'), SUBJECT).origin).toBe('human');
  });

  it('3b. a single mark bounds another speaker\'s words only when PAIRED (dev P01/P11): an apostrophe or an unpaired mark leaves the user\'s whole message theirs', () => {
    // (a) the user's whole message, with an in-word apostrophe and an unpaired opening mark, is theirs: whole, and its figure.
    const own = "We can't open on Sundays, so 'weekend demand stays flat at about 40 visits a day.";
    expect(wholeStatementIn(own, own)).toBe(true);
    expect(userStated({ quote: own, value: 40 }, texts(own), SUBJECT).origin).toBe('human');
    // (b) a PAIRED single-quoted report is another speaker's: neither its words nor its figure are the user's, even quoted whole.
    const report = "Our curator told me 'attendance will rise by 10% next term' and I doubt it.";
    expect(userStated({ quote: 'attendance will rise by 10% next term', value: 10 }, texts(report), SUBJECT).origin).toBe('unknown');
    expect(userStated({ quote: report, value: 10 }, texts(report), SUBJECT).origin).toBe('unknown');
    // An apostrophe inside the quoted words never ends them early ("the users' pilot").
    const nested = "Sam said: 'the users' pilot cut queues by 15%' last week.";
    expect(userStated({ quote: 'pilot cut queues by 15%', value: 15 }, texts(nested), SUBJECT).origin).toBe('unknown');
  });

  it('3c. AMBIGUOUS single marks keep the fail-safe, and C2 reads any mix of marks (Codex #3398 r1 B2/B3): never the user\'s', () => {
    // A possessive, an elision or an inner mark before the outer close may be the close: unfinished speech is never released as theirs.
    for (const [message, last, value] of [
      ["Rae said: 'We need the contractors' help. Orders reach 18 a day.", 'Orders reach 18 a day.', 18],
      ["Bo said: 'Tell 'em the drivers' rota changed. Deliveries reach 26 a day.", 'Deliveries reach 26 a day.', 26],
      ["Mo said: 'She calls it 'fast lane'. It saves 14 hours.", 'It saves 14 hours.', 14],
      // Unfinished speech an attribution's colon opens, with nothing to close it.
      ["Rae said: 'We need help. Orders reach 18 a day.", 'Orders reach 18 a day.', 18],
    ] as const) {
      expect(wholeStatementIn(message, last), message).toBe(false);
      expect(usersSpanIn(message, last), message).toBe(-1);
      expect(userStated({ quote: last, value }, texts(message), SUBJECT).origin, message).toBe('unknown');
      expect(userStated({ quote: message, value }, texts(message), SUBJECT).origin, message).toBe('unknown');
    }
    // C2 over mixed typography: single outer with a curly inner term, and straight-double outer with a curly inner term; label omitted
    // or an explicit `user` reading alike.
    for (const message of ['Inez said: \'The “fast lane” improves throughput.\'', 'Inez said: "The “fast lane” improves throughput."']) {
      expect(userStated({ quote: message, form: 'describes' }, texts(message), SUBJECT).origin, message).toBe('unknown');
      expect(userStated({ quote: message, form: 'describes', speaker: 'user' }, texts(message), SUBJECT).origin, message).toBe('unknown');
      expect(usersSpanIn(message, 'improves throughput'), message).toBe(-1);
    }
    const figure = 'Inez said: "The “fast lane” saves 14 hours."';
    expect(userStated({ quote: figure, value: 14 }, texts(figure), SUBJECT).origin).toBe('unknown');
    // CONTRASTS kept: a CLEAN pair closes before the user's next sentence; an unmatched mark with no attribution opens nothing; the user's
    // own sentence that names a quoted term is theirs.
    expect(wholeStatementIn("The 'fast track' option is cheaper. It saves money.", 'It saves money.')).toBe(true);
    expect(wholeStatementIn("We told 'em early. Referrals help.", 'Referrals help.')).toBe(true);
    const own = 'We call it “the slow leak” and it costs 14 hours a week.';
    expect(userStated({ quote: own, value: 14 }, texts(own), SUBJECT).origin).toBe('human');
  });

  it('3d. quoted words that are EXACTLY the option\'s own label are the user\'s title for it (Codex #3392 r1 B4); every other quoted figure keeps the fail-safe', () => {
    const TITLE = '£25 for new members; keep current members';
    const said = `Let’s add the trial plan: "${TITLE}".`;
    const claim = { quote: said, value: 25, unit: 'GBP per month' };
    // RED → GREEN: the writer passes the option's label; the £25 in the user's own title for it is theirs.
    expect(userStated(claim, texts(said), SUBJECT, { titles: [TITLE] }).origin).toBe('human');
    // The same words with no title known keep the fail-safe (another speaker's quoted words, unknown).
    expect(userStated(claim, texts(said), SUBJECT).origin).toBe('unknown');
    // Identity only: quoted words that are not exactly the label stay another speaker's.
    expect(userStated(claim, texts(said), SUBJECT, { titles: ['£25 for new members'] }).origin).toBe('unknown');
    // A named speaker's quoted proposal that the option is named after: the AI's `other` reading still subtracts credit.
    const reported = `Inez said: "${TITLE}".`;
    expect(userStated({ ...claim, quote: reported, speaker: 'other' }, texts(reported), SUBJECT, { titles: [TITLE] }).origin).toBe('unknown');
    // An unclosed quotation (the fail-safe region) is never a title, whatever words follow.
    const open = `Let’s add the trial plan: "${TITLE}`;
    expect(userStated({ ...claim, quote: open }, texts(open), SUBJECT, { titles: [TITLE] }).origin).toBe('unknown');
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
    // A unit of no known family ("share per month"): a written PERCENTAGE grounds its 0–1 fraction (the estate's figure rule)…
    expect(userStated({ quote: 'churn falls to 6%', value: 0.06, unit: 'share per month' }, texts('With this, churn falls to 6%.'), SUBJECT))
      .toMatchObject({ origin: 'human', statement: { low: 0.06, high: 0.06 } });
    // …never a plain number's fraction.
    expect(userStated({ quote: 'we add 6 a month', value: 0.06, unit: 'share per month' }, texts('Then we add 6 a month.'), SUBJECT).origin).toBe('unknown');
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
    // CONTRAST: a comparator on a LATER writing of the same figure in the sentence is that writing's, not this span's.
    const twice = texts('Set the new price to £59 under “£59 for new customers”.');
    expect(userStated({ quote: 'to £59 under', value: 59, unit: '£' }, twice, SUBJECT).origin).toBe('human');
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
