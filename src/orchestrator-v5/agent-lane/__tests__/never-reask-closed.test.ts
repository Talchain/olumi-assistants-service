/**
 * ⭐ NEVER RE-ASK WHAT THE USER HAS CLOSED (DL 0df0e1, 6 Oct; FU-1 from #2642).
 *
 * FU-1: the figure question promises "If “T” does not change, the link stays as it is". The user answers "It doesn't
 * change." and the binder reads a DENIAL; the runtime then told the Agent to ask "How much does X move Y, using the figures
 * you wrote?", breaking that promise. A denial now ends the ask: nothing is recorded, nothing is asked, the link stays.
 * Both entry shapes of `propose_link_effect` (one link; `links: [...]`) are bound. CONTROLS: a genuinely new figure the
 * binder cannot read, and a question, still get their asks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const served = (f: string): Json => (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { graph: Json }).graph;
const C = served('served-journey-c-price-subscribers-unsized-5411da8.json');
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'r', user_text });

function world(graph: Json) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store };
}
const ENDS = { from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers' };
const FIGS = { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' };
const STAYS = 'Nothing was prepared. Tell the user exactly this: "Nothing is recorded: the link from “Pro plan price” to '
  + '“Pro plan paying subscribers” stays as it is."';

/** One link (the single path) and the same link as `links: [one]` (the grouped path): both doors. */
const single = (said: string, quote: string) => world(C).caps.proposeLinkEffect!(ctxSaying(said), { ...ENDS, ...FIGS, quote }) as Promise<Json>;
const grouped = (said: string, quote: string) => world(C).caps.proposeLinkEffect!(ctxSaying(said), { links: [{ ...ENDS, ...FIGS, quote }] }) as Promise<Json>;

const DENIALS = [
  ['the no-change answer', 'It doesn’t change.', 'It doesn’t change'],
  ['a straight-quote no-change answer', "It doesn't change.", "It doesn't change"],
] as const;
/**
 * Codex r1 on #2664 P1: a denial that WRITES A FIGURE is a correction or a denied figure, not "it doesn't change". It closes
 * nothing: it keeps its ask, exactly as before FU-1. PRECONDITION on each: the binder still reads a denial.
 */
const FIGURED_DENIALS = [
  ['a corrected figure', 'Every £1 on the Pro price loses us 50 paying subscribers, not 20.', 'Every £1 on the Pro price loses us 50 paying subscribers, not 20'],
  ['a denied figure (PR Review\'s row)', 'Every £1 on the Pro price does not lose us 50 paying subscribers.', 'Every £1 on the Pro price does not lose us 50 paying subscribers'],
  ['figure-free words quoted out of a correction', 'It doesn’t change by 50, more like 20.', 'It doesn’t change'],
] as const;
const FIGURES_ASK = 'How much does “Pro plan price” move “Pro plan paying subscribers”, using the figures you wrote?';

describe('FU-1: a denial ends the ask — nothing recorded, nothing asked, the link stays', () => {
  it.each(DENIALS)('single link: %s → the stays words, no question', async (_n, said, quote) => {
    const r = await single(said, quote);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_statement');
    expect(r.why).toBe('denied');
    expect(r.detail).toBe(STAYS);
    expect(r.question).toBeUndefined();
    expect(String(r.detail)).not.toContain('?');
  });
  it.each(DENIALS)('links: [one]: %s → the stays words, no question', async (_n, said, quote) => {
    const r = await grouped(said, quote);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_statement');
    expect(r.detail).toBe(STAYS);
    expect(String(r.detail)).not.toContain('?');
  });
});

describe('CONTROLS: what the user has NOT closed still gets its ask', () => {
  it.each(FIGURED_DENIALS)('⭐ single link: %s → still asked, never "stays as it is"', async (_n, said, quote) => {
    const r = await single(said, quote);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.why, 'precondition: the binder reads a denial').toBe('denied');
    expect(String(r.detail)).toContain(FIGURES_ASK);
    expect(String(r.detail)).not.toContain('stays as it is');
  });
  it.each(FIGURED_DENIALS)('⭐ links: [one]: %s → still asked, never "stays as it is"', async (_n, said, quote) => {
    const r = await grouped(said, quote);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_statement');
    expect(String(r.detail)).toContain(FIGURES_ASK);
    expect(String(r.detail)).not.toContain('stays as it is');
  });
  it.each([
    ['a question (single)', single, 'Does every £1 on the Pro price lose us 50 paying subscribers?', 'Does every £1 on the Pro price lose us 50 paying subscribers'],
    ['a question (links)', grouped, 'Does every £1 on the Pro price lose us 50 paying subscribers?', 'Does every £1 on the Pro price lose us 50 paying subscribers'],
  ] as const)('%s → still asked, with the canvas route', async (_n, call, said, quote) => {
    const r = await call(said, quote);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_statement');
    expect(String(r.detail)).toContain('How much does “Pro plan price” move “Pro plan paying subscribers”, using the figures you wrote?');
    expect(String(r.detail)).toContain('How strong is this effect?');
  });
  it.each([
    ['single', single], ['links', grouped],
  ] as const)('a figure the statement does not carry (%s) → still asked "in figures"', async (_n, call) => {
    const said = 'Our budget is £1 a month; we have 50 paying subscribers. Raising the Pro price loses us paying subscribers.';
    const r = await call(said, 'Raising the Pro price loses us paying subscribers');
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('not_the_users_figure');
    expect(String(r.detail)).toContain('How much does “Pro plan price” move “Pro plan paying subscribers”, in figures?');
  });
  it('a genuinely new figure the binder reads still prepares (the door is unchanged)', async () => {
    const said = 'Honestly, every £1 on the Pro price loses us about 50 paying subscribers.';
    const r = await single(said, 'every £1 on the Pro price loses us about 50 paying subscribers');
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
});
