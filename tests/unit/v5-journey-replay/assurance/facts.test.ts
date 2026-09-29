import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  pickFactorTarget,
  pickFactorTargets,
  readFactorValue,
  chooseMutationValue,
  formatMutationValue,
  summariseHandlerFacts,
  type PersistedGraph,
} from '../../../../tools/v5-journey-replay/assurance/facts.js';

const graph: PersistedGraph = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Scale delivery' },
    { id: 'opt_1', kind: 'option', label: 'Hire locally' },
    {
      id: 'fac_budget_1',
      kind: 'factor',
      label: 'Budget',
      observed_state: { value: 0.5, raw_value: 100000, unit: 'GBP', cap: 200000 },
    },
    {
      id: 'fac_speed_1',
      kind: 'factor',
      label: 'Delivery speed',
      observed_state: { value: 0.7, raw_value: 12, unit: 'weeks' },
    },
    // factor with no observed_state — not mutable
    { id: 'fac_prior_1', kind: 'factor', label: 'Team morale' },
  ],
  edges: [],
};

describe('facts — pure helpers', () => {
  it('pickFactorTarget prefers a "budget" scale-defined factor (unit + cap)', () => {
    const t = pickFactorTarget(graph);
    expect(t?.id).toBe('fac_budget_1');
    expect(t?.currentValue).toBe(100000); // raw_value (human scale)
    expect(t?.unit).toBe('GBP');
    expect(t?.cap).toBe(200000);
  });

  it('pickFactorTarget falls back to a human-scale factor when no scale-defined one', () => {
    // fac_speed_1 has a unit but no cap → not "scale-defined"; it lands in the
    // human-scale fallback (raw_value 12 ≥ 1).
    const noBudget: PersistedGraph = { nodes: graph.nodes!.filter((n) => n.id !== 'fac_budget_1') };
    expect(pickFactorTarget(noBudget)?.id).toBe('fac_speed_1');
  });

  it('pickFactorTargets ranks clean (raw 0 / raw>=1) above malformed sub-1 raw', () => {
    const g: PersistedGraph = {
      nodes: [
        { id: 'fac_malformed', kind: 'factor', label: 'Malformed Cost', observed_state: { value: 0.5, raw_value: 0.5, unit: '£', cap: 300000 } },
        { id: 'fac_clean_zero', kind: 'factor', label: 'Clean Cost', observed_state: { value: 0, raw_value: 0, unit: '£', cap: 300000 } },
      ],
    };
    const ranked = pickFactorTargets(g);
    expect(ranked[0]?.id).toBe('fac_clean_zero'); // raw 0 (rank 0) beats raw 0.5 (rank 2)
    expect(ranked.map((r) => r.id)).toContain('fac_malformed'); // still a candidate, just last
  });

  it('pickFactorTarget returns null when no mutable factor', () => {
    expect(pickFactorTarget({ nodes: [{ id: 'fac_x', kind: 'factor', label: 'X' }] })).toBeNull();
    expect(pickFactorTarget(null)).toBeNull();
  });

  it('readFactorValue reads raw_value (preferred) by node id', () => {
    expect(readFactorValue(graph, 'fac_budget_1')).toBe(100000);
    expect(readFactorValue(graph, 'fac_speed_1')).toBe(12);
    expect(readFactorValue(graph, 'missing')).toBeNull();
  });

  it('chooseMutationValue: in-cap, same-scale, clearly different', () => {
    expect(chooseMutationValue(100000, 200000)).toBe(60000); // frac 0.5 → 30% of cap
    expect(chooseMutationValue(40000, 150000)).toBe(105000); // frac 0.27 → 70% of cap
    expect(chooseMutationValue(0, 200000)).toBe(140000); // unset → 70% of cap
    expect(chooseMutationValue(90, 100)).toBe(30); // percent factor
    expect(chooseMutationValue(100000, null)).toBe(200007); // no cap → double+offset
    expect(chooseMutationValue(null, null)).toBe(40000);
  });

  it('chooseMutationValue never returns the current value and stays in cap', () => {
    for (const [cur, cap] of [
      [100000, 200000], [40000, 150000], [0, 200000], [90, 100], [15, 50], [3, 12],
    ] as Array<[number, number]>) {
      const t = chooseMutationValue(cur, cap);
      expect(t).not.toBe(Math.round(cur));
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(cap);
    }
  });

  it('formatMutationValue renders unit-appropriate text', () => {
    expect(formatMutationValue(105000, '£')).toBe('£105000');
    expect(formatMutationValue(25, '%')).toBe('25%');
    expect(formatMutationValue(38, 'engineers')).toBe('38 engineers');
    expect(formatMutationValue(9, null)).toBe('9');
  });
});

describe('facts — summariseHandlerFacts (mock client)', () => {
  function mockClient(rows: Array<{ action_type?: string; noop?: boolean }>): SupabaseClient {
    return {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    } as unknown as SupabaseClient;
  }

  it('counts total, byActionType, noopCount', async () => {
    const client = mockClient([
      { action_type: 'run_analysis', noop: false },
      { action_type: 'set_factor_value', noop: false },
      { action_type: 'run_analysis', noop: true },
    ]);
    const s = await summariseHandlerFacts(client, 'sB');
    expect(s.total).toBe(3);
    expect(s.byActionType['run_analysis']).toBe(2);
    expect(s.byActionType['set_factor_value']).toBe(1);
    expect(s.noopCount).toBe(1);
  });

  it('graphless scenario → zero facts', async () => {
    const s = await summariseHandlerFacts(mockClient([]), 'sA');
    expect(s.total).toBe(0);
    expect(s.byActionType).toEqual({});
  });
});
