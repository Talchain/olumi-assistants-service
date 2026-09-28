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
import {
  definitionalLinkInUse, definitionalLinkOf, definitionalLinks, definitionalLinkRefusalText, identityRunUseFromFacts,
} from '../definitional-links.js';
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

describe('AIQ 5867435409 (1): refused only while the identity is IN USE — the last Run decides', () => {
  let clock = 0;
  const runFact = (enrichment: unknown, status?: string) => ({
    fact_type: 'run_analysis', noop: false,
    result: { enrichment: status === undefined ? enrichment : { ...(enrichment as object), analysis_status: status },
      computed_at: new Date(Date.UTC(2026, 8, 28, 9, 0, clock++)).toISOString() },
  });

  it('no Run yet → the link is in use (refused; the next Run decides)', () => {
    expect(identityRunUseFromFacts([])).toBeNull();
    expect(definitionalLinkInUse(graph, 'price', 'mrr', null)?.carrier_id).toBe('mrr');
  });

  it('the last Run EVALUATED the carrier → in use (refused)', () => {
    const use = identityRunUseFromFacts([runFact({ identity_evaluations: [{ node_id: 'mrr', evaluated: true }] })]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)?.carrier_id).toBe('mrr');
  });

  it('⭐ RED: the last Run WITHDREW it (_meta.identities_not_forwarded) → an ordinary belief: NOT refused', () => {
    const use = identityRunUseFromFacts([runFact({ _meta: { identities_not_forwarded: [{ node_id: 'mrr', reason: 'inferred_identity_inconsistent', frameless_node_ids: [] }] } })]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)).toBeNull();
  });

  it('⭐ RED: the last Run did not evaluate it (evaluated: false) → NOT refused', () => {
    const use = identityRunUseFromFacts([runFact({ identity_evaluations: [{ node_id: 'mrr', evaluated: false, withheld_reason: 'identity_zero_level' }] })]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)).toBeNull();
  });

  it('only the NEWEST run BY TIME decides (the one ordering core), and other facts are skipped', () => {
    const older = runFact({ _meta: { identities_not_forwarded: [{ node_id: 'mrr' }] } });
    const newer = runFact({ identity_evaluations: [{ node_id: 'mrr', evaluated: true }] });
    // Array position must not decide: the older withdrawing Run first, the newer evaluating one after.
    const use = identityRunUseFromFacts([{ fact_type: 'edit_graph', result: {} }, older, newer]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)?.carrier_id).toBe('mrr');
  });

  it('⭐ RED (DL verdict): a newer FAILED Run after a withdrawing one does not re-refuse — only successful Runs decide', () => {
    const withdrawing = runFact({ _meta: { identities_not_forwarded: [{ node_id: 'mrr' }] } });
    const failed = runFact({}, 'failed');
    const use = identityRunUseFromFacts([failed, withdrawing]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)).toBeNull();
  });

  it('a withdrawal of ANOTHER carrier leaves this one in use', () => {
    const use = identityRunUseFromFacts([runFact({ _meta: { identities_not_forwarded: [{ node_id: 'spend' }] } })]);
    expect(definitionalLinkInUse(graph, 'price', 'mrr', use)?.carrier_id).toBe('mrr');
    expect(definitionalLinkInUse(graph, 'ads', 'spend', use)).toBeNull();
  });
});

describe('AIQ 5867435409 (2): whose reading — an inferred identity is Olumi\'s reading, never stated as fact', () => {
  const inferred = {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === 'mrr' ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs'], stated_in_brief: false } } : n)),
  };

  it('⭐ RED: stated_in_brief false → "Olumi reads MRR as …", with the way out; never "is defined by"', () => {
    const text = definitionalLinkRefusalText(inferred, definitionalLinkOf(inferred, 'price', 'mrr')!);
    expect(text).toMatch(/^Olumi reads MRR as Pro plan price × Pro paying subscribers/);
    expect(text).toMatch(/That reading is Olumi's, not yours; if MRR isn't that, say so\./);
    expect(text).not.toContain('is defined by');
    // AIQ 5868909577: no promise of an action nobody can take.
    expect(text).not.toMatch(/I'll|I will|stop reading/i);
  });

  it('a declaration with no stated_in_brief is Olumi\'s reading too (never promoted to fact)', () => {
    const unknown = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'mrr' ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subs'] } } : n)) };
    expect(definitionalLinkRefusalText(unknown, definitionalLinkOf(unknown, 'price', 'mrr')!)).toMatch(/^Olumi reads/);
  });

  it('CONTROL: stated_in_brief true → stated as the brief\'s definition', () => {
    expect(definitionalLinkRefusalText(graph, definitionalLinkOf(graph, 'price', 'mrr')!)).toMatch(/^This link is defined by MRR =/);
  });
});
