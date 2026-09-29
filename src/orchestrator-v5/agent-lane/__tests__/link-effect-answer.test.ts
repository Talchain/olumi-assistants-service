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

type Json = Record<string, any>;
const served = (f: string): Json => (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { graph: Json }).graph;
const C = served('served-journey-c-price-subscribers-unsized-5411da8.json');
const A = served('served-journey-a-price-churn-0df78f4.json');
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
    const said = 'A £10 rise adds about 0.5 points of monthly churn.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), {
      from_label: 'Pro plan price', to_label: 'Monthly churn', amount: 0.5, amount_unit: 'percentage points',
      per_source_change: 10, per_source_change_unit: '£/month', quote: 'A £10 rise adds about 0.5 points of monthly churn',
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
    const said = 'Every £1 on the Pro price loses us about 50 customers.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), { ...SUBS_ARGS, amount_unit: 'customers', quote: 'Every £1 on the Pro price loses us about 50 customers' }) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'unit_mismatch' }));
    expect(String(r.detail)).toMatch(/subscribers/);
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

  it('FAIL CLOSED without the level door: approving writes nothing and says so (never a strength-only or register fallback)', async () => {
    const { caps } = world(C);
    const r = await caps.proposeLinkEffect!(ctxSaying(SUBS_SAID), SUBS_ARGS) as Json;
    const out = await caps.authoriseChange(ctxSaying('yes'), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: false, reason: 'link_effect_writer_unavailable' }));
  });
});
