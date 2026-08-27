/**
 * ⭐⭐ THE WRITER DIVIDES BY THE FRAME; THE INVERTER MULTIPLIED BY 100.
 *
 * `normaliseFactorValue` (the capless WRITE path, `d1-shared/normalise-factor-
 * value.ts:173`) resolves the factor's frame through the shared owner
 * `resolveScaleFrame` and writes `{value: raw/frame, raw_value: raw}` — with NO
 * percent special case. A percent factor on a frame of 200 is written
 * `{0.575, 115}`, and that is correct.
 *
 * `resolveExistingRawValue` (the INVERSE, `d1-shared/evaluate-factor-value-
 * proposal.ts`) took no frame at all. For `unit === '%'` it hard-coded the
 * divisor at 100. So the inverse of a frame-aware write was computed on the
 * wrong scale, and the two halves of one round-trip disagreed by `frame/100`.
 *
 * ── WHY PERCENT FACTORS ARE EVER FRAMED ABOVE 100 ──────────────────────────
 * `deriveFactorScaleFrame` pins 100 only when `isPercentScaledUnit(unit) &&
 * max <= 100`. ABOVE 100 it falls through to the {1,2,5}·10^k ladder, so an NRR
 * of [95,115] frames at 200 and an ROI of [50,300] frames at 500 — the founder's
 * named class ("NRR, growth and ROI may be >100%").
 *
 * ── WHAT THIS FIX DOES NOT DO ───────────────────────────────────────────────
 * It does NOT remove the `unit !== '%'` gate on `reconcileObservedValuePair`'s
 * frame branch, and it does NOT unify the narrow `'%'` predicate toward the
 * broad `isPercentScaledUnit` one. Both were measured at this tip: the broad
 * spellings route sub-1 percent inputs into the frame branch's ambiguity throw,
 * so `unit: 'percent'` on a frame of 100 stating `0.4` — the single commonest
 * percent edit there is — THROWS `AmbiguousScaleValueError` today. Unifying
 * toward the broad predicate would convert that correct case into a throw. The
 * gate's stated reason ("a sub-1 percent input is NOT the ambiguous class") is
 * still valid; the defect was never the gate, it was the divisor behind it.
 *
 * It also does NOT widen the out-of-`[0,1]` verdict. A stated `115` on a framed
 * percent factor is genuinely ambiguous (a level of 115 frames, or a raw 115%?)
 * and stays `ambiguous`, fail-closed, exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { reconcileObservedValuePair } from '../../../../orchestrator/canonicalise-value-ops.js';
import { resolveExistingRawValue } from '../d1-shared/evaluate-factor-value-proposal.js';
import { resolveRunAdmission } from '../analysis-ready-core.js';

describe('resolveExistingRawValue honours a supplied scale frame for percent factors', () => {
  it('inverts a percent level on a frame of 200 as value*200, not value*100', () => {
    expect(resolveExistingRawValue({ value: 0.9, unit: '%', scaleFrame: 200 })).toEqual({
      kind: 'resolved',
      raw: 180,
    });
  });

  it('inverts a percent level on a frame of 500 as value*500', () => {
    expect(resolveExistingRawValue({ value: 0.5, unit: '%', scaleFrame: 500 })).toEqual({
      kind: 'resolved',
      raw: 250,
    });
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — a frame of 100 is byte-identical to the hard-coded divisor', () => {
    // The whole existing percent convention IS frame 100. Passing it explicitly
    // must change nothing, or the fix has moved a correct case.
    expect(resolveExistingRawValue({ value: 0.9, unit: '%', scaleFrame: 100 })).toEqual(
      resolveExistingRawValue({ value: 0.9, unit: '%' }),
    );
    expect(resolveExistingRawValue({ value: 0.04, unit: '%', scaleFrame: 100 })).toEqual({
      kind: 'resolved',
      raw: 4,
    });
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — omitting the frame preserves today behaviour exactly', () => {
    // Every pre-existing caller passes no frame. All of them must be untouched.
    expect(resolveExistingRawValue({ value: 0.9, unit: '%' })).toEqual({ kind: 'resolved', raw: 90 });
    expect(resolveExistingRawValue({ value: 115, unit: '%' })).toEqual({ kind: 'ambiguous' });
    expect(resolveExistingRawValue({ value: 0.05, unit: '%', cap: 100 })).toEqual({
      kind: 'resolved',
      raw: 5,
    });
  });

  it('a frame does NOT widen the out-of-[0,1] verdict — still ambiguous, still fail-closed', () => {
    // 115 on a framed percent factor is genuinely ambiguous (115 frames, or
    // 115%?). The frame supplies a divisor, never a licence to guess.
    expect(resolveExistingRawValue({ value: 115, unit: '%', scaleFrame: 200 })).toEqual({
      kind: 'ambiguous',
    });
  });

  it('a cap still wins over a frame (a capped factor is not a framed factor)', () => {
    expect(resolveExistingRawValue({ value: 0.05, unit: '%', cap: 100, scaleFrame: 200 })).toEqual({
      kind: 'resolved',
      raw: 5,
    });
  });

  it('an out-of-domain frame is refused, not applied (same domain the frame owner proves)', () => {
    // `resolveScaleFrame`/`recoverScaleFrame` accept only finite frames > 1. A
    // value outside that domain must fall back to today's divisor, never be
    // multiplied in.
    expect(resolveExistingRawValue({ value: 0.9, unit: '%', scaleFrame: 1 })).toEqual({
      kind: 'resolved',
      raw: 90,
    });
    expect(resolveExistingRawValue({ value: 0.9, unit: '%', scaleFrame: Number.NaN })).toEqual({
      kind: 'resolved',
      raw: 90,
    });
  });

  it('⭐ non-percent factors never read the frame (the gate is the percent unit)', () => {
    // Binding check: a £ factor with a frame supplied resolves on its cap, not
    // on the frame. Proves the new parameter cannot leak into the non-% branch.
    expect(resolveExistingRawValue({ value: 0.4, cap: 100000, unit: '£', scaleFrame: 200 })).toEqual({
      kind: 'resolved',
      raw: 40000,
    });
  });
});

/**
 * The seam. `reconcileObservedValuePair` is the one caller that HAS the frame —
 * the node's persisted `scale_frame` plus its before-pair — and it was throwing
 * that knowledge away at the `resolveExistingRawValue` call.
 *
 * REACHABILITY, stated precisely: this path needs the payload to CARRY
 * `raw_value` (the stale-carry-forward signature `canonicaliseUpdateNodeValue`
 * produces by merging the node's observed_state under the write). WITHOUT it,
 * `storedFrameAdmits` declines a percent factor on a non-100 frame by reference
 * and the analysis seam refuses honestly — that refusal is deliberate, is NOT
 * changed here, and is pinned by `stored-scale-frame-edit.test.ts`.
 *
 * ⚠⚠ BUT "DELIBERATE" NOW MEANS SOMETHING NARROWER THAN IT DID, AND SAYING SO
 * HERE IS THE POINT. The refusal's ORIGINAL recorded reason was that the
 * unlocked path "hard-codes `value * 100`" and would therefore ignore the frame
 * that unlocked it. THIS PR REMOVED THAT HARD-CODE, so for a node whose own
 * `observed_state.unit` is `'%'` the path below now honours the frame and would
 * answer correctly. The guard's own gate reads the PAYLOAD's unit, so the two
 * disagree on a unit-less node — and only there does the old reason still hold.
 *
 * The behaviour is unchanged and the pin still passes; what changed is that the
 * JUSTIFICATION is now confined to a narrower class than the text it inherits
 * implies. Recorded so the comment and the pin cannot drift apart again — a
 * refusal kept for a reason that has expired is how an honest label becomes a
 * false one (trap 14), and the falsification here was self-inflicted by this
 * very PR rather than introduced by someone else.
 */
