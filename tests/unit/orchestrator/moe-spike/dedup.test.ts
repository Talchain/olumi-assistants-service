import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callBriefSpecialist } from '../../../../src/orchestrator/moe-spike/call-specialist.js';
import { MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';

const mockChat = vi.fn();

vi.mock('../../../../src/adapters/llm/router.js', () => ({
  getAdapterForProvider: vi.fn(() => ({
    name: 'openai',
    model: 'gpt-4.1-mini',
    chat: mockChat,
  })),
}));

beforeEach(() => {
  mockChat.mockReset();
});

describe('bias signal deduplication', () => {
  it('duplicate bias_type deduplicated to highest confidence', async () => {
    const response = {
      version: MOE_SPIKE_VERSION,
      framing_quality: 'moderate',
      diversity_assessment: 'diverse',
      stakeholder_completeness: 'partial',
      bias_signals: [
        { bias_type: 'anchoring', signal: 'First anchoring signal found here', claim_id: null, confidence: 0.6 },
        { bias_type: 'Anchoring', signal: 'Second anchoring signal different', claim_id: null, confidence: 0.9 },
        { bias_type: 'sunk_cost', signal: 'Sunk cost bias is clearly present', claim_id: null, confidence: 0.7 },
      ],
      missing_elements: [],
    };

    mockChat.mockResolvedValue({
      content: JSON.stringify(response),
      usage: { input_tokens: 100, output_tokens: 80 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    const result = await callBriefSpecialist('A detailed decision brief about pricing strategy', 'req-dedup');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // anchoring + Anchoring → single entry with confidence 0.9
      const anchoring = result.result.bias_signals.filter(
        (s) => s.bias_type.toLowerCase() === 'anchoring',
      );
      expect(anchoring).toHaveLength(1);
      expect(anchoring[0].confidence).toBe(0.9);

      // sunk_cost preserved
      const sunkCost = result.result.bias_signals.filter(
        (s) => s.bias_type.toLowerCase() === 'sunk_cost',
      );
      expect(sunkCost).toHaveLength(1);

      // Total: 2 unique signals
      expect(result.result.bias_signals).toHaveLength(2);
    }
  });
});
