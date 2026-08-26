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
});
