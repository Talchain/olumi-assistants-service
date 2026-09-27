/**
 * SLICE C2 — `buildAddRiskTransaction` (Canonical #70 5855234599), the add-risk door's own builder. The door refuses
 * every kind pair but factor → risk, risk → outcome and risk → goal ITSELF (never relying on `v3-validator.ts`), every
 * link is Olumi's placeholder hypothesis, and the node carries {id, kind, label} only.
 */
import { describe, it, expect } from 'vitest';
import { buildAddRiskTransaction } from '../add-risk-transaction.js';

const view = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Choose a price' },
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'share', kind: 'outcome', label: 'Market share' },
    { id: 'orphan', kind: 'outcome', label: 'Brand buzz' },
    { id: 'price', kind: 'factor', label: 'Price' },
    { id: 'opt', kind: 'option', label: 'Raise to £59' },
    { id: 'old_risk', kind: 'risk', label: 'Churn spike' },
  ],
  edges: [{ from: 'price', to: 'share' }, { from: 'share', to: 'goal' }, { from: 'dec', to: 'opt' }, { from: 'opt', to: 'price' }],
};
const build = (links: unknown[], label = 'Competitive response', extra: Record<string, unknown> = {}) =>
  buildAddRiskTransaction({ risk: { label, ...extra }, links }, view);

describe('buildAddRiskTransaction — one held batch, the ruled kind pairs only', () => {
  it('builds add_node {id, kind, label} FIRST, then one placeholder hypothesis link each (cee_hypothesis, defaulted)', () => {
    const r = build([{ from_id: 'price', effect_direction: 'positive' }, { to_id: 'goal', effect_direction: 'negative' }, { to_id: 'share', effect_direction: 'negative' }]);
    expect(r.matched).toBe(true);
    if (!r.matched) return;
    const [node, ...edges] = r.proposal.operations;
    expect(node).toEqual({ op: 'add_node', path: 'risk_competitive_response', value: { id: 'risk_competitive_response', kind: 'risk', label: 'Competitive response' } });
    expect(edges.map((e) => e.path)).toEqual(['price::risk_competitive_response', 'risk_competitive_response::goal', 'risk_competitive_response::share']);
    for (const e of edges) {
      const v = e.value as { defaulted?: unknown; provenance?: { source?: unknown }; strength?: { mean?: number } };
      expect(e.op).toBe('add_edge');
      expect(v.defaulted).toBe(true);
      expect(v.provenance?.source).toBe('cee_hypothesis');
    }
    expect((edges[1]!.value as { strength: { mean: number } }).strength.mean).toBeLessThan(0);
  });

  it.each([
    ['risk → factor (a risk is not a mediator)', [{ to_id: 'goal', effect_direction: 'negative' }, { to_id: 'price', effect_direction: 'negative' }]],
    ['risk → option', [{ to_id: 'goal', effect_direction: 'negative' }, { to_id: 'opt', effect_direction: 'negative' }]],
    ['risk → risk', [{ to_id: 'goal', effect_direction: 'negative' }, { to_id: 'old_risk', effect_direction: 'negative' }]],
    ['goal → risk', [{ to_id: 'goal', effect_direction: 'negative' }, { from_id: 'goal', effect_direction: 'positive' }]],
    ['option → risk (the validator allows it; this door does not)', [{ to_id: 'goal', effect_direction: 'negative' }, { from_id: 'opt', effect_direction: 'positive' }]],
    ['decision → risk', [{ to_id: 'goal', effect_direction: 'negative' }, { from_id: 'dec', effect_direction: 'positive' }]],
  ])('RED row: %s is refused by the builder itself', (_name, links) => {
    expect(build(links as unknown[])).toEqual({ matched: false, reason: 'kind_pair_not_allowed' });
  });

  it('refuses zero links, a risk that threatens nothing, one that cannot reach the goal, and a repeated pair', () => {
    expect(build([])).toEqual({ matched: false, reason: 'no_links' });
    expect(build([{ from_id: 'price', effect_direction: 'positive' }])).toEqual({ matched: false, reason: 'no_affects_link' });
    expect(build([{ to_id: 'orphan', effect_direction: 'negative' }])).toEqual({ matched: false, reason: 'risk_unreachable' });
    expect(build([{ to_id: 'goal', effect_direction: 'negative' }, { to_id: 'goal', effect_direction: 'positive' }])).toEqual({ matched: false, reason: 'duplicate_link' });
  });

  it('refuses an unknown id, a link naming both or neither end, a duplicate label, and a taken or malformed id', () => {
    expect(build([{ to_id: 'nope', effect_direction: 'negative' }])).toEqual({ matched: false, reason: 'node_not_found' });
    expect(build([{ from_id: 'price', to_id: 'goal', effect_direction: 'negative' }])).toEqual({ matched: false, reason: 'link_endpoint_invalid' });
    expect(build([{ effect_direction: 'negative' }])).toEqual({ matched: false, reason: 'link_endpoint_invalid' });
    expect(build([{ to_id: 'goal', effect_direction: 'negative' }], '  churn SPIKE ')).toEqual({ matched: false, reason: 'risk_label_exists' });
    expect(build([{ to_id: 'goal', effect_direction: 'negative' }], 'X', { id: 'price' })).toEqual({ matched: false, reason: 'risk_id_collision' });
    expect(build([{ to_id: 'goal', effect_direction: 'negative' }], 'X', { id: 'Bad Id' })).toEqual({ matched: false, reason: 'risk_id_invalid' });
    expect(buildAddRiskTransaction({ risk: { label: 'X' }, links: [{ to_id: 'goal', effect_direction: 'negative', strength: 0.9 }] }, view))
      .toEqual({ matched: false, reason: 'parameters_invalid' });
    expect(buildAddRiskTransaction({ risk: { label: 'X' }, links: [] }, null)).toEqual({ matched: false, reason: 'no_graph' });
  });
});
