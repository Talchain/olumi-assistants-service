/**
 * Recovery Batch C, gap 2 (DL lease 12 Oct): the goal's stated target basis (`goal_target_basis`: reference, denominator,
 * period, effect timing) decides which goal chance may be said, so a change to it alone must make a stored Run STALE.
 * It joins the analysis hash ONLY WHEN PRESENT (and well-formed), so every existing hash stays byte-identical.
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';

type Rec = Record<string, any>;

const BASIS = {
  quantity_frame: 'change', target_frame: 'change_abs', target_raw: 10, reference: 'today',
  denominator: 'today’s productivity (monthly development capacity)', period_months: 3, period_kind: 'at_end',
  effect_unit: '% of today’s productivity per added person, at month three', effects_at_period_end: true,
  also_required: ['code quality maintained'], source: 'olumi_reading',
};

const graph = (basis?: unknown): Rec => ({
  nodes: [
    { id: 'devs', kind: 'factor', label: 'Additional developers hired', category: 'controllable', scale_frame: 10,
      observed_state: { value: 0, baseline: 0, unit: 'people', source: 'brief_extraction', raw_value: 0, cap: 10 } },
    { id: 'productivity', kind: 'goal', label: 'Productivity', quantity_frame: 'change', goal_threshold_frame: 'change_abs',
      goal_threshold_raw: 10, goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold: 0.1,
      ...(basis === undefined ? {} : { goal_target_basis: basis }) },
  ],
  edges: [{ from: 'devs', to: 'productivity', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
  options: [
    { id: 'two', status: 'ready', interventions: { devs: { value: 0.2, raw_value: 2, unit: 'people', target_match: { node_id: 'devs' } } } },
    { id: 'carry_on', status: 'ready', is_baseline: true, interventions: {} },
  ],
  goal_node_id: 'productivity',
});

describe('goal_target_basis in the analysis hash — only when present', () => {
  it('PIN: an existing fixture with no basis hashes byte-identically (graph-identity golden: bc48670191eca62b)', () => {
    const golden = {
      nodes: [
        { id: 'budget', kind: 'factor', label: 'Budget', category: 'controllable', observed_state: { value: 100, baseline: 100, unit: 'GBP', source: 'brief_extraction' } },
        { id: 'goal', kind: 'goal', label: 'Success', goal_threshold: 0.8 },
      ],
      edges: [{ from: 'budget', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
      options: [{ id: 'opt-1', status: 'ready', is_baseline: true, interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } } }],
      goal_node_id: 'goal',
    };
    expect(computeAnalysisAffectingGraphHash(golden as never)).toBe('bc48670191eca62b');
  });

  it('absent and malformed bases hash exactly as no basis (no existing hash moves)', () => {
    const none = computeAnalysisAffectingGraphHash(graph() as never);
    expect(computeAnalysisAffectingGraphHash(graph({ reference: 'yesterday' }) as never)).toBe(none);
    expect(computeAnalysisAffectingGraphHash(graph(null) as never)).toBe(none);
  });

  it('RED: a basis-only change makes the stored Run stale (period, timing, denominator each move the hash)', () => {
    const base = computeAnalysisAffectingGraphHash(graph(BASIS) as never);
    expect(base).not.toBe(computeAnalysisAffectingGraphHash(graph() as never));
    expect(computeAnalysisAffectingGraphHash(graph({ ...BASIS, period_months: 6 }) as never)).not.toBe(base);
    expect(computeAnalysisAffectingGraphHash(graph({ ...BASIS, effects_at_period_end: false }) as never)).not.toBe(base);
    expect(computeAnalysisAffectingGraphHash(graph({ ...BASIS, denominator: 'today’s output' }) as never)).not.toBe(base);
    // CONTROL: the same basis hashes the same (deterministic).
    expect(computeAnalysisAffectingGraphHash(graph({ ...BASIS }) as never)).toBe(base);
  });
});
