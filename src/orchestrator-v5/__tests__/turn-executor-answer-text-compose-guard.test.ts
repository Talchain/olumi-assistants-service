/**
 * CEE_ANSWER_TEXT_REQUIRED — compose-guard layer (layer B) integration
 * tests, exercised through `runTurnExecutor`.
 *
 * Belt-and-braces hardening for the coach/converse `answer_text` channel
 * (PR #380 / ROADMAP 1.38). On Sonnet 5, adaptive thinking sometimes
 * starves `orientationText` to zero, which — combined with an absent
 * `answer_text` — produces a fully empty user-facing coach/converse answer
 * (live-observed 1/6, acceptance-evidence/sonnet5-reflip/).
 *
 * Layer A (tool-schema.ts) forces a REPAIR_ONCE retry whenever the RAW
 * `answer_text` is absent/blank on a coach/converse tool call, which makes
 * that exact raw-blank scenario unreachable here once layer A has run — but
 * layer A validates the RAW string, BEFORE the sanitise/coaching-guard
 * pipeline. The genuinely independent residual layer B closes: a raw
 * `answer_text` that is non-blank (so layer A is satisfied, no repair
 * fires) can still sanitise down to empty — e.g. pure tag/markup content
 * with no retained inner text (`sanitiseNarrateOutput`'s TAG_PATTERN strips
 * `<...>` markers but keeps inner text; content that is ONLY markers
 * sanitises to `''`). Layer B checks the FINAL composed text, so it also
 * backstops layer A being bypassed by a future/rolled code path.
 *
 * UNCONDITIONAL since 2026-07-20 (O-7 wave 2: CEE_ANSWER_TEXT_REQUIRED
 * deleted, live-true on staging). The former flag-OFF describes were removed
 * with the flag — their scenario (a tool call omitting answer_text) now
 * takes the unconditional REPAIR_ONCE + layer-B path pinned here. The
 * separate always-on STEP 7 backstop (ROADMAP 1.20(a),
 * `buildBoundedFallbackCopyAndChips`) remains beneath this guard at the
 * commit chokepoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: '99999999-9999-4999-8999-999999999998',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
  message: 'help me think this through',
});

// Sanitises to '' via sanitiseNarrateOutput's TAG_PATTERN (strips <...>
// markers, retains inner text — this string has none) while being raw
// non-blank, so it satisfies layer A's schema-pressure check and never
// triggers REPAIR_ONCE.
const PURE_MARKUP = '<internal></internal>';

function toolResult(input: unknown, prefaceText?: string): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [];
  if (prefaceText) content.push({ type: 'text', text: prefaceText });
  content.push({
    type: 'tool_use',
    id: 'tu-1',
    name: OLUMI_ACTION_TOOL_NAME,
    input: input as Record<string, unknown>,
  });
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

// The former flag-OFF describes were removed 2026-07-20 (O-7 wave 2:
// CEE_ANSWER_TEXT_REQUIRED deleted, live-true on staging): their scenarios —
// a tool call omitting answer_text — now take the unconditional REPAIR_ONCE +
// layer-B path pinned below, so a distinct OFF state no longer exists.
describe('coach — answer_text hardening (unconditional) — compose guard (layer B)', () => {

  it('raw answer_text passes layer A (non-blank) but sanitises to empty on BOTH fields → single LLM call, degrades to bounded-recovery', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'coach', coaching_mode: 'reframe', answer_text: PURE_MARKUP }),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-flagon-empty', {
      routingAdapter: adapter,
    });

    // Layer A's Zod check only inspects the RAW string (non-blank here), so
    // no REPAIR_ONCE retry fires — proves layer B is independent of layer A.
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(telemetry.intent_class).toBe('coach');
    expect(response.assistant_text.trim()).not.toBe('');
    // Same deterministic copy family as commitBoundedRoutingFallback's
    // "no prior analysis" branch (no run_analysis fact on this turn).
    expect(response.assistant_text).toBe(
      "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.",
    );
    expect(response.suggested_actions).toEqual([]);

    const recoveryEvent = events.find((e) => e.event === 'v5.coaching.empty_answer_recovered');
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent?.data.intent_class).toBe('coach');
    expect(recoveryEvent?.data.answer_text_length).toBe(PURE_MARKUP.length);
    expect(recoveryEvent?.data.orientation_length).toBe(0);
    // Lengths only — never the model's prose.
    expect(Object.keys(recoveryEvent!.data)).not.toContain('answer_text');
    expect(Object.keys(recoveryEvent!.data)).not.toContain('orientation_text');
  });

  it('absent answer_text on attempt 1 → REPAIR_ONCE supplies a real answer_text on attempt 2 → ships the repaired answer, no layer-B recovery', async () => {
    const adapter = {
      chatWithTools: vi
        .fn<(args: ChatWithToolsArgs, opts: unknown) => Promise<ChatWithToolsResult>>()
        .mockResolvedValueOnce(toolResult({ intent_class: 'coach', coaching_mode: 'reframe' }))
        .mockResolvedValueOnce(
          toolResult({
            intent_class: 'coach',
            coaching_mode: 'reframe',
            answer_text: 'The repaired full coaching answer.',
          }),
        ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-flagon-repaired', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(2);
    expect(telemetry.intent_class).toBe('coach');
    expect(response.assistant_text).toBe('The repaired full coaching answer.');
    expect(events.some((e) => e.event === 'v5.coaching.empty_answer_recovered')).toBe(false);
  });

  it('non-empty answer_text passes through UNCHANGED — no repair, no recovery, no telemetry', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          {
            intent_class: 'coach',
            coaching_mode: 'reframe',
            answer_text: 'The full coaching answer stands on its own merits here.',
          },
          'Short orientation.',
        ),
      ),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-coach-flagon-full', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toBe('The full coaching answer stands on its own merits here.');
    expect(events.some((e) => e.event === 'v5.coaching.empty_answer_recovered')).toBe(false);
  });
});

describe('converse — answer_text hardening (unconditional) — compose guard (layer B)', () => {

  it('raw answer_text passes layer A but sanitises to empty on BOTH fields → single LLM call, degrades to bounded-recovery', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'converse', answer_text: PURE_MARKUP }),
      ),
    };

    const { response, telemetry } = await runTurnExecutor(BASE_PAYLOAD, 'req-converse-flagon-empty', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(telemetry.intent_class).toBe('converse');
    expect(response.assistant_text.trim()).not.toBe('');
    expect(response.assistant_text).toBe(
      "I couldn't complete that turn cleanly. Try again, or rephrase what you'd like to do.",
    );

    const recoveryEvent = events.find((e) => e.event === 'v5.coaching.empty_answer_recovered');
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent?.data.intent_class).toBe('converse');
    expect(recoveryEvent?.data.answer_text_length).toBe(PURE_MARKUP.length);
    expect(recoveryEvent?.data.orientation_length).toBe(0);
  });

  it('non-empty converse answer_text passes through unchanged — no repair, no recovery', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          { intent_class: 'converse', answer_text: 'The full conversational answer stands alone.' },
          'Short lead-in.',
        ),
      ),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-converse-flagon-full', {
      routingAdapter: adapter,
    });

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(response.assistant_text).toBe('The full conversational answer stands alone.');
    expect(events.some((e) => e.event === 'v5.coaching.empty_answer_recovered')).toBe(false);
  });

  it('text_only converse (no tool call) is never empty and never triggers the guard', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce({
        content: [{ type: 'text', text: 'A plain conversational reply.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 20,
      }),
    };

    const { response } = await runTurnExecutor(BASE_PAYLOAD, 'req-converse-flagon-textonly', {
      routingAdapter: adapter,
    });

    expect(response.assistant_text).toBe('A plain conversational reply.');
    expect(events.some((e) => e.event === 'v5.coaching.empty_answer_recovered')).toBe(false);
  });
});
