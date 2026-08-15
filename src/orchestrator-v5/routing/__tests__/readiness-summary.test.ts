import { describe, expect, it } from 'vitest';

import { summariseReadiness } from '../readiness-summary.js';

type ReadinessPayload = Parameters<typeof summariseReadiness>[0];

const READY_OPTIONS: ReadinessPayload['options'] = [
  {
    option_id: 'opt_fast',
    label: 'Move quickly',
    status: 'ready',
    interventions: { fac_reach: 0.8 },
  },
  {
    option_id: 'opt_careful',
    label: 'Phase carefully',
    status: 'ready',
    interventions: { fac_reach: 0.4 },
  },
];

describe('summariseReadiness — canonical status/blocker projection', () => {
  it('surfaces an unreachable controllable factor from whole-status even when every option is ready', () => {
    const readiness = {
      status: 'needs_user_mapping',
      goal_node_id: 'goal_growth',
      goal_threshold: 0.7,
      options: READY_OPTIONS,
      blockers: [{
        factor_id: 'fac_capacity',
        factor_label: 'Delivery capacity',
        blocker_type: 'missing_value',
        suggested_action: 'add_value',
      }],
    } as ReadinessPayload;

    const summary = summariseReadiness(readiness);
    expect(summary.open_items).toHaveLength(1);
    expect(summary.open_items[0]).toMatchObject({ kind: 'option_needs_mapping' });
    expect(summary.prose).toContain('unresolved mapping');
    // Whole status wins over the factor-only blocker: never ask for an
    // invented scalar when the canonical producer says mapping.
    expect(summary.prose).not.toContain('missing effect value');
    expect(summary.prose).not.toContain('threshold');
  });

  it('exact ready stays ready when goal_threshold is absent', () => {
    const readiness = {
      status: 'ready',
      goal_node_id: 'goal_growth',
      options: READY_OPTIONS,
    } as ReadinessPayload;

    expect(summariseReadiness(readiness)).toEqual({ open_items: [], prose: '' });
  });

  it('whole needs_encoding status wins even when child option statuses look ready', () => {
    const readiness = {
      status: 'needs_encoding',
      goal_node_id: 'goal_growth',
      goal_threshold: 0.7,
      options: READY_OPTIONS,
    } as ReadinessPayload;

    const summary = summariseReadiness(readiness);
    expect(summary.open_items).toHaveLength(1);
    expect(summary.open_items[0].kind).toBe('option_needs_encoding');
    expect(summary.prose).toContain('effect scale');
  });

  it('blocked status is a model review, never reconstructed as a value request', () => {
    const readiness = {
      status: 'blocked',
      goal_node_id: '',
      options: [],
      blockers: [{
        option_id: 'opt_fast',
        factor_id: 'fac_capacity',
        blocker_type: 'missing_value',
      }],
    } as ReadinessPayload;

    const summary = summariseReadiness(readiness);
    expect(summary.open_items[0].kind).toBe('model_needs_review');
    expect(summary.prose).toContain('resolve the model issue');
    expect(summary.prose).not.toContain('effect value');
  });
});
