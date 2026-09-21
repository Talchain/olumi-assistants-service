/**
 * ⭐⭐ THE REAL ADAPTER REALLY REACHES THE SKIP GATE, AND WHAT IT THROWS IS REALLY
 * CLASSIFIABLE (F1, 2026-07-25).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM
 * `tests/unit/cee.unified-pipeline.runaway-abort-dead-end.test.ts`. That file
 * proves the PIPELINE serves honest copy for a runaway-abort failure. It does so
 * against a fixture, and a fixture is a claim about the adapter, not evidence
 * about it. This file removes that gap: it drives `draftGraphWithAnthropic`
 * until `shouldSkipDoomedFinalAttempt` fires for real, and asserts that the
 * error the adapter ACTUALLY throws satisfies `isDemandNotBriefFailure`. If the
 * skip throw ever stops carrying a canonical `_llm_meta` — the single property
 * the classification now derives from — this goes red at the source rather than
 * silently re-opening the dead end downstream.
 *
 * ⭐ THE SCENARIO IS THE MEASURED ONE, not an invented one. `draft-budget.ts`
 * records the live 2026-07-24 failure as "after two 30s runaway aborts had
 * burned 60s of the 110s window". Replayed here exactly, and the arithmetic is
 * asserted rather than asserted-about:
 *
 *   attempt 1 · remaining 110,000 → abortable (aff(85,000)=6,300 ≥ 3,581) → abort at +30s
 *   attempt 2 · remaining  80,000 → abortable (aff(55,000)=3,600 ≥ 3,581) → abort at +30s
 *   loop top  · remaining  50,000 → final (50,000 ≤ 79,789) AND aff(50,000)=3,150 < 3,581
 *                                 → SKIP, throw
 *
 * THE CLOCK IS DRIVEN, NOT WAITED ON. `Date.now` is stubbed so each runaway
 * attempt "consumes" 30s of the window; the streams themselves yield instantly.
 * Without that the skip gate is unreachable in a unit test BY CONSTRUCTION — it
 * is the gate that fires only once the window has actually been burned, which is
 * exactly why no test reached it before and why the defect shipped.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  DRAFT_RUNAWAY_HARD_CEILING_MS,
  DRAFT_RUNAWAY_MIN_RETRY_MS,
  isDemandNotBriefFailure,
} from '../draft-budget.js';
import {
  getAffordableDraftTokens,
  viableRunawayRetryFloorTokens,
} from '../../../config/timeouts.js';

/** The whole draft window, and what one runaway attempt costs inside it. */
const DRAFT_WINDOW_MS = 110_000;
const RUNAWAY_ATTEMPT_COST_MS = 30_000;

const h = vi.hoisted(() => ({
  callCount: 0,
  /** Milliseconds of the draft window consumed so far, driven by the streams. */
  elapsedMs: 0,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        h.callCount += 1;
        return makeRunawayStream();
      },
    };
  }
  return { default: MockAnthropic };
});

/**
 * One unterminated JSON string value, preceded by an edge marker so the
 * total-char gate is cancelled and only the per-value ceiling can fire — the
 * same discriminating shape `draft-string-run-abort.test.ts` uses.
 */
function runawayDeltas(): string[] {
  const deltas: string[] = [
    '{"edges":[{"from":"fac_a","to":"goal_g"}],"goal_constraints":[{"label":"',
  ];
  for (let i = 0; i < 40; i++) deltas.push('​'.repeat(64));
  return deltas;
}

function makeRunawayStream() {
  return {
    async *[Symbol.asyncIterator]() {
      // The attempt costs real window time before it is abandoned.
      h.elapsedMs += RUNAWAY_ATTEMPT_COST_MS;
      for (const d of runawayDeltas()) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: d } };
      }
    },
    async finalMessage() {
      return {
        content: [{ type: 'text', text: runawayDeltas().join('') }],
        usage: { input_tokens: 1_000, output_tokens: 8_550 },
        stop_reason: 'max_tokens',
      };
    },
  };
}

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let priorKey: string | undefined;
let nowSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-skipgate';
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
  nowSpy?.mockRestore();
  nowSpy = undefined;
  h.callCount = 0;
  h.elapsedMs = 0;
  vi.restoreAllMocks();
});

