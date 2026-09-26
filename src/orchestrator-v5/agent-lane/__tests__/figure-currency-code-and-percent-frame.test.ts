/**
 * ⛔ A FIGURE IS THE USER'S ONLY IN THE CURRENCY THEY WROTE IT IN, AND ON THE FRAME THEY WROTE IT ON (`stated-by-user.ts`).
 *
 * Model Generation #70 5845579390 item 1 (EXECUTED at CEE staging after #1978): `figureTheUserWrote` grounded an
 * Agent-passed `{value: 12000, unit: 'GBP'}` as the user's figure on each of "$12,000", "12,000 USD", "€12k",
 * "12,000 dollars" and "USD 12,000" — 5 of 5. The currency branch checked only the KIND, and a number with its
 * currency written AFTER it (or an ISO code before it) was scanned as a bare number, which grounds any unit. The
 * share rule let "3%" ground 0.03 on a %-measured quantity — 100x too small on a factor framed on 100.
 *
 * Delivery Lead 5845585247: "the code must match; a trailing currency is not a bare number; the % frame goes
 * through the target's cap". CONTRAST: the brief-path rule `isAmountStatedInBrief(12000, 'GBP', text)` is false
 * for all five.
 *
 * ROUND 2 (review of db6c8a3a, CHANGES_REQUIRED): round 1's shaped attachment still grounded nine real forms the brief
 * path refuses. Currency identity is now the brief path's own exported rule (`amountFitsUnit`), and the PARITY row
 * below holds the two readers equal over a corpus, with the one declared difference (a bare number) listed by name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { contradictsItsName, figureTheUserWrote } from '../stated-by-user.js';
import { isAmountStatedInBrief } from '../../../cee/provenance/stated-amounts.js';

const FIVE_OTHER_CURRENCIES = [
  'Our MRR is $12,000.',
  'Our MRR is 12,000 USD.',
  'Our MRR is €12k.',
  'Our MRR is 12,000 dollars.',
  'Our MRR is USD 12,000.',
] as const;

describe('figureTheUserWrote — a currency unit is grounded only by an amount in the SAME currency', () => {
  it('RED (#70 5845579390 item 1): each of the five other-currency forms is not the user\'s GBP figure', () => {
    for (const text of FIVE_OTHER_CURRENCIES) {
      expect(figureTheUserWrote(12000, 'GBP', text), text).toBe(false);
    }
  });

  it('RED: the unit\'s code is read from the unit phrase — "GBP per month", "£/month", "£ per month", "pounds" are GBP', () => {
    for (const unit of ['GBP per month', '£/month', '£ per month', '£', 'pounds'] as const) {
      expect(figureTheUserWrote(12000, unit, 'Our MRR is $12,000.'), `${unit} vs $12,000`).toBe(false);
      expect(figureTheUserWrote(12000, unit, 'Our MRR is 12,000 USD.'), `${unit} vs 12,000 USD`).toBe(false);
      expect(figureTheUserWrote(12000, unit, 'Our MRR is £12,000.'), `${unit} vs £12,000`).toBe(true);
    }
  });

  it('CONTRAST: the same amount in the unit\'s own currency — symbol, code after, code before, word after — is the user\'s', () => {
    for (const text of ['Our MRR is £12,000.', 'Our MRR is 12,000 GBP.', 'Our MRR is GBP 12,000.', 'Our MRR is 12,000 pounds.'] as const) {
      expect(figureTheUserWrote(12000, 'GBP', text), text).toBe(true);
    }
    expect(figureTheUserWrote(12000, 'USD', 'Our MRR is $12,000.')).toBe(true);
    expect(figureTheUserWrote(12000, 'USD', 'Our MRR is 12,000 dollars.')).toBe(true);
    expect(figureTheUserWrote(12000, '$', 'Our MRR is USD 12,000.')).toBe(true);
  });

  it('CONTRAST: the brief-path rule already refuses all five — the two provenance readers agree', () => {
    for (const text of FIVE_OTHER_CURRENCIES) {
      expect(isAmountStatedInBrief(12000, 'GBP', text), text).toBe(false);
    }
  });
});

describe('figureTheUserWrote — a number with a currency attached is a CURRENCY amount, never a bare number', () => {
  it('RED: "12,000 USD" never grounds a plain unit ("subscribers")', () => {
    expect(figureTheUserWrote(12000, 'subscribers', 'Our MRR is 12,000 USD.')).toBe(false);
    expect(figureTheUserWrote(12000, 'subscribers', 'Our MRR is 12,000 dollars.')).toBe(false);
    expect(figureTheUserWrote(12000, 'subscribers', 'Our MRR is USD 12,000.')).toBe(false);
  });

  it('RED: a symbol glued to letters ("US$12,000", which the scanner reads bare) is still that currency', () => {
    expect(figureTheUserWrote(12000, 'GBP', 'Our MRR is US$12,000.')).toBe(false);
    expect(figureTheUserWrote(12000, 'USD', 'Our MRR is US$12,000.')).toBe(true);
  });

  it('CONTRAST: a bare number still grounds any kind — "raise to 59 at release" on a £ price, 250 on subscribers', () => {
    expect(figureTheUserWrote(59, '£', 'raise to 59 at release')).toBe(true);
    expect(figureTheUserWrote(59, 'GBP per month', 'raise to 59 at release')).toBe(true);
    expect(figureTheUserWrote(250, 'subscribers', 'We have 250 Pro subscribers.')).toBe(true);
  });

  it('CONTRAST: word boundaries hold — a word merely ending in a code ("fraud") attaches nothing', () => {
    expect(figureTheUserWrote(12, 'cases', 'We saw fraud 12 times last year.')).toBe(true);
    expect(figureTheUserWrote(12, 'cases', 'We had 12 poundland stores.')).toBe(true);
  });
});

describe('figureTheUserWrote — a written percentage on a %-measured quantity is the same magnitude, never its fraction', () => {
  it('RED: "3%" on a "%" unit grounds 3, never 0.03 (100x too small on a factor framed on 100)', () => {
    expect(figureTheUserWrote(3, '%', 'Churn is 3%.')).toBe(true);
    expect(figureTheUserWrote(0.03, '%', 'Churn is 3%.')).toBe(false);
    expect(figureTheUserWrote(0.03, 'percent per month', 'Churn is 3%.')).toBe(false);
    expect(figureTheUserWrote(0.03, 'percent', 'Churn is 3%.')).toBe(false);
  });

  it('CONTRAST: on a share kept as 0–1 the fraction still grounds ("40%" → 0.4 on "share")', () => {
    expect(figureTheUserWrote(0.4, 'share', 'Onboarding share is 40%.')).toBe(true);
    expect(figureTheUserWrote(0.4, undefined, 'Onboarding share is 40%.')).toBe(true);
  });
});

describe('propose_assumptions: a revision written in another currency is not the user\'s GBP figure', () => {
  const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
  const ctxSaying = (user_text: string) => ({
    scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_text,
  });
  const setup = () => {
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
      return { status: 500, json: {} };
    };
    const store = new ProposalStore();
    return { caps: createAgentCapabilities(d, store), store };
  };
  const revise = { assumptions: [{ factor_label: 'Pro plan price', value: 12000, unit: 'GBP', basis: 'x', revise: true }] };
  const opAuthor = (store: ProposalStore, id: unknown) =>
    ((store.get(String(id))?.operations[0]?.value ?? {}) as { authored_by?: unknown }).authored_by;

  it('RED: "Our MRR is $12,000." with a GBP 12,000 → recorded as Olumi\'s, and said', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying('Our MRR is $12,000.'), revise as never) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown[] };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opAuthor(store, r.proposal_id)).toBe('model_proposed');
    expect(store.get(String(r.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(r.not_the_users_figure).toEqual([{ factor: 'Pro plan price', value: 12000 }]);
  });

  it('CONTRAST: "Our MRR is £12,000." → the user\'s revision', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying('Our MRR is £12,000.'), revise as never) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opAuthor(store, r.proposal_id)).toBe('user_stated');
    expect(r).not.toHaveProperty('not_the_users_figure');
  });
});

/**
 * ⛔ ROUND-2 REVIEW (CHANGES_REQUIRED on db6c8a3a): the round-1 attachment was a SECOND pattern set, shaped (the token
 * straight after the number, or a code straight before it), and it disagreed with the brief-path rule on real forms.
 * `isAmountStatedInBrief` refuses every one of these for a GBP 12,000 — its kind rule never lets a plain number ground
 * a currency unit — while `figureTheUserWrote` still grounded them, and `proposeAssumptions` recorded 'user_stated'.
 */
