import { describe, it, expect } from 'vitest';
import { MoeSpikeResultPayload, MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';

function validResult() {
  return {
    version: MOE_SPIKE_VERSION,
    framing_quality: 'moderate',
    diversity_assessment: 'diverse',
    stakeholder_completeness: 'partial',
    bias_signals: [
      { bias_type: 'anchoring', signal: 'Over-reliance on initial price point', claim_id: null, confidence: 0.8 },
    ],
    missing_elements: ['time_horizon'],
  };
}

describe('MoeSpikeResultPayload', () => {
  it('parses a valid result', () => {
    const result = MoeSpikeResultPayload.safeParse(validResult());
    expect(result.success).toBe(true);
  });

  it('rejects wrong enum for framing_quality', () => {
    const result = MoeSpikeResultPayload.safeParse({ ...validResult(), framing_quality: 'excellent' });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const bad = validResult();
    bad.bias_signals = [{ bias_type: 'anchoring', signal: 'A signal that is long enough', claim_id: null, confidence: 1.5 }];
    const result = MoeSpikeResultPayload.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects >3 bias signals', () => {
    const bad = validResult();
    bad.bias_signals = Array.from({ length: 4 }, (_, i) => ({
      bias_type: `type_${i}`,
      signal: 'A signal that is long enough',
      claim_id: null,
      confidence: 0.5,
    }));
    const result = MoeSpikeResultPayload.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects signal shorter than 12 characters', () => {
    const bad = validResult();
    bad.bias_signals = [{ bias_type: 'anchoring', signal: 'short', claim_id: null, confidence: 0.5 }];
    const result = MoeSpikeResultPayload.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects non-null claim_id (enforced at schema level)', () => {
    const bad = validResult();
    bad.bias_signals = [{ bias_type: 'anchoring', signal: 'A signal that is long enough', claim_id: 'invented_id' as unknown as null, confidence: 0.5 }];
    const result = MoeSpikeResultPayload.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
