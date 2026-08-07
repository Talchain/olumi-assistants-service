/**
 * routeWithToolUse — F2 CHANGE A forced explanation intent (typed analytical pill).
 *
 * When a typed `explain_results` / `what_would_flip` chip-click pill routes
 * through the coach (having been removed from the deterministic-chip whitelist),
 * TurnExecutor threads `forcedExplanationHandlerId` into routeWithToolUse. This
 * call must then:
 *   1. DISABLE thinking on the routing turn (reuses the existing
 *      `{ thinking: { type: 'disabled' } }` mechanism — the ~9s latency path),
 *   2. FORCE the `olumi_action` tool (`tool_choice: { type: 'tool' }`) so the
 *      coach always emits a structured proposal + authored `answer_text`,
 *   3. carry the VERBATIM conversation window into the prompt (so the pill
 *      answer can reference what the user just said), and
 *   4. PIN the proposal `handler_id` to the forced value — the coach authors the
 *      prose but CANNOT re-route the typed pill to a different handler.
 *
 * All tests use an injected mock adapter. No real Anthropic API calls.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../../adapters/llm/types.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';
import {
  assembleContextPack,
  type ContextPack,
} from '../../context/context-pack-assembler.js';
import {
  routeWithToolUse,
  applyForcedExplanationHandler,
  buildForcedIntentDirective,
} from '../route-with-tool-use.js';
import type { RoutingResult } from '../route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../tool-schema.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

// A distinctive phrase seeded into the conversation window. If the coach call
// carries the conversation verbatim, this string appears in the serialised user
// message the adapter receives. Deliberately unusual so a substring match is
// unambiguous.
const CONVERSATION_SEED = 'the Reykjavik warehouse relocation';

function priorTurn(n: number, userMessage: string): SessionTurnWithContent {
  return {
    id: `row-${n}`,
    scenario_id: 'scen-forced',
    user_id: null,
    turn_id: `prior-turn-${n}`,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:prior-${n}`,
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 8,
    created_at: `2026-04-30T0${Math.min(n, 9)}:00:00.000Z`,
    user_message: userMessage,
    assistant_message: `noted`,
  } as unknown as SessionTurnWithContent;
}

function packWithConversation(): ContextPack {
  return assembleContextPack({
    payload: makeMessagePayload({
      turn_id: 't-forced',
      scenario_id: 'scen-forced',
      message: 'Explain these results.',
    }),
    priorTurns: [priorTurn(1, `I am deciding about ${CONVERSATION_SEED}.`)],
  });
}

function mkResult(
  content: ToolResponseBlock[],
  model = 'claude-sonnet-4-6',
): ChatWithToolsResult {
  return {
    content,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as unknown as ChatWithToolsResult['usage'],
    model,
    latencyMs: 123,
  };
}

/**
 * A well-formed olumi_action execute tool_use. `handler_id` is deliberately a
 * DIFFERENT explanation handler than the one the pill forces, so a passing test
 * proves the pin overrides the model's choice (forced, not reclassified).
 */
function explanationToolUse(handlerId: string, answerText: string): ToolResponseBlock {
  return {
    type: 'tool_use',
    id: 'toolu_forced',
    name: OLUMI_ACTION_TOOL_NAME,
    input: {
      intent_class: 'execute',
      action: {
        handler_id: handlerId,
        entity: {
          id: 'opt-a',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'context_inference',
        },
        parameters: [],
        cited_context_fields: [],
        explanation: { answer_text: answerText },
      },
    },
  } as unknown as ToolResponseBlock;
}

