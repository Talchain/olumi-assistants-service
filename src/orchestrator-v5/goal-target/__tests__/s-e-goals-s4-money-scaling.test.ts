import { expect, it } from 'vitest';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
import { readNewLimit } from '../../agent-lane/stated-limit.js';

it.each([1, 6])('money amounts advance once: 20k → 160k £%i figures, <22x', amount => {
  const costGraph = { nodes: [{ id: 'total-cost', kind: 'factor', label: 'Total cost', quantity_frame: 'level',
    observed_state: { value: 0.5, raw_value: 150000, cap: 300000, unit: '£' } }], edges: [] };
  const small = `£${amount} `.repeat(20_000);
  const large = `£${amount} `.repeat(160_000);
  const timing = scalingRatio(() => readNewLimit(costGraph, small, 6), () => readNewLimit(costGraph, large, 6));
  console.log(`S4 money scaling (20k -> 160k amounts): ${timing.detail}`);
  expect(timing.ratio).toBeLessThan(22);
}, 120_000);