const REVIEWER_FORMS = [
  '12,000 US dollars',
  '12,000 (USD)',
  '12,000 Australian dollars',
  '12,000 U.S. dollars',
  '12,000 in USD',
  'USD: 12,000',
  '(USD) 12,000',
  'MRR is 12,000 (USD)',
  '12,000 USDs',
] as const;

describe('ROUND-2 RED: a currency of another code written anywhere beside the number is not the user\'s GBP figure', () => {
  it('every reviewer form, bare and in a sentence, is not a GBP 12,000 the user wrote', () => {
    for (const form of REVIEWER_FORMS) {
      expect(figureTheUserWrote(12000, 'GBP', form), form).toBe(false);
      expect(figureTheUserWrote(12000, 'GBP', `Our MRR is ${form}.`), `Our MRR is ${form}.`).toBe(false);
      expect(isAmountStatedInBrief(12000, 'GBP', form), `brief path: ${form}`).toBe(false);
    }
  });

  it('CONTRAST: the same shapes in the unit\'s OWN currency are the user\'s, and a USD unit takes the USD forms', () => {
    for (const form of ['12,000 (GBP)', '12,000 in GBP', 'GBP: 12,000', '(GBP) 12,000', '12,000 GBPs', '12,000 British pounds'] as const) {
      expect(figureTheUserWrote(12000, 'GBP', form), form).toBe(true);
    }
    for (const form of ['12,000 (USD)', '12,000 in USD', 'USD: 12,000', '(USD) 12,000', '12,000 USDs', '12,000 US dollars'] as const) {
      expect(figureTheUserWrote(12000, 'USD', form), `${form} on USD`).toBe(true);
    }
  });

  it('CONTRAST: a currency beside ANOTHER number does not attach to this one — "no other number between"', () => {
    expect(figureTheUserWrote(62, 'GBP per month', 'Raise it to 62. Our US rival charges $79.'), '$ belongs to 79').toBe(true);
    expect(figureTheUserWrote(62, 'GBP per month', 'Raise it to 62, not 79 dollars.'), 'dollars belongs to 79').toBe(true);
    expect(figureTheUserWrote(62, 'GBP per month', 'Raise it to 62 dollars.')).toBe(false);
  });
});

