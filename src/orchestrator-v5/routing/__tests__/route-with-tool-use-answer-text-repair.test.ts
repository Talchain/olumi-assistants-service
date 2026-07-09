/**
 * CEE_ANSWER_TEXT_REQUIRED — REPAIR_ONCE integration (layer A, schema
 * pressure). Proves that a coach/converse tool call omitting `answer_text`
 * is a plain Zod validation failure that flows through the EXISTING
 * REPAIR_ONCE mechanism (no new retry plumbing): one repair call, with the
 * omission cited in the repair message, then a typed
 * `schema_repair_failed` RoutingError if the retry also omits it.
 *
 * Model-agnosticism: `routeWithToolUse` only depends on the injected
 * adapter's `chatWithTools` shape — this suite never references a specific
 * model, so the same repair mechanism applies whichever model the
 * orchestrator resolves to (Sonnet 5 today; unaffected by a revert to a
 * gpt-4o-class model since the adapter interface is uniform).
 *
 * Flag default OFF — see config/index.ts `features.answerTextRequired`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

function minimalContextPack(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-01',
      scenario_id: 'scen-abc',
      message: 'What now?',
    }),
    priorTurns: [],
  });
}

function toolCallBlock(input: unknown): ToolResponseBlock {
  return { type: 'tool_use', id: 'tu-1', name: OLUMI_ACTION_TOOL_NAME, input: input as Record<string, unknown> };
}

function mkResult(content: ToolResponseBlock[]): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'tool_use',
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

let priorFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_TEXT_REQUIRED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

describe('routeWithToolUse — CEE_ANSWER_TEXT_REQUIRED flag ON — REPAIR_ONCE', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('coach tool call omitting answer_text triggers ONE repair call citing the omission, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'coach', coaching_mode: 'reframe' })]))
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_text: 'The full repaired coaching answer.',
            }),
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-repair-coach',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.llmCallCount).toBe(2);
      expect(result.proposal.intent_class).toBe('coach');
      if (result.proposal.intent_class === 'coach') {
        expect(result.proposal.answer_text).toBe('The full repaired coaching answer.');
      }
    }

    // The repair message must cite the answer_text omission so the model
    // knows exactly what to fill in on the retry.
    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const userMsg = repairArgs.messages[2]!;
    const userContent = userMsg.content as ToolResponseBlock[];
    const toolResultBlock = userContent.find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
    if (toolResultBlock?.type === 'tool_result') {
      expect(toolResultBlock.content).toContain('answer_text is required');
    }
  });

  it('converse tool call omitting answer_text triggers ONE repair call, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'converse' })]))
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'converse',
              answer_text: 'The full repaired conversational answer.',
            }),
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-repair-converse',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'converse') {
      expect(result.proposal.answer_text).toBe('The full repaired conversational answer.');
    }
  });

  it('coach tool call omitting answer_text on BOTH attempts → schema_repair_failed after exactly 2 calls', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'coach', coaching_mode: 'reframe' })]))
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'coach', coaching_mode: 'reframe' })])),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'go', { requestId: 'req-repair-fail', adapter }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it('execute and clarify tool calls are unaffected — no repair triggered by the answer_text rule', async () => {
    const executeAdapter = {
      chatWithTools: vi.fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>().mockResolvedValueOnce(
        mkResult([
          toolCallBlock({
            intent_class: 'execute',
            action: {
              handler_id: 'run_analysis',
              entity: {
                id: 'scen-abc',
                kind: 'option',
                resolution_status: 'resolved',
                resolution_method: 'id_match',
              },
              parameters: [],
              cited_context_fields: [],
            },
          }),
        ]),
      ),
    };
    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-execute-unaffected',
      adapter: executeAdapter,
    });
    expect(result.type).toBe('tool_call');
    expect(executeAdapter.chatWithTools).toHaveBeenCalledTimes(1);
  });
});

describe('routeWithToolUse — CEE_ANSWER_TEXT_REQUIRED flag OFF (default) — byte-identical, no repair', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('coach tool call with NO answer_text: single call, no repair, proposal parses as before', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'coach', coaching_mode: 'reframe' })])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-flag-off-coach',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'coach') {
      expect(result.proposal.answer_text).toBeUndefined();
    }
  });

  it('converse tool call with NO answer_text: single call, no repair', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'converse' })])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-flag-off-converse',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
  });
});
