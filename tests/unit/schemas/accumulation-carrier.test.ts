/**
 * CEE #3 (accumulation identity, read-tolerant carrier). Contract: programme-docs
 * design/ACCUMULATION-CARRIER-CONTRACT-20261008.md. Before this member, `NodeV3`'s `.catch(undefined)` ERASED an
 * `operation: 'accumulation'` carrier on every read, so a model written with one lost it silently.
 */
import { describe, it, expect } from 'vitest';
import { NodeV3 } from '../../../src/schemas/cee-v3.js';
import { definitionalLinkOf, definitionalLinkRefusalText } from '../../../src/orchestrator-v5/compose/definitional-links.js';
import { nodesUnderANonlinearIdentity } from '../../../src/orchestrator-v5/agent-lane/admit-model.js';

const ACC = {
  operation: 'accumulation',
  factor_ids: ['subs_today', 'churn', 'new_subs'],
  horizon_months: 12,
  rate_scale: 0.01,
  stated_in_brief: false,
} as const;

const node = (nonlinear_identity: unknown) => ({ id: 'subs_m12', kind: 'factor', label: 'Pro subscribers at month 12', nonlinear_identity });

describe('NodeV3 reads an accumulation carrier (no silent erase)', () => {
  it('keeps a well-formed accumulation carrier byte-for-byte', () => {
    const r = NodeV3.safeParse(node(ACC));
    expect(r.success).toBe(true);
    expect(r.success && r.data.nonlinear_identity).toEqual(ACC);
  });

  it('keeps product and sum carriers unchanged (control)', () => {
    const product = { operation: 'product', factor_ids: ['price', 'subs_m12'], stated_in_brief: true };
    const sum = { operation: 'sum', factor_ids: ['a', 'b'], stated_in_brief: false };
    expect((NodeV3.parse(node(product)) as { nonlinear_identity?: unknown }).nonlinear_identity).toEqual(product);
    expect((NodeV3.parse(node(sum)) as { nonlinear_identity?: unknown }).nonlinear_identity).toEqual(sum);
  });

  it.each([
    ['two factors', { ...ACC, factor_ids: ['subs_today', 'churn'] }],
    ['four factors', { ...ACC, factor_ids: ['subs_today', 'churn', 'new_subs', 'x'] }],
    ['a repeated factor', { ...ACC, factor_ids: ['subs_today', 'churn', 'churn'] }],
    ['no horizon', { ...ACC, horizon_months: undefined }],
    ['horizon 0', { ...ACC, horizon_months: 0 }],
    ['horizon 121', { ...ACC, horizon_months: 121 }],
    ['a fractional horizon', { ...ACC, horizon_months: 12.5 }],
    ['rate_scale 0', { ...ACC, rate_scale: 0 }],
    ['rate_scale above 1', { ...ACC, rate_scale: 100 }],
    ['an extra key (addends)', { ...ACC, addends: ['x'] }],
    ['no stated_in_brief', { ...ACC, stated_in_brief: undefined }],
  ])('erases a malformed accumulation carrier (%s) and keeps the node', (_why, carrier) => {
    const r = NodeV3.safeParse(node(carrier));
    expect(r.success).toBe(true);
    expect(r.success && r.data.nonlinear_identity).toBeUndefined();
    expect(r.success && r.data.id).toBe('subs_m12');
  });
});

describe('readers treat an accumulation as a definition, never as a product', () => {
  const graph = {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'subs_today', kind: 'factor', label: 'Pro subscribers today' },
      { id: 'churn', kind: 'factor', label: 'Monthly churn' },
      { id: 'new_subs', kind: 'factor', label: 'New subscribers per month' },
      { id: 'other', kind: 'factor', label: 'Brand' },
      node(ACC),
    ],
    edges: [],
  };

  it('each input → carrier link is definitional, with the horizon; a non-input is not', () => {
    for (const from of ACC.factor_ids) {
      const link = definitionalLinkOf(graph, from, 'subs_m12');
      expect(link?.operation).toBe('accumulation');
      expect(link?.horizon_months).toBe(12);
    }
    expect(definitionalLinkOf(graph, 'other', 'subs_m12')).toBeNull();
  });

  it('words the refusal as worked out over the months, never as a product formula', () => {
    const link = definitionalLinkOf(graph, 'churn', 'subs_m12')!;
    const text = definitionalLinkRefusalText(graph, link);
    expect(text).toBe(
      'Olumi works out Pro subscribers at month 12 from Pro subscribers today, Monthly churn and New subscribers per month '
      + "over 12 months, at steady monthly rates. So this link's strength isn't used in the analysis, and I haven't changed "
      + 'it. Change Pro subscribers today, Monthly churn or New subscribers per month instead. That\'s Olumi\'s reading, not '
      + "yours; if Pro subscribers at month 12 isn't worked out that way, say so.",
    );
    expect(text).not.toContain('×');
    const stated = definitionalLinkRefusalText(graph, { ...link, stated_in_brief: true });
    expect(stated).toBe(
      'Pro subscribers at month 12 is worked out from Pro subscribers today, Monthly churn and New subscribers per month '
      + "over 12 months, at steady monthly rates. So this link's strength isn't used in the analysis, and I haven't changed "
      + 'it. Change Pro subscribers today, Monthly churn or New subscribers per month instead.',
    );
    expect(stated).not.toContain("Olumi's");
  });

  it('the limit-sentence distrust set includes the accumulation carrier and the goal (conservative)', () => {
    expect([...nodesUnderANonlinearIdentity(graph)].sort()).toEqual(['goal', 'subs_m12']);
    const plain = { ...graph, nodes: graph.nodes.filter((n) => n.id !== 'subs_m12') };
    expect(nodesUnderANonlinearIdentity(plain).size).toBe(0);
  });
});