describe('reconcileObservedValuePair resolves the percent divisor from the factor frame', () => {
  const nrrGraph = (frame: number, unit: string, pair: Record<string, unknown>) => ({
    nodes: [
      {
        id: 'nrr',
        kind: 'factor',
        label: 'Net Revenue Retention',
        observed_state: { unit, ...pair },
        scale_frame: frame,
      },
    ],
    edges: [],
  });

  const carryForwardOp = (unit: string, observed: Record<string, unknown>) => ({
    op: 'update_node' as const,
    path: 'nrr',
    value: { observed_state: { unit, ...observed } },
  });

  /** Bind by node identity, never by a value predicate another node could satisfy. */
  const observedFor = (out: unknown) => {
    const op = out as { path?: string; value?: { observed_state?: Record<string, unknown> } };
    expect(op.path).toBe('nrr');
    return op.value?.observed_state ?? {};
  };

  it('NRR on a frame of 200: a level of 0.9 writes raw_value 180, not 90', () => {
    const graph = nrrGraph(200, '%', { value: 0.575, raw_value: 115 });
    const ops = [carryForwardOp('%', { value: 0.9, raw_value: 115 }) as never];
    const out = reconcileObservedValuePair(ops, graph as never)[0];
    expect(out).not.toBe(ops[0]);
    const observed = observedFor(out);
    expect(observed.value).toBe(0.9);
    expect(observed.raw_value).toBe(180);
  });

  it('ROI on a frame of 500: a level of 0.5 writes raw_value 250, not 50', () => {
    const graph = nrrGraph(500, '%', { value: 0.1, raw_value: 50 });
    const ops = [carryForwardOp('%', { value: 0.5, raw_value: 50 }) as never];
    const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
    expect(observed.raw_value).toBe(250);
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — an ordinary percent factor on frame 100 is unchanged', () => {
    // 3–5% churn frames at exactly 100. This is the case that was ALWAYS
    // correct, and the fix must leave it byte-identical.
    const graph = nrrGraph(100, '%', { value: 0.03, raw_value: 3 });
    const ops = [carryForwardOp('%', { value: 0.9, raw_value: 3 }) as never];
    const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
    expect(observed.value).toBe(0.9);
    expect(observed.raw_value).toBe(90);
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — a percent factor with no stored frame is unchanged', () => {
    const graph = {
      nodes: [
        {
          id: 'nrr',
          kind: 'factor',
          label: 'Net Revenue Retention',
          observed_state: { unit: '%', value: 0.03, raw_value: 3 },
        },
      ],
      edges: [],
    };
    const ops = [carryForwardOp('%', { value: 0.9, raw_value: 3 }) as never];
    const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
    expect(observed.raw_value).toBe(90);
  });

  it('⭐ an INCOHERENT stored frame is refused, and the divisor degrades to 100', () => {
    // #1127's coherence check owns this: a stored frame the pair contradicts is
    // wrong under every reading, so `resolveScaleFrame` returns undefined and
    // this path must fall back rather than apply a frame nothing supports.
    // Pair {0.9, 90} implies 100; the stored 200 contradicts it.
    const graph = nrrGraph(200, '%', { value: 0.9, raw_value: 90 });
    const ops = [carryForwardOp('%', { value: 0.4, raw_value: 90 }) as never];
    const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
    expect(observed.raw_value).toBe(40);
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — the >100 stated case stays REFUSED by reference', () => {
    // Pinned by stored-scale-frame-edit.test.ts and deliberately untouched: a
    // percent factor on a non-100 frame with no carried raw_value is declined,
    // and the analysis seam refuses honestly. Restated here so a future widening
    // of this fix REDs against its own suite.
    const graph = nrrGraph(200, '%', { value: 0.475 });
    const ops = [
      { op: 'update_node' as const, path: 'nrr', value: { observed_state: { unit: '%', value: 115 } } } as never,
    ];
    expect(reconcileObservedValuePair(ops, graph as never)[0]).toBe(ops[0]);
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — a £ factor on a ladder frame is untouched by this change', () => {
    const graph = nrrGraph(500_000, '£', { value: 1, raw_value: 500_000 });
    const ops = [carryForwardOp('£', { value: 600_000, raw_value: 500_000 }) as never];
    const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
    expect(observed.value).toBe(600_000 / 500_000);
    expect(observed.raw_value).toBe(600_000);
  });

  /**
   * ⚠⚠ THE UNIT GATE READS THE PAYLOAD; THE FRAME READS THE NODE.
   *
   * On an edit that changes `unit`, those are DIFFERENT OBJECTS. The first
   * version of this fix offered the node's frame whenever the PAYLOAD's unit
   * was a percentage, so a magnitude-framed factor re-labelled as a percentage
   * took its magnitude frame as a percent divisor. `unit` is an editable
   * observed subkey and the canonicaliser produces the carry-forward shape
   * itself, so the state is reachable by the same route the fix relies on.
   *
   * The frame is now offered only when the NODE's own unit is `'%'` — the same
   * question, asked of both objects, in the same spelling the consumer gates on.
   */
  describe('the frame is a property of the NODE, not of the payload', () => {
    it('a magnitude-framed factor re-labelled as a percentage does NOT take its magnitude frame', () => {
      const graph = nrrGraph(500_000, '£', { value: 1, raw_value: 500_000 });
      const ops = [carryForwardOp('%', { value: 0.9, raw_value: 500_000 }) as never];
      const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
      // The percentage convention, i.e. base behaviour — never 0.9 × 500,000.
      expect(observed.raw_value).toBe(90);
    });

    it('a count-framed factor re-labelled as a percentage does NOT take its count frame', () => {
      const graph = nrrGraph(100_000, 'users', { value: 1, raw_value: 100_000 });
      const ops = [carryForwardOp('%', { value: 0.9, raw_value: 100_000 }) as never];
      const observed = observedFor(reconcileObservedValuePair(ops, graph as never)[0]);
      expect(observed.raw_value).toBe(90);
    });

    it('⭐ OPPOSITE-DIRECTION TWIN — the target class still resolves on its frame', () => {
      // The node IS a percentage here, so the frame is its own and applies.
      const graph = nrrGraph(200, '%', { value: 0.575, raw_value: 115 });
      const ops = [carryForwardOp('%', { value: 0.9, raw_value: 115 }) as never];
      expect(observedFor(reconcileObservedValuePair(ops, graph as never)[0]).raw_value).toBe(180);
    });

    it('⭐ OPPOSITE-DIRECTION TWIN — an ordinary percent node is still 100', () => {
      const graph = nrrGraph(100, '%', { value: 0.03, raw_value: 3 });
      const ops = [carryForwardOp('%', { value: 0.9, raw_value: 3 }) as never];
      expect(observedFor(reconcileObservedValuePair(ops, graph as never)[0]).raw_value).toBe(90);
    });
  });

  /**
   * ⭐⭐ A RECOVERED FRAME IS A QUOTIENT, AND 10 OF THE 100 INTEGER PERCENTS DO
   * NOT RECOVER EXACTLY 100.
   *
   * `raw_value / value` for `{0.07, 7}` is 99.99999999999999, so the divisor is
   * a few ulps low and `raw_value` lands on 89.99999999999999 instead of 90.
   * The relative error is ~1.4e-16 — seven orders INSIDE the coherence epsilon,
   * so #1127 reads the pair as coherent and the value is silently wrong.
   *
   * ⚠ This suite's own earlier twin used `{0.03, 3}`, which is one of the 90%
   * that happens to be exact — a corpus sharing the code's blind spot. The
   * inexact members are enumerated here rather than sampled.
   */
  describe('a pair-recovered percent frame snaps to the convention', () => {
    /**
     * Enumerated, not sampled: every integer percent whose quotient is not
     * exactly 100. ⚠ Note 57 and 69 recover 100.00000000000001 — ABOVE the
     * convention, not below. The drift is SIGN-SYMMETRIC, so a snap written
     * only for the low side would silently miss two of the ten; the guard uses
     * an absolute relative difference for exactly that reason.
     */
    const INEXACT_PERCENTS = [7, 14, 17, 28, 34, 55, 56, 57, 68, 69];

    it('the inexact set is exactly these ten — the enumeration is pinned, not assumed', () => {
      const found: number[] = [];
      for (let p = 1; p <= 100; p += 1) {
        if (p / (p / 100) !== 100) found.push(p);
      }
      expect(found).toEqual(INEXACT_PERCENTS);
    });

    it('the drift runs in BOTH directions — not a one-sided rounding', () => {
      expect(57 / (57 / 100)).toBeGreaterThan(100);
      expect(7 / (7 / 100)).toBeLessThan(100);
    });

    it.each(INEXACT_PERCENTS)(
      'a pair recovered from %i percent still writes an exact raw_value',
      (percent) => {
        const graph = {
          nodes: [
            {
              id: 'nrr',
              kind: 'factor',
              label: 'Net Revenue Retention',
              observed_state: { unit: '%', value: percent / 100, raw_value: percent },
            },
          ],
          edges: [],
        };
        const ops = [carryForwardOp('%', { value: 0.9, raw_value: percent }) as never];
        expect(observedFor(reconcileObservedValuePair(ops, graph as never)[0]).raw_value).toBe(90);
      },
    );

    it('⭐ OPPOSITE-DIRECTION TWIN — a genuine ladder frame is far outside the window and survives', () => {
      // 200 is 1e14 epsilons away from 100; the snap must not reach it.
      const graph = nrrGraph(200, '%', { value: 0.575, raw_value: 115 });
      const ops = [carryForwardOp('%', { value: 0.9, raw_value: 115 }) as never];
      expect(observedFor(reconcileObservedValuePair(ops, graph as never)[0]).raw_value).toBe(180);
    });
  });
});