describe('ROUND-2 PARITY: figureTheUserWrote(v, "GBP", t) === isAmountStatedInBrief(v, "GBP", t), except where declared', () => {
  /**
   * The ONLY intended differences, each with its reason. Anything not listed must agree exactly.
   *  - BARE: a bare number grounds any kind in the Agent lane (pinned on base: figure-must-be-written-by-user.test.ts,
   *    "a bare figure grounds any kind" — 62 on 'GBP per month'); the brief path never lets a plain number ground a
   *    currency unit. A bare number here has NO currency token between it and its neighbouring numbers.
   *  - OWN CODE: the unit's own code or currency word written beside the number is read as GBP in the Agent lane; the
   *    brief path does not read codes or words in text (its documented false-negative list: ISO codes inside the brief,
   *    word-form currency, postfix currency). Either way it would ground: it is at worst a bare number.
   */
  const BARE = 'bare number: grounds any kind in the Agent lane (base-pinned); the brief path never grounds a plain number on a currency unit';
  const OWN_CODE = 'the unit\'s own code/word beside the number: read as GBP here; the brief path does not read codes/words in text (documented false negative)';
  const CORPUS: readonly { text: string; differs?: string }[] = [
    // The reviewer's strings (round-1 review, blocking).
    ...REVIEWER_FORMS.map((text) => ({ text })),
    { text: 'Our MRR is 12,000 US dollars.' },
    { text: 'Our MRR is 12,000 (USD).' },
    // Round 1's five forms and its contrast strings.
    ...FIVE_OTHER_CURRENCIES.map((text) => ({ text })),
    { text: 'Our MRR is US$12,000.' },
    { text: 'Our MRR is £12,000.' },
    { text: 'Our MRR is 12,000 GBP.', differs: OWN_CODE },
    { text: 'Our MRR is GBP 12,000.', differs: OWN_CODE },
    { text: 'Our MRR is 12,000 pounds.', differs: OWN_CODE },
    { text: 'raise to 12000 at release', differs: BARE },
    { text: 'Our MRR is 12,000.', differs: BARE },
    // Written from the registered vocabulary (CURRENCY_SYMBOL_TO_CODE + CURRENCY_WORDS).
    { text: 'MRR is €12,000' },
    { text: 'MRR is 12,000 euros' },
    { text: 'MRR is 12,000 euro' },
    { text: 'MRR is 12,000 EUR' },
    { text: 'MRR is EUR 12,000' },
    { text: 'MRR is ¥12,000' },
    { text: 'MRR is 12,000 JPY' },
    { text: 'MRR is ₹12,000' },
    { text: 'MRR is INR 12,000' },
    { text: 'MRR is A$12,000' },
    { text: 'MRR is C$12,000' },
    { text: 'MRR is NZ$12,000' },
    { text: 'MRR is CHF 12,000' },
    { text: 'MRR is 12,000 CHF' },
    { text: 'MRR is 12,000 kr' },
    { text: 'MRR is kr 12,000' },
    { text: 'MRR is 12,000 SEK' },
    { text: 'MRR is 12,000 AUD' },
    { text: 'MRR is CAD 12,000' },
    { text: 'MRR is 12,000 NZD' },
    { text: 'MRR is 12,000 dollar' },
    { text: 'MRR is 12,000 GBP or USD' },
    { text: 'MRR is 12,000 USD, about 9,500 GBP' },
    { text: 'MRR is 9,500 GBP, about 12,000 USD' },
    { text: 'MRR is £12k' },
    { text: 'MRR is 12k GBP', differs: OWN_CODE },
    { text: 'MRR is 12,000£', differs: OWN_CODE },
    { text: 'MRR is 12,000 pound', differs: OWN_CODE },
    { text: 'MRR is GBP12,000' },
    { text: 'MRR is twelve thousand pounds' },
  ];

  it('every row agrees, or differs exactly as declared (the Agent lane grounds, the brief path does not)', () => {
    const agreeTrue: string[] = [];
    const agreeFalse: string[] = [];
    for (const { text, differs } of CORPUS) {
      const figure = figureTheUserWrote(12000, 'GBP', text);
      const brief = isAmountStatedInBrief(12000, 'GBP', text);
      if (differs !== undefined) {
        expect({ text, figure, brief }, differs).toEqual({ text, figure: true, brief: false });
      } else {
        expect({ text, figure }).toEqual({ text, figure: brief });
        (brief ? agreeTrue : agreeFalse).push(text);
      }
    }
    // Non-vacuity: the corpus exercises both verdicts, and is at least the size this row was written with.
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
    expect(agreeTrue.length, agreeTrue.join(' | ')).toBeGreaterThanOrEqual(2);
    expect(agreeFalse.length, agreeFalse.join(' | ')).toBeGreaterThanOrEqual(35);
  });
});

