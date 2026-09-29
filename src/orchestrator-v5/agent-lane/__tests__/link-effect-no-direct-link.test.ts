/**
 * ⛔ A TOTAL EFFECT IS NEVER A NEW DIRECT LINK (Runtime #72 5883636858; Canonical 5883568580 point 3: Runtime's).
 *
 * SERVED (0929 D3, live replay 3/3): "every £1 on the Pro price loses us about 50 paying subscribers" on a model with
 * NO direct price → "Paying Pro subscribers" link — price reaches it through new subscriptions and churn. The Agent
 * called no tool, offered a NEW direct link and asked for a band: the user's figure dropped, and the offered link would
 * count price's effect a second time. `propose_link_effect` now refuses `no_direct_link` with the connecting paths read
 * from the graph (never the model's own reading), and says the figure is their total — nothing prepared, nothing offered
 * that would double count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, connectingPaths, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const D3 = (JSON.parse(readFileSync(new URL('./fixtures/served-price-paying-subscribers-indirect-0929-d3.json', import.meta.url), 'utf8')) as { graph: Json }).graph;
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400d3', authenticated_user_id: null, request_id: 'r', user_text });
function world(graph: Json) {
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return { caps: createAgentCapabilities(d, store), store };
}
const SAID = 'From our last two price changes: every £1 on the Pro price loses us about 50 paying subscribers.';
const ARGS = {
  from_label: 'Pro plan price', to_label: 'Paying Pro subscribers', amount: -50, amount_unit: 'subscribers',
  per_source_change: 1, per_source_change_unit: 'GBP/month', quote: 'every £1 on the Pro price loses us about 50 paying subscribers',
};
const PATHS = [
  'Pro plan price → Monthly churn → Paying Pro subscribers',
  'Pro plan price → Monthly gross new Pro subscribers → Paying Pro subscribers',
  'Pro plan price → Price sensitivity → Monthly churn → Paying Pro subscribers',
];

describe('propose_link_effect on a pair the model connects only through other factors', () => {
  it('precondition (served D3): no direct link, three connecting paths', () => {
    expect((D3.edges as Json[]).some((e) => e.from === 'pro_plan_price' && e.to === 'paying_pro_subscribers')).toBe(false);
    expect(connectingPaths(D3, 'pro_plan_price', 'paying_pro_subscribers').map((p) => p.join(' → ')).sort()).toEqual(PATHS);
  });

  it('RED (served D3): refused `no_direct_link` with the paths, the figure said as their TOTAL, nothing prepared', async () => {
    const { caps, store } = world(D3);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'no_direct_link' }));
    expect((r.paths as string[][]).map((p) => p.join(' → ')).sort()).toEqual(PATHS);
    expect(String(r.detail)).toMatch(/total/i);
    expect(String(r.detail)).toMatch(/Repeat their figure in their own words/);
    expect(String(r.detail)).toMatch(/Never offer a new direct link/);
    expect(String(r.detail)).toMatch(/never ask for a strength band/i);
    expect(store.size()).toBe(0);
  });

  it('CONTROL: a pair the model does not connect at all stays `no_such_link` (no paths invented)', async () => {
    const { caps } = world(D3);
    const said = 'Every 50 paying subscribers we lose costs us £1 on the Pro price.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), {
      from_label: 'Paying Pro subscribers', to_label: 'Pro plan price', amount: 1, amount_unit: 'GBP/month',
      per_source_change: 50, per_source_change_unit: 'subscribers', quote: 'Every 50 paying subscribers we lose costs us £1 on the Pro price',
    }) as Json;
    expect(connectingPaths(D3, 'paying_pro_subscribers', 'pro_plan_price')).toEqual([]);
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_link' }));
    expect(r).not.toHaveProperty('paths');
  });
});
