/**
 * Coach/converse answer-channel REPAIR_ONCE integration (layer A, schema
 * pressure). The coach/converse answer channel is now governed by the
 * mandatory answer_shape (ROADMAP 1.132, F2 — unconditional since the F1 flag
 * deletion): a tool call OMITTING the shape is a plain Zod validation failure
 * that flows through the EXISTING REPAIR_ONCE mechanism (no new retry
 * plumbing): one repair call, with the omission cited in the repair message,
 * then a typed `schema_repair_failed` RoutingError if the retry also omits it.
 *
 * Model-agnosticism: `routeWithToolUse` only depends on the injected adapter's
 * `chatWithTools` shape — this suite never references a specific model, so the
 * same repair mechanism applies whichever model the orchestrator resolves to.
 *
 * The full shape-repair matrix (malformed shape, both-attempts-fail) lives in
 * `route-with-tool-use-answer-shape-repair.test.ts`; this file retains the
 * execute/clarify-unaffected pin.
 */

import { describe, expect, it, vi } from 'vitest';

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
import { deriveAnswerTextFromShape } from '../answer-shape.js';
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

const VALID_SHAPE = {
  headline: 'The complete answer in one sentence.',
  bullets: ['A supporting point.'],
  detail: 'The full supporting explanation carrying the rest of the answer.',
};

describe('routeWithToolUse — coach/converse answer channel (shape-governed) — REPAIR_ONCE', () => {
  it('coach tool call omitting the answer_shape triggers ONE repair call citing the omission, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'coach', coaching_mode: 'reframe' })]))
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_shape: VALID_SHAPE,
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
        expect(result.proposal.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      }
    }

    // The repair message must cite the answer_shape omission so the model
    // knows exactly what to fill in on the retry.
    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const userMsg = repairArgs.messages[2]!;
    const userContent = userMsg.content as ToolResponseBlock[];
    const toolResultBlock = userContent.find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
    if (toolResultBlock?.type === 'tool_result') {
      expect(toolResultBlock.content).toContain('answer_shape is required');
    }
  });

  it('converse tool call omitting the answer_shape triggers ONE repair call, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock({ intent_class: 'converse' })]))
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'converse',
              answer_shape: VALID_SHAPE,
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
      expect(result.proposal.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });

  it('coach tool call omitting the shape on BOTH attempts → schema_repair_failed after exactly 2 calls', async () => {
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

  it('execute and clarify tool calls are unaffected — no repair triggered by the answer channel rule', async () => {
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
