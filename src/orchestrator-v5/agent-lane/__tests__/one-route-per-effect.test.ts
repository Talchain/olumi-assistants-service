/**
 * ⛔ ONE EFFECT, ONE ROUTE (PR Review CHANGES_REQUIRED on #2276 @ df299ae5): a machine-authored factor → risk link whose
 * risk only re-draws the factor's own direct links, the same way, is left out and said; the risk stays.
 * Rows 1–6: the pure rule, bound by ids. Row 7: the saved lsF A-0 draft through the real build (0 LLM calls).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { oneRoutePerEffect, type RouteEdge } from '../one-route-per-effect.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const USER = new Set(['brief_extraction', 'user_specified']);
const kinds = (m: Record<string, string>) => new Map(Object.entries(m));
const e = (from: string, to: string, d: 'positive' | 'negative', source = 'cee_hypothesis'): RouteEdge =>
  ({ from, to, effect_direction: d, provenance: { source } });
const pairs = (es: readonly RouteEdge[]) => es.map((x) => `${x.from}->${x.to}`);

describe('the rule, on the exact shape', () => {
  const K = kinds({ price: 'factor', sens: 'risk', newsubs: 'factor', mrr: 'goal' });
  const L = new Map([['price', 'Pro plan price'], ['sens', 'Price sensitivity'], ['newsubs', 'New Pro subscribers']]);
  it('RED 1 — lsF A-0: price → sensitivity (+) → new subscribers (−) beside price → new subscribers (−): price → sensitivity goes, said', () => {
    const r = oneRoutePerEffect([e('price', 'sens', 'positive'), e('sens', 'newsubs', 'negative'), e('price', 'newsubs', 'negative'), e('newsubs', 'mrr', 'positive')], K, L, USER);
    expect(pairs(r.edges)).toEqual(['sens->newsubs', 'price->newsubs', 'newsubs->mrr']);
    expect(r.loss).toHaveLength(1);
    expect(r.loss[0]).toMatchObject({ field_path: 'edges[price::sens].one_route', before: 'positive', after: null, severity: 'info' });
    expect(r.loss[0]!.reason).toBe('The link from "Pro plan price" to "Price sensitivity" was left out: "Pro plan price" already moves "New Pro subscribers" straight, the same way, so a route through "Price sensitivity" would count that effect twice. "Price sensitivity" stays in the model as a risk to "New Pro subscribers".');
  });
  it('CONTROL 2 — a TEMPERING risk (its route runs against the direct link) is a separate downside: kept', () => {
    const r = oneRoutePerEffect([e('price', 'sens', 'positive'), e('sens', 'newsubs', 'positive'), e('price', 'newsubs', 'negative')], K, L, USER);
    expect(r.loss).toEqual([]);
    expect(pairs(r.edges)).toContain('price->sens');
  });
  it('CONTROL 3 — a risk with ANY other effect (a quantity the factor does not reach straight) is kept', () => {
    const K3 = kinds({ price: 'factor', sens: 'risk', newsubs: 'factor', brand: 'factor' });
    const r = oneRoutePerEffect([e('price', 'sens', 'positive'), e('sens', 'newsubs', 'negative'), e('sens', 'brand', 'negative'), e('price', 'newsubs', 'negative')], K3, L, USER);
    expect(r.loss).toEqual([]);
  });
  it('CONTROL 4 — the USER stated factor → risk: their claim, kept', () => {
    const r = oneRoutePerEffect([e('price', 'sens', 'positive', 'brief_extraction'), e('sens', 'newsubs', 'negative'), e('price', 'newsubs', 'negative')], K, L, USER);
    expect(r.loss).toEqual([]);
  });
  it('CONTROL 5 — no direct link: the risk IS the route, kept', () => {
    const r = oneRoutePerEffect([e('price', 'sens', 'positive'), e('sens', 'newsubs', 'negative')], K, L, USER);
    expect(r.loss).toEqual([]);
  });
  it('6 — two parents: only the parent whose direct link it re-draws loses its route; the other keeps driving the risk', () => {
    const K6 = kinds({ price: 'factor', ads: 'factor', sens: 'risk', newsubs: 'factor' });
    const r = oneRoutePerEffect([e('price', 'sens', 'positive'), e('ads', 'sens', 'negative'), e('sens', 'newsubs', 'negative'), e('price', 'newsubs', 'negative')], K6, L, USER);
    expect(pairs(r.edges)).toEqual(['ads->sens', 'sens->newsubs', 'price->newsubs']);
  });
});

describe('the saved lsF A-0 draft through the real build', () => {
  const FX = JSON.parse(readFileSync(new URL('./fixtures/lsF-A0-candidate-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: unknown };
  function run() {
    let registered: { nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[] } | null = null;
    const fn = vi.fn(async () => ({ text: JSON.stringify(FX.candidate) })) as unknown as CallStructuredModel;
    const dispatch = (async (path: string, body: unknown) => {
      if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
      return { status: 200, json: { versions: [] } };
    }) as unknown as InternalDispatch;
    return buildModelFromBrief('99999999-9999-4999-8999-999999999999', FX.brief, dispatch, fn)
      .then((r) => ({ r: r as Record<string, unknown>, g: registered as unknown as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } }));
  }
  it('RED 7 — the registered model has no price → price sensitivity link; the risk and its link to new subscribers stay; said', async () => {
    const { r, g } = await run();
    const has = (from: string, to: string) => g.edges.some((x) => x.from === from && x.to === to);
    expect(has('pro_plan_price', 'monthly_new_pro_subscribers'), 'PRECONDITION: the direct link').toBe(true);
    expect(has('pro_plan_price', 'price_sensitivity')).toBe(false);
    expect(has('price_sensitivity', 'monthly_new_pro_subscribers')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'price_sensitivity' && n.kind === 'risk')).toBe(true);
    expect(JSON.stringify(r)).toMatch(/would count that effect twice/);
  });
});
