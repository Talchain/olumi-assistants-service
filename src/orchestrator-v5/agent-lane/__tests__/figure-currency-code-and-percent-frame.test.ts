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
 * for all five, so the two provenance readers now agree on the currency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { figureTheUserWrote } from '../stated-by-user.js';
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
