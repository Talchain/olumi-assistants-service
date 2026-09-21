import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createMessage = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: createMessage };
  },
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('mock system prompt'),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: 'test',
    prompt_hash: 'abc',
    source: 'default',
    version: null,
    cache_status: 'test',
    use_staging_mode: false,
  }),
  invalidatePromptCache: vi.fn(),
}));

import { chatWithAnthropic } from '../../src/adapters/llm/anthropic.js';
import { ModelAssignmentError } from '../../src/config/model-assignment.js';

const CALL = {
  system: 'system bytes',
  userMessage: 'user bytes',
  maxTokens: 32,
} as const;

describe('chatWithAnthropic model authority at the network boundary', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    createMessage.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  });

  afterEach(() => {
    createMessage.mockReset();
    vi.unstubAllEnvs();
  });

  it.each([
    ['unknown id', 'claude-looking-but-unknown', 'MODEL_NOT_REGISTERED'],
    ['disabled registry row', 'test-disabled-model', 'MODEL_DISABLED'],
    ['explicit OpenAI alias', 'gpt-4.1', 'MODEL_PROVIDER_MISMATCH'],
  ])('rejects %s before making any SDK call', async (_label, model, code) => {
    await expect(
      chatWithAnthropic({ ...CALL, model }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'ModelAssignmentError',
        code,
        model,
      }),
    );
    expect(createMessage).not.toHaveBeenCalled();
  });

  it.each(['claude-haiku-4-5', 'claude-sonnet-5'])(
    'preserves exact registered/provider-alias bytes for %s',
    async (model) => {
      const result = await chatWithAnthropic({ ...CALL, model });

      expect(result.model).toBe(model);
      expect(createMessage).toHaveBeenCalledOnce();
      expect(createMessage.mock.calls[0]?.[0]).toMatchObject({ model });
    },
  );

  it('uses a typed provider-mismatch failure rather than cross-provider dispatch', async () => {
    try {
      await chatWithAnthropic({ ...CALL, model: 'gpt-4.1' });
      expect.unreachable('OpenAI aliases must never reach Anthropic');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelAssignmentError);
      expect((error as ModelAssignmentError).code).toBe(
        'MODEL_PROVIDER_MISMATCH',
      );
    }
  });
});
