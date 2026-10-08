/**
 * CEE #4: the ONE writer of the `accumulation` carrier fails closed, and says each refusal.
 */
import { describe, it, expect } from 'vitest';
import { admitAccumulationIdentities, withAccumulationCarriers } from '../../../src/orchestrator-v5/agent-lane/accumulation-identity.js';
import { NodeV3 } from '../../../src/schemas/cee-v3.js';

// Paul's brief: 250 Pro subscribers, 3% monthly churn (served frame: value 0.03, raw 3), +20 a month, within 12 months.
const nodes = [
  { id: 'goal', kind: 'goal', label: 'Pro MRR', goal_horizon_months: 12 },
  { id: 'subs', kind: 'factor', label: 'Pro subscribers', observed_state: { value: 250, unit: 'subscribers' } },
  { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
  { id: 'adds', kind: 'factor', label: 'New Pro subscribers per month', observed_state: { value: 20, unit: 'subscribers/month' } },
  { id: 'subs12', kind: 'outcome', label: 'Pro subscribers at month 12' },
];
const edges = [
  { from: 'subs', to: 'subs12' }, { from: 'churn', to: 'subs12' }, { from: 'adds', to: 'subs12' }, { from: 'subs12', to: 'goal' },
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
    expect(admitAccumulationIdentities(nodes, edges, [decl({ provenance: 'explicit' })]).carriers.get('subs12')?.stated_in_brief).toBe(true);
  });

  it('the written carrier survives NodeV3 (CEE #3 reader) byte-for-byte', () => {
    const r = admitAccumulationIdentities(nodes, edges, [decl()]);
    const written = withAccumulationCarriers(nodes, r.carriers).find((n) => n.id === 'subs12')!;
    expect(NodeV3.parse(written).nonlinear_identity).toEqual((written as { nonlinear_identity: unknown }).nonlinear_identity);
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
    ['an outcome already carrying a product', [nodes.map((n) => (n.id === 'subs12' ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: false } } : n)), edges, [decl()]], /already worked out/],
  ];
  it.each(refusals)('refuses %s, says why, writes nothing', (_why, args, words) => {
    const r = admitAccumulationIdentities(...args);
    expect(r.carriers.size).toBe(0);
    expect(r.loss).toHaveLength(1);
    expect(r.loss[0]!.reason).toMatch(words);
    expect(r.loss[0]!.reason).toMatch(/nothing about it is assumed\.$/);
  });

  it('the carrier never depends on the churn frame: a framed 3% (cap 20 → value 0.15) is carried exactly as cap 100 is (ISL applies rate_scale to the level)', () => {
    const cap20 = nodes.map((n) => (n.id === 'churn' ? { ...n, observed_state: { value: 0.15, raw_value: 3, unit: '%' } } : n));
    expect(admitAccumulationIdentities(cap20, edges, [decl()]).carriers.get('subs12')).toEqual(
      admitAccumulationIdentities(nodes, edges, [decl()]).carriers.get('subs12'));
  });
});
