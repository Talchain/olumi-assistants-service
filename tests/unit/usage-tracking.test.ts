/**
 * Usage-tracking adapter wrapper tests.
 *
 * Verifies:
 * - Token usage is logged after LLM calls (both providers via adapter interface)
 * - Logging covers multiple task types with rich context
 * - Budget recording is called with correct token count
 * - Budget enforcement throws DailyBudgetExceededError before LLM calls
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock setup — vi.hoisted ensures variables exist before hoisted vi.mock
// ============================================================================

const { mockLog, mockCheckBudget, mockRecordTokenUsage, mockGetRequestContext, mockIsBudgetEnabled } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockCheckBudget: vi.fn().mockReturnValue({ exceeded: false, used: 0, limit: 500_000, retryAfterSeconds: 0 }),
  mockRecordTokenUsage: vi.fn(),
  mockGetRequestContext: vi.fn().mockReturnValue({
    userKey: 'sub:user-1',
    userId: 'user-1',
    scenarioId: 'sc-42',
    task: 'draft_graph',
  }),
  mockIsBudgetEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/utils/telemetry.js', () => ({
  log: mockLog,
}));

vi.mock('../../src/middleware/token-budget.js', () => ({
  checkBudget: mockCheckBudget,
  recordTokenUsage: mockRecordTokenUsage,
  getRequestContext: mockGetRequestContext,
  isBudgetEnabled: mockIsBudgetEnabled,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { withUsageTracking } from '../../src/adapters/llm/usage-tracking.js';
import { DailyBudgetExceededError } from '../../src/adapters/llm/errors.js';
import type { LLMAdapter, CallOpts, UsageMetrics } from '../../src/adapters/llm/types.js';

// ============================================================================
// Helpers
// ============================================================================

function makeUsage(input = 100, output = 50): UsageMetrics {
  return { input_tokens: input, output_tokens: output };
}

const baseOpts: CallOpts = {
  requestId: 'req-123',
  timeoutMs: 30_000,
};

/** Minimal mock adapter that returns controllable results. */
function createMockAdapter(): LLMAdapter {
  return {
    name: 'openai',
    model: 'gpt-4o',
    draftGraph: vi.fn().mockResolvedValue({ graph: {}, usage: makeUsage(200, 100) }),
    suggestOptions: vi.fn().mockResolvedValue({ options: [], usage: makeUsage(80, 40) }),
    repairGraph: vi.fn().mockResolvedValue({ graph: {}, usage: makeUsage(150, 75) }),
    clarifyBrief: vi.fn().mockResolvedValue({ questions: [], usage: makeUsage(60, 30) }),
    critiqueGraph: vi.fn().mockResolvedValue({ issues: [], usage: makeUsage(90, 45) }),
    explainDiff: vi.fn().mockResolvedValue({ rationales: [], usage: makeUsage(70, 35) }),
    chat: vi.fn().mockResolvedValue({ content: '', model: 'gpt-4o', latencyMs: 100, usage: makeUsage(110, 55) }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('withUsageTracking', () => {
  let mockAdapter: LLMAdapter;
  let tracked: LLMAdapter;

  beforeEach(() => {
    mockLog.info.mockClear();
    mockRecordTokenUsage.mockClear();
    mockCheckBudget.mockClear();
    mockGetRequestContext.mockClear();
    mockIsBudgetEnabled.mockClear();
    mockCheckBudget.mockReturnValue({ exceeded: false, used: 0, limit: 500_000, retryAfterSeconds: 0 });
    mockGetRequestContext.mockReturnValue({
      userKey: 'sub:user-1',
      userId: 'user-1',
      scenarioId: 'sc-42',
      task: 'draft_graph',
    });
    mockIsBudgetEnabled.mockReturnValue(true);
    mockAdapter = createMockAdapter();
    tracked = withUsageTracking(mockAdapter);
  });

  it('preserves adapter name and model', () => {
    expect(tracked.name).toBe('openai');
    expect(tracked.model).toBe('gpt-4o');
  });

  it('logs usage with rich context after draftGraph', async () => {
    await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'llm_usage',
        model: 'gpt-4o',
        provider: 'openai',
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        user_id: 'user-1',
        scenario_id: 'sc-42',
        task: 'draft_graph',
        request_id: 'req-123',
      }),
      'LLM token usage',
    );
  });

  it('records tokens against daily budget', async () => {
    await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);
    expect(mockRecordTokenUsage).toHaveBeenCalledWith('req-123', 300);
  });

  it('enforces budget before every LLM call', async () => {
    await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);
    expect(mockCheckBudget).toHaveBeenCalledWith('sub:user-1');
  });

  it('throws DailyBudgetExceededError when budget exceeded', async () => {
    mockCheckBudget.mockReturnValue({ exceeded: true, used: 500_000, limit: 500_000, retryAfterSeconds: 3600 });

    await expect(tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts))
      .rejects.toThrow(DailyBudgetExceededError);
  });

  it('skips budget enforcement when disabled', async () => {
    mockIsBudgetEnabled.mockReturnValue(false);
    await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);
    expect(mockCheckBudget).not.toHaveBeenCalled();
  });

  it('skips budget enforcement when no request context', async () => {
    mockGetRequestContext.mockReturnValue(undefined);
    await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);
    expect(mockCheckBudget).not.toHaveBeenCalled();
  });

  it('logs usage after chat', async () => {
    await tracked.chat({ system: 's', userMessage: 'u' }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'llm_usage',
        task: 'draft_graph', // from request context, not adapter method
        prompt_tokens: 110,
        completion_tokens: 55,
        total_tokens: 165,
      }),
      'LLM token usage',
    );
    expect(mockRecordTokenUsage).toHaveBeenCalledWith('req-123', 165);
  });

  it('logs usage after suggestOptions', async () => {
    await tracked.suggestOptions({ goal: 'test' }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm_usage', task: 'draft_graph' }),
      'LLM token usage',
    );
  });

  it('logs usage after repairGraph', async () => {
    await tracked.repairGraph({ graph: {} as any, violations: [] }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm_usage' }),
      'LLM token usage',
    );
  });

  it('logs usage after clarifyBrief', async () => {
    await tracked.clarifyBrief({ brief: 'test', round: 1 }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm_usage' }),
      'LLM token usage',
    );
  });

  it('logs usage after critiqueGraph', async () => {
    await tracked.critiqueGraph({ graph: {} as any }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm_usage' }),
      'LLM token usage',
    );
  });

  it('logs usage after explainDiff', async () => {
    await tracked.explainDiff({ patch: { adds: { nodes: [], edges: [] }, updates: [], removes: [] } }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'llm_usage' }),
      'LLM token usage',
    );
  });

  it('delegates call to underlying adapter', async () => {
    const result = await tracked.draftGraph({ brief: 'test', seed: 1 }, baseOpts);
    expect(mockAdapter.draftGraph).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual(makeUsage(200, 100));
  });

  it('falls back to adapter task name when no request context', async () => {
    mockGetRequestContext.mockReturnValue(undefined);
    await tracked.chat({ system: 's', userMessage: 'u' }, baseOpts);

    expect(mockLog.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'llm_usage',
        task: 'chat', // fallback — no request context
        user_id: null,
        scenario_id: null,
      }),
      'LLM token usage',
    );
  });
});
