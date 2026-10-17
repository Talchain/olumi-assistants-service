import { describe, it, expect } from 'vitest';
import { COACHING_SYSTEM } from '../../../cee/unified-pipeline/stages/coaching-pass.js';

const COACHING_CARDINALITY_CAPS = {
  strengthen_items: 4,
  bias_signals: 3,
  causal_claims: 8,
} as const;

describe('M6 — the stated caps ARE the prompt\'s caps', () => {
  it('every cap appears in the rendered prompt as the model is told it', () => {
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.strengthen_items} items`);
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.bias_signals},`);
    expect(COACHING_SYSTEM).toContain(`0-${COACHING_CARDINALITY_CAPS.causal_claims} claims`);
  });
});
