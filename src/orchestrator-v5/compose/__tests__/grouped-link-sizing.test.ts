import { describe, expect, it } from 'vitest';
import { groupedGoalPathLinks, groupedLinkSizingAction, groupedLinkSizingLines } from '../grouped-link-sizing.js';

const graph = (override: Record<string, unknown> = {}) => ({
  nodes: [
    { id: 'option', kind: 'option', label: 'Raise prices' },
    { id: 'price', kind: 'factor', label: 'Price change', unit: '%' },
    { id: 'mrr', kind: 'outcome', label: 'Monthly recurring revenue', unit: 'GBP/month' },
    { id: 'goal', kind: 'goal', label: 'Monthly recurring revenue', unit: 'GBP/month' },
  ],
  edges: [
    { from: 'option', to: 'price', strength: { mean: 0.5 }, provenance: { magnitude: 'unmarked' } },
    { from: 'price', to: 'mrr', strength: { mean: 0.5 }, provenance: { magnitude: 'olumi_placeholder' } },
    { from: 'mrr', to: 'goal', strength: { mean: 0.5 }, provenance: { magnitude: 'olumi_placeholder' } },
  ], ...override,
});

describe('grouped goal-path sizing', () => {
  it('binds every missing link by endpoint identity and asks in units', () => {
    const action = groupedLinkSizingAction(graph(), 'size-1');
    expect(action?.label).toBe('Size the links Olumi needs');
    expect(action?.links.map((x) => [x.from, x.to])).toEqual([['price', 'mrr'], ['mrr', 'goal']]);
    expect(action?.links[0]?.question).toContain('in GBP/month');
  });

  it('does not fabricate an estimate, but exposes an existing natural reading', () => {
    const g = graph();
    (g.edges[1] as Record<string, unknown>).provenance = { magnitude: 'olumi_placeholder', natural_effect: {
      amount: 12000, amount_unit: 'GBP/month', per_source_change: 10, per_source_change_unit: '%',
    } };
    const links = groupedGoalPathLinks(g);
    expect(links[0]?.estimate?.display).toContain('12000');
    expect(links[1]?.estimate).toBeUndefined();
    const action = groupedLinkSizingAction(g, 'size-1')!;
    expect(groupedLinkSizingLines(action)).toEqual([
      'Price change → Monthly recurring revenue: Olumi\'s reading: 12000 GBP/month per 10 %',
      expect.stringContaining('Monthly recurring revenue → Monthly recurring revenue: needs your figure:'),
    ]);
  });

  it('leaves ordinary graphs without a missing goal-path link alone', () => {
    const g = graph();
    for (const e of g.edges.slice(1)) (e as Record<string, unknown>).provenance = { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 1, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: '%' } };
    expect(groupedLinkSizingAction(g, 'size-2')).toBeUndefined();
  });
});
