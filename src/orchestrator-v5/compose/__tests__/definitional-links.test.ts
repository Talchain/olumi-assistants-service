/**
 * R3-9 (AIQ #72 5866734772; DL 5866746362, owner Canonical) — A DEFINITIONAL LINK IS NOT A BELIEF A USER CAN EDIT.
 *
 * Under an evaluated identity (MRR = price × subscribers) the analysis computes the carrier from its operands and never
 * reads the operand edges' strengths. A user's strength edit on price → MRR was stored, then silently ignored. ONE
 * predicate names those edges (every operand AND addend of a declared `nonlinear_identity`, into its carrier), read off
 * the RAW persisted graph: CEE's `NodeV3` drops an identity it does not model (addends, `sum`), and a predicate over the
 * parsed graph would call a real definition an ordinary belief. Each edge writer refuses there, in the user's words.
 */
import { describe, it, expect } from 'vitest';
import { definitionalLinkOf, definitionalLinks, definitionalLinkRefusalText } from '../definitional-links.js';
import { composeEdgeIdentity } from '../edge-address.js';

const graph = {
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: true } },
    { id: 'price', kind: 'factor', label: 'Pro plan price' },
    { id: 'subs', kind: 'factor', label: 'Pro paying subscribers' },
    { id: 'churn', kind: 'factor', label: 'Monthly churn' },
    { id: 'spend', kind: 'factor', label: 'Total spend', nonlinear_identity: { operation: 'sum', factor_ids: ['ads', 'features'], addends: ['tools'], stated_in_brief: true } },
    { id: 'ads', kind: 'factor', label: 'Advertising' },
    { id: 'features', kind: 'factor', label: 'Feature investment' },
    { id: 'tools', kind: 'factor', label: 'Tooling' },
  ],
  edges: [
    { from: 'price', to: 'mrr' }, { from: 'subs', to: 'mrr' }, { from: 'churn', to: 'subs' },
    { from: 'ads', to: 'spend' }, { from: 'features', to: 'spend' }, { from: 'tools', to: 'spend' },
  ],
};

describe('R3-9 — the ONE definitional-link predicate', () => {
  it('names every operand edge of a product, into its carrier', () => {
    expect(definitionalLinkOf(graph, 'price', 'mrr')?.carrier_id).toBe('mrr');
    expect(definitionalLinkOf(graph, 'subs', 'mrr')?.carrier_id).toBe('mrr');
  });

  it('names the ADDEND edges too, and a sum identity CEE\'s NodeV3 would drop (read off the raw graph)', () => {
    expect(definitionalLinkOf(graph, 'ads', 'spend')).not.toBeNull();
    expect(definitionalLinkOf(graph, 'tools', 'spend')).not.toBeNull();
  });

  it('control: an ordinary belief edge (churn → subscribers) is NOT definitional', () => {
    expect(definitionalLinkOf(graph, 'churn', 'subs')).toBeNull();
  });

  it('direction matters: the carrier → operand direction is not the definition', () => {
    expect(definitionalLinkOf(graph, 'mrr', 'price')).toBeNull();
  });

  it('the set form is keyed by the card\'s own edge identity and holds exactly the definitional edges', () => {
    const set = definitionalLinks(graph);
    expect([...set].sort()).toEqual([
      composeEdgeIdentity('ads', 'spend'), composeEdgeIdentity('features', 'spend'), composeEdgeIdentity('price', 'mrr'),
      composeEdgeIdentity('subs', 'mrr'), composeEdgeIdentity('tools', 'spend'),
    ].sort());
  });

  it('no graph, no nodes, a malformed identity → nothing definitional (never throws)', () => {
    expect(definitionalLinks(null).size).toBe(0);
    expect(definitionalLinkOf({ nodes: [{ id: 'x', nonlinear_identity: { factor_ids: 'nope' } }] }, 'a', 'x')).toBeNull();
  });

  it('the refusal says the definition in the user\'s labels and names what to change instead', () => {
    const product = definitionalLinkRefusalText(graph, definitionalLinkOf(graph, 'price', 'mrr')!);
    expect(product).toContain('MRR = Pro plan price × Pro paying subscribers');
    expect(product).toMatch(/change Pro plan price or Pro paying subscribers instead/i);
    const sum = definitionalLinkRefusalText(graph, definitionalLinkOf(graph, 'tools', 'spend')!);
    expect(sum).toContain('Total spend = Advertising + Feature investment + Tooling');
  });
});
