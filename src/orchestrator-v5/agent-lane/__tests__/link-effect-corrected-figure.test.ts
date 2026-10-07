/**
 * ⭐ A CORRECTION "X, not Y" STATES X (DL ruling 7 Oct: a figure the user types for that link this turn is the user's
 * statement). Canvas D1 served witness, draw 3 (staging CEE 13149d8): the user opened the driver link "Price rise →
 * monthly recurring revenue" (their brief's "each 1% price rise adds £1,200 a month") and typed the corrected figure
 * below. `propose_link_effect` refused it as `not_the_users_statement`: its trailing "not" read as a denial of the whole
 * sentence, so the link could not be sized and the goal chance could not move.
 *
 * Graph: the served read before that turn, verbatim (`fixtures/served-t1b-user-figure-13149d8.json`). User text: the
 * request body's `message`, verbatim. Both doors (one link; `links: [one]`). Only the graph dispatch is replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withoutCorrectedFigureTail, linkEffectQuoteContextMiss } from '../stated-by-user.js';

type Json = Record<string, any>;
const SERVED = (JSON.parse(readFileSync(new URL('./fixtures/served-t1b-user-figure-13149d8.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const SAID = 'Each 1% price rise adds £600 a month to monthly recurring revenue, not £1,200.';
const ENDS = { from_label: 'Price rise', to_label: 'monthly recurring revenue' };
const FIGS = (amount: number) => ({ amount, amount_unit: '£/month', per_source_change: 1, per_source_change_unit: '%' });
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'r', user_text });

function world() {
  const store = new ProposalStore();
  const calls: { path: string; init?: unknown }[] = [];
  const d: InternalDispatch = async (path, init) => {
    calls.push({ path, init });
    if (path.endsWith('/graph')) return { status: 200, json: { graph: SERVED, graph_hash: computeAnalysisAffectingGraphHash(SERVED as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store, calls };
}
const single = (said: string, quote: string, amount: number) => {
  const w = world();
  return (w.caps.proposeLinkEffect!(ctxSaying(said), { ...ENDS, ...FIGS(amount), quote }) as Promise<Json>).then((r) => ({ r, w }));
};
/** Nothing is written before Approve: the only dispatch is the graph READ (no write path, no mutation). */
const onlyReads = (w: ReturnType<typeof world>) => {
  expect(w.calls.length).toBeGreaterThan(0);
  for (const c of w.calls) expect(c.path.endsWith('/graph'), c.path).toBe(true);
};

describe('⭐ the served correction reads exactly as the same sentence without its "not" tail', () => {
  // The served sentence's "1%" on a source measured in % then gets the points-or-share question (U3): the SAME answer its
  // tail-free twin gets, never the denial it got on 13149d8 ("How much does … move …, using the figures you wrote?").
  const TWIN = 'Each 1% price rise adds £600 a month to monthly recurring revenue.';
  it.each(['%', 'percentage points'])('one link, per-change unit %s: served sentence ≡ its twin, never a denial', async (unit) => {
    const run = async (said: string) => {
      const w = world();
      const r = await (w.caps.proposeLinkEffect!(ctxSaying(said), { ...ENDS, ...FIGS(600), per_source_change_unit: unit, quote: said }) as Promise<Json>);
      return { r, w };
    };
    const served = await run(SAID);
    const twin = await run(TWIN);
    expect(served.r.why, JSON.stringify(served.r)).not.toBe('denied');
    expect({ ok: served.r.ok, refusal: served.r.refusal, question: served.r.question })
      .toEqual({ ok: twin.r.ok, refusal: twin.r.refusal, question: twin.r.question });
    onlyReads(served.w);
  });
});

