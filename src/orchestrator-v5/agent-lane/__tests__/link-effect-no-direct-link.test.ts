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
import { createAgentCapabilities, connectingPaths, pathCensus, PATHS_SHOWN, type InternalDispatch } from '../runtime/agent-capabilities.js';
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

  it('AIQ 5883735180 (ii) — served D3 has UNSIZED links on its paths: no comparison, and the split offer (never guessed, never one path)', async () => {
    const { caps, store } = world(D3);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r).not.toHaveProperty('model_total');
    const detail = String(r.detail);
    expect(detail).toMatch(/has not sized every link on those paths, so it cannot compare its own total with theirs yet/);
    expect(detail).toMatch(/how their figure splits between "Monthly churn", "Monthly gross new Pro subscribers" and "Price sensitivity"/);
    expect(detail).toMatch(/record each one on its own link/);
    expect(detail).toMatch(/Never guess the split, never put the whole figure on one path/);
    expect(store.size()).toBe(0);
  });

  it('AIQ 5883735180 (i) — every link on the paths sized, units chaining: the model\'s total is the sum over paths of the products, said as a check', async () => {
    const sized = structuredClone(D3);
    const size = (from: string, to: string, amount: number, amount_unit: string, per_source_change_unit: string): void => {
      const e = (sized.edges as Json[]).find((x) => x.from === from && x.to === to)!;
      e.provenance = { ...(e.provenance ?? {}), magnitude: 'olumi_estimate', natural_effect: { amount, amount_unit, per_source_change: 1, per_source_change_unit } };
    };
    size('monthly_churn', 'paying_pro_subscribers', -15, 'subscribers', 'percentage points');
    size('monthly_gross_new_pro_subscribers', 'paying_pro_subscribers', 1, 'subscribers', 'subscribers/month');
    size('pro_plan_price', 'price_sensitivity', 0.01, 'index', 'GBP/month');
    size('price_sensitivity', 'monthly_churn', 2, 'percentage points', 'index');
    // By hand: churn 0.1 × −15 = −1.5 · sign-ups −5 × 1 = −5 · sensitivity 0.01 × 2 × −15 = −0.3 → −6.8 subscribers per £1.
    const { caps, store } = world(sized);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r.refusal).toBe('no_direct_link');
    expect(r.model_total.amount).toBeCloseTo(-6.8, 9);
    expect(r.model_total).toEqual(expect.objectContaining({ per_source_change: 1, amount_unit: 'subscribers', per_source_change_unit: 'GBP/month' }));
    expect(String(r.detail)).toMatch(/The model\u2019s own total through those paths is about -6\.8 subscribers per 1 GBP\/month/);
    expect(String(r.detail)).toMatch(/as a check/);
    expect(store.size()).toBe(0);
  });

  it('(i) FAILS CLOSED when a unit does not chain exactly: no comparison is invented', async () => {
    const sized = structuredClone(D3);
    for (const e of sized.edges as Json[]) {
      if (['monthly_churn', 'monthly_gross_new_pro_subscribers', 'price_sensitivity'].includes(e.from) || (e.from === 'pro_plan_price' && e.to === 'price_sensitivity')) {
        e.provenance = { ...(e.provenance ?? {}), magnitude: 'olumi_estimate', natural_effect: { amount: 1, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'percent/month' } };
      }
    }
    const { caps } = world(sized);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r).not.toHaveProperty('model_total');
    expect(String(r.detail)).toMatch(/cannot compare its own total with theirs yet/);
  });

  it('CONTROL: a pair the model does not connect at all stays `no_such_link` (no paths invented)', async () => {
    const { caps } = world(D3);
    const said = 'Every 50 paying subscribers we gain adds £1 to the Pro price.';
    const r = await caps.proposeLinkEffect!(ctxSaying(said), {
      from_label: 'Paying Pro subscribers', to_label: 'Pro plan price', amount: 1, amount_unit: 'GBP/month',
      per_source_change: 50, per_source_change_unit: 'subscribers', quote: 'Every 50 paying subscribers we gain adds £1 to the Pro price',
    }) as Json;
    expect(connectingPaths(D3, 'paying_pro_subscribers', 'pro_plan_price')).toEqual([]);
    expect(r).toEqual(expect.objectContaining({ ok: false, refusal: 'no_such_link' }));
    expect(r).not.toHaveProperty('paths');
  });

  it('a pair connected ONLY by a route longer than four links is `no_direct_link`, never `no_such_link` (exact reachability)', async () => {
    const { caps, store } = world(routes([['a', 'b', 'c', 'd']]));
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r.refusal).toBe('no_direct_link');
    expect((r.paths as string[][]).map((p) => p.length)).toEqual([6]); // five links
    expect(store.size()).toBe(0);
  });
});

