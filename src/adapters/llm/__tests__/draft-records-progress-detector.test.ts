/**
 * ⭐⭐ THE RUNAWAY DETECTOR MUST SEE RECORDS PROGRESS, NOT ONLY EDGES.
 *
 * ── THE DEFECT, DERIVED AT THIS HEAD ───────────────────────────────────────
 * The draft path now asks the model for a RECORD SET (`{stated_items, claims}`)
 * and projects the graph deterministically. The runaway detector's two timer
 * gates and its total-char gate are all keyed on `edgesReached`
 * (`anthropic.ts`: the stall timer, the hard-ceiling timer, and the
 * `DRAFT_RUNAWAY_DETECT_CHARS` branch).
 *
 * ⚠ CORRECTION TO THE INHERITED DIAGNOSIS, MEASURED RATHER THAN INHERITED.
 * The claim carried into this lane was that `edgesReached` "can never become
 * true on the records path". That is FALSE at this head: `33a1dda3` widened the
 * probe to `/"from(_ref)?"\s*:/`, and `from_ref` is the records grammar's own
 * causal-link field. The prior lane read the variable NAME and the comments
 * (which all say "edges") and not the regex.
 *
 * WHAT IS ACTUALLY BROKEN IS NARROWER, AND STILL REAL — two holes:
 *
 *   1. THE LATCH IS LATE. `from_ref` is the causal_link field, so it cannot
 *      appear until the whole `stated_items` array and every preceding
 *      non-causal claim has been emitted. Measured on the two banked
 *      long-brief streams: the first `from_ref` lands at char 3,869 of 7,627
 *      (B1) and 3,790 of 6,845 (B3) — i.e. HALFWAY. Everything before that
 *      point is unprotected by the lift and exposed to the 25 s ceiling.
 *
 *   2. THE LATCH IS NOT GUARANTEED AT ALL. `claims` deliberately carries no
 *      `minItems` (grammar design note 2), and `from_ref` is optional and
 *      `causal_link`-only. A record set of `factor` and `prior` claims is
 *      STRICTLY CONFORMANT, honest, and useful — and contains no `from_ref`
 *      anywhere, so it can never lift the gates. Such a draft is aborted as a
 *      "runaway" at 25 s, or at 8,000 accumulated characters, for being
 *      healthy. B1's real stream is 7,627 chars: within 5 % of that gate.
 *
 * ── WHAT THIS FILE PINS ────────────────────────────────────────────────────
 * A DISCRIMINATING PAIR, not a single biting assertion (trap 19): the same
 * hang, the same clock, the same adapter — only the CONTENT of the stream
 * differs, and the outcomes must differ with it.
 *
 *   A. records stream that has DECODED CLAIMS  → the ceiling LIFTS, exactly as
 *      an edge lifts it for a graph. No abort.
 *   B. records stream with NO decoded claim    → the ceiling still FIRES. The
 *      detector's purpose survives; this is the control that keeps A honest.
 *   C. a stream carrying `from_ref`            → byte-identical to today: lifts,
 *      no abort, and `draft_edges_reached` still reports `time_to_edges_ms`.
 *
 * B is the case that would pass with the fix REVERTED, so A alone would not
 * prove binding; C is the case that would pass if the fix accidentally replaced
 * the edges path instead of joining it.
 *
 * RED-FIRST: at pristine `e0975d0f`, A fails — `runaway_abort_count` is 1
 * because no `from_ref` was emitted — while B and C already pass.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

import {
  DRAFT_RUNAWAY_HARD_CEILING_MS,
  DRAFT_RUNAWAY_DETECT_CHARS,
  DRAFT_RUNAWAY_MAX_STRING_CHARS,
} from '../draft-budget.js';

type Delta = { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } };

const h = vi.hoisted(() => ({
  callCount: 0,
  /** Deltas attempt 1 emits BEFORE it hangs. */
  prefixDeltas: [] as string[],
  /** Deltas attempt 1 emits after the test releases it. */
  suffixDeltas: [] as string[],
  /** Resolver for the mid-stream hang, set by the mock, called by the test. */
  release: null as null | (() => void),
  /** Set when attempt 1's iterator has reached the hang. */
  hung: false,
  /**
   * Number of 2 s keep-alive deltas attempt 1 emits BEFORE it hangs. Each one
   * refreshes `lastDeltaAt`, so the STALL gate (which needs 8 s of silence)
   * cannot fire and the HARD CEILING is the only gate left that can. Without
   * this, every timer case in this file dies on `stall` and the ceiling — the
   * gate the 2026-08-12 block actually observed firing — is never exercised.
   */
  keepAliveTicks: 0,
}));

