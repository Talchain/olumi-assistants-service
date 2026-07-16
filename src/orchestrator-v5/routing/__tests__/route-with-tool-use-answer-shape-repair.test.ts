/**
 * CEE_ANSWER_SHAPE_ENFORCED — REPAIR_ONCE integration (ROADMAP 1.132, F2).
 *
 * Proves that a coach/converse tool call whose `answer_shape` is missing or
 * malformed is a plain Zod validation failure that flows through the
 * EXISTING REPAIR_ONCE mechanism (no new retry plumbing): one repair call,
 * with the violation cited in the repair message, then a typed
 * `schema_repair_failed` RoutingError if the retry is also invalid.
 *
 * Also pins the tool-definition contract at the adapter seam:
 *   - flag ON  → the adapter receives the EXTENDED definition (answer_shape
 *                advertised);
 *   - flag OFF → the adapter receives the exact pre-flag OLUMI_ACTION_TOOL
 *                (served-definition byte-identity).
 *
 * Mirrors route-with-tool-use-answer-text-repair.test.ts.
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
import { OLUMI_ACTION_TOOL, OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
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
  return {
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  };
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
  headline: 'Focus on retention before pricing.',
  bullets: ['Churn dominates your graph.'],
  detail: 'The churn→revenue link is the strongest causal link in the model.',
};

// Deliberately malformed: 4 bullets breaches the ≤3 cap.
const MALFORMED_SHAPE = { ...VALID_SHAPE, bullets: ['a', 'b', 'c', 'd'] };

let priorFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_SHAPE_ENFORCED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = value;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
}

describe('routeWithToolUse — CEE_ANSWER_SHAPE_ENFORCED flag ON — REPAIR_ONCE', () => {
  beforeEach(async () => {
    await setFlag('true');
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('coach tool call with a MALFORMED shape (4 bullets) triggers ONE repair citing the violation, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_shape: MALFORMED_SHAPE,
            }),
          ]),
        )
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
      requestId: 'req-shape-repair-coach',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      expect(result.llmCallCount).toBe(2);
      expect(result.proposal.intent_class).toBe('coach');
      if (result.proposal.intent_class === 'coach') {
        expect(result.proposal.answer_shape).toEqual(VALID_SHAPE);
        expect(result.proposal.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      }
    }

    // The repair message must cite the shape violation so the model knows
    // exactly what to fix on the retry.
    const repairArgs = adapter.chatWithTools.mock.calls[1]![0];
    const userMsg = repairArgs.messages[2]!;
    const userContent = userMsg.content as ToolResponseBlock[];
    const toolResultBlock = userContent.find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
    if (toolResultBlock?.type === 'tool_result') {
      expect(toolResultBlock.content).toContain('at most 3');
    }
  });

  it('converse tool call OMITTING answer_shape triggers ONE repair, then succeeds', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([toolCallBlock({ intent_class: 'converse', answer_text: 'prose only' })]),
        )
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({ intent_class: 'converse', answer_shape: VALID_SHAPE }),
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-shape-repair-converse',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'converse') {
      expect(result.proposal.answer_shape).toEqual(VALID_SHAPE);
      expect(result.proposal.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });

  it('malformed shape on BOTH attempts → schema_repair_failed after exactly 2 calls', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_shape: MALFORMED_SHAPE,
            }),
          ]),
        )
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_shape: MALFORMED_SHAPE,
            }),
          ]),
        ),
    };

    await expect(
      routeWithToolUse(minimalContextPack(), 'go', {
        requestId: 'req-shape-repair-fail',
        adapter,
      }),
    ).rejects.toMatchObject({ name: 'RoutingError', cause: 'schema_repair_failed' });
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it('the adapter receives the EXTENDED tool definition (answer_shape advertised)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
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
    await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-shape-tooldef-on',
      adapter,
    });
    const args = adapter.chatWithTools.mock.calls[0]![0];
    const inputSchema = args.tools?.[0]?.input_schema;
    const properties = inputSchema?.properties as Record<string, unknown> | undefined;
    expect(properties?.answer_shape).toBeDefined();
  });
});

describe('routeWithToolUse — CEE_ANSWER_SHAPE_ENFORCED flag OFF (default) — byte-identical', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });
  afterEach(async () => {
    await restoreFlag();
  });

  it('coach tool call with legacy answer_text: single call, no repair, and the adapter receives the EXACT pre-flag tool definition', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([
            toolCallBlock({
              intent_class: 'coach',
              coaching_mode: 'reframe',
              answer_text: 'The full coaching answer.',
            }),
          ]),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-shape-flag-off',
      adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call' && result.proposal.intent_class === 'coach') {
      expect(result.proposal.answer_text).toBe('The full coaching answer.');
      expect(result.proposal.answer_shape).toBeUndefined();
    }
    const args = adapter.chatWithTools.mock.calls[0]![0];
    // Served-definition byte-identity: the exact same object, not a clone.
    expect(args.tools?.[0]).toBe(OLUMI_ACTION_TOOL);
  });
});