/**
 * ⭐ THE PATH CENSUS (PR Review CHANGES_REQUIRED @ e5fb963c): a total is published only over EVERY route. The walk
 * used to stop at four links and keep the first six paths, and the total summed that sample.
 */
type Route = string[];
/** D3's two ends, with ONLY the given routes between them (each a list of middle-node ids). `sized: false` leaves a route's last link unsized. */
function routes(list: Route[], opts: { unsizedRoute?: number } = {}): Json {
  const g = structuredClone(D3);
  const price = (g.nodes as Json[]).find((n) => n.id === 'pro_plan_price')!;
  const subs = (g.nodes as Json[]).find((n) => n.id === 'paying_pro_subscribers')!;
  const factor = (g.nodes as Json[]).find((n) => n.id === 'monthly_churn')!;
  g.nodes = (g.nodes as Json[]).filter((n) => n.kind !== 'factor' || n.id === price.id || n.id === subs.id);
  g.edges = [];
  const sized = (from: string, to: string, amount: number, amount_unit: string, per_source_change_unit: string): Json => ({
    from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: amount < 0 ? 'negative' : 'positive',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount, amount_unit, per_source_change: 1, per_source_change_unit } },
  });
  const seenNodes = new Set<string>();
  list.forEach((mids, k) => {
    for (const id of mids) {
      if (!seenNodes.has(id)) { seenNodes.add(id); (g.nodes as Json[]).push({ ...structuredClone(factor), id, label: `Route ${id}` }); }
    }
    const chain = [price.id, ...mids, subs.id];
    for (let i = 0; i + 1 < chain.length; i += 1) {
      const from = chain[i]!; const to = chain[i + 1]!;
      if ((g.edges as Json[]).some((e) => e.from === from && e.to === to)) continue;
      const first = i === 0; const last = i + 2 === chain.length;
      const e = sized(from, to, last ? -(k + 1) : 1, last ? 'subscribers' : 'widgets', first ? 'GBP/month' : 'widgets');
      if (last && opts.unsizedRoute === k) e.provenance = { source: 'cee_hypothesis' };
      (g.edges as Json[]).push(e);
    }
  });
  return g;
}
const seven = Array.from({ length: 7 }, (_, k) => [`m${k + 1}`]);

describe('the path census: a total only over EVERY route', () => {
  it('SEVEN sized parallel routes: the total sums all seven (−1 −2 … −7 = −28), and the Agent is told there are seven', async () => {
    const g = routes(seven);
    expect(pathCensus(g, 'pro_plan_price', 'paying_pro_subscribers')).toEqual(expect.objectContaining({ complete: true, reachable: true }));
    expect(PATHS_SHOWN).toBe(6); // precondition: one route is past the shown cap
    const { caps, store } = world(g);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r.refusal).toBe('no_direct_link');
    expect(r.paths).toHaveLength(6);
    expect(r.paths_total).toBe(7);
    expect(r.model_total.amount).toBeCloseTo(-28, 9); // the capped sample would say −21
    expect(String(r.detail)).toMatch(/and 1 more route\b/);
    expect(store.size()).toBe(0);
  });

  it('SEVEN routes, the SEVENTH (past the shown six) unsized → NO total; the split names every route', async () => {
    const { caps } = world(routes(seven, { unsizedRoute: 6 }));
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r.refusal).toBe('no_direct_link');
    expect(r).not.toHaveProperty('model_total');
    expect(String(r.detail)).toMatch(/cannot compare its own total with theirs yet/);
    expect(String(r.detail)).toMatch(/"Route m7"/); // the unshown route is still a place their figure could go
  });

  it('an INCOMPLETE census (more routes than it walks) → no total, and says so; never a sum over a sample', async () => {
    // 9 × 9 = 81 routes of three links, every one sized.
    const layered = Array.from({ length: 81 }, (_, k) => [`a${Math.floor(k / 9)}`, `b${k % 9}`]);
    const g = routes(layered);
    const census = pathCensus(g, 'pro_plan_price', 'paying_pro_subscribers');
    expect(census).toEqual(expect.objectContaining({ complete: false, reachable: true }));
    const { caps } = world(g);
    const r = await caps.proposeLinkEffect!(ctxSaying(SAID), ARGS) as Json;
    expect(r.refusal).toBe('no_direct_link');
    expect(r).not.toHaveProperty('model_total');
    expect(r.paths_complete).toBe(false);
    expect(r).not.toHaveProperty('paths_total');
    expect(String(r.detail)).toMatch(/more routes than Olumi can check here, so it cannot compare its own total/);
  });
});
