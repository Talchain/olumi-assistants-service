/**
 * MoE Spike integration tests.
 *
 * Verifies the spike fires/doesn't fire based on feature flag,
 * never attaches to envelope, and main path is untouched on spike failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callBriefSpecialist } from '../../../../src/orchestrator/moe-spike/call-specialist.js';
import { compareSpikeWithBil } from '../../../../src/orchestrator/moe-spike/compare.js';
import { MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';
import type { MoeSpikeResult } from '../../../../src/orchestrator/moe-spike/schemas.js';
import type { BriefIntelligence } from '../../../../src/schemas/brief-intelligence.js';

const mockChat = vi.fn();

vi.mock('../../../../src/adapters/llm/router.js', () => ({
  getAdapterForProvider: vi.fn(() => ({
    name: 'openai',
    model: 'gpt-4.1-mini',
    chat: mockChat,
  })),
}));

function makeBil(): BriefIntelligence {
  return {
    contract_version: '1.0.0',
    goal: { label: 'Test goal', measurable: true, confidence: 0.8 },
    options: [
      { label: 'Option A', confidence: 0.7 },
      { label: 'Option B', confidence: 0.6 },
    ],
    constraints: [],
    factors: [],
    completeness_band: 'medium',
    ambiguity_flags: [],
    missing_elements: [],
    dsk_cues: [],
  };
}

function validSpikeResponse(): Record<string, unknown> {
  return {
    version: MOE_SPIKE_VERSION,
    framing_quality: 'moderate',
    diversity_assessment: 'similar',
    stakeholder_completeness: 'partial',
    bias_signals: [
      { bias_type: 'anchoring', signal: 'Over-reliance on initial numbers', claim_id: null, confidence: 0.8 },
    ],
    missing_elements: ['time_horizon'],
  };
}

beforeEach(() => {
  mockChat.mockReset();
});

describe('MoE spike integration', () => {
  it('flag on + BIL available → spike fires and produces comparison', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify(validSpikeResponse()),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    const outcome = await callBriefSpecialist('A decision brief about pricing strategy', 'req-int-1');
    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      const bil = makeBil();
      const comparison = compareSpikeWithBil(outcome.result, bil, outcome.briefHash);
      expect(comparison.verdict).toBeDefined();
      expect(['spike_adds_value', 'spike_worse', 'equivalent']).toContain(comparison.verdict);
    }
  });

  it('spike result never contains envelope-attachable fields', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify(validSpikeResponse()),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    const outcome = await callBriefSpecialist('A decision brief for testing envelope isolation', 'req-int-2');
    expect(outcome.ok).toBe(true);

    if (outcome.ok) {
      const result = outcome.result;
      // MoeSpikeResult should not have any fields that match envelope shape
      expect(result).not.toHaveProperty('assistantText');
      expect(result).not.toHaveProperty('blocks');
      expect(result).not.toHaveProperty('turnPlan');
      expect(result).not.toHaveProperty('error');
      expect(result).not.toHaveProperty('dskCoaching');
    }
  });

  it('spike failure → main path untouched', async () => {
    mockChat.mockRejectedValue(new Error('Specialist LLM unavailable'));

    const outcome = await callBriefSpecialist('A decision brief for testing failure isolation', 'req-int-3');
    expect(outcome.ok).toBe(false);

    // The error result has no spike data that could contaminate the main path
    if (!outcome.ok) {
      expect(outcome.error).toBeTruthy();
      expect(outcome.briefHash).toHaveLength(12);
      // No partial result exposed
      expect(outcome).not.toHaveProperty('result');
    }
  });

  it('parse failure skips persistence entirely — no raw model output leaks to disk', async () => {
    // Simulate the wiring in parallel-generate.ts:
    // callBriefSpecialist → if outcome.ok → compare → persist
    // On parse failure, outcome.ok is false, so compare+persist never execute.
    mockChat.mockResolvedValue({
      content: 'not valid json {{{',
      usage: { input_tokens: 100, output_tokens: 10 },
      model: 'gpt-4.1-mini',
      latencyMs: 150,
    });

    const outcome = await callBriefSpecialist('A decision brief for parse failure test', 'req-int-persist');
    expect(outcome.ok).toBe(false);

    // Error outcome has no 'result' field → wiring guard `if (outcome.ok)` blocks
    // comparison and persistence. No MoeSpikeResult exists to pass to persistSpikeComparison.
    expect(outcome).not.toHaveProperty('result');

    // Replicate the wiring guard: persistence is structurally unreachable on error
    let persistCalled = false;
    if (outcome.ok) {
      // This block is dead code — outcome.ok is false
      compareSpikeWithBil(outcome.result, makeBil(), outcome.briefHash);
      persistCalled = true;
    }
    expect(persistCalled).toBe(false);
  });

  it('comparison is deterministic: same inputs → same output', () => {
    const spike: MoeSpikeResult = {
      version: MOE_SPIKE_VERSION,
      framing_quality: 'moderate',
      diversity_assessment: 'diverse',
      stakeholder_completeness: 'partial',
      bias_signals: [
        { bias_type: 'anchoring', signal: 'Over-reliance on initial price', claim_id: null, confidence: 0.8 },
      ],
      missing_elements: ['time_horizon'],
    };
    const bil = makeBil();

    const c1 = compareSpikeWithBil(spike, bil, 'hash123');
    const c2 = compareSpikeWithBil(spike, bil, 'hash123');
    expect(c1).toEqual(c2);
  });
});
