/**
 * V5 Task 3.1 — prompt-loading mechanism smoke test.
 *
 * Confirms that a large system prompt (representative of a future ~19K-char
 * routing prompt drop-in) is passed through the adapter unchanged, with no
 * silent truncation. This is a mechanism-only test; prompt content is out
 * of scope for CC per the brief ("must not author, edit, or optimise prompt
 * text"). We generate a deterministic placeholder string to exercise the
 * path.
 */

import { describe, expect, it } from 'vitest';

import { routeWithToolUse } from '../route-with-tool-use.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import type { ContextPack } from '../../context/context-pack-assembler.js';

function makeContextPack(): ContextPack {
  return {
    version: '2.0',
    stage: 'frame',
    graph: {
      nodes: [],
      edges: [],
      options: [],
      goals: [],
      constraints: [],
      counts: { nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 },
    },
    analysis: null,
    conversation: {
      recent_turns: [],
      turn_count: 0,
      last_tool_used: null,
      pending_confirmation: false,
    },
    coaching: {
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  };
}

describe('routeWithToolUse — system prompt loading (Task 3.1)', () => {
  it('passes the full system prompt through to the adapter unchanged', async () => {
    let capturedSystem = '';
    const mockAdapter = {
      async chatWithTools(args: ChatWithToolsArgs): Promise<ChatWithToolsResult> {
        capturedSystem = args.system as string;
        return {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        } as ChatWithToolsResult;
      },
    };

    await routeWithToolUse(makeContextPack(), 'what should I do?', {
      requestId: 'req-size',
      adapter: mockAdapter,
    });

    // Minimal smoke assertion: system prompt reaches the adapter. After V5
    // alpha hardening Phase 2.1 the prompt is loaded from Prompts/v38.2.txt;
    // we assert content known to exist in that prompt without coupling to
    // the exact phrasing.
    expect(capturedSystem.length).toBeGreaterThan(0);
    expect(capturedSystem).toContain('Olumi');
    expect(capturedSystem).toContain('<ROLE>');
  });

  it('passes the routing system prompt through at its full length (no truncation)', async () => {
    // Imports the actual constant so the assertion is tied to what would
    // land in production. When the constant is replaced with a 19K-char
    // prompt, this assertion still holds — the test becomes a regression
    // guard that the loading path never truncates.
    const { ROUTING_SYSTEM_PROMPT } = await import('../route-with-tool-use.js');

    let capturedLength = 0;
    const mockAdapter = {
      async chatWithTools(args: ChatWithToolsArgs): Promise<ChatWithToolsResult> {
        capturedLength = (args.system as string).length;
        return {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        } as ChatWithToolsResult;
      },
    };

    await routeWithToolUse(makeContextPack(), 'hello', {
      requestId: 'req-size-2',
      adapter: mockAdapter,
    });

    // Adapter receives exactly the constant's length — no truncation, no
    // padding. This test survives prompt-content churn as long as the
    // loading mechanism stays intact.
    expect(capturedLength).toBe(ROUTING_SYSTEM_PROMPT.length);
    expect(capturedLength).toBeGreaterThan(100);
  });

  it('passes a 19K-character override prompt through the adapter byte-for-byte', async () => {
    // V5 Task 3.1 (post-review): prove the loading path survives the
    // future ~19K-char prompt drop-in. Uses the `systemPromptOverride`
    // seam so the test doesn't depend on mutating the module-level const.
    const longPrompt = 'X'.repeat(19_000);
    expect(longPrompt.length).toBe(19_000);

    let captured: string | null = null;
    const mockAdapter = {
      async chatWithTools(args: ChatWithToolsArgs): Promise<ChatWithToolsResult> {
        captured = args.system as string;
        return {
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 0, output_tokens: 0 },
        } as ChatWithToolsResult;
      },
    };

    await routeWithToolUse(makeContextPack(), 'hi', {
      requestId: 'req-size-19k',
      adapter: mockAdapter,
      systemPromptOverride: longPrompt,
    });

    expect(captured).not.toBeNull();
    // Byte-for-byte equality — no truncation, no collapse, no re-encode.
    expect(captured!.length).toBe(longPrompt.length);
    expect(captured).toBe(longPrompt);
  });
});
