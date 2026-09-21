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

describe('draft_graph — a runaway can no longer strand a STARVED final attempt (skip-gate alignment, 2026-07-25)', () => {
  it('the doomed sub-budget final attempt is SKIPPED, not run — and the skip error states the real numbers', async () => {
    // ⚠ THIS TEST REPLACES F5's ORIGINAL SCENARIO, WHICH IS NOW UNREACHABLE BY
    // CONSTRUCTION — recorded rather than quietly rewritten.
    //
    // F5 asserted "a late final attempt whose cap the F1 squeeze LOWERED reports
    // that lowered cap honestly". Reaching that state required a final attempt
    // running at `finalCap < outerCap` after a runaway abort. The aligned gate
    // makes that state impossible: a final attempt is now permitted only when it
    // can fund AT LEAST the cap of the attempt that was abandoned, i.e. only when
    // `finalCap >= outerCap`. `finalCap < outerCap` and "permitted to run" are
    // now mutually exclusive, so the runaway-driven squeeze cannot be observed.
    // That is the whole point of the fix — the state F5 was making legible is
    // the state that produced the live 0/18 (`/assist` A2killer, 2026-07-24).
    //
    // What this test pins instead is strictly stronger: the doomed attempt does
    // not run at all, it fails FAST rather than ~30s later, and the honest
    // reporting F5 introduced is still present on the error.
    //
    // (`actualMaxTokens` honest-cap reporting itself stays covered on the live
    // path — the truncation log, `failedCallLlmMeta.max_tokens`, and the success
    // meta all read it, and the F1 squeeze still applies to withRetry's transient
    // re-invocations, which this fix does not touch.)
    //
    // MUTATION-CHECK: revert the adapter's skip-gate to the bare
    // `finalAttemptAffordableTokens < LEAN_DRAFT_AFFORDABLE_TOKENS_FLOOR` and
    // this goes RED — a second stream body is captured and the message changes
    // from the unaffordable-final error to the truncation error.
    h.capturedBodies = [];
    h.clock = 0;
    h.callCount = 0;
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => h.clock);

    let err: unknown;
    try {
      await draftGraphWithAnthropic(
        { brief: 'Should we launch product A or B next quarter?', docs: [], seed: 1 },
        // Attempt 1 capped BELOW what the post-abort window affords, so the
        // runaway ladder is armed (at the full cap no abort is authorised at
        // all). aff(120s)=9,450; aff(90s)=6,750; a 6,000 ceiling is re-fundable.
        { timeoutMs: 120_000, forceDefault: true, maxTokensCeiling: 6_000 },
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);

    // POSITIVE CONTROL — the runaway really did fire. Without this the assertion
    // below ("only one body captured") would pass on a stream that never ran.
    expect(h.callCount).toBe(1);
    expect(h.capturedBodies.length).toBe(1);
    expect(h.capturedBodies[0]!.max_tokens).toBe(6_000);

    // The clock advanced to 70s, leaving 50s → aff(50s) = 3,150 < the 6,000 cap
    // that was abandoned → the final attempt is refused, not starved.
    const message = (err as Error).message;
    expect(message).toContain('final attempt unaffordable');
    expect(message).toContain('3150 tokens');   // what the window really affords
    expect(message).toContain('6000-token cap'); // what the abandoned attempt had
  });
});