/**
 * ⛔⛔ THE RECOVERED PERCENT FRAME WAS BOUNDED ONLY FROM BELOW.
 *
 * Every guard in the frame chain is a LOWER bound plus a finiteness check —
 * `recoverScaleFrame` (`scale-frame.ts:50`) `frame <= 1`, the stored-frame
 * domain check (`:209`) `stored > 1`, and the divisor admission
 * (`evaluate-factor-value-proposal.ts:305-306`) `scaleFrame > 1`. NOTHING
 * bounds the top, and `snapToPercentConvention` is a 1e-9 tightening toward
 * 100, not a bound — anything outside that window passes through untouched.
 *
 * ── MEASURED THROUGH THE REAL `reconcileObservedValuePair`, NOT A MODEL ────
 * (a reimplementation of the pure functions agreed, but the shipped chain is
 * what decides, and these are the shipped chain's own numbers):
 *
 *   stored frame 1e9,           level 0.9  ->  raw_value 900000000
 *   stored frame 1e300,         level 0.9  ->  raw_value 9e+299
 *   stored frame 1.0000000001,  level 0.9  ->  raw_value 0.90000000009
 *   recovered {1e-7, 100},      level 0.9  ->  raw_value 900000000
 *
 * ⭐ TWO HARMS, OPPOSITE DIRECTIONS, AND ONE LOWER BOUND SERVES NEITHER: a huge
 * frame OVER-states `raw_value`, a frame just above 1 UNDER-states it by 100x.
 * #1127's coherence check cannot see either, because `raw = value x frame` is
 * coherent with that frame BY CONSTRUCTION.
 *
 * ⚠ `0`, negative, `NaN` and `Infinity` are ALREADY safe — the existing lower
 * bound catches them and the op is returned unchanged. Pinned below as the
 * contrast control, so this block cannot pass by breaking everything.
 *
 * ── THE BAND IS DERIVED FROM THE PRODUCER, NOT INVENTED ───────────────────
 * `deriveFactorScaleFrame` (`draft/records/projector.ts:1173-1189`) is the only
 * producer of a factor frame. For a percent-scaled unit it emits exactly 100
 * when `max <= 100`, and otherwise the {1,2,5}x10^k ladder — so NRR 115% frames
 * at 200 and ROI 300% at 500. It can never emit a percent frame BELOW 100, and
 * the basis-points sibling on the very next line pins 10,000 as the estate's
 * already-sanctioned top of the percentage family.
 *
 * REFUSE, NEVER REPAIR — the doctrine `scale-frame.ts:166-168` states for the
 * bottom of the range, verbatim: *"A `<= 1` frame is not a near-miss to be
 * rounded — it is a value no producer emits, so it is refused rather than
 * repaired."* This is that sentence's missing symmetric half. A refused frame
 * degrades the divisor to 100, which is the fail-safe this module already
 * documents for an incoherent stored frame.
 */
