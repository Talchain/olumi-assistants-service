/**
 * ⭐ THE USER'S ANSWER TO "HOW MUCH DOES X MOVE Y?" HAS A DOOR (DL 5882763151: Runtime owns the answer handler; Canonical
 * the writer `applyLinkEffectEdit`, contract 5882965890 + correction 5882989451; AIQ 5882619314 "answerable end to end").
 *
 * Before: nothing after construction wrote `magnitude: 'user_stated'` + a `natural_effect` (Runtime 5882633365), so "every
 * £1 on the price loses us about 50 subscribers" had nowhere to land. `propose_link_effect` prepares ONE change: the
 * user's two figures, in the units of the link's two ends (or the ask's own unit words), with their verbatim quote,
 * bound to the analysis revision AND every byte of the link (`edge_token`). It DRY-RUNS Canonical's pure writer on the
 * read it proposes from, so every refusal is the writer's own, said truthfully at propose time — never at approval.
 *
 * SERVED fixtures: journey C (5411da8) has a DIRECT, UNSIZED "Pro plan price" → "Pro plan paying subscribers" link;
 * journey A (0df78f4) has "Pro plan price" (£/month) → "Monthly churn" (%).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { linkEffectEdgeToken } from '../../system-events/link-effect-edit.js';
import { approvalChipsFor, approvalChipIdFor } from '../approval-chips.js';
import type { CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const served = (f: string): Json => (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { graph: Json }).graph;
const C = served('served-journey-c-price-subscribers-unsized-5411da8.json');
const A = served('served-journey-a-price-churn-0df78f4.json');
const BEYOND = served('served-price-subscribers-beyond-range-0df78f4-d2.json');
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400a7', authenticated_user_id: null, request_id: 'r', user_text });

function world(graph: Json) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store };
}
const SUBS_SAID = 'Honestly, every £1 on the Pro price loses us about 50 paying subscribers.';
const SUBS_ARGS = {
  from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers',
  amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month',
  quote: 'every £1 on the Pro price loses us about 50 paying subscribers',
};

describe('propose_link_effect — the user\'s stated effect on a link, prepared as ONE change', () => {
  it('RED (served journey C, unsized direct link): prepared, bound to the revision AND the link\'s own bytes, quoting the user', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const p = store.get(String(r.proposal_id))!;
    expect(p.base_graph_identity_hash).toBe(computeAnalysisAffectingGraphHash(C as never));
    expect(p.provenance.authored_by).toBe('user_stated');
    expect(p.operations).toEqual([{ op: 'set_link_effect', path: 'pro_plan_price::pro_plan_paying_subscribers', value: {
      from: 'pro_plan_price', to: 'pro_plan_paying_subscribers',
      effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' },
      quote: SUBS_ARGS.quote, edge_token: linkEffectEdgeToken(C, 'pro_plan_price', 'pro_plan_paying_subscribers'),
    } }]);
    expect(String(r.public_label)).toContain(SUBS_ARGS.quote);
  });

  it('RED (served journey A): "0.5 points" of a % churn is the ask\'s own unit words — prepared, not refused', async () => {
    const { caps } = world(A);
    const said = 'A £10 rise in the Pro price adds about 0.5 points of monthly churn.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), {
      from_label: 'Pro plan price', to_label: 'Monthly churn', amount: 0.5, amount_unit: 'percentage points',
      per_source_change: 10, per_source_change_unit: '£/month', quote: 'A £10 rise in the Pro price adds about 0.5 points of monthly churn',
    }) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('REFUSED: a figure the user did not write is never recorded as theirs', async () => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying('Every price rise loses us subscribers.'), { ...SUBS_ARGS, quote: 'Every price rise loses us subscribers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_the_users_figure' }));
    expect(store.size()).toBe(0);
  });

  it('REFUSED: the quote must be the user\'s own words, verbatim', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), { ...SUBS_ARGS, quote: 'each pound costs roughly fifty customers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'quote_not_verbatim' }));
  });

  it('REFUSED by the writer\'s own rule, at propose time: a unit that is not the end\'s ("customers") → unit_mismatch, said', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), { ...SUBS_ARGS, amount_unit: 'customers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toMatch(/subscribers/);
  });

  /**
   * ⛔ PR Review CHANGES_REQUIRED on #2275 @ `ac0023c7`: a size is the user's only when ONE statement of theirs says it
   * (`linkEffectTheUserStated`). The input CLASS, on served journey C (Pro plan price → Pro plan paying subscribers):
   * six ways a user states it, each prepared; eight near-misses, each refused — the same numerals in the turn, a
   * question, a denial, an unnamed end, the opposite way, no way at all, a source said to fall with no word of it.
   */
  const stated = async (turn: string, quote: string, amount: number, per: number): Promise<Json> => {
    const { caps, store } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(turn), { ...SUBS_ARGS, amount, per_source_change: per, quote }) as Json;
    return { ...r, stored: store.size() };
  };
  it.each([
    ['every £1 on the Pro price loses us about 50 paying subscribers', -50, 1],
    ['every £1 we add to the Pro price costs us roughly 50 paying subscribers', -50, 1],
    ['A £10 rise in the Pro price would lose us about 500 paying subscribers', -500, 10],
    ['every £1 increase in the Pro price loses us 50 paying subscribers', -50, 1],
    ['If the Pro price falls by £1 we gain about 50 paying subscribers', 50, -1],
    ['each £1 on the Pro price means 50 fewer paying subscribers', -50, 1],
  ])('STATED, prepared: "%s"', async (quote, amount, per) => {
    const r = await stated(`${quote}.`, quote as string, amount as number, per as number);
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it.each([
    // PR Review's case: both numerals in the turn, the quote a question — and the statement with them names no price.
    ['Our budget is £1 per month and we currently have 50 subscribers. Does a Pro price rise affect paying subscribers?',
      'Does a Pro price rise affect paying subscribers?', -50, 1, 'not_the_users_statement', 'question'],
    ['Our budget is £1 per month and we currently have 50 paying subscribers. Does a Pro price rise affect them?',
      'Our budget is £1 per month and we currently have 50 paying subscribers', -50, 1, 'not_the_users_statement', 'end_not_named'],
    ['Does every £1 on the Pro price lose us 50 paying subscribers?', 'Does every £1 on the Pro price lose us 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'question'],
    ['Every £1 on the Pro price does not lose us 50 paying subscribers.', 'Every £1 on the Pro price does not lose us 50 paying subscribers',
      -50, 1, 'not_the_users_statement', 'denied'],
    // The opposite way, with the STORED sign supplied: the user said "wins", the tool says −50.
    ['Every £1 on the Pro price wins us about 50 paying subscribers.', 'Every £1 on the Pro price wins us about 50 paying subscribers',
      -50, 1, 'not_the_users_statement', 'direction_contradicts'],
    ['£1 on the Pro price and 50 paying subscribers.', '£1 on the Pro price and 50 paying subscribers', -50, 1,
      'not_the_users_statement', 'direction_not_stated'],
    ['Every £1 on the Pro price loses us about 50 paying subscribers.', 'Every £1 on the Pro price loses us about 50 paying subscribers',
      50, -1, 'not_the_users_statement', 'direction_contradicts'],
    // The figures only ELSEWHERE in the turn; the quoted statement names both ends and the way, but no size.
    ['Our budget is £1 a month; we have 50 paying subscribers. Raising the Pro price loses us paying subscribers.',
      'Raising the Pro price loses us paying subscribers', -50, 1, 'not_the_users_figure', undefined],
    // A NAMED under-claim: the source only implied ("a £10 rise") — the Agent asks, never infers the price.
    ['A £10 rise loses us about 500 paying subscribers.', 'A £10 rise loses us about 500 paying subscribers', -500, 10,
      'not_the_users_statement', 'end_not_named'],
  ])('NOT STATED, refused: %s', async (turn, quote, amount, per, refusal, why) => {
    const r = await stated(turn as string, quote as string, amount as number, per as number);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal }));
    if (why !== undefined) expect(r.why).toBe(why);
    expect(r.stored).toBe(0);
  });

  it('the tool is registered: dispatchTool routes propose_link_effect to the capability', async () => {
    const { caps } = world(C);
    const r = await dispatchTool('propose_link_effect', JSON.stringify(SUBS_ARGS), ctxSaying(SUBS_SAID), caps) as Json;
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  it('REFUSED (sign_conflict, AIQ 5882847470): the user\'s figure runs the OTHER way — said plainly, with the reversal door offered', async () => {
    const { caps } = world(C);
    const said = 'Every £1 on the Pro price wins us about 50 paying subscribers.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...SUBS_ARGS, amount: 50, quote: 'Every £1 on the Pro price wins us about 50 paying subscribers' }) as Json;
    const edge = (C.edges as Json[]).find((e) => e.from === 'pro_plan_price' && e.to === 'pro_plan_paying_subscribers')!;
    expect(edge.effect_direction ?? Math.sign(edge.strength?.mean)).not.toBe('positive'); // precondition: served link runs negative
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'sign_conflict' }));
    expect(String(r.detail)).toMatch(/propose_link_strength/);
  });

  it('RED (live replay on served C + 0929 D2, 29 Sep: 6/6 prepared, 0 chips): the prepared change is OFFERED — one approve chip for it', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const chips = approvalChipsFor([{ name: 'propose_link_effect', ok: true, mutated: false, proposal_id: String(r.proposal_id) }]);
    const approve = chips.filter((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve.map((c) => c.id)).toEqual([approvalChipIdFor(String(r.proposal_id))]);
    expect(approve[0]!.label).toBe('Record your figure');
  });

  const BEYOND_SAID = 'From our last two price changes: every £1 on the Pro price loses us about 50 paying subscribers.';
  const BEYOND_ARGS = {
    from_label: 'Pro plan price', to_label: 'Pro paying subscribers', amount: -50, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: 'GBP/month', quote: 'every £1 on the Pro price loses us about 50 paying subscribers',
  };

  it('REFUSED (served 0df78f4 D2, live replay 3/3; AIQ 5883669977): the model\'s RANGE is what stops it — never the user\'s figure first, no dead-end offer', async () => {
    const { caps, store } = world(BEYOND);
    const r = await caps.proposeLinkEffect!(ctxSaying(BEYOND_SAID), BEYOND_ARGS) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'not_representable' }));
    const detail = String(r.detail);
    expect(detail).toMatch(/the range the model uses for "Pro plan price" \(up to 200 GBP\/month\) and "Pro paying subscribers"/);
    expect(detail).toMatch(/it is that range, not their figure, that stops it being used/);
    expect(detail).toMatch(/Never ask them to change their figure first/);
    expect(detail).toMatch(/Repeat their figure in their own words/);
    expect(detail).toMatch(/cannot be changed from this conversation yet/); // no dead-end "OK?" before a reframe door exists (Canonical 5883707376)
    expect(detail).not.toMatch(/Is that the size they meant/); // mutant: asking the user's size first → RED
    // Canonical 5883707376: no typed field says whose a cap is — the words never claim the range is Olumi's (or theirs).
    expect(detail).not.toMatch(/Olumi\u2019s own|Olumi's own|their range|range they gave/);
    expect(detail).not.toMatch(/not_representable|not representable/); // never the raw code
    expect(store.size()).toBe(0);
  });

  /**
   * PR Review on #2275: the read-back proves THIS figure — the user's source, both numbers AND both units. A door that
   * reports "committed" while the stored link holds another source or unit is never said as "recorded".
   */
  const readBackAfter = async (stored: Json): Promise<Json> => {
    const graph = structuredClone(C);
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
      throw new Error(`unexpected dispatch ${path}`);
    };
    const commitOptionLevels = async (): Promise<CommitOptionLevelsResult> => {
      const e = (graph.edges as Json[]).find((x) => x.from === 'pro_plan_price' && x.to === 'pro_plan_paying_subscribers')!;
      e.provenance = { ...(e.provenance ?? {}), ...stored };
      return { status: 'committed', graph_hash: 'h-after', receipt: null, already_applied: false, committed_levels: [], links_resized: [] };
    };
    const store = new ProposalStore();
    const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    return await caps.authoriseChange(ctxSaying('yes'), { proposal_id: String(r.proposal_id) }) as Json;
  };
  const THEIRS = { source: 'user_specified', magnitude: 'user_stated',
    natural_effect: { amount: -50, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'GBP per month' } };
  it('READ-BACK: the user\'s source, numbers and units → recorded', async () => {
    expect(await readBackAfter(THEIRS)).toEqual(expect.objectContaining({ ok: true, applied: true }));
  });
  it.each([
    ['another source', { ...THEIRS, source: 'cee_hypothesis' }],
    ['another target unit', { ...THEIRS, natural_effect: { ...THEIRS.natural_effect, amount_unit: 'customers' } }],
    ['another source unit', { ...THEIRS, natural_effect: { ...THEIRS.natural_effect, per_source_change_unit: 'percent' } }],
  ])('READ-BACK: %s → never said as recorded', async (_why, stored) => {
    expect(await readBackAfter(stored as Json)).toEqual(expect.objectContaining({ ok: false, applied: false, refusal: 'not_verified' }));
  });

  it('FAIL CLOSED without the level door: approving writes nothing and says so (never a strength-only or register fallback)', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const out = await caps.authoriseChange(ctxSaying('yes'), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: false, reason: 'link_effect_writer_unavailable' }));
  });
});
