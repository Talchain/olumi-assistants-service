/**
 * ⭐⭐ PROOF THAT THE PER-STRING-VALUE GUARD ACTUALLY FIRES — end-to-end through
 * the real adapter, not just against the scanner in isolation (2026-07-25).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `draft-string-run-guard.test.ts`. That file
 * proves the SCANNER measures correctly. This one proves the MECHANISM EXECUTES:
 * that a runaway stream reaching `draftGraphWithAnthropic` is aborted, retried,
 * and that the abort is legible on the result meta. A scanner that is never
 * consulted is exactly the state the fast-abort detector sat in for weeks —
 * built, correct, and switched off, with `runaway_abort_count: 0` on all 30 live
 * observations to prove it. Correctness of the measurement is not evidence that
 * the measurement is taken.
 *
 * ⭐ THE DISCRIMINATING PROPERTY. The runaway stream below keeps TOTAL accumulated
 * characters BELOW `DRAFT_RUNAWAY_DETECT_CHARS` (8,000) and emits deltas
 * continuously (so neither the stall gate nor the hard ceiling can fire) — and it
 * contains an edge marker, which CANCELS the total-char gate outright. So the
 * abort CANNOT be attributed to any pre-existing gate. If the per-string-value
 * trigger were removed, this stream would run to completion unaborted; that is
 * the mutation this file is built to fail on.
 *
 * RED-FIRST: on `ea4229c1` this file fails at import (`DRAFT_RUNAWAY_MAX_STRING_CHARS`
 * does not exist).
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  DRAFT_RUNAWAY_MAX_STRING_CHARS,
  DRAFT_RUNAWAY_DETECT_CHARS,
  DRAFT_RUNAWAY_RETRY_TEMPERATURE,
} from '../draft-budget.js';

const h = vi.hoisted(() => ({
  callCount: 0,
  /** Attempt 1 emits a single oversized JSON string value when true. */
  runawayFirstAttempt: true,
  /** The request body of every attempt, in order — F3 reads the temperatures. */
  sentBodies: [] as Array<Record<string, unknown>>,
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.callCount += 1;
        h.sentBodies.push(body);
        return makeStream(h.callCount);
      },
    };
  }
  return { default: MockAnthropic };
});

const HEALTHY_GRAPH =
  '{"nodes":[{"id":"fac_a","kind":"factor","label":"Support headcount"},' +
  '{"id":"goal_g","kind":"goal","label":"Resolve support overwhelm"}],' +
  '"edges":[{"from":"fac_a","to":"goal_g","strength":{"mean":0.5,"std":0.1},' +
  '"exists_probability":0.9,"effect_direction":"positive"}],"goal_constraints":[]}';

/**
 * The runaway shape, replayed from the 2026-07-25 wire capture: one string value
 * that never terminates. Deliberately kept well under the 8,000-char TOTAL gate,
 * and preceded by an edge marker so the total gate is cancelled anyway.
 */
function runawayDeltas(): string[] {
  const deltas: string[] = [
    // An edge marker FIRST: `edgesReached` becomes true, every detector timer is
    // cleared, and the total-char gate stops applying. Only the per-value
    // ceiling can still see what follows — which is precisely the hole in the
    // pre-existing detector that this guard closes.
    '{"edges":[{"from":"fac_a","to":"goal_g"}],"goal_constraints":[{"label":"',
  ];
  // 40 x 64 = 2,560 chars inside ONE unterminated string: past the 1,900 ceiling,
  // and the whole stream stays under 3,000 total.
  for (let i = 0; i < 40; i++) deltas.push('​'.repeat(64));
  return deltas;
}

function makeStream(attempt: number) {
  const isRunaway = h.runawayFirstAttempt && attempt === 1;
  return {
    async *[Symbol.asyncIterator]() {
      if (isRunaway) {
        for (const d of runawayDeltas()) {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: d } };
        }
        return;
      }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: HEALTHY_GRAPH } };
    },
    async finalMessage() {
      return {
        content: [{ type: 'text', text: isRunaway ? runawayDeltas().join('') : HEALTHY_GRAPH }],
        usage: { input_tokens: 1_000, output_tokens: isRunaway ? 8_550 : 2_000 },
        stop_reason: isRunaway ? 'max_tokens' : 'end_turn',
      };
    },
  };
}

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stringrun';
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
  h.callCount = 0;
  h.runawayFirstAttempt = true;
  h.sentBodies = [];
  vi.restoreAllMocks();
});

describe('⭐ the per-string-value ceiling ABORTS a runaway and the abort is visible', () => {
  it('aborts the doomed attempt, retries, and reports trigger "string" on the result meta', async () => {
    h.runawayFirstAttempt = true;

    const result = await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 },
    );

    // THE MECHANISM EXECUTED: a second generation was started, which only
    // happens when the first was aborted.
    expect(h.callCount).toBe(2);

    const meta = result.meta as Record<string, unknown>;
    expect(meta.runaway_abort_count).toBe(1);
    // THE ABORT IS LEGIBLE. Without this the wire says only "an abort happened",
    // which cannot distinguish a per-value runaway from a cardinality one or a
    // slow-but-healthy draft.
    expect(meta.runaway_abort_triggers).toEqual(['string']);

    // …and the retry produced a real graph, so the abort bought something.
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.graph.edges.length).toBeGreaterThan(0);
  });

  it('⭐ NO OTHER GATE COULD HAVE FIRED — the abort is attributable to this trigger alone', () => {
    // Stated as arithmetic over the fixture, so the claim is checkable rather
    // than asserted. If a future edit lengthens the fixture past the total gate,
    // this fails and the test above stops being discriminating.
    const total = runawayDeltas().join('').length;
    expect(total).toBeLessThan(DRAFT_RUNAWAY_DETECT_CHARS);
    // The single string run does exceed the per-value ceiling…
    expect(total).toBeGreaterThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);
    // …and the stream carries an edge marker, so the total-char gate — which is
    // `!edgesReached`-gated — is cancelled before the oversized string even
    // starts. This fixture is the case the OLD detector was blind to.
    expect(runawayDeltas()[0]).toContain('"from"');
  });

  it('POSITIVE CONTROL — a HEALTHY draft is not aborted (the guard discriminates)', async () => {
    // Trap #13: proving the guard fires is worthless without proving it does not
    // fire on the healthy population. Same adapter, same path, real graph.
    h.runawayFirstAttempt = false;

    const result = await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 },
    );

    expect(h.callCount).toBe(1);
    const meta = result.meta as Record<string, unknown>;
    expect(meta.runaway_abort_count).toBe(0);
    expect(meta.runaway_abort_triggers).toEqual([]);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
  });
});

