/**
 * Shared GraphV3T fixtures for D1 handler tests. One graph that exercises
 * every D1 handler's needs:
 *
 *   nodes:
 *     g-revenue       — goal
 *     f-churn         — factor with cap=100, unit="%", percentage scale
 *     f-budget        — factor with cap=100000, unit="£", currency
 *     f-quality       — factor without cap, no unit (ratio in [0,1])
 *     f-uncapped      — factor without cap, no unit, no observed_state.value cap
 *     o-launch        — option
 *
 *   edges:
 *     f-budget → g-revenue   strength.mean = 0.4 (moderate, positive)
 *     f-churn  → g-revenue   strength.mean = -0.6 (moderate, negative)
 *     f-quality → g-revenue  strength.mean = 0.95 (very strong)
 */

import type { GraphV3T } from '../../../../../schemas/cee-v3.js';

export function buildD1Fixture(): GraphV3T {
  return {
    nodes: [
      {
        id: 'g-revenue',
        kind: 'goal',
        label: 'Revenue',
      },
      {
        id: 'f-churn',
        kind: 'factor',
        label: 'Customer churn',
        observed_state: {
          value: 0.04,
          raw_value: 4,
          unit: '%',
          cap: 100,
        },
      },
      {
        id: 'f-budget',
        kind: 'factor',
        label: 'Marketing budget',
        observed_state: {
          value: 0.4,
          raw_value: 40000,
          unit: '£',
          cap: 100000,
        },
      },
      {
        id: 'f-quality',
        kind: 'factor',
        label: 'Product quality',
        observed_state: {
          value: 0.7,
        },
      },
      {
        id: 'f-uncapped',
        kind: 'factor',
        label: 'Headcount',
        observed_state: {
          value: 12,
          raw_value: 12,
          unit: 'people',
        },
      },
      {
        id: 'o-launch',
        kind: 'option',
        label: 'Launch now',
      },
    ],
    edges: [
      {
        from: 'f-budget',
        to: 'g-revenue',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
      {
        from: 'f-churn',
        to: 'g-revenue',
        strength: { mean: -0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
      {
        from: 'f-quality',
        to: 'g-revenue',
        strength: { mean: 0.95, std: 0.05 },
        exists_probability: 0.95,
        effect_direction: 'positive',
      },
    ],
  };
}