describe('⭐ a correction the binder can read is the user\'s statement, held for approval (nothing written)', () => {
  const POINT = 'Each 1 point price rise adds £600 a month to monthly recurring revenue, not £1,200.';
  const POINT_UNITS = 'Each 1 point price rise adds £600 a month to monthly recurring revenue, not £1,200 a month.';
  const PTS = { per_source_change_unit: 'percentage points' };
  it('one link: £600 (the affirmed figure) → a card, nothing written', async () => {
    const w = world();
    const r = await (w.caps.proposeLinkEffect!(ctxSaying(POINT), { ...ENDS, ...FIGS(600), ...PTS, quote: POINT }) as Promise<Json>);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    expect(typeof r.proposal_id).toBe('string');
    expect(w.store.get(String(r.proposal_id))).toBeDefined();
    onlyReads(w);
  });
  it('links: [one]: £600 → a card, nothing written', async () => {
    const w = world();
    const r = await (w.caps.proposeLinkEffect!(ctxSaying(POINT), { links: [{ ...ENDS, ...FIGS(600), ...PTS, quote: POINT }] }) as Promise<Json>);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.mutated).toBe(false);
    onlyReads(w);
  });
  it('units on both sides ("£600 a month, not £1,200 a month") → a card', async () => {
    const w = world();
    const r = await (w.caps.proposeLinkEffect!(ctxSaying(POINT_UNITS), { ...ENDS, ...FIGS(600), ...PTS, quote: POINT_UNITS }) as Promise<Json>);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it('the REPLACED figure (£1,200, in the "not" tail) is never a stated figure → refused, no card', async () => {
    const w = world();
    const r = await (w.caps.proposeLinkEffect!(ctxSaying(POINT), { ...ENDS, ...FIGS(1200), ...PTS, quote: POINT }) as Promise<Json>);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_figure');
    expect(r.proposal_id).toBeUndefined();
    onlyReads(w);
  });
});

describe('MUST NOT STRIP: a denial stays a denial (DL rows)', () => {
  const DENIALS = [
    ['another negator before the tail', "We don't think it's £600, not £1,200."],
    ['no figure in the tail', "It's £600 a month, not a guess."],
    ['both negated', 'Not £600 a month, not £1,200 either.'],
    ['two figures in the tail', 'Each 1% price rise adds £600 a month to monthly recurring revenue, not £1,200 or £900.'],
  ] as const;
  it.each(DENIALS)('%s: the sentence reads unchanged', (_n, said) => {
    expect(withoutCorrectedFigureTail(said)).toBe(said);
  });
  it.each(DENIALS)('%s: one link → refused as a denial, no card', async (_n, said) => {
    const { r, w } = await single(said, said, 600);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_statement');
    expect(r.why).toBe('denied');
    expect(r.proposal_id).toBeUndefined();
    onlyReads(w);
  });
});

describe('the tail itself', () => {
  it('strips exactly one trailing ", not <one figure>" and keeps the sentence end', () => {
    expect(withoutCorrectedFigureTail(SAID)).toBe('Each 1% price rise adds £600 a month to monthly recurring revenue.');
    expect(withoutCorrectedFigureTail('Every £1 on the Pro price loses us 50 paying subscribers, not 20.'))
      .toBe('Every £1 on the Pro price loses us 50 paying subscribers.');
    expect(withoutCorrectedFigureTail('It adds £600 a month, rather than £1,200')).toBe('It adds £600 a month');
  });
  it('CONTROL: a sentence with no correction is untouched', () => {
    const plain = 'Each 1% price rise adds £600 a month to monthly recurring revenue.';
    expect(withoutCorrectedFigureTail(plain)).toBe(plain);
  });
});

describe('the tail reader is linear: it runs on every turn (DL review 7 Oct: 9.5 s on 3,200 spaces at 9add5bbd)', () => {
  const PLAIN = 'Each 1% price rise adds £600 a month to monthly recurring revenue';
  const spaced = (n: number, end = '') => `${PLAIN}, not £1,200${' '.repeat(n)}${end}`;
  // The slow case is a whitespace run the tail cannot finish (here ":)"): the old pattern tried every split of the run
  // between its three adjacent whitespace quantifiers (≈2 s at 1,600 spaces, measured 7 Oct). 2,000 keeps the RED bounded.
  it('", not £1,200" + 2,000 spaces + ":)" reads in well under a second, through the every-turn guard', () => {
    const said = spaced(2_000, ':)');
    const t0 = performance.now();
    expect(withoutCorrectedFigureTail(said)).toBe(said);
    linkEffectQuoteContextMiss('Each 1% price rise adds £600 a month', said);
    expect(performance.now() - t0).toBeLessThan(250);
  });
  it('PRECONDITION: a short whitespace run still has its tail read (the timing row is about the same tail)', () => {
    expect(withoutCorrectedFigureTail(spaced(3))).toBe(PLAIN);
  });
  it('a space before the end mark still ends the tail ("not £1,200 .")', () => {
    expect(withoutCorrectedFigureTail(`${PLAIN}, not £1,200 .`)).toBe(`${PLAIN}.`);
  });
});
