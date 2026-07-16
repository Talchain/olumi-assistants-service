/**
 * CEE_ANSWER_SHAPE_ENFORCED — turn-executor threading (ROADMAP 1.132, F2).
 *
 * Proves runTurnExecutor:
 *   - flag ON, coach/converse tool call with a valid `answer_shape`:
 *     `response.assistant_text` IS the shape-derived text (headline /
 *     ≤3 bullets / detail — the wall-of-prose fix) AND the shape is
 *     surfaced on `TurnExecutorRunResult.answerShape` for the route's
 *     flag-gated `_answer_shape` wire sidecar (same threading class as
 *     `run.reasoning` — see turn-executor-reasoning-capture.test.ts).
 *   - flag OFF: a legacy coach turn's assistant_text is BYTE-IDENTICAL to
 *     the model-authored answer_text (golden), and `run.answerShape` is
 *     absent.
 *
 * The wire-level strip → validate → re-attach gate is route-v2's and is
 * covered in tests/integration/orchestrator/route-v2-answer-shape.test.ts.
 *
 * Harness mirrors turn-executor-answer-text-compose-guard.test.ts.
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
const { deriveAnswerTextFromShape } = await import('../routing/answer-shape.js');

const BASE_PAYLOAD = makeMessagePayload({
  turn_id: '99999999-9999-4999-8999-999999999997',
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
  message: 'help me think this through',
});

const VALID_SHAPE = {
  headline: 'Focus on retention before pricing.',
  bullets: ['Churn dominates your graph.', 'Pricing is second-order.'],
  detail:
    'The churn to revenue causal link is the strongest in the model, so ' +
    'retention work moves the goal most.',
};

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

function mockAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

let priorFlag: string | undefined;

async function setFlag(value: 'true' | undefined) {
  priorFlag = process.env.CEE_ANSWER_SHAPE_ENFORCED;
  if (value === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = value;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

async function restoreFlag() {
  if (priorFlag === undefined) {
    delete process.env.CEE_ANSWER_SHAPE_ENFORCED;
  } else {
    process.env.CEE_ANSWER_SHAPE_ENFORCED = priorFlag;
  }
  const { _resetConfigCache } = await import('../../config/index.js');
  _resetConfigCache();
}

describe('TurnExecutor — answer_shape threading (CEE_ANSWER_SHAPE_ENFORCED)', () => {
  beforeEach(() => {
    setTestSink(() => {});
  });
  afterEach(async () => {
    setTestSink(null);
    vi.restoreAllMocks();
    await restoreFlag();
  });

  it('flag ON, coach turn: assistant_text IS the shape-derived text and run.answerShape carries the shape', async () => {
    await setFlag('true');
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-coach-on', {
      routingAdapter: mockAdapter(
        toolResult(
          { intent_class: 'coach', coaching_mode: 'reframe', answer_shape: VALID_SHAPE },
          'Orientation sentence.',
        ),
      ),
    });

    expect(result.response.assistant_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    expect(result.answerShape).toEqual(VALID_SHAPE);
    // The shape never rides the pre-egress response body itself — route-v2
    // attaches the sidecar post-validation.
    expect('_answer_shape' in (result.response as Record<string, unknown>)).toBe(false);
  });

  it('flag ON, converse turn: same contract as coach', async () => {
    await setFlag('true');
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-converse-on', {
      routingAdapter: mockAdapter(
        toolResult({ intent_class: 'converse', answer_shape: VALID_SHAPE }, 'Orientation.'),
      ),
    });

    expect(result.response.assistant_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    expect(result.answerShape).toEqual(VALID_SHAPE);
  });

  it('flag OFF (default), legacy coach turn: assistant_text is BYTE-IDENTICAL to the model answer_text; run.answerShape is absent', async () => {
    await setFlag(undefined);
    const legacyAnswer =
      'The full coaching answer, written as ordinary prose with no shape.';
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-coach-off', {
      routingAdapter: mockAdapter(
        toolResult(
          { intent_class: 'coach', coaching_mode: 'reframe', answer_text: legacyAnswer },
          'Orientation sentence.',
        ),
      ),
    });

    expect(result.response.assistant_text).toBe(legacyAnswer);
    expect(result.answerShape).toBeUndefined();
  });
});
