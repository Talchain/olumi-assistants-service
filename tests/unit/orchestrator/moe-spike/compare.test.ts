import { describe, it, expect } from 'vitest';
import { compareSpikeWithBil } from '../../../../src/orchestrator/moe-spike/compare.js';
import type { MoeSpikeResult } from '../../../../src/orchestrator/moe-spike/schemas.js';
import type { BriefIntelligence } from '../../../../src/schemas/brief-intelligence.js';
import { MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';

function makeSpike(overrides: Partial<MoeSpikeResult> = {}): MoeSpikeResult {
  return {
    version: MOE_SPIKE_VERSION,
    framing_quality: 'moderate',
    diversity_assessment: 'diverse',
    stakeholder_completeness: 'partial',
    bias_signals: [],
    missing_elements: [],
    ...overrides,
  };
}

function makeBil(overrides: Partial<BriefIntelligence> = {}): BriefIntelligence {
  return {
    contract_version: '1.0.0',
    goal: { label: 'Test goal', measurable: true, confidence: 0.8 },
    options: [
      { label: 'Option A', confidence: 0.7 },
      { label: 'Option B', confidence: 0.6 },
      { label: 'Option C', confidence: 0.5 },
    ],
    constraints: [],
    factors: [],
    completeness_band: 'medium',
    ambiguity_flags: [],
    missing_elements: [],
    dsk_cues: [],
    ...overrides,
  };
}

describe('compareSpikeWithBil', () => {
  it('bias agreement: matching bias_types appear in bias_agreed', () => {
    const spike = makeSpike({
      bias_signals: [{ bias_type: 'anchoring', signal: 'Over-reliance on initial price', claim_id: null, confidence: 0.8 }],
    });
    const bil = makeBil({
      dsk_cues: [{ bias_type: 'Anchoring', signal: 'price anchoring detected', claim_id: null, confidence: 0.7 }],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.bias_agreed).toContain('anchoring');
    expect(result.bias_spike_only).toHaveLength(0);
    expect(result.bias_bil_only).toHaveLength(0);
  });

  it('spike-only bias signals tracked', () => {
    const spike = makeSpike({
      bias_signals: [{ bias_type: 'sunk_cost', signal: 'Already invested heavily in option A', claim_id: null, confidence: 0.9 }],
    });
    const bil = makeBil();

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.bias_spike_only).toContain('sunk_cost');
  });

  it('bil-only bias signals tracked', () => {
    const spike = makeSpike();
    const bil = makeBil({
      dsk_cues: [{ bias_type: 'confirmation', signal: 'confirmation bias detected', claim_id: null, confidence: 0.8 }],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.bias_bil_only).toContain('confirmation');
  });

  it('framing agreement: medium completeness_band maps to moderate', () => {
    const spike = makeSpike({ framing_quality: 'moderate' });
    const bil = makeBil({ completeness_band: 'medium' });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.framing_agrees).toBe(true);
  });

  it('verdict: spike_adds_value requires ≥2 high-confidence spike-only bias signals not in BIL', () => {
    const spike = makeSpike({
      bias_signals: [
        { bias_type: 'sunk_cost', signal: 'Heavy prior investment in option A', claim_id: null, confidence: 0.8 },
        { bias_type: 'groupthink', signal: 'Team consensus without dissent recorded', claim_id: null, confidence: 0.75 },
      ],
    });
    const bil = makeBil(); // no dsk_cues

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.verdict).toBe('spike_adds_value');
  });

  it('verdict: spike_adds_value rejected when BIL has same bias_type (contradiction)', () => {
    const spike = makeSpike({
      bias_signals: [
        { bias_type: 'sunk_cost', signal: 'Heavy prior investment in option A', claim_id: null, confidence: 0.8 },
        { bias_type: 'groupthink', signal: 'Team consensus without dissent recorded', claim_id: null, confidence: 0.75 },
      ],
    });
    // BIL has one of the same types — contradicts spike exclusivity
    const bil = makeBil({
      dsk_cues: [{ bias_type: 'sunk_cost', signal: 'sunk cost detected differently', claim_id: null, confidence: 0.6 }],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    // Only 1 high-conf spike-only (groupthink), sunk_cost is agreed not spike-only
    expect(result.verdict).not.toBe('spike_adds_value');
  });

  it('verdict: spike_worse when ≥2 bil-only and 0 spike-only', () => {
    const spike = makeSpike();
    const bil = makeBil({
      dsk_cues: [
        { bias_type: 'anchoring', signal: 'anchoring detected', claim_id: null, confidence: 0.7 },
        { bias_type: 'confirmation', signal: 'confirmation bias found', claim_id: null, confidence: 0.8 },
      ],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.verdict).toBe('spike_worse');
  });

  it('verdict: equivalent when neither threshold met', () => {
    const spike = makeSpike({
      bias_signals: [{ bias_type: 'anchoring', signal: 'Over-reliance on initial price', claim_id: null, confidence: 0.8 }],
    });
    const bil = makeBil({
      dsk_cues: [{ bias_type: 'anchoring', signal: 'anchoring detected', claim_id: null, confidence: 0.7 }],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.verdict).toBe('equivalent');
  });

  it('missing elements comparison works case-insensitively', () => {
    const spike = makeSpike({ missing_elements: ['time_horizon', 'risk_factors'] });
    const bil = makeBil({ missing_elements: ['time_horizon'] });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.missing_elements_spike_only).toContain('risk_factors');
    expect(result.missing_elements_bil_only).toHaveLength(0);
  });

  it('verdict: equivalent when both have zero bias signals', () => {
    const spike = makeSpike({ bias_signals: [] });
    const bil = makeBil({ dsk_cues: [] });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    expect(result.verdict).toBe('equivalent');
    expect(result.spike_bias_count).toBe(0);
    expect(result.bil_bias_count).toBe(0);
  });

  it('verdict: equivalent when BIL has 1 signal and spike has 0 (below spike_worse threshold)', () => {
    const spike = makeSpike({ bias_signals: [] });
    const bil = makeBil({
      dsk_cues: [{ bias_type: 'anchoring', signal: 'anchoring detected', claim_id: null, confidence: 0.7 }],
    });

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    // spike_worse requires ≥2 BIL-only, so 1 is not enough
    expect(result.verdict).toBe('equivalent');
    expect(result.bias_bil_only).toHaveLength(1);
  });

  it('verdict: spike_adds_value rejected when spike-only signals have confidence < 0.7', () => {
    const spike = makeSpike({
      bias_signals: [
        { bias_type: 'sunk_cost', signal: 'Heavy prior investment in option A', claim_id: null, confidence: 0.65 },
        { bias_type: 'groupthink', signal: 'Team consensus without dissent recorded', claim_id: null, confidence: 0.6 },
      ],
    });
    const bil = makeBil(); // no dsk_cues

    const result = compareSpikeWithBil(spike, bil, 'abc123');
    // Both signals are spike-only but confidence < 0.7
    expect(result.verdict).not.toBe('spike_adds_value');
  });
});