describe('⭐ F3 — the retry after a runaway abort CAN differ from the attempt that failed', () => {
  // MODEL BINDING (2026-08-08): these three tests pass an EXPLICIT
  // temperature-accepting model. The F3 escalation is routed through
  // anthropicTemperatureFor, which returns undefined for rejects-sampling
  // models — and the checked-in draft DEFAULT is now claude-sonnet-5, which
  // rejects sampling params, so under the default the escalation is a designed
  // no-op (anthropic.ts retry branch: no change → no rewrite). Without the
  // explicit model these tests would silently stop exercising the mechanism
  // they exist to pin (trap 3b's shape: a test bound to a surface the default
  // no longer serves). The default-model (rejects-sampling) semantics are
  // pinned by the dedicated test at the bottom of this block.
  it('sends the post-abort retry at a higher temperature than the attempt it is replacing', async () => {
    // THE DEFECT (F3, /code-review 2026-07-25): every attempt was sent at
    // temperature 0, so "abort the doomed generation and re-roll" re-sent a
    // byte-identical request to a near-deterministic decode. A LEGITIMATE long
    // string is deterministic input, so the retry reproduced it and aborted
    // again — burning every remaining abort and, if the window ran out, landing
    // on the F1 dead end. The docstring justifying the 25x ceiling explicitly
    // claimed "a false abort costs 25s and buys a properly-funded retry"; it
    // bought a duplicate.
    h.runawayFirstAttempt = true;

    await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17, model: 'claude-sonnet-4-6' },
    );

    expect(h.sentBodies).toHaveLength(2);
    const [first, retry] = h.sentBodies;

    // Attempt 1 is UNCHANGED — deterministic drafting for the healthy
    // population is not what this fix trades away.
    expect(first.temperature).toBe(0);

    // The retry is decorrelated from the generation that just failed.
    expect(retry.temperature).toBe(DRAFT_RUNAWAY_RETRY_TEMPERATURE);
    expect(retry.temperature).not.toBe(first.temperature);
  });

  it('POSITIVE CONTROL — an unaborted draft is still sent at temperature 0', async () => {
    // Without this, the assertion above would pass just as well if the adapter
    // simply raised the temperature of every draft.
    h.runawayFirstAttempt = false;

    await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17, model: 'claude-sonnet-4-6' },
    );

    expect(h.sentBodies).toHaveLength(1);
    expect(h.sentBodies[0].temperature).toBe(0);
  });

  it('the SUCCESS metadata reports the temperature that was actually sent, not a literal', async () => {
    // `_llm_meta.temperature` was a hard-coded `0` on the success path, which was
    // already wrong under extended thinking (the API forces 1) and became wrong
    // for every post-abort retry. A metadata field that cannot change is not
    // metadata.
    h.runawayFirstAttempt = true;

    const result = await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17, model: 'claude-sonnet-4-6' },
    );

    const meta = result.meta as Record<string, unknown>;
    expect(meta.temperature).toBe(DRAFT_RUNAWAY_RETRY_TEMPERATURE);
    expect(meta.temperature).toBe((h.sentBodies.at(-1) as Record<string, unknown>).temperature);
  });

  it('under the DEFAULT model (claude-sonnet-5, rejects sampling params) no attempt carries a temperature — and the abort/retry machinery still executes', async () => {
    // The checked-in draft default moved to claude-sonnet-5 (2026-08-08),
    // which has rejectsSamplingParams: anthropicTemperatureFor returns
    // undefined, attempt 1 is built with temperature undefined, and the F3
    // retry branch (retryTemperature !== attempt temperature → rewrite) is a
    // deliberate no-op because undefined === undefined. This pins the LIVE
    // default's semantics so the three explicit-model tests above cannot be
    // mistaken for coverage of the default path.
    h.runawayFirstAttempt = true;

    const result = await draftGraphWithAnthropic(
      { brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 },
    );

    // The abort mechanism is temperature-independent: still 2 attempts.
    expect(h.callCount).toBe(2);
    const meta = result.meta as Record<string, unknown>;
    expect(meta.runaway_abort_count).toBe(1);
    // No sampling params were sent on EITHER attempt…
    expect((h.sentBodies[0] as Record<string, unknown>).temperature).toBeUndefined();
    expect((h.sentBodies[1] as Record<string, unknown>).temperature).toBeUndefined();
    // …and the metadata honestly reports what was sent (nothing), not a literal.
    expect(meta.temperature).toBeUndefined();
  });
});