describe('the percent divisor frame is bounded at BOTH ends', () => {
  const graph = (frame: number | undefined, pair: Record<string, unknown>) => ({
    nodes: [
      {
        id: 'nrr',
        kind: 'factor',
        label: 'Net Revenue Retention',
        observed_state: { unit: '%', ...pair },
        ...(frame !== undefined ? { scale_frame: frame } : {}),
      },
    ],
    edges: [],
  });
  const op = (observed: Record<string, unknown>) => ({
    op: 'update_node' as const,
    path: 'nrr',
    value: { observed_state: { unit: '%', ...observed } },
  });
  const rawFor = (out: unknown) => {
    const o = out as { path?: string; value?: { observed_state?: Record<string, unknown> } };
    expect(o.path).toBe('nrr');
    return o.value?.observed_state?.raw_value;
  };

  it('⛔ a frame far ABOVE the ladder is refused — no 900000000 raw_value', () => {
    const out = reconcileObservedValuePair(
      [op({ value: 0.9, raw_value: 1 }) as never],
      graph(1e9, { value: 1e-9, raw_value: 1 }) as never,
    )[0];
    expect(rawFor(out)).toBe(90);
    expect(rawFor(out)).not.toBe(900000000);
  });

  it('⛔ a frame just ABOVE 1 is refused — no 100x UNDER-statement', () => {
    const out = reconcileObservedValuePair(
      [op({ value: 0.9, raw_value: 1 }) as never],
      graph(1.0000000001, { value: 1, raw_value: 1.0000000001 }) as never,
    )[0];
    expect(rawFor(out)).toBe(90);
    expect(rawFor(out)).not.toBe(0.90000000009);
  });

  it('⛔ a RECOVERED frame (no stored field) is bounded too — the route that needs no stored value', () => {
    const out = reconcileObservedValuePair(
      [op({ value: 0.9, raw_value: 100 }) as never],
      graph(undefined, { value: 1e-7, raw_value: 100 }) as never,
    )[0];
    expect(rawFor(out)).toBe(90);
    expect(rawFor(out)).not.toBe(900000000);
  });

  it('⭐ OPPOSITE-DIRECTION TWINS — every frame the producer CAN emit still works', () => {
    // Without these the bound could pass by refusing everything.
    expect(
      rawFor(
        reconcileObservedValuePair(
          [op({ value: 0.9, raw_value: 115 }) as never],
          graph(200, { value: 0.575, raw_value: 115 }) as never,
        )[0],
      ),
    ).toBe(180);
    expect(
      rawFor(
        reconcileObservedValuePair(
          [op({ value: 0.5, raw_value: 50 }) as never],
          graph(500, { value: 0.1, raw_value: 50 }) as never,
        )[0],
      ),
    ).toBe(250);
    expect(
      rawFor(
        reconcileObservedValuePair(
          [op({ value: 0.9, raw_value: 3 }) as never],
          graph(100, { value: 0.03, raw_value: 3 }) as never,
        )[0],
      ),
    ).toBe(90);
  });

  it('CONTRAST CONTROL: 0 / negative frames were ALREADY safe and stay untouched', () => {
    // These never reached the divisor — the pre-existing lower bound refuses
    // them and the op is returned by reference. If this block had "fixed" them
    // too, it would be evidence the probe was not discriminating.
    for (const bad of [0, -200]) {
      const ops = [op({ value: 0.9, raw_value: 90 }) as never];
      const out = reconcileObservedValuePair(ops, graph(bad, { value: 0.9, raw_value: 90 }) as never)[0];
      expect(out).toBe(ops[0]);
    }
  });
});

