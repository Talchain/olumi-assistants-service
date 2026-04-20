import { describe, expect, it } from 'vitest';

import { CEEGraphResponseV3 } from '../cee-v3.js';

/**
 * V5 Group 1, Task A.1: coaching.widening_log and coaching.bias_signals must
 * survive the CEE V3 Zod boundary. Prior behaviour stripped these (default
 * strip mode on the narrow schema); they are now declared as optional
 * unknown arrays.
 */

const MINIMAL_BASE = {
  schema_version: '3.0' as const,
  nodes: [
    {
      id: 'goal_1',
      kind: 'goal' as const,
      label: 'Grow revenue',
    },
  ],
  edges: [],
  options: [],
  goal_node_id: 'goal_1',
  causal_claims: [],
};

describe('CEE V3 coaching schema (V5 Group 1, Task A.1)', () => {
  it('preserves widening_log when present in the coaching block', () => {
    const input = {
      ...MINIMAL_BASE,
      coaching: {
        summary: 'short',
        strengthen_items: [],
        widening_log: [{ step: 1, note: 'widened options' }],
      },
    };

    const parsed = CEEGraphResponseV3.parse(input);
    expect(parsed.coaching?.widening_log).toEqual(input.coaching.widening_log);
  });

  it('preserves bias_signals when present in the coaching block', () => {
    const biasSignals = [{ type: 'anchoring', confidence: 'high', evidence: 'reference price' }];
    const input = {
      ...MINIMAL_BASE,
      coaching: {
        summary: 'short',
        strengthen_items: [],
        bias_signals: biasSignals,
      },
    };

    const parsed = CEEGraphResponseV3.parse(input);
    expect(parsed.coaching?.bias_signals).toEqual(biasSignals);
  });

  it('omits widening_log and bias_signals when absent (optional)', () => {
    const input = {
      ...MINIMAL_BASE,
      coaching: {
        summary: 'short',
        strengthen_items: [],
      },
    };

    const parsed = CEEGraphResponseV3.parse(input);
    expect(parsed.coaching?.widening_log).toBeUndefined();
    expect(parsed.coaching?.bias_signals).toBeUndefined();
  });

  it('accepts both widening_log and bias_signals alongside summary + strengthen_items', () => {
    const input = {
      ...MINIMAL_BASE,
      coaching: {
        summary: 'the whole picture',
        strengthen_items: [
          { id: 's1', label: 'option B', detail: 'add a reversible alternative', action_type: 'widen' },
        ],
        widening_log: [{ step: 1 }],
        bias_signals: [{ type: 'anchoring' }],
      },
    };

    const parsed = CEEGraphResponseV3.parse(input);
    expect(parsed.coaching?.summary).toBe('the whole picture');
    expect(parsed.coaching?.strengthen_items).toHaveLength(1);
    expect(parsed.coaching?.widening_log).toHaveLength(1);
    expect(parsed.coaching?.bias_signals).toHaveLength(1);
  });
});
