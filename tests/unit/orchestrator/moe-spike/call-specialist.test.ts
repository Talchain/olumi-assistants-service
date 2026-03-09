import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callBriefSpecialist, hashBrief } from '../../../../src/orchestrator/moe-spike/call-specialist.js';
import { MOE_SPIKE_VERSION } from '../../../../src/orchestrator/moe-spike/schemas.js';
import { UpstreamTimeoutError } from '../../../../src/adapters/llm/errors.js';

const mockChat = vi.fn();

vi.mock('../../../../src/adapters/llm/router.js', () => ({
  getAdapterForProvider: vi.fn(() => ({
    name: 'openai',
    model: 'gpt-4.1-mini',
    chat: mockChat,
  })),
}));

function validResponse() {
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

beforeEach(() => {
  mockChat.mockReset();
});

describe('callBriefSpecialist', () => {
  it('success: parses valid JSON response', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify(validResponse()),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    const result = await callBriefSpecialist('A decision brief about pricing strategy for our SaaS product', 'req-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.framing_quality).toBe('moderate');
      expect(result.result.bias_signals).toHaveLength(1);
    }
    expect(result.briefHash).toHaveLength(12);
  });

  it('error: JSON parse failure returns clean error', async () => {
    mockChat.mockResolvedValue({
      content: 'not valid json',
      usage: { input_tokens: 100, output_tokens: 10 },
      model: 'gpt-4.1-mini',
      latencyMs: 150,
    });

    const result = await callBriefSpecialist('A decision brief for testing', 'req-2');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('JSON_PARSE_FAILED');
    }
  });

  it('error: Zod validation failure returns coarse error code', async () => {
    const bad = { ...validResponse(), framing_quality: 'excellent' };
    mockChat.mockResolvedValue({
      content: JSON.stringify(bad),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 180,
    });

    const result = await callBriefSpecialist('A decision brief for testing', 'req-3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ZOD_VALIDATION_FAILED');
    }
  });

  it('error: adapter timeout returns coarse error code', async () => {
    mockChat.mockRejectedValue(
      new UpstreamTimeoutError('OpenAI timeout during connect phase', 'openai', 'chat', 'connect', 5000),
    );

    const result = await callBriefSpecialist('A decision brief for testing', 'req-4');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('TIMEOUT');
    }
  });

  it('error: generic Error classified as ADAPTER_ERROR not TIMEOUT', async () => {
    mockChat.mockRejectedValue(new Error('Some unexpected error'));

    const result = await callBriefSpecialist('A decision brief for testing', 'req-generic');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('ADAPTER_ERROR');
    }
  });

  it('truncates long briefs at word boundary', async () => {
    const longBrief = 'word '.repeat(800); // 4000 chars
    mockChat.mockResolvedValue({
      content: JSON.stringify(validResponse()),
      usage: { input_tokens: 500, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 300,
    });

    await callBriefSpecialist(longBrief, 'req-5');

    const sentMessage = mockChat.mock.calls[0][0].userMessage as string;
    expect(sentMessage.length).toBeLessThanOrEqual(3003); // 3000 + "..."
    expect(sentMessage.endsWith('...')).toBe(true);
  });

  it('does not truncate brief exactly at 3000 chars', async () => {
    const exactBrief = 'x'.repeat(3000);
    mockChat.mockResolvedValue({
      content: JSON.stringify(validResponse()),
      usage: { input_tokens: 400, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    await callBriefSpecialist(exactBrief, 'req-exact');

    const sentMessage = mockChat.mock.calls[0][0].userMessage as string;
    expect(sentMessage).toBe(exactBrief);
    expect(sentMessage.endsWith('...')).toBe(false);
  });

  it('uses request-scoped ID for traceability', async () => {
    mockChat.mockResolvedValue({
      content: JSON.stringify(validResponse()),
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'gpt-4.1-mini',
      latencyMs: 200,
    });

    await callBriefSpecialist('A decision brief for testing', 'req-trace-123');

    const callOpts = mockChat.mock.calls[0][1];
    expect(callOpts.requestId).toBe('req-trace-123:moe-spike');
  });

  it('adapter unavailable: getAdapterForProvider throws → clean error', async () => {
    const { getAdapterForProvider } = await import('../../../../src/adapters/llm/router.js');
    (getAdapterForProvider as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('Provider openai not configured');
    });

    const result = await callBriefSpecialist('A decision brief for testing', 'req-err');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('ADAPTER_ERROR');
    }
  });
});

describe('hashBrief', () => {
  it('produces deterministic 12-char hex hash', () => {
    const hash1 = hashBrief('test brief');
    const hash2 = hashBrief('test brief');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
    expect(hash1).toMatch(/^[0-9a-f]{12}$/);
  });

  it('different briefs produce different hashes', () => {
    expect(hashBrief('brief A')).not.toBe(hashBrief('brief B'));
  });
});