function driveClock(): void {
  const base = Date.now();
  nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => base + h.elapsedMs);
}

describe('the runaway-abort skip gate — reachability and classification', () => {
  it('POSITIVE CONTROL — the schedule this test drives really does reach the skip gate', () => {
    // Derived from the shipped budget functions, so a re-aimed yardstick makes
    // this test say so instead of silently testing a different scenario.
    const afterFirstAbort = DRAFT_WINDOW_MS - RUNAWAY_ATTEMPT_COST_MS;
    const afterSecondAbort = DRAFT_WINDOW_MS - 2 * RUNAWAY_ATTEMPT_COST_MS;
    const noMoreAbortableAttempts = DRAFT_RUNAWAY_HARD_CEILING_MS + DRAFT_RUNAWAY_MIN_RETRY_MS;

    // Attempts 1 and 2 must both be AUTHORISED to abort, or the guard never
    // arms and the run never spends the budget.
    expect(DRAFT_WINDOW_MS).toBeGreaterThan(noMoreAbortableAttempts);
    expect(getAffordableDraftTokens(DRAFT_WINDOW_MS - DRAFT_RUNAWAY_HARD_CEILING_MS))
      .toBeGreaterThanOrEqual(viableRunawayRetryFloorTokens());
    expect(afterFirstAbort).toBeGreaterThan(noMoreAbortableAttempts);
    expect(getAffordableDraftTokens(afterFirstAbort - DRAFT_RUNAWAY_HARD_CEILING_MS))
      .toBeGreaterThanOrEqual(viableRunawayRetryFloorTokens());

    // …and the third loop top must be BOTH final and unaffordable, or the run
    // takes the ordinary final attempt and never reaches the throw under test.
    expect(afterSecondAbort).toBeLessThanOrEqual(noMoreAbortableAttempts);
    expect(getAffordableDraftTokens(afterSecondAbort))
      .toBeLessThan(viableRunawayRetryFloorTokens());
  });

  it('throws from the skip gate after two aborts, and the thrown error IS classified as a demand failure', async () => {
    driveClock();

    let thrown: unknown;
    try {
      await draftGraphWithAnthropic(
        { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 } as never,
        { timeoutMs: DRAFT_WINDOW_MS },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    // The gate names itself and its arithmetic in the message, so this pins that
    // the throw under test is the skip gate rather than some earlier failure.
    expect((thrown as Error).message).toContain('final attempt unaffordable');
    expect((thrown as Error).message).toContain('after 2 runaway abort(s)');

    // The skip gate, not some other failure: two generations were funded and
    // abandoned, and the third was never made.
    const meta = (thrown as { _llm_meta?: Record<string, unknown> })._llm_meta;
    expect(meta, 'the skip throw must carry the canonical failed-call meta').toBeTruthy();
    expect(meta!.finish_reason).toBe('skipped_unaffordable_final');
    expect(meta!.runaway_abort_count).toBe(2);
    expect(meta!.runaway_abort_triggers).toEqual(['string', 'string']);
    expect(h.callCount).toBe(2);

    // ⭐ THE ASSERTION THIS FILE EXISTS FOR. Pre-fix the classifier read
    // `err.truncated_at_max_tokens`, which this error does not and should not
    // carry — nothing was cut at max_tokens, the attempt was never made — so it
    // classified as a vague brief and the user got the cruel inversion.
    expect(
      (thrown as { truncated_at_max_tokens?: unknown }).truncated_at_max_tokens,
      'the skip path legitimately has no truncation flag — the classification must not need one',
    ).toBeUndefined();
    expect(isDemandNotBriefFailure(thrown)).toBe(true);
  });
});