/**
 * A healthy record set with NO causal_link — so it carries no `from_ref`. This
 * is the shape hole 2 above describes: strictly conformant, honest, and
 * invisible to the edges probe.
 */
const RECORDS_NO_CAUSAL_LINK = {
  stated_items: [
    { kind: 'goal', source_quote: 'Resolve support overwhelm' },
    { kind: 'option', source_quote: 'hire more support staff' },
    { kind: 'option', source_quote: 'buy a triage tool' },
  ],
  claims: [
    { claim_kind: 'factor', label: 'Support headcount', basis: [0] },
    { claim_kind: 'prior', label: 'ticket volume is rising', basis: [0] },
  ],
};

/** The same set, with the causal spine that makes it project to a legal graph. */
const RECORDS_HEALTHY = JSON.stringify({
  stated_items: [{ kind: 'goal', source_quote: 'Resolve support overwhelm' }],
  claims: [
    { claim_kind: 'factor', label: 'Support headcount', basis: [0] },
    {
      claim_kind: 'causal_link',
      label: 'more headcount resolves the overwhelm',
      basis: [0],
      from_ref: 'c0',
      to_ref: 's0',
      effect: 'positive',
    },
  ],
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      // ⚠ THE SIGNAL IS HONOURED. A mock that ignores `opts.signal` cannot
      // observe a TIMER gate at all: `anthropic.ts` only returns `kind:
      // "runaway"` for a timer abort when the stream itself throws (the F5 race
      // branch deliberately PREFERS a cleanly-finished stream over discarding
      // it). A signal-deaf mock therefore reports "no abort" for every case and
      // agrees with itself — which is exactly how this file's first draft
      // scored a RED-first test as already passing.
      stream: (_body: unknown, opts?: { signal?: AbortSignal }) => {
        h.callCount += 1;
        const attempt = h.callCount;
        const signal = opts?.signal;
        let aborted = false;
        const abortErr = () => Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
        return {
          async *[Symbol.asyncIterator](): AsyncGenerator<Delta> {
            if (attempt > 1) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: RECORDS_HEALTHY } };
              return;
            }
            for (const d of h.prefixDeltas) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: d } };
            }
            for (let i = 0; i < h.keepAliveTicks; i++) {
              await new Promise<void>((r) => setTimeout(r, 2_000));
              if (signal?.aborted) { aborted = true; throw abortErr(); }
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' ' } };
            }
            // HANG — the stream is still open when the test advances the clock,
            // which is the only way a timer gate can be observed at all.
            await new Promise<void>((resolve, reject) => {
              h.hung = true;
              h.release = resolve;
              if (signal?.aborted) { aborted = true; reject(abortErr()); return; }
              signal?.addEventListener('abort', () => { aborted = true; reject(abortErr()); }, { once: true });
            });
            for (const d of h.suffixDeltas) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: d } };
            }
          },
          async finalMessage() {
            if (aborted) throw abortErr();
            const text = attempt > 1
              ? RECORDS_HEALTHY
              : h.prefixDeltas.join('') + h.suffixDeltas.join('');
            return {
              content: [{ type: 'text', text }],
              usage: { input_tokens: 1_000, output_tokens: 2_000 },
              stop_reason: 'end_turn',
            };
          },
        };
      },
    };
  }
  return { default: MockAnthropic };
});

let draftGraphWithAnthropic: typeof import('../anthropic.js').draftGraphWithAnthropic;
let priorKey: string | undefined;

