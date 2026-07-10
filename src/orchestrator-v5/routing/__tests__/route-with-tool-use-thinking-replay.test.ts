/**
 * ROADMAP 1.55(b) — REPAIR_ONCE must replay thinking blocks to the API.
 *
 * Anthropic's extended-thinking + tool-use protocol: when tool_results are
 * returned, the assistant message containing the tool_use must carry its
 * COMPLETE, UNMODIFIED thinking block(s), or the API rejects the request
 * with 400 invalid_request_error ("`thinking` or `redacted_thinking` blocks
 * in the latest assistant message cannot be modified"; docs: "you must pass
 * `thinking` blocks back to the API, and you must include the complete
 * unmodified block"). This applies on adaptive-default models (Sonnet 5
 * runs adaptive thinking with the `thinking` param omitted — exactly how
 * the routing call is made).
 *
 * The repair replay previously echoed only `ChatWithToolsResult.content`
 * (text/tool_use — thinking is filtered out by the #385 user-facing filter),
 * so a thinking-bearing first response could never be rescued by repair:
 * the repair call itself would 400.
 *
 * Fix contract:
 *   1. The API-BOUND repair message prepends `replay_thinking_blocks`
 *      verbatim (signature intact) ahead of the echoed content.
 *   2. The user-facing surfaces (orientationText / text / proposal /
 *      rawResult.content) still NEVER carry thinking text or signatures —
 *      the fix is replay-payload-only, not a loosening of the filter.
 *   3. No replay blocks captured → the repair message is byte-identical to
 *      the previous behaviour.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ReplayThinkingBlock,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';

import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import { routeWithToolUse } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

// -----------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------

const THINKING_TEXT = 'The user wants an analysis run; olumi_action fits...';
const SIGNATURE = 'sig_opaque_replay_token_1f9b';

const THINKING_BLOCK: ReplayThinkingBlock = {
  type: 'thinking',
  thinking: THINKING_TEXT,
  signature: SIGNATURE,
};

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

function textBlock(text: string): ToolResponseBlock {
  return { type: 'text', text };
}

function mkResult(
  content: ToolResponseBlock[],
  opts?: {
    stop?: ChatWithToolsResult['stop_reason'];
    replayThinkingBlocks?: ReplayThinkingBlock[];
  },
): ChatWithToolsResult {
  return {
    content,
    stop_reason: opts?.stop ?? 'tool_use',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-5',
    latencyMs: 123,
    ...(opts?.replayThinkingBlocks
      ? { replay_thinking_blocks: opts.replayThinkingBlocks }
      : {}),
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

const INVALID_INPUT = { intent_class: 'execute' }; // missing action → parse failure

// -----------------------------------------------------------------------
// Replay payload
// -----------------------------------------------------------------------

describe('routeWithToolUse — REPAIR_ONCE thinking-block replay (ROADMAP 1.55b)', () => {
  it('prepends the captured thinking block VERBATIM to the API-bound repair assistant message', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([textBlock('Kicking off...'), toolCallBlock(INVALID_INPUT)], {
            replayThinkingBlocks: [THINKING_BLOCK],
          }),
        )
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-think-replay',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);

    const repairArgs = adapter.chatWithTools.mock.calls[1]![0] as ChatWithToolsArgs;
    const assistantMsg = repairArgs.messages[1]!;
    expect(assistantMsg.role).toBe('assistant');
    const assistantContent = assistantMsg.content as Array<
      ToolResponseBlock | ReplayThinkingBlock
    >;

    // Protocol requirement: the assistant message must START with the
    // complete, unmodified thinking block (signature intact).
    expect(assistantContent[0]).toEqual(THINKING_BLOCK);
    // Followed by the previously-echoed content, order preserved.
    expect(assistantContent.slice(1)).toEqual([
      textBlock('Kicking off...'),
      toolCallBlock(INVALID_INPUT),
    ]);

    // tool_result blocks still match the tool_use id.
    const userMsg = repairArgs.messages[2]!;
    expect(userMsg.role).toBe('user');
    const userContent = userMsg.content as ToolResponseBlock[];
    const toolResult = userContent.find((b) => b.type === 'tool_result');
    expect(toolResult).toMatchObject({ tool_use_id: 'tu-1', is_error: true });
  });

  it('replays multiple thinking blocks in original order ahead of the echoed content', async () => {
    const secondThinking: ReplayThinkingBlock = {
      type: 'redacted_thinking',
      data: 'enc_opaque_payload',
    };
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([toolCallBlock(INVALID_INPUT)], {
            replayThinkingBlocks: [THINKING_BLOCK, secondThinking],
          }),
        )
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-think-replay-2',
      adapter,
    });

    const repairArgs = adapter.chatWithTools.mock.calls[1]![0] as ChatWithToolsArgs;
    const assistantContent = repairArgs.messages[1]!.content as Array<
      ToolResponseBlock | ReplayThinkingBlock
    >;
    expect(assistantContent.slice(0, 2)).toEqual([THINKING_BLOCK, secondThinking]);
  });

  it('without captured thinking blocks the repair assistant message is unchanged (no empty prefix)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([toolCallBlock(INVALID_INPUT)]))
        .mockResolvedValueOnce(mkResult([toolCallBlock(VALID_EXECUTE_INPUT)])),
    };

    await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-no-think',
      adapter,
    });

    const repairArgs = adapter.chatWithTools.mock.calls[1]![0] as ChatWithToolsArgs;
    const assistantContent = repairArgs.messages[1]!.content as ToolResponseBlock[];
    expect(assistantContent).toEqual([toolCallBlock(INVALID_INPUT)]);
  });

  // ---------------------------------------------------------------------
  // Egress guard — replay is API-bound ONLY
  // ---------------------------------------------------------------------

  it('GUARD: thinking text and signature never reach user-facing routing output', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([textBlock('Kicking off...'), toolCallBlock(INVALID_INPUT)], {
            replayThinkingBlocks: [THINKING_BLOCK],
          }),
        )
        .mockResolvedValueOnce(
          mkResult([textBlock('Here we go.'), toolCallBlock(VALID_EXECUTE_INPUT)], {
            replayThinkingBlocks: [THINKING_BLOCK],
          }),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'go', {
      requestId: 'req-guard',
      adapter,
    });

    expect(result.type).toBe('tool_call');
    if (result.type === 'tool_call') {
      // User-facing orientation text: no thinking text, no signature.
      expect(result.orientationText).not.toContain(THINKING_TEXT);
      expect(result.orientationText).not.toContain(SIGNATURE);
      // Proposal payload: same guarantee.
      const proposalJson = JSON.stringify(result.proposal);
      expect(proposalJson).not.toContain(THINKING_TEXT);
      expect(proposalJson).not.toContain(SIGNATURE);
      // rawResult.content (consumed by the executor for assistant_text
      // assembly) must remain free of thinking-type blocks.
      expect(
        result.rawResult.content.every(
          (b) => b.type === 'text' || b.type === 'tool_use' || b.type === 'tool_result',
        ),
      ).toBe(true);
    }
  });

  it('GUARD: text_only path never surfaces thinking text or signature', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([textBlock('Just a plain answer.')], {
            stop: 'end_turn',
            replayThinkingBlocks: [THINKING_BLOCK],
          }),
        ),
    };

    const result = await routeWithToolUse(minimalContextPack(), 'hello', {
      requestId: 'req-guard-text',
      adapter,
    });

    expect(result.type).toBe('text_only');
    if (result.type === 'text_only') {
      expect(result.text).toBe('Just a plain answer.');
      expect(result.text).not.toContain(SIGNATURE);
    }
  });
});