/**
 * ⭐⭐ COMPOSITION WITH #1143's `IDENTICAL_OPTIONS` FLOOR — MEASURED, NOT ARGUED.
 *
 * #1143 (staging `3c3d3d53`) applies PLoT's `IDENTICAL_OPTIONS` floor on the
 * strictly-ready path. This PR canonicalises values on the EDIT path. Different
 * files — but `edit-graph.ts:3759` builds `analysis_ready` from the POST-EDIT
 * graph, so both genuinely bear on ONE payload in ONE turn, and "different
 * files" is not on its own an answer.
 *
 * ── WHY THEY CANNOT INTERACT, DERIVED AT THE BYTES ────────────────────────
 * They read and write DISJOINT FIELDS:
 *
 *   * the floor's comparator `comparisonSurvivesDedup`
 *     (`analysis-ready-core.ts:542-562`) fingerprints each option by its
 *     `interventions`, unwrapping `.value` — it never reads `raw_value`;
 *   * `reconcileObservedValuePair` gates on `op.op === 'update_node'` and
 *     writes `observed_state.raw_value`. Contrast control in the same sweep:
 *     `interventions` occurs 16x in `canonicalise-value-ops.ts` and ZERO times
 *     inside `reconcileObservedValuePair` itself.
 *
 * Measured through both shipped functions: the canonicaliser returns
 * `{unit:'%', value:0.9, raw_value:180}` — `value` UNCHANGED, only the display
 * carrier moved — and emits no `interventions` at all.
 *
 * ⚠ The two assertions below are built so the probe cannot pass by being blind:
 * the first shows the floor's verdict is INVARIANT under the canonicaliser's
 * output, the second shows the same fixture's verdict DOES flip when the field
 * the floor actually reads changes. Invariance alone would be satisfied by a
 * fixture that never reaches the floor.
 */
