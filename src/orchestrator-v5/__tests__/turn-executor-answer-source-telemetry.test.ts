/**
 * `v5.coaching.answer_source` — the measurement instrument for the
 * `answer_text` channel itself (ROADMAP 1.38).
 *
 * Emitted at the compose pick site for every coach/converse (tool_call)
 * turn, recording which channel shipped: the model-authored `answer_text`
 * or the `orientationText` fallback. Deliberately NOT flag-gated behind
 * `CEE_ANSWER_TEXT_REQUIRED` — the whole point is to quantify the
 * prompt-only world as it exists today (v42.2g), i.e. the population lift
 * the belt-and-braces hardening (layers A/B) is measured against. Lengths +
 * closed enums only — never the model's prose.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeMessagePayload } from './fixtures.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { ChatWithToolsResult, ToolResponseBlock } from '../../adapters/llm/types.js';

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
  turn_id: '99999999-9999-4999-8999-999999999997',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
  message: 'help me think this through',
});

// Sanitises to '' via sanitiseNarrateOutput's TAG_PATTERN (strips <...>
// markers, retains inner text — this string has none) while being raw
// non-blank, so it satisfies layer A's schema-pressure check and never
// triggers REPAIR_ONCE (mirrors turn-executor-answer-text-compose-guard.test.ts).
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

let priorFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_TEXT_REQUIRED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = value;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_TEXT_REQUIRED;
  } else {
    process.env.CEE_ANSWER_TEXT_REQUIRED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});

afterEach(async () => {
  setTestSink(null);
  vi.restoreAllMocks();
  await restoreFlag();
});

describe('v5.coaching.answer_source — flag OFF (default, the current prompt-only world)', () => {
  beforeEach(async () => {
    await setFlag(undefined);
  });

  it('coach with a real answer_text records source=answer_text', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          { intent_class: 'coach', coaching_mode: 'reframe', answer_text: 'The full coaching answer.' },
          'Short orientation.',
        ),
      ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-coach-answer', { routingAdapter: adapter });

    const evt = events.find((e) => e.event === 'v5.coaching.answer_source');
    expect(evt).toBeDefined();
    expect(evt?.data.intent_class).toBe('coach');
    expect(evt?.data.source).toBe('answer_text');
    expect(evt?.data.answer_text_length).toBe('The full coaching answer.'.length);
    expect(evt?.data.orientation_length).toBe('Short orientation.'.length);
    // Lengths only — never the model's prose.
    expect(Object.keys(evt!.data)).not.toContain('answer_text');
    expect(Object.keys(evt!.data)).not.toContain('orientation_text');
  });

  it('coach with absent answer_text records source=orientation_fallback', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'coach', coaching_mode: 'reframe' }, 'Fallback orientation text.'),
      ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-coach-fallback', { routingAdapter: adapter });

    const evt = events.find((e) => e.event === 'v5.coaching.answer_source');
    expect(evt).toBeDefined();
    expect(evt?.data.intent_class).toBe('coach');
    expect(evt?.data.source).toBe('orientation_fallback');
    expect(evt?.data.answer_text_length).toBe(0);
    expect(evt?.data.orientation_length).toBe('Fallback orientation text.'.length);
  });

  it('tool-call converse with a real answer_text records source=answer_text', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult(
          { intent_class: 'converse', answer_text: 'The full conversational answer.' },
          'Short lead-in.',
        ),
      ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-converse-answer', { routingAdapter: adapter });

    const evt = events.find((e) => e.event === 'v5.coaching.answer_source');
    expect(evt).toBeDefined();
    expect(evt?.data.intent_class).toBe('converse');
    expect(evt?.data.source).toBe('answer_text');
  });

  it('tool-call converse with absent answer_text records source=orientation_fallback', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'converse' }, 'Only the orientation.'),
      ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-converse-fallback', { routingAdapter: adapter });

    const evt = events.find((e) => e.event === 'v5.coaching.answer_source');
    expect(evt).toBeDefined();
    expect(evt?.data.intent_class).toBe('converse');
    expect(evt?.data.source).toBe('orientation_fallback');
  });

  it('text_only converse (no tool call) never emits the channel-pick event — no answer_text channel exists', async () => {
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce({
        content: [{ type: 'text', text: 'A plain conversational reply.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 5 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 20,
      }),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-textonly', { routingAdapter: adapter });

    expect(events.some((e) => e.event === 'v5.coaching.answer_source')).toBe(false);
  });
});

describe('v5.coaching.answer_source — flag ON — still fires, independent of the recovery guard', () => {
  beforeEach(async () => {
    await setFlag('true');
  });

  it('fires alongside the layer-B recovery event — reflects the RAW channel pick, independent of post-sanitise recovery', async () => {
    // Raw answer_text is non-blank (satisfies layer A, no REPAIR_ONCE) but
    // sanitises to '' (pure markup, no retained inner text), so layer B's
    // FINAL-text check still degrades to bounded-recovery. The source
    // telemetry is computed at the RAW pick site, before sanitisation, so
    // it correctly reports 'answer_text' here — proving the two signals
    // are independent instruments measuring different things.
    const adapter = {
      chatWithTools: vi.fn().mockResolvedValueOnce(
        toolResult({ intent_class: 'coach', coaching_mode: 'reframe', answer_text: PURE_MARKUP }),
      ),
    };

    await runTurnExecutor(BASE_PAYLOAD, 'req-source-coach-flagon-empty', { routingAdapter: adapter });

    const sourceEvt = events.find((e) => e.event === 'v5.coaching.answer_source');
    expect(sourceEvt).toBeDefined();
    expect(sourceEvt?.data.source).toBe('answer_text');
    expect(sourceEvt?.data.answer_text_length).toBe(PURE_MARKUP.length);
    expect(events.some((e) => e.event === 'v5.coaching.empty_answer_recovered')).toBe(true);
  });
});
