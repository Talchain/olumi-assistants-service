/**
 * Answer-shape threading through runTurnExecutor (ROADMAP 1.132, F2) —
 * UNCONDITIONAL since the F1 flag deletion (no-dark-launches doctrine).
 *
 * Proves runTurnExecutor:
 *   - coach/converse tool call with a valid `answer_shape`:
 *     `response.assistant_text` IS the shape-derived text (headline /
 *     ≤3 bullets / detail — the wall-of-prose fix) AND the shape is
 *     surfaced on `TurnExecutorRunResult.answerShape` for the route's
 *     `_answer_shape` wire sidecar (same threading class as `run.reasoning`
 *     — see turn-executor-reasoning-capture.test.ts).
 *   - P1 fail-closed: a turn whose text is rewritten AFTER shape capture
 *     ships a MATCHING sidecar or NONE — never one describing text the user
 *     never sees.
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
const { V5_STRUCTURAL_DECLINE_TEXT } = await import('../routing/mutation-language.js');

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

describe('TurnExecutor — answer_shape threading (unconditional)', () => {
  beforeEach(() => {
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('coach turn: assistant_text IS the shape-derived text and run.answerShape carries the shape', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-coach', {
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

  it('converse turn: same contract as coach', async () => {
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-converse', {
      routingAdapter: mockAdapter(
        toolResult({ intent_class: 'converse', answer_shape: VALID_SHAPE }, 'Orientation.'),
      ),
    });

    expect(result.response.assistant_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    expect(result.answerShape).toEqual(VALID_SHAPE);
  });

  it('coach turn rewritten by a post-capture guard: ships a matching sidecar or NONE (P1 — stale-sidecar fail-closed)', async () => {
    // A shape whose derived text is a tightly-bound first-person structural
    // COMPLETION claim with NO committed mutation this turn — exactly the
    // input a post-capture honesty guard rewrites. The rewrite runs AFTER the
    // STEP 6.7 shape capture, so without the finalise-time re-verification the
    // run would surface a sidecar describing text the user never receives
    // (guarantee-theatre class).
    const CLAIM_SHAPE = {
      headline: "I've added the churn factor to your model.",
      bullets: [],
      detail:
        'The churn factor now feeds the revenue goal directly, which is why ' +
        'retention work moves the outcome most.',
    };
    const result = await runTurnExecutor(BASE_PAYLOAD, 'req-shape-coach-swapped', {
      routingAdapter: mockAdapter(
        toolResult(
          { intent_class: 'coach', coaching_mode: 'reframe', answer_shape: CLAIM_SHAPE },
          'Orientation sentence.',
        ),
      ),
    });

    // Positive control for the mechanism: a rewriter DID fire — the final
    // text is not the shape-derived text. Without this, the absence
    // assertion below would be vacuous. The coaching-context post-check
    // (unconditional) degrades this completion-claim-under-freshness-'none'
    // prose to the deterministic verdict-correct copy BEFORE the STEP 6.6
    // honesty gate would swap it — so the pinned text is the coaching degrade
    // response, not V5_STRUCTURAL_DECLINE_TEXT. The invariant under test is
    // unchanged.
    expect(result.response.assistant_text).toContain('No analysis has been run on your model yet');
    expect(result.response.assistant_text).not.toBe(V5_STRUCTURAL_DECLINE_TEXT);
    expect(result.response.assistant_text).not.toBe(deriveAnswerTextFromShape(CLAIM_SHAPE));
    // The invariant under test: a turn whose text was rewritten AFTER shape
    // capture must ship either a matching sidecar or none. The derived text
    // no longer matches, so the shape must be dropped.
    expect(result.answerShape).toBeUndefined();
  });
});