describe('routeWithToolUse — F2 forced explanation intent', () => {
  it('disables thinking and forces the olumi_action tool on the pill path', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([explanationToolUse('explain_results', `Here is a full explanation of your options for ${CONVERSATION_SEED}, grounded in the analysis you just ran.`)]),
        ),
    };

    await routeWithToolUse(packWithConversation(), 'Explain these results.', {
      requestId: 'req-forced-thinking',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    const args = adapter.chatWithTools.mock.calls[0]![0];
    // Thinking disabled on this path — the ~9s latency lever (existing mechanism).
    expect(args.thinking).toEqual({ type: 'disabled' });
    // Tool forced so the coach always emits a structured proposal.
    expect(args.tool_choice).toEqual({ type: 'tool', name: OLUMI_ACTION_TOOL_NAME });
    expect(args.temperature).toBe(0);
  });

  it('carries the verbatim conversation window into the coach prompt', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(
          mkResult([explanationToolUse('explain_results', 'A complete plain-language explanation of the current analysis results and what they imply.')]),
        ),
    };

    await routeWithToolUse(packWithConversation(), 'Explain these results.', {
      requestId: 'req-forced-convo',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    const userContent = String(args.messages[0]!.content);
    // The conversation the user just had rides on the coach prompt — the whole
    // point of F2 (the pill answer can reference what was just said).
    expect(userContent).toContain(CONVERSATION_SEED);
    // The forced-intent directive is present so the authored answer stays on-topic.
    expect(userContent).toContain('handler_id "explain_results"');
  });

  it('PINS the proposal handler_id to the forced intent even when the model chose a different explanation handler', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        // Model routed to explain_from_structure — the pin must override it.
        .mockResolvedValueOnce(
          mkResult([explanationToolUse('explain_from_structure', `A thorough explanation referencing ${CONVERSATION_SEED} and the analysis.`)]),
        ),
    };

    const result = await routeWithToolUse(packWithConversation(), 'Explain these results.', {
      requestId: 'req-forced-pin',
      adapter,
      forcedExplanationHandlerId: 'explain_results',
    });

    expect(result.type).toBe('tool_call');
    if (result.type !== 'tool_call') throw new Error('expected tool_call');
    expect(result.proposal.intent_class).toBe('execute');
    if (result.proposal.intent_class !== 'execute') throw new Error('expected execute');
    // Forced, not reclassified.
    expect(result.proposal.action.handler_id).toBe('explain_results');
    // The coach's authored answer is preserved (it references the conversation).
    expect(result.proposal.action.explanation?.answer_text).toContain(CONVERSATION_SEED);
  });

  it('leaves a non-pill routing turn byte-identical (no thinking-force, auto tool_choice)', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(mkResult([{ type: 'text', text: 'Hello.' } as ToolResponseBlock])),
    };

    // No forcedExplanationHandlerId — the default coach path. (Thinking default
    // is governed by CEE_COACH_THINKING_DISABLED, asserted elsewhere; here we
    // only assert the tool_choice is NOT forced to a specific tool.)
    await routeWithToolUse(packWithConversation(), 'hi', {
      requestId: 'req-unforced',
      adapter,
    });

    const args = adapter.chatWithTools.mock.calls[0]![0];
    expect(args.tool_choice).toEqual({ type: 'auto' });
  });
});

describe('applyForcedExplanationHandler (pure)', () => {
  const baseToolCall: RoutingResult = {
    type: 'tool_call',
    orientationText: '',
    llmCallCount: 1,
    droppedActions: [],
    rawResult: mkResult([]),
    proposal: {
      intent_class: 'execute',
      action: {
        handler_id: 'explain_from_structure',
        entity: {
          id: 'opt-a',
          kind: 'option',
          resolution_status: 'resolved',
          resolution_method: 'context_inference',
        },
        parameters: [],
        cited_context_fields: [],
        explanation: { answer_text: 'authored prose' },
      },
    },
  } as unknown as RoutingResult;

  it('is a no-op when no forced handler is supplied', () => {
    expect(applyForcedExplanationHandler(baseToolCall, undefined)).toBe(baseToolCall);
  });

  it('overrides only the handler_id and preserves the authored explanation', () => {
    const out = applyForcedExplanationHandler(baseToolCall, 'explain_results');
    expect(out.type).toBe('tool_call');
    if (out.type !== 'tool_call' || out.proposal.intent_class !== 'execute') {
      throw new Error('expected execute tool_call');
    }
    expect(out.proposal.action.handler_id).toBe('explain_results');
    expect(out.proposal.action.explanation?.answer_text).toBe('authored prose');
  });

  it('lifts orientation text into answer_text when the model omitted the explanation', () => {
    const bare = {
      ...baseToolCall,
      orientationText: 'orientation authored prose',
      proposal: {
        intent_class: 'execute',
        action: {
          handler_id: 'what_would_flip',
          entity: {
            id: 'opt-a',
            kind: 'option',
            resolution_status: 'resolved',
            resolution_method: 'context_inference',
          },
          parameters: [],
          cited_context_fields: [],
        },
      },
    } as unknown as RoutingResult;
    const out = applyForcedExplanationHandler(bare, 'what_would_flip');
    if (out.type !== 'tool_call' || out.proposal.intent_class !== 'execute') {
      throw new Error('expected execute tool_call');
    }
    expect(out.proposal.action.explanation?.answer_text).toBe('orientation authored prose');
  });

  it('leaves a text_only result unchanged (defensive — forced tool_choice prevents this)', () => {
    const textOnly = {
      type: 'text_only',
      text: 'converse',
      inferredIntent: 'converse',
      rawResult: mkResult([]),
      llmCallCount: 1,
    } as unknown as RoutingResult;
    expect(applyForcedExplanationHandler(textOnly, 'explain_results')).toBe(textOnly);
  });
});

describe('buildForcedIntentDirective', () => {
  it('names the clicked question and pins the wire handler_id', () => {
    const explain = buildForcedIntentDirective('explain_results');
    expect(explain).toContain('handler_id "explain_results"');
    expect(explain).toContain('answer_text');
    const flip = buildForcedIntentDirective('what_would_flip');
    expect(flip).toContain('handler_id "what_would_flip"');
  });
});