describe('composition — the percent canonicaliser cannot move the IDENTICAL_OPTIONS floor', () => {
  const E = (id: string, from: string, to: string) => ({
    id, from, to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive' as const,
  });

  /**
   * ⚠ THE FIRST VERSION OF THIS FIXTURE NEVER REACHED THE FLOOR, AND THE
   * CONTRAST CONTROL BELOW IS WHAT CAUGHT IT. A percent factor added without
   * edges makes the graph `unrecoverable`, so BOTH arms refused for an
   * unrelated reason and the invariance assertion passed by testing nothing.
   * The factor is therefore `external` with a prior and fully wired, which
   * keeps `strict.status === 'analysis_ready'` — the STRICT path, which is
   * precisely the path #1143 changed.
   */
  const build = (interventions: Array<Record<string, number>>, nrrRawValue: number) => {
    const options = interventions.map((iv, i) => ({
      id: `opt_${i}`, kind: 'option', label: `Opt ${i}`, interventions: iv,
    }));
    return {
      version: '1',
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Goal' },
        { id: 'decision', kind: 'decision', label: 'Hiring' },
        { id: 'fac_velocity', kind: 'factor', label: 'Velocity', category: 'controllable',
          observed_state: { value: 0.5, cap: 1 } },
        { id: 'nrr', kind: 'factor', label: 'NRR', category: 'external',
          observed_state: { unit: '%', value: 0.575, raw_value: nrrRawValue },
          scale_frame: 200,
          prior: { distribution: 'uniform', range_min: 0.4, range_max: 0.8 } },
        ...options,
      ],
      edges: [
        ...options.map((o, i) => E(`ed${i}`, 'decision', o.id)),
        ...options.map((o, i) => E(`ef${i}`, o.id, 'fac_velocity')),
        E('eg', 'fac_velocity', 'goal'),
        ...options.map((o, i) => E(`en${i}`, o.id, 'nrr')),
        E('engoal', 'nrr', 'goal'),
      ],
    };
  };
  const DISTINCT = [{ fac_velocity: 0.3 }, { fac_velocity: 0.7 }];
  const IDENTICAL = [{ fac_velocity: 0.5 }, { fac_velocity: 0.5 }];

  it('PRECONDITION: the fixture actually reaches the floor on the STRICT path', () => {
    // Pins what the invariance assertion depends on. Without this the whole
    // block could pass because the graph refused for an unrelated reason.
    const admission = resolveRunAdmission(build(DISTINCT, 115) as never);
    expect(admission.strict.status).toBe('analysis_ready');
    expect(admission.willProceed).toBe(true);
  });

  it('the admission verdict is INVARIANT under the raw_value this PR rewrites', () => {
    // 115 is the pre-canonicalisation carrier, 180 the post- one.
    const before = resolveRunAdmission(build(DISTINCT, 115) as never);
    const after = resolveRunAdmission(build(DISTINCT, 180) as never);
    expect(after.willProceed).toBe(before.willProceed);
    expect(after.blockedNextStep).toStrictEqual(before.blockedNextStep);
    expect(after.strict.status).toBe(before.strict.status);
  });

  it('CONTRAST CONTROL: the SAME fixture DOES flip on the field the floor reads', () => {
    const distinct = resolveRunAdmission(build(DISTINCT, 115) as never);
    const identical = resolveRunAdmission(build(IDENTICAL, 115) as never);
    expect(distinct.willProceed).toBe(true);
    expect(identical.willProceed).toBe(false);
  });

  it('the canonicaliser leaves `value` and `interventions` untouched — only the display carrier moves', () => {
    const ops = [{
      op: 'update_node' as const, path: 'nrr',
      value: { observed_state: { unit: '%', value: 0.9, raw_value: 115 } },
    } as never];
    const out = reconcileObservedValuePair(ops, build(DISTINCT, 115) as never)[0] as {
      value?: { observed_state?: Record<string, unknown>; interventions?: unknown };
    };
    expect(out.value?.observed_state?.value).toBe(0.9);
    expect(out.value?.observed_state?.raw_value).toBe(180);
    expect(out.value?.interventions).toBeUndefined();
  });
});