describe('ROUND-2 (mutant C): a currency-family unit that names no code keeps the kind-only rule', () => {
  it('a written amount of any currency can ground a codeless money unit; a percentage never does', () => {
    expect(figureTheUserWrote(12000, 'grand', 'Our MRR is $12,000.')).toBe(true);
    expect(figureTheUserWrote(12000, 'grand', 'Our MRR is 12,000 USD.')).toBe(true);
    expect(figureTheUserWrote(12, 'grand', 'Churn is 12%.')).toBe(false);
  });
});

describe('ROUND-2 (mutant D): a composite money unit is read for its code — same code grounds, another code does not', () => {
  it('"MRR (GBP)", "Monthly revenue (£)", "price (GBP)", "cost (£)" take £12,000 and refuse $12,000 / 12,000 USD', () => {
    for (const unit of ['MRR (GBP)', 'Monthly revenue (£)', 'price (GBP)', 'cost (£)'] as const) {
      expect(figureTheUserWrote(12000, unit, 'Our MRR is £12,000.'), `${unit} vs £12,000`).toBe(true);
      expect(figureTheUserWrote(12000, unit, 'Our MRR is $12,000.'), `${unit} vs $12,000`).toBe(false);
      expect(figureTheUserWrote(12000, unit, 'Our MRR is 12,000 USD.'), `${unit} vs 12,000 USD`).toBe(false);
    }
  });
});

