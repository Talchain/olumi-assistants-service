/**
 * Anthropic adapter — system_cache_blocks SDK payload shape.
 *
 * Confirms that `system_cache_blocks` from `ChatWithToolsArgs` is
 * forwarded to the SDK as `system: [{ type: 'text', text, cache_control:
 * { type: 'ephemeral' } }]` — the format Anthropic's prompt cache
 * actually keys on. Adapter unit (mocked SDK), not network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('mock system prompt'),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: 'test',
    prompt_hash: 'abc',
    source: 'default',
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: 'test',
    use_staging_mode: false,
  }),
  buildDraftPrompt: vi.fn().mockResolvedValue({
    system: 'mock system',
    userContent: 'mock user content',
  }),
  invalidatePromptCache: vi.fn(),
}));

function makeResponse() {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    model: 'claude-sonnet-4-6',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 50,
      cache_read_input_tokens: 0,
    },
  };
}

describe('chatWithToolsAnthropic — system_cache_blocks → SDK payload', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeResponse());
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('forwards system_cache_blocks as an array with cache_control on the SDK system param', async () => {
    const { chatWithToolsAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await chatWithToolsAnthropic({
      system: 'STABLE_PREFIX',
      system_cache_blocks: [
        { type: 'text', text: 'STABLE_PREFIX', cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} } }],
      model: 'claude-sonnet-4-6',
    });

    const [body] = mockCreate.mock.calls[0];
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(1);
    expect(body.system[0]).toEqual({
      type: 'text',
      text: 'STABLE_PREFIX',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('without system_cache_blocks falls back to passing system as a plain string', async () => {
    const { chatWithToolsAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await chatWithToolsAnthropic({
      system: 'PLAIN_STRING_SYSTEM',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} } }],
      model: 'claude-sonnet-4-6',
    });

    const [body] = mockCreate.mock.calls[0];
    expect(body.system).toBe('PLAIN_STRING_SYSTEM');
  });
});
