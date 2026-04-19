/**
 * routeWithToolUse — unit tests.
 *
 * All tests use an injected mock adapter. No real Anthropic API calls. Floor
 * per brief §4 D5: 10 tests; target 15.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  UpstreamHTTPError,
  UpstreamTimeoutError,
} from '../../../adapters/llm/errors.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';

import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import {
  ROUTING_SYSTEM_PROMPT,
  RoutingError,
  routeWithToolUse,
} from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';

// -----------------------------------------------------------------------
// Fixture builders
// -----------------------------------------------------------------------

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: {
      turn_id: 't-01',
      scenario_id: 'scen-abc',
      message: 'What now?',
      turn_class: 'frame',
      stage: 'frame',
    },
    priorTurns: [],
  });
}

function toolCallBlock(input: unknown): ToolResponseBlock {
  return { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> };
}

function textBlock(text: string): ToolResponseBlock {
  return { type: 'text', text };
}

function mkResult(
  content: ToolResponseBlock[],
  stop: ChatWithToolsResult['stop_reason'] = 'tool_use',
): ChatWithToolsResult {
  return {
    content,
    stop_reason: stop,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 123,
  };
}

const VALID_EXECUTE_INPUT = {
  intent_class: 'execute' as const,
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'scen-abc',
      kind: 'option' as const,
      resolution_status: 'resolved' as const,
      resolution_method: 'id_match' as const,
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

// -----------------------------------------------------------------------
// Happy paths
// -----------------------------------------------------------------------

describe('routeWithToolUse — happy paths', () => {
  it('tool call response yields a RoutingResult with proposal + orientationText', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([textBlock('Running analysis on your current scenario...'), toolCallBlock(VALID_EXECUTE_INPUT)]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'run analysis', {
      requestId: 'req-1',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.proposal.intent_class).toBe('execute');
      expect(result.orientationText).toBe('Running analysis on your current scenario...');
    }
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('text-only response yields a RoutingResult with inferredIntent "converse"', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('Hello — how can I help?')], 'end_turn')),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'hi', {
      requestId: 'req-2',
      adapter,
    });

    expect(result.type).toBe('text_only');
    if (result.type === 'text_only') {
      expect(result.inferredIntent).toBe('converse');
      expect(result.text).toBe('Hello — how can I help?');
    }
  });

  it('passes the routing system prompt + olumi_action tool on the adapter call', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-3', adapter });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.system).toBe(ROUTING_SYSTEM_PROMPT);
    expect(args.tools.length).toBe(1);
    expect(args.tools[0]!.name).toBe(OLUMI_ACTION_TOOL_NAME);
    expect(args.tool_choice).toEqual({ type: 'auto' });
  });

  it('serialises the ContextPack fields into the user message', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([textBlock('ok')], 'end_turn')),
    };

    await routeWithToolUse(minimalContextPack(), 'hi', { requestId: 'req-4', adapter });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    const userContent = args.messages[0]!.content;
    expect(typeof userContent).toBe('string');
    expect(userContent).toContain('## ContextPack');
    expect(userContent).toContain('"version": "2.0"');
    expect(userContent).toContain('## User turn');
    expect(userContent).toContain('hi');
  });
});

// -----------------------------------------------------------------------
// Error paths — every path is typed; no raw error leaks
// -----------------------------------------------------------------------

describe('routeWithToolUse — error paths', () => {
  it('UpstreamTimeoutError from adapter → RoutingError{cause:"timeout"}', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockRejectedValueOnce(new UpstreamTimeoutError('read timeout')),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-t', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'timeout' });
  });

  it('AbortSignal abort from adapter → RoutingError{cause:"aborted"}', async () => {
    const abortErr = Object.assign(new Error('abort'), { name: 'AbortError' });
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(abortErr) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-a', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'aborted' });
  });

  it('UpstreamHTTPError from adapter → RoutingError{cause:"api_error"} with provider_message', async () => {
    const httpErr = new UpstreamHTTPError('5xx status', { status: 502 } as never);
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(httpErr) };

    let caught: unknown;
    try {
      await routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-h', adapter });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoutingError);
    expect((caught as RoutingError).cause).toBe('api_error');
    expect((caught as RoutingError).provider_message).toBe('5xx status');
  });

  it('generic Error from adapter still produces a typed RoutingError (no raw leak)', async () => {
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce(new Error('weird')) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-g', adapter }),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  it('non-Error thrown value still produces a typed RoutingError', async () => {
    const adapter = { chatWithTools: vi.fn().mockRejectedValueOnce('string not error') };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-s', adapter }),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  it('max_tokens stop reason → RoutingError{cause:"unexpected_stop_reason"}', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(mkResult([textBlock('partial')], 'max_tokens')),
    };

    let caught: unknown;
    try {
      await routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-mx', adapter });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RoutingError);
    expect((caught as RoutingError).cause).toBe('unexpected_stop_reason');
  });

  it('empty response (no text, no tool) → RoutingError{cause:"empty_response"}', async () => {
    const adapter = { chatWithTools: vi.fn().mockResolvedValueOnce(mkResult([], 'end_turn')) };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-e', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'empty_response' });
  });

  it('wrong tool name called by Sonnet → RoutingError{cause:"api_error"}', async () => {
    const adapter = {
      chatWithTools: vi
        .fn()
        .mockResolvedValueOnce(
          mkResult([{ type: 'tool_use', id: 'x', name: 'not_olumi_action', input: {} } as ToolResponseBlock]),
        ),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-w', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'api_error' });
  });
});

// -----------------------------------------------------------------------
// REPAIR_ONCE
// -----------------------------------------------------------------------

describe('routeWithToolUse — REPAIR_ONCE', () => {
  it('invalid schema on first attempt triggers ONE repair call with structured feedback', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' /* missing action */ })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-r',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);

    // The repair prompt must include the failure detail so Sonnet knows what to fix
    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const lastUserMessage = repairArgs.messages[repairArgs.messages.length - 1]!;
    expect(lastUserMessage.role).toBe('user');
    expect(typeof lastUserMessage.content).toBe('string');
    expect(lastUserMessage.content as string).toMatch(/olumi_action tool call failed/);
  });

  it('second schema failure → RoutingError{cause:"schema_repair_failed"}', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'clarify' })])), // still wrong
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-r2', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it('abort during the repair call also produces a typed RoutingError', async () => {
    const abortErr = Object.assign(new Error('abort'), { name: 'AbortError' });
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'execute' /* missing action */ })]))
        .mockRejectedValueOnce(abortErr),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'x', { requestId: 'req-r3', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'aborted' });
  });
});