beforeAll(async () => {
  priorKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-recordsprogress';
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
  h.prefixDeltas = [];
  h.suffixDeltas = [];
  h.release = null;
  h.hung = false;
  h.keepAliveTicks = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/**
 * Run one draft whose first attempt hangs mid-stream, advancing the fake clock
 * PAST the hard ceiling while it hangs. Returns the adapter's own meta.
 *
 * NON-EMPTY INPUT ASSERTED: a prefix that emitted nothing would make every
 * outcome here vacuous, so it is a hard error rather than a silent pass.
 */
async function runWithHang(prefix: string[], suffix: string[]): Promise<Record<string, unknown>> {
  if (prefix.join('').length === 0) throw new Error('HARD ERROR: empty prefix — the probe would prove nothing');
  h.prefixDeltas = prefix;
  h.suffixDeltas = suffix;
  vi.useFakeTimers();
  const pending = draftGraphWithAnthropic({ brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 });
  // Walk the fake clock forward in 1 s steps until the stream reaches its hang,
  // so any keep-alive ticks in front of it actually fire, then push past the
  // hard ceiling. Stepping (rather than one jump) is what lets a keep-alive
  // stream refresh `lastDeltaAt` the way a real slow stream does.
  const stepMs = 1_000;
  const totalMs = DRAFT_RUNAWAY_HARD_CEILING_MS + 30_000;
  for (let elapsed = 0; elapsed < totalMs && !h.hung; elapsed += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  // NON-VACUITY: either the stream reached its hang (so the clock probe below
  // measures a real open stream), or the detector already aborted it and a
  // retry was started. Neither ⇒ nothing was measured and the result is void.
  if (!h.hung && h.callCount < 2) {
    throw new Error('HARD ERROR: the stream neither hung nor was aborted — this probe measured nothing');
  }
  if (h.hung) await vi.advanceTimersByTimeAsync(DRAFT_RUNAWAY_HARD_CEILING_MS + 5_000);
  h.release?.();
  const result = await pending;
  return result.meta as Record<string, unknown>;
}

describe('⭐⭐ the runaway detector must lift on RECORDS progress, not only on edges', () => {
  it('A — a records stream WITH decoded claims survives the hard ceiling (the lift works)', async () => {
    const json = JSON.stringify(RECORDS_NO_CAUSAL_LINK);
    // Split so the claims — and therefore at least one `claim_kind` — are fully
    // decoded BEFORE the hang. This is the whole point: real structural progress
    // has been made, and no `from_ref` exists anywhere in the payload.
    const cut = json.lastIndexOf('}]}');
    expect(cut).toBeGreaterThan(0);
    const prefix = [json.slice(0, cut)];
    expect(prefix[0]).toContain('"claim_kind"');
    // THE DISCRIMINATING PROPERTY, stated as arithmetic so it stays checkable:
    // no edge marker anywhere, and comfortably under the total-char gate — so an
    // abort here could ONLY be the timer gates, and a survival here could ONLY be
    // a records-aware lift.
    expect(json).not.toMatch(/"from(_ref)?"\s*:/);
    expect(json.length).toBeLessThan(DRAFT_RUNAWAY_DETECT_CHARS);

    const meta = await runWithHang(prefix, [json.slice(cut)]);

    expect(meta.runaway_abort_count).toBe(0);
    expect(meta.runaway_abort_triggers).toEqual([]);
    expect(h.callCount).toBe(1);
  });

  it('B — CONTROL: a records stream with NO decoded claim is still aborted (the detector survives)', async () => {
    // Only the opening of `stated_items`: real bytes, real forward progress at
    // the delta level, but nothing structural decoded. A stream that hangs here
    // is exactly what the ceiling exists for, and it MUST still die.
    const partial = '{"stated_items":[{"kind":"goal","source_quote":"Resolve support overwhelm"}';
    expect(partial).not.toContain('"claim_kind"');
    expect(partial).not.toMatch(/"from(_ref)?"\s*:/);

    const meta = await runWithHang([partial], [']}']);

    expect(meta.runaway_abort_count).toBe(1);
    // `stall`, not `time`: a stream that goes SILENT trips the stall gate at
    // DETECT_MS + STALL_MS, which is earlier than the hard ceiling. Asserted by
    // name rather than by count so a future edit that changes WHICH gate fires
    // cannot pass this test unnoticed. Case D below drives the ceiling itself.
    expect(meta.runaway_abort_triggers).toEqual(['stall']);
    // …and the abort bought a retry that produced a real graph.
    expect(h.callCount).toBe(2);
  });

  it('C — CONTROL: the edges path is untouched — a `from_ref` stream still lifts', async () => {
    const cut = RECORDS_HEALTHY.indexOf('"to_ref"');
    expect(cut).toBeGreaterThan(0);
    const prefix = [RECORDS_HEALTHY.slice(0, cut)];
    expect(prefix[0]).toMatch(/"from_ref"\s*:/);

    const meta = await runWithHang(prefix, [RECORDS_HEALTHY.slice(cut)]);

    expect(meta.runaway_abort_count).toBe(0);
    expect(meta.runaway_abort_triggers).toEqual([]);
    expect(h.callCount).toBe(1);
  });

  it('E — a records stream with claims survives the TOTAL-CHAR gate too', async () => {
    // The third gate, and the one closest to biting in production: the banked
    // B1 stream is 7,627 chars against a DRAFT_RUNAWAY_DETECT_CHARS of 8,000 —
    // within 5 %. A record set that carries claims but no `from_ref` and runs
    // slightly longer is healthy and must not be scored a cardinality runaway.
    //
    // ⚠ VOLUME IS MADE OF MANY SHORT CLAIMS, NOT ONE LONG STRING. A single
    // padded label would trip the PER-STRING ceiling instead — a different
    // guard, deliberately ungated on progress — and this case would then be
    // measuring that guard while claiming to measure the char gate. (It did,
    // on the first attempt: abort trigger `string`, not `chars`.)
    const many = Array.from({ length: 80 }, (_, i) => ({
      claim_kind: 'factor' as const,
      label: `factor number ${i} with a label of ordinary human length, about a hundred characters wide`,
      basis: [0],
    }));
    const padded = JSON.stringify({
      stated_items: RECORDS_NO_CAUSAL_LINK.stated_items,
      claims: [...RECORDS_NO_CAUSAL_LINK.claims, ...many],
    });
    expect(padded.length).toBeGreaterThan(DRAFT_RUNAWAY_DETECT_CHARS);
    expect(padded).not.toMatch(/"from(_ref)?"\s*:/);
    expect(Math.max(...many.map((c) => c.label.length))).toBeLessThan(DRAFT_RUNAWAY_MAX_STRING_CHARS);

    const chunks: string[] = [];
    for (let i = 0; i < padded.length; i += 400) chunks.push(padded.slice(i, i + 400));
    expect(chunks.length).toBeGreaterThan(1);

    h.prefixDeltas = chunks;
    h.suffixDeltas = [];
    vi.useFakeTimers();
    const pending = draftGraphWithAnthropic({ brief: 'SaaS customer support is getting overwhelmed.', docs: [], seed: 17 });
    await vi.advanceTimersByTimeAsync(1_000);
    // Non-vacuity: the stream must have reached its hang, i.e. all the volume
    // was actually delivered.
    expect(h.hung).toBe(true);
    h.release?.();
    const result = await pending;
    const meta = result.meta as Record<string, unknown>;

    expect(meta.runaway_abort_count).toBe(0);
    expect(h.callCount).toBe(1);
  });

  it('D — CONTROL: an ACTIVELY-EMITTING stream with no claim still dies on the CEILING', async () => {
    // The gate the 2026-08-12 measured block actually observed firing
    // (`trigger: "time"`, `elapsed_ms: 25002`). Keep-alive deltas every 2 s keep
    // `lastDeltaAt` fresh so the stall gate cannot fire; nothing structural is
    // ever decoded, so the ceiling must still bound the attempt. If the records
    // lift were written as "any delta counts as progress" instead of "a CLAIM
    // was decoded", this case would survive and the detector would be off.
    h.keepAliveTicks = 20;
    const partial = '{"stated_items":[{"kind":"goal","source_quote":"Resolve support overwhelm"}';
    expect(partial).not.toContain('"claim_kind"');

    const meta = await runWithHang([partial], [']}']);

    expect(meta.runaway_abort_count).toBe(1);
    expect(meta.runaway_abort_triggers).toEqual(['time']);
    expect(h.callCount).toBe(2);
  });
});