describe('ROUND-2: contradictsItsName reads the name with the SAME rule — the % frame and the currency code', () => {
  it('RED: 0.03 on a "%" factor contradicts "Cut churn to 3%" (100x too small)', () => {
    expect(contradictsItsName(0.03, '%', 'Cut churn to 3%')).toBe(true);
    expect(contradictsItsName(0.03, 'percent per month', 'Cut churn to 3%')).toBe(true);
  });

  it('RED: a GBP 12,000 contradicts "Test $12,000" and "Test 12,000 USD"', () => {
    expect(contradictsItsName(12000, 'GBP', 'Test $12,000')).toBe(true);
    expect(contradictsItsName(12000, 'GBP', 'Test 12,000 USD')).toBe(true);
    expect(contradictsItsName(12000, 'GBP per month', 'Test $12,000')).toBe(true);
  });

  it('CONTRAST: the figure the name states, in its own frame and currency, does not contradict it', () => {
    expect(contradictsItsName(3, '%', 'Cut churn to 3%')).toBe(false);
    expect(contradictsItsName(0.03, undefined, 'Cut churn to 3%'), 'a share kept as 0–1 on no unit').toBe(false);
    expect(contradictsItsName(0.03, 'share', 'Cut churn to 3%')).toBe(false);
    expect(contradictsItsName(12000, 'GBP', 'Test £12,000')).toBe(false);
    expect(contradictsItsName(12000, 'GBP', 'Test 12,000 GBP')).toBe(false);
    expect(contradictsItsName(12000, 'grand', 'Test $12,000'), 'a codeless money unit keeps the kind-only rule').toBe(false);
    expect(contradictsItsName(64, 'GBP', 'Test £54 at release'), 'the base row still holds').toBe(true);
    expect(contradictsItsName(2, 'engineers', 'Hire 2 developers'), 'a bare number in a name is about something else').toBe(false);
  });
});

describe('ROUND-2 (caller gap): a BLANK Agent unit falls back to the factor\'s unit — it is not "no unit"', () => {
  const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
  const ctxSaying = (user_text: string) => ({
    scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', user_text,
  });
  const setup = () => {
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
      return { status: 500, json: {} };
    };
    const store = new ProposalStore();
    return { caps: createAgentCapabilities(d, store), store };
  };
  const reviseIn = (unit: string) => ({ assumptions: [{ factor_label: 'Pro plan price', value: 12000, unit, basis: 'x', revise: true }] });
  const opAuthor = (store: ProposalStore, id: unknown) =>
    ((store.get(String(id))?.operations[0]?.value ?? {}) as { authored_by?: unknown }).authored_by;
  const run = async (text: string, unit: string) => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying(text), reviseIn(unit) as never) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return { author: opAuthor(store, r.proposal_id), r };
  };

  it('RED: "Our MRR is $12,000." with unit \'\' on the GBP-per-month price → Olumi\'s, and said', async () => {
    const { author, r } = await run('Our MRR is $12,000.', '');
    expect(author).toBe('model_proposed');
    expect(r.not_the_users_figure).toEqual([{ factor: 'Pro plan price', value: 12000 }]);
    expect((await run('Our MRR is $12,000.', '   ')).author, 'whitespace is blank too').toBe('model_proposed');
  });

  it('RED (writer): the reviewer\'s "12,000 US dollars" and "12,000 (USD)" with a GBP revision → Olumi\'s, not user_stated', async () => {
    expect((await run('Our MRR is 12,000 US dollars.', 'GBP')).author).toBe('model_proposed');
    expect((await run('Our MRR is 12,000 (USD).', 'GBP')).author).toBe('model_proposed');
  });

  it('CONTRAST: "Our MRR is £12,000." with unit \'\' → the user\'s (the factor\'s GBP takes a £ figure)', async () => {
    expect((await run('Our MRR is £12,000.', '')).author).toBe('user_stated');
    expect((await run('Our MRR is 12,000 (GBP).', 'GBP')).author).toBe('user_stated');
  });
});
