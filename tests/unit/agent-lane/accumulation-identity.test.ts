/**
 * CEE #4: the ONE writer of the `accumulation` carrier fails closed, and says each refusal.
 */
import { describe, it, expect } from 'vitest';
import { admitAccumulationIdentities, withAccumulationCarriers } from '../../../src/orchestrator-v5/agent-lane/accumulation-identity.js';
import { NodeV3 } from '../../../src/schemas/cee-v3.js';

// Paul's brief: 250 Pro subscribers, 3% monthly churn (served frame: value 0.03, raw 3), +20 a month, within 12 months.
const nodes = [
  { id: 'goal', kind: 'goal', label: 'Pro MRR', goal_horizon_months: 12,
    nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs12'], stated_in_brief: false } },
  { id: 'price', kind: 'factor', label: 'Pro price', observed_state: { value: 49, unit: 'GBP', source: 'brief_extraction' } },
  { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 250, unit: 'subscribers' } },
  { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
  { id: 'adds', kind: 'factor', label: 'New Pro subscribers per month', observed_state: { value: 20, unit: 'subscribers/month' } },
  { id: 'subs12', kind: 'outcome', label: 'Pro subscribers at month 12' },
];
const userNodes = nodes.map((n) => ['subs', 'churn', 'adds'].includes(n.id)
  ? { ...n, observed_state: { ...n.observed_state!, source: 'brief_extraction' } } : n);
const edges = [
  { from: 'subs', to: 'subs12' }, { from: 'churn', to: 'subs12' }, { from: 'adds', to: 'subs12' }, { from: 'subs12', to: 'goal' },
  { from: 'price', to: 'goal' },
];
const decl = (over: Record<string, unknown> = {}) => ({
  outcome: 'Pro subscribers at month 12', operation: 'accumulation',
  factors: ['Pro subscribers', 'Monthly churn', 'New Pro subscribers per month'], provenance: 'inferred', ...over,
});

describe('admitAccumulationIdentities', () => {
  it('carries a well-formed declaration: positional ids, the HELD horizon, rate_scale 0.01, Olumi\'s reading', () => {
    const r = admitAccumulationIdentities(nodes, edges, [decl()]);
    expect(r.loss).toEqual([]);
    expect(r.carriers.get('subs12')).toEqual({
      operation: 'accumulation', factor_ids: ['subs', 'churn', 'adds'], horizon_months: 12, rate_scale: 0.01, stated_in_brief: false,
    });
    expect(admitAccumulationIdentities(nodes, edges, [decl({ provenance: 'explicit' })]).carriers.get('subs12')?.stated_in_brief).toBe(false);
  });

  it.each(['cee_inference', undefined])('an explicit declaration over one %s level remains Olumi\'s reading', (source) => {
    const mixed = userNodes.map((n) => n.id === 'churn'
      ? { ...n, observed_state: { ...n.observed_state!, source } } : n);
    const r = admitAccumulationIdentities(mixed, edges, [decl({ provenance: 'explicit' })]);
    expect(r.loss).toEqual([]);
    expect(r.carriers.get('subs12')).toMatchObject({ operation: 'accumulation', stated_in_brief: false });
  });

  it('all three user-stated or user-ratified levels carry the brief\'s levels even when the declaration is inferred', () => {
    const reviewed = userNodes.map((n) => n.id === 'churn'
      ? { ...n, observed_state: { ...n.observed_state!, source: 'user_confirmed' } } : n);
    expect(admitAccumulationIdentities(reviewed, edges, [decl({ provenance: 'explicit' })]).carriers.get('subs12')?.stated_in_brief).toBe(true);
    expect(admitAccumulationIdentities(reviewed, edges, [decl()]).carriers.get('subs12')?.stated_in_brief).toBe(true);
  });

  it.each([
    ['no admitted goal product', undefined],
    ['a non-product goal carrier', { operation: 'sum', factor_ids: ['price', 'subs12'], stated_in_brief: false }],
    ['an admitted goal product over today\'s stock instead', { operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: false }],
  ])('refuses when %s uses the projected stock, even if the drafter declared a goal product', (_why, identity) => {
    const unused = nodes.map((n) => n.id === 'goal' ? { ...n, nonlinear_identity: identity } : n);
    const declaredProduct = { outcome: 'Pro MRR', operation: 'product', factors: ['Pro price', 'Pro subscribers at month 12'], provenance: 'inferred' };
    const r = admitAccumulationIdentities(unused, edges, [decl(), declaredProduct]);
    expect(r.carriers.size).toBe(0);
    expect(r.loss).toHaveLength(1);
    expect(r.loss[0]!.reason).toContain('but nothing in the model works the goal out from it, so that was not used');
    expect(withAccumulationCarriers(unused, r.carriers)).toEqual(unused);
  });

  it('the written carrier survives NodeV3 (CEE #3 reader) byte-for-byte', () => {
    const r = admitAccumulationIdentities(nodes, edges, [decl()]);
    const written = withAccumulationCarriers(nodes, r.carriers).find((n) => n.id === 'subs12')!;
    expect(NodeV3.parse(written).nonlinear_identity).toEqual(r.carriers.get('subs12'));
  });

  const frames: [string, Parameters<typeof admitAccumulationIdentities>[0], number][] = [
    ['twice the raw levels (250 and 20)', nodes, 1960], // 2 × (500 + 40 × 12)
    ['caps before node frames or normalised values', nodes.map((n) => n.id === 'subs'
      ? { ...n, scale_frame: 2000, observed_state: { value: 0.25, raw_value: 250, cap: 1000, unit: 'subscribers' } }
      : n.id === 'adds' ? { ...n, scale_frame: 400, observed_state: { value: 0.1, raw_value: 20, cap: 200, unit: 'subscribers/month' } } : n), 6800],
    ['node frames when caps are not positive, rounding each up', nodes.map((n) => n.id === 'subs'
      ? { ...n, scale_frame: 1000.2, observed_state: { value: 250, cap: 0, unit: 'subscribers' } }
      : n.id === 'adds' ? { ...n, scale_frame: 200.2, observed_state: { value: 20, cap: -1, unit: 'subscribers/month' } } : n), 6826],
    ['raw levels when neither cap nor node frame is positive, rounding each up', nodes.map((n) => n.id === 'subs'
      ? { ...n, scale_frame: 0, observed_state: { value: 0.25, raw_value: 250.2, cap: 0, unit: 'subscribers' } }
      : n.id === 'adds' ? { ...n, scale_frame: -1, observed_state: { value: 0.1, raw_value: 20.2, cap: -1, unit: 'subscribers/month' } } : n), 1986],
    ['a zero stock with positive inflow', nodes.map((n) => n.id === 'subs'
      ? { ...n, observed_state: { value: 0, unit: 'subscribers' } } : n), 960],
  ];
  it.each(frames)('writes a positive carrier scale_frame from %s', (_why, input, expected) => {
    const r = admitAccumulationIdentities(input, edges, [decl()]);
    expect(r.loss).toEqual([]);
    const written = withAccumulationCarriers(input, r.carriers).find((n) => n.id === 'subs12')!;
    const read = NodeV3.parse(written);
    expect(read.scale_frame).toBe(expected);
    expect(read.nonlinear_identity?.operation).toBe('accumulation');
    expect(read.observed_state).toBeUndefined();
  });

  it('keeps an existing positive scale_frame on the carrier unchanged', () => {
    const framed = nodes.map((n) => n.id === 'subs12' ? { ...n, scale_frame: 1234.5 } : n);
    const r = admitAccumulationIdentities(framed, edges, [decl()]);
    expect(r.loss).toEqual([]);
    const written = withAccumulationCarriers(framed, r.carriers).find((n) => n.id === 'subs12')!;
    expect(NodeV3.parse(written).scale_frame).toBe(1234.5);
    expect(NodeV3.parse(written).nonlinear_identity?.operation).toBe('accumulation');
  });

  it('no accumulation declared → nothing written, nodes byte-identical (products are not read here)', () => {
    const product = { outcome: 'Pro MRR', operation: 'product', factors: ['Pro price', 'Pro subscribers at month 12'], provenance: 'inferred' };
    const r = admitAccumulationIdentities(nodes, edges, [product]);
    expect(r.carriers.size).toBe(0);
    expect(r.loss).toEqual([]);
    expect(withAccumulationCarriers(nodes, r.carriers)).toEqual(nodes);
  });

  const refusals: [string, Parameters<typeof admitAccumulationIdentities>, RegExp][] = [
    ['no held deadline', [nodes.map((n) => (n.id === 'goal' ? { ...n, goal_horizon_months: undefined } : n)), edges, [decl()]], /no deadline/],
    ['on the goal', [nodes, edges, [decl({ outcome: 'Pro MRR' })]], /goal itself/],
    ['two factors', [nodes, edges, [decl({ factors: ['Pro subscribers', 'Monthly churn'] })]], /exactly three/],
    ['a repeated factor', [nodes, edges, [decl({ factors: ['Pro subscribers', 'Monthly churn', 'Monthly churn'] })]], /not all different/],
    ['an unknown label', [nodes, edges, [decl({ factors: ['Pro subscribers', 'Churn', 'New Pro subscribers per month'] })]], /"Churn" is not in the model/],
    ['an input not a direct parent', [nodes, edges.filter((e) => e.from !== 'adds'), [decl()]], /does not feed directly/],
    ['churn per year', [nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 0.3, raw_value: 30, unit: '% per year' } } : n)), edges, [decl()]], /"Monthly churn" is given per year, not per month; give it per month and Olumi can use it/],
    ['churn as a fraction', [nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 0.03, unit: 'fraction' } } : n)), edges, [decl()]], /percentage per month/],
    ['churn in % of today', [nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 100, unit: '% of today' } } : n)), edges, [decl()]], /percentage per month/],
    ['no level today', [nodes.map((n) => (n.id === 'adds' ? { ...n, observed_state: undefined } : n)), edges, [decl()]], /today's level of "New Pro subscribers per month"/],
    ['churn of 100% (read as the LEVEL: framed value 1, raw 100)', [nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 1, raw_value: 100, unit: '%' } } : n)), edges, [decl()]], /outside what/],
    ['no positive frame computable', [nodes.map((n) => n.id === 'subs' || n.id === 'adds'
      ? { ...n, observed_state: { ...n.observed_state, value: 0 } } : n), edges, [decl()]], /its range could not be worked out/],
    ['a computed frame overflows', [nodes.map((n) => n.id === 'subs'
      ? { ...n, observed_state: { value: Number.MAX_VALUE, unit: 'subscribers' } } : n), edges, [decl()]], /its range could not be worked out/],
    ['an outcome already carrying a product', [nodes.map((n) => (n.id === 'subs12' ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false } } : n)), edges, [decl()]], /already worked out/],
  ];
  it.each(refusals)('refuses %s, says why, writes nothing', (_why, args, words) => {
    const r = admitAccumulationIdentities(...args);
    expect(r.carriers.size).toBe(0);
    expect(r.loss).toHaveLength(1);
    expect(r.loss[0]!.reason).toMatch(words);
    expect(r.loss[0]!.reason).toMatch(/nothing about it is assumed\.$/);
    expect(withAccumulationCarriers(args[0], r.carriers)).toEqual(args[0]);
  });

  it('the carrier never depends on the churn frame: a framed 3% (cap 20 → value 0.15) is carried exactly as cap 100 is (ISL applies rate_scale to the level)', () => {
    const cap20 = nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 0.15, raw_value: 3, cap: 20, unit: '%' } } : n));
    const cap100 = nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 0.03, raw_value: 3, cap: 100, unit: '%' } } : n));
    const r20 = admitAccumulationIdentities(cap20, edges, [decl()]);
    const r100 = admitAccumulationIdentities(cap100, edges, [decl()]);
    expect(r20.carriers.get('subs12')).toEqual(r100.carriers.get('subs12'));
    expect(withAccumulationCarriers(cap20, r20.carriers).find((n) => n.id === 'subs12')).toEqual(
      withAccumulationCarriers(cap100, r100.carriers).find((n) => n.id === 'subs12'));
  });
});
