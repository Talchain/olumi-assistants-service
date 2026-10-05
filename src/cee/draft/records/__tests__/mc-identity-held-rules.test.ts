import { describe, expect, it } from 'vitest';
import { projectDraftRecords } from '../seam.js';
import { BRIEF, sealedRecordsVNext } from './compile-spec/sealed-fixture-vnext.js';
import type { DraftRecordSet } from '../grammar.js';
function project(r: DraftRecordSet, brief = BRIEF) {
  const p = projectDraftRecords(r, brief); if (!p.ok) throw Error(p.detail); return p.projection;
}
function cascade(stated = false, retainedCause = false) {
  const r = sealedRecordsVNext(); const a = r.claims.length;
  r.claims.push({ claim_kind: 'factor', label: 'Stranded lever' });
  const b = r.claims.length;
  const quote = 'Supplier strain is 23 customers.';
  const statedIndex = r.stated_items.length;
  if (stated) r.stated_items.push({ kind: 'figure', source_quote: quote, value: 23, value_literal: '23', unit: 'customers', unit_literals: ['customers'], quantity: statedIndex, role: 'baseline' });
  else r.claims.push({ claim_kind: 'factor', label: 'Supplier strain' });
  const c = r.claims.length;
  r.claims.push({ claim_kind: 'risk', label: 'Service risk' });
  const middle = stated ? { to_stated: statedIndex } : { to_claim: b };
  const fromMiddle = stated ? { from_stated: statedIndex } : { from_claim: b };
  r.claims.push({ claim_kind: 'causal_link', label: 'option sets stranded lever', from_stated: 3, to_claim: a, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'stranded lever causes strain', from_claim: a, ...middle, effect: 'positive' },
    { claim_kind: 'causal_link', label: 'strain causes service risk', ...fromMiddle, to_claim: c, effect: 'positive' });
  if (retainedCause) r.claims.push({ claim_kind: 'causal_link', label: 'customers also cause strain', from_claim: 2, ...middle, effect: 'positive' });
  return project(r, `${BRIEF} ${quote}`);
}
// Science 5 Oct Round 4: conditional e1 disclosure is authorised.
describe('MC R1 goal quantity authority', () => {
  it('RED R1: claim on goal quantity is set aside and disclosed', () => {
    const r = sealedRecordsVNext(); const p = project(r); const claim = r.claims.find(c => c.quantity === 0)!;
    expect(p.graph.nodes.some(n => n.label === claim.label)).toBe(false);
    expect(p.dropped).toContainEqual(expect.objectContaining({ label: claim.label, reason: 'goal_quantity_projection_set_aside' }));
    const outcome = p.graph.nodes.find(n => n.id === '8a21277c')!;
    expect(outcome).toMatchObject({kind:'outcome',quantity_ref:0,provenance:{provenance_class:'stated'}});
    const cause = p.graph.edges.find(e => e.provenance?.source_quote === r.stated_items[10]!.source_quote && e.provenance?.natural_effect?.amount === -300)!;
    expect(cause.to).toBe(outcome.id);
    expect(p.dropped).toContainEqual(expect.objectContaining({node_id:'f171bf57',reason:'goal_quantity_projection_set_aside'}));
  });
  it('CONTRAST R1: a non-goal claim remains the endpoint carrier', () => {
    const r = sealedRecordsVNext(); const p = project(r); const claim = r.claims.find(c => c.quantity === 9)!;
    const node = p.graph.nodes.find(n => n.label === claim.label)!;
    expect(node.quantity_ref).toBe(9);
    expect(p.graph.edges.some(e => e.from === node.id && e.provenance?.natural_effect?.amount === -300)).toBe(true);
    expect(p.dropped.some(d => d.label === claim.label && (d.reason as string) === 'goal_quantity_projection_set_aside')).toBe(false);
  });
});
describe('MC R3 only the post-prune inferred cascade', () => {
  it('RED R3: a two-level lost-cause cascade is withdrawn and terminates deterministically', () => {
    const p = cascade();
    for (const label of ['Stranded lever', 'Supplier strain', 'Service risk']) {
      expect(p.graph.nodes.some(n => n.label === label), label).toBe(false);
      expect(p.dropped.filter(d => d.label === label && d.reason === 'unconnected_to_goal'), label).toHaveLength(1);
    }
    expect(cascade()).toEqual(p);
    expect(p.graph.edges.every(e => p.graph.nodes.some(n => n.id === e.from) && p.graph.nodes.some(n => n.id === e.to))).toBe(true);
  });
  it('CONTRAST R3: the user-stated orphan stays, is disclosed, and still causes its risk', () => {
    const p = cascade(true); const node = p.graph.nodes.find(n => n.provenance?.source_quote === 'Supplier strain is 23 customers.')!;
    expect(node).toBeDefined(); expect(node.observed_state?.raw_value).toBe(23);
    expect(p.dropped).toContainEqual(expect.objectContaining({ node_id: node.id, reason: 'unconnected_to_goal', value: 23 }));
    expect(p.graph.edges.some(e => e.from === node.id && p.graph.nodes.find(n => n.id === e.to)?.label === 'Service risk')).toBe(true);
  });
  it('CONTRAST R3: an inert risk with a surviving cause stays', () => {
    const p = cascade(false, true);
    expect(p.graph.nodes.some(n => n.label === 'Supplier strain')).toBe(true);
    expect(p.graph.nodes.some(n => n.label === 'Service risk')).toBe(true);
    expect(p.dropped.some(d => d.label === 'Service risk')).toBe(false);
  });
});
