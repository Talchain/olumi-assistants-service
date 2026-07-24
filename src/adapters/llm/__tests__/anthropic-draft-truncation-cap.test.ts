/**
 * F5 (Codex deep-review, 2026-07-24) — the late-final-attempt token cap must be
 * reported HONESTLY.
 *
 * The F1 squeeze LOWERS `attemptBody.max_tokens` on a late final attempt (a
 * persistent runaway that ate most of the request budget). Before F5, logs,
 * salvage telemetry, the thrown error message and the returned metadata all
 * still reported the OUTER cap (~8,550) rather than the cap that actually
 * applied (e.g. ~4,000). This test drives exactly that path — attempt 1
 * runs away (char gate), the clock advances so attempt 2 is the FINAL attempt
 * with a LOWERED cap, and attempt 2 truncates at max_tokens — then asserts the
 * thrown truncation error reports the NUMERIC per-attempt cap, not the outer one.
 *
 * MUTATION-CHECK: revert the reporting sites in anthropic.ts from
 * `actualMaxTokens` back to `maxTokens` and this test goes RED (the message
 * carries the outer cap, and `.toContain(finalCap)` fails).
 */
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

// Shared, hoisted mutable state the SDK mock and the test both read.
const h = vi.hoisted(() => ({
  capturedBodies: [] as Array<{ max_tokens?: number }>,
  clock: 0,
  callCount: 0,
  ADVANCE_MS: 70_000, // leaves < 55s remaining on attempt 2 → it is the FINAL attempt
  TRUNCATED_TEXT: '{"summary": "partial draft that got cut before nodes',
}));

// Mock the Anthropic SDK so getClient()'s `new Anthropic(...)` yields our double.
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: { max_tokens?: number }) => {
        h.capturedBodies.push(body);
        const call = ++h.callCount;
        if (call === 1) {
          // Attempt 1: advance the clock so attempt 2's remaining budget drops
          // below the retry floor (→ final attempt). The closure already read
          // attempt 1's remaining (full) before invoking stream, so advancing
          // here only affects attempt 2.
          h.clock = h.ADVANCE_MS;
          return makeRunawayStream();
        }
        return makeTruncatedStream();
      },
    };
  }
  return { default: MockAnthropic };
});

// Attempt 1: a char-gate runaway — >8000 chars, no `"from":` (never reaches edges).
function makeRunawayStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x'.repeat(8_050) } };
    },
    async finalMessage() {
      throw new Error('finalMessage should not be reached on a char-gate runaway');
    },
  };
}

// Attempt 2 (final): completes with stop_reason=max_tokens and un-salvageable
// truncated JSON (no `nodes` array) → the typed truncation throw.
function makeTruncatedStream() {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: h.TRUNCATED_TEXT } };
    },
    async finalMessage() {
      return {
        content: [{ type: 'text', text: h.TRUNCATED_TEXT }],
        usage: { input_tokens: 1_000, output_tokens: 4_096 },
        stop_reason: 'max_tokens',
      };
    },
  };
}

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let dateNowSpy: ReturnType<typeof vi.spyOn>;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-f5';
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
  ({ draftGraphWithAnthropic } = await import('../anthropic.js'));
});

afterAll(async () => {
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = priorKey;
  const { _resetConfigCache } = await import('../../../config/index.js');
  _resetConfigCache();
});

afterEach(() => {
  dateNowSpy?.mockRestore();
});

describe('draft_graph — late-final-attempt token cap is reported honestly (F5)', () => {
  it('the truncation error reports the LOWERED per-attempt cap, not the outer cap', async () => {
    h.capturedBodies = [];
    h.clock = 0;
    h.callCount = 0;
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => h.clock);

    let err: unknown;
    try {
      await draftGraphWithAnthropic(
        { brief: 'Should we launch product A or B next quarter?', docs: [], seed: 1 },
        { timeoutMs: 120_000, forceDefault: true },
      );
    } catch (e) {
      err = e;
    }

    // The draft must have failed (truncation could not be salvaged).
    expect(err).toBeInstanceOf(Error);

    // Two attempts were made; the final attempt's cap was LOWERED by F1.
    expect(h.capturedBodies.length).toBe(2);
    const outerCap = h.capturedBodies[0]!.max_tokens!;
    const finalCap = h.capturedBodies[1]!.max_tokens!;
    expect(finalCap).toBeLessThan(outerCap); // positive control: the squeeze happened

    // F5: the reported cap is the ACTUAL per-attempt cap, not the outer one.
    const message = (err as Error).message;
    expect(message).toContain(`max_tokens=${finalCap}`);
    expect(message).not.toContain(`max_tokens=${outerCap}`);
  });
});
