/** P14b review finding 3: the suggestion gate and factor door share punctuation-aware label equality. */
import { describe, expect, it } from 'vitest';

import { FACTOR_METHOD, factorGate, factorsTurnForReadback } from '../../agent-lane/method-turn/widen-turn.js';
import { buildAddFactorTransaction, recheckAddFactorBatch } from '../add-factor-transaction.js';

const seed = (label: string) => ({
  goal_node_id: 'goal',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Sustainable business' },
    { id: 'revenue', kind: 'outcome', label: 'Revenue' },
    { id: 'capacity', kind: 'factor', category: 'external', label },
  ],
  edges: [{ from: 'capacity', to: 'revenue' }, { from: 'revenue', to: 'goal' }],
});
const request = (label: string) => ({ factors: [{ label, link: { to_id: 'revenue', effect_direction: 'positive' } }] });
const gateOn = (existing: string, proposed: string) => {
  const turn = factorsTurnForReadback({ graph: seed(existing) });
  expect(turn.kind).toBe('run_factors');
  if (turn.kind !== 'run_factors') throw new Error('factor turn unavailable');
  return factorGate(turn, [{ label: proposed, category: FACTOR_METHOD.categories[2], anchor_id: 'revenue',
    direction: 'positive', since: 'steadier capacity supports customer delivery' }]);
};

describe('P14b duplicate label fold, shared by gate and atomic factor door', () => {
  it.each([
    ['typographic apostrophe', 'Founder’s capacity', "Founder's capacity"],
    ['typographic double quotes', 'Team “capacity”', 'Team "capacity"'],
  ])('%s: gate classifies the existing name as FD-NO-DUP', (_kind, existing, proposed) => {
    const gate = gateOn(existing, proposed);
    expect(gate.kept).toEqual([]);
    expect(gate.dropped).toHaveLength(1);
    expect(gate.dropped[0]!.failed).toContain('FD-NO-DUP');
  });

  it.each([
    ['apostrophe', 'Founder’s capacity', "Founder's capacity"],
    ['double quotes', 'Team “capacity”', 'Team "capacity"'],
  ])('%s: direct transaction rejects an existing folded name', (_kind, existing, proposed) => {
    expect(buildAddFactorTransaction(request(proposed), seed(existing)))
      .toEqual({ matched: false, reason: 'factor_label_exists' });
  });

  it('the atomic transaction refuses a repeated folded name within its own batch', () => {
    expect(buildAddFactorTransaction({ factors: [
      { label: 'Founder’s capacity', link: { to_id: 'revenue', effect_direction: 'positive' } },
      { label: "Founder's capacity", link: { to_id: 'revenue', effect_direction: 'positive' } },
    ] }, seed('Delivery capacity'))).toEqual({ matched: false, reason: 'factor_label_repeated' });
  });

  it('approve rechecks the same folded name after a canvas add', () => {
    const proposal = buildAddFactorTransaction(request("Founder's capacity"), seed('Delivery capacity'));
    expect(proposal.matched).toBe(true);
    if (!proposal.matched) throw new Error('factor proposal unavailable');
    expect(recheckAddFactorBatch(proposal.proposal.operations, seed('Founder’s capacity'))).toBe('factor_label_exists');
  });

  it('case and whitespace still fold, while distinct punctuation stays distinct', () => {
    expect(gateOn('Founder’s capacity', "  FOUNDER'S   capacity ").dropped.flatMap((d) => d.failed)).toContain('FD-NO-DUP');
    expect(buildAddFactorTransaction(request("  FOUNDER'S   capacity "), seed('Founder’s capacity')))
      .toEqual({ matched: false, reason: 'factor_label_exists' });
    expect(gateOn('Founders capacity', "Founder's capacity").kept.map((s) => s.label)).toEqual(["Founder's capacity"]);
    expect(buildAddFactorTransaction(request("Founder's capacity"), seed('Founders capacity')).matched).toBe(true);
  });
});
