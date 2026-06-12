/**
 * Anthropic adapter — generic chat() system_cache_blocks SDK payload shape.
 *
 * Confirms that `system_cache_blocks` on the generic chat path (used by
 * edit_graph) is forwarded to the SDK as
 * `system: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }, ...]`
 * — the same contract chatWithTools already honours — and that the plain
 * string `system` is sent unchanged when no blocks are provided.
 * Adapter unit (mocked SDK), not network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
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
      cache_read_input_tokens: 4000,
    },
  };
}

describe('chatWithAnthropic — system_cache_blocks → SDK payload', () => {
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
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await chatWithAnthropic({
      system: 'STABLE_PREFIX\n\nVARIABLE_CONTEXT',
      system_cache_blocks: [
        { type: 'text', text: 'STABLE_PREFIX', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: '\n\nVARIABLE_CONTEXT' },
      ],
      userMessage: 'hello',
      model: 'claude-sonnet-4-6',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toEqual([
      { type: 'text', text: 'STABLE_PREFIX', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '\n\nVARIABLE_CONTEXT' },
    ]);
    // The concatenation contract: blocks join back to the plain system string.
    const joined = body.system.map((b: { text: string }) => b.text).join('');
    expect(joined).toBe('STABLE_PREFIX\n\nVARIABLE_CONTEXT');
  });

  it('sends the plain system string when no blocks are provided (back-compat)', async () => {
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    await chatWithAnthropic({
      system: 'PLAIN_SYSTEM',
      userMessage: 'hello',
      model: 'claude-sonnet-4-6',
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const body = mockCreate.mock.calls[0][0];
    expect(body.system).toBe('PLAIN_SYSTEM');
  });

  it('surfaces cache usage fields from the SDK response in ChatResult.usage', async () => {
    const { chatWithAnthropic } = await import('../../src/adapters/llm/anthropic.js');
    const result = await chatWithAnthropic({
      system: 'STABLE',
      system_cache_blocks: [{ type: 'text', text: 'STABLE', cache_control: { type: 'ephemeral' } }],
      userMessage: 'hello',
      model: 'claude-sonnet-4-6',
    });

    expect(result.usage.cache_read_input_tokens).toBe(4000);
    expect(result.usage.cache_creation_input_tokens).toBe(50);
  });
});
