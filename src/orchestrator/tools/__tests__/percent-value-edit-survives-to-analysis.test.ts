/**
 * ⭐⭐ A PERCENTAGE THE USER SETS ON THE OP PATH MUST STILL BE ANALYSABLE.
 *
 * ── THE DEFECT, REPRODUCED LIVE (2026-09-02, CEE `3575b18` / UI `05ca160b`) ──
 * A fresh guest model refused every analysis attempt with, verbatim on screen:
 *
 *   "I can't run this analysis safely. Sales say the product is too shallow
 *    for the enterprise deals we're now chasing is recorded as a bare amount
 *    with no range for me to measure it against ... Telling me the same amount
 *    again won't clear it; ask me to run it again after any change and I'll
 *    re-check."
 *
 * The named factor's PERSISTED record, read out of the deployed session:
 *
 *   83c01b53  { value: 40, unit: '%', source: 'user_override' }   display "40%"
 *
 * — no `raw_value`. Its FOUR sibling percent factors in the same graph all
 * carried `{ value: 0.x, unit: '%', raw_value: x0 }`. That 4-to-1 split in one
 * live graph is the contrast control: the convention is `value` = the analysis
 * level, `raw_value` = the user's magnitude, and this one record has the raw
 * magnitude sitting in the LEVEL slot.
 *
 * ── WHICH AUTHORITY IS WRONG, AND WHY IT IS NOT THE GATE ───────────────────
 * The analysis seam's baseline gate (`findScaleIncoherentBaselineFactorIds`)
 * refuses it, and it is RIGHT to: CEE's own percent-inversion authority
 * `resolveExistingRawValue` independently classifies `{value: 40, unit: '%'}`
 * as `ambiguous` — "a `%` value OUTSIDE [0,1] ... is genuinely ambiguous →
 * fail closed". Two independent readers agree the RECORD is incoherent. The
 * gate is not loosened here and is not touched.
 *
 * The first failure is the WRITER. `normaliseFactorValue` — the V5
 * `set_factor_value` writer — given the same "40%" writes `{value: 0.4,
 * raw_value: 40}` through `unitPinnedScaleFrame`. `canonicaliseValueOps` — the
 * V4/op writer — returned the op UNTOUCHED, persisting `{value: 40}`. Two
 * writers, one input, two different answers: the twins defect (trap 12), and
 * the fix is to make the second consult the SAME authority as the first, not
 * to hold a new opinion about frames.
 *
 * ── WHY `unitPinnedScaleFrame` AND NOTHING ELSE ────────────────────────────
 * It returns a CONSTANT that is a function of the UNIT ALONE (percent → 100,
 * basis points → 10,000) and abstains everywhere else, so it can never hand
 * back a laddered, sibling-dependent number and can never silently rescale a
 * sibling intervention. Critically it abstains ABOVE 100 — which is exactly
 * the class a prior lane fought to keep refusing (NRR 115%, ROI 300% frame at
 * 200/500, where a hard-coded 100 is a 2-5x error). That exclusion is
 * PRESERVED here by the authority itself, not by a second guard that could
 * drift from it.
 *
 * ── THE MATRIX IS THE POINT: EXACTLY ONE CELL MOVES ────────────────────────
 * Measured at pristine, all five cells; only the first changes.
 *
 *   payload -> % factor, 40    BLOCKS  ->  computes   ← the defect
 *   payload -> % factor, 150   BLOCKS  ->  BLOCKS     ← above the pinned bound
 *   payload -> % factor, 0.4   computes -> computes   ← already a level
 *   payload -> £ factor, 40    BLOCKS  ->  BLOCKS     ← the currency lie stays shut
 *   payload -> unitless, 40    BLOCKS  ->  BLOCKS     ← no stated scale
 *
 * ── BINDING (trap 19) ─────────────────────────────────────────────────────
 * `fac_decoy` carries `{value: 0.4, raw_value: 40, unit: '%'}` — the SAME
 * magnitudes as the target's expected post-fix pair — so no value predicate
 * can tell target from decoy. Every assertion names `fac_share` by id, and the
 * preconditions are pinned in-test so a fixture that stopped exercising the
 * canonicaliser could not make this agree for the wrong reason (trap 13b).
 */
/**
 * ⭐⭐ A PERCENTAGE THE USER SETS ON THE OP PATH MUST STILL BE ANALYSABLE.
 *
 * ── THE DEFECT, REPRODUCED LIVE (2026-09-02, CEE `3575b18` / UI `05ca160b`) ──
 * A fresh guest model refused every analysis attempt with, verbatim on screen:
 *
 *   "I can't run this analysis safely. Sales say the product is too shallow
 *    for the enterprise deals we're now chasing is recorded as a bare amount
 *    with no range for me to measure it against ... Telling me the same amount
 *    again won't clear it; ask me to run it again after any change and I'll
 *    re-check."
 *
 * The named factor's PERSISTED record, read out of the deployed session:
 *
 *   83c01b53  { value: 40, unit: '%', source: 'user_override' }   display "40%"
 *
 * — no `raw_value`. Its FOUR sibling percent factors in the same graph all
 * carried `{ value: 0.x, unit: '%', raw_value: x0 }`. That 4-to-1 split in one
 * live graph is the contrast control: the convention is `value` = the analysis
 * level, `raw_value` = the user's magnitude, and this one record has the raw
 * magnitude sitting in the LEVEL slot.
 *
 * ── WHICH AUTHORITY IS WRONG, AND WHY IT IS NOT THE GATE ───────────────────
 * The analysis seam's baseline gate (`findScaleIncoherentBaselineFactorIds`)
 * refuses it, and it is RIGHT to: CEE's own percent-inversion authority
 * `resolveExistingRawValue` independently classifies `{value: 40, unit: '%'}`
 * as `ambiguous` — "a `%` value OUTSIDE [0,1] ... is genuinely ambiguous →
 * fail closed". Two independent readers agree the RECORD is incoherent. The
 * gate is not loosened here and is not touched.
 *
 * The first failure is the WRITER. `normaliseFactorValue` — the V5
 * `set_factor_value` writer — given the same "40%" writes `{value: 0.4,
 * raw_value: 40}` through `unitPinnedScaleFrame`. `canonicaliseValueOps` — the
 * V4/op writer — returned the op UNTOUCHED, persisting `{value: 40}`. Two
 * writers, one input, two different answers: the twins defect (trap 12), and
 * the fix is to make the second consult the SAME authority as the first, not
 * to hold a new opinion about frames.
 *
 * ── WHY `unitPinnedScaleFrame` AND NOTHING ELSE ────────────────────────────
 * It returns a CONSTANT that is a function of the UNIT ALONE (percent → 100,
 * basis points → 10,000) and abstains everywhere else, so it can never hand
 * back a laddered, sibling-dependent number and can never silently rescale a
 * sibling intervention. Critically it abstains ABOVE 100 — which is exactly
 * the class a prior lane fought to keep refusing (NRR 115%, ROI 300% frame at
 * 200/500, where a hard-coded 100 is a 2-5x error). That exclusion is
 * PRESERVED here by the authority itself, not by a second guard that could
 * drift from it.
 *
 * ── THE MATRIX IS THE POINT: EXACTLY ONE CELL MOVES ────────────────────────
 * Measured at pristine, all five cells; only the first changes.
 *
 *   payload -> % factor, 40    BLOCKS  ->  computes   ← the defect
 *   payload -> % factor, 150   BLOCKS  ->  BLOCKS     ← above the pinned bound
 *   payload -> % factor, 0.4   computes -> computes   ← already a level
 *   payload -> £ factor, 40    BLOCKS  ->  BLOCKS     ← the currency lie stays shut
 *   payload -> unitless, 40    BLOCKS  ->  BLOCKS     ← no stated scale
 *
 * ── BINDING (trap 19) ─────────────────────────────────────────────────────
 * `fac_decoy` carries `{value: 0.4, raw_value: 40, unit: '%'}` — the SAME
 * magnitudes as the target's expected post-fix pair — so no value predicate
 * can tell target from decoy. Every assertion names `fac_share` by id, and the
 * preconditions are pinned in-test so a fixture that stopped exercising the
 * canonicaliser could not make this agree for the wrong reason (trap 13b).
 */
import { describe, it, expect } from 'vitest';

import {
  canonicaliseValueOps,
  stampUserEditProvenance,
  reconcileObservedValuePair,
} from '../../canonicalise-value-ops.js';
import {
  findScaleIncoherentBaselineFactorIds,
  decideAnalysisScaleBlock,
} from '../../../orchestrator-v5/tools/plot-intervention-scale.js';
import { normaliseFactorValue } from '../../../orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.js';
import type { PatchOperation } from '../../types.js';

const TARGET = 'fac_share';
const DECOY = 'fac_decoy';

function buildGraph(unit: string | undefined): unknown {
  return {
    nodes: [
      {
        id: TARGET,
        kind: 'factor',
        label: 'Share of deals the product is too shallow for',
        observed_state: unit !== undefined ? { unit } : {},
      },
      {
        // Same magnitudes as the target's expected post-fix pair.
        id: DECOY,
        kind: 'factor',
        label: 'Decoy',
        observed_state: { value: 0.4, raw_value: 40, unit: '%' },
      },
    ],
  };
}

/** The post-`normalisePath` op spelling the handler feeds the canonicaliser. */
function leafPatch(nodeId: string, to: unknown): PatchOperation {
  return {
    op: 'update_node',
    path: nodeId,
    value: { 'data/value': to },
  } as unknown as PatchOperation;
}

/** EXACTLY the composition both apply seams run (edit-graph.ts, gm-held-execute.ts). */
function walk(to: unknown, unit: string | undefined) {
  const graph = buildGraph(unit) as { nodes: Record<string, unknown>[] };
  const ops = [leafPatch(TARGET, to)];
  const applied = reconcileObservedValuePair(
    stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops),
    graph,
  );
  const written =
    ((applied[0]!.value as Record<string, unknown>).observed_state as Record<string, unknown>) ?? {};
  // Persist exactly as the applier would: the write merges onto the node.
  const persistedTarget = {
    ...graph.nodes[0],
    observed_state: {
      ...(graph.nodes[0]!.observed_state as Record<string, unknown>),
      ...written,
    },
  };
  const blockedIds = findScaleIncoherentBaselineFactorIds([persistedTarget, graph.nodes[1]], []);
  return {
    written,
    blockedIds,
    verdict: decideAnalysisScaleBlock(
      { mixedUnresolved: false, unresolvedFactorIds: [] },
      blockedIds,
    ),
  };
}

describe('a percentage set through the op path survives to the analysis seam', () => {
  it('⭐ 40 on a % factor is recorded as the LEVEL 0.4 beside raw 40, and the analysis runs', () => {
    const out = walk(40, '%');

    // ── PRECONDITION PINNED IN-TEST (trap 13b) ────────────────────────────
    // The verdict below is only about this fix if the canonicaliser really
    // produced a write for this op. A fixture that silently stopped
    // exercising it would leave `written` empty and make everything agree.
    expect(Object.keys(out.written).length).toBeGreaterThan(0);
    expect(out.written.source).toBe('user_override');

    // The record the estate's other writer (`normaliseFactorValue`) already
    // produces for the same input, and the shape all four live siblings hold.
    expect(out.written.value).toBeCloseTo(0.4, 12);
    expect(out.written.raw_value).toBe(40);
    expect(out.written.unit).toBe('%');

    // Bound by IDENTITY: the decoy carries the same magnitudes.
    expect(out.blockedIds).not.toContain(TARGET);
    expect(out.blockedIds).not.toContain(DECOY);
    expect(out.verdict).toEqual({ blocked: false });
  });

  it('150 on a % factor is ABOVE the pinned bound — still refused, loudly (the 2-5x class)', () => {
    const out = walk(150, '%');
    expect(out.written.value).toBe(150);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });

  it('0.4 on a % factor is ALREADY a level — untouched, and it computed before and after', () => {
    const out = walk(0.4, '%');
    expect(out.written.value).toBe(0.4);
    expect(out.blockedIds).not.toContain(TARGET);
    expect(out.verdict).toEqual({ blocked: false });
  });

  it('40 on a CURRENCY factor pins no divisor — still refused (closing the percent gap must not open the currency lie)', () => {
    const out = walk(40, '£');
    expect(out.written.value).toBe(40);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });

  it('40 on a factor with NO stated unit states no scale — still refused', () => {
    const out = walk(40, undefined);
    expect(out.written.value).toBe(40);
    expect(out.written.raw_value).toBeUndefined();
    expect(out.verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: [TARGET],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE ORDERING AXIS — round 3 (review of #1317 at `8e2e9d94`).
//
// The limb resolved the UNIT-PINNED CONSTANT first and consulted no frame the
// factor already carried. A legacy percent factor whose `{value, raw_value}`
// PAIR encodes a non-100 frame has NO stored `scale_frame`, so it fell into the
// limb and the constant 100 OVERRODE the pair's 200 — one input, two writers,
// two answers, which is the twins defect this PR exists to close, reappearing
// inside the fix. It lands on the founder-named NRR-115% class: a baseline
// level of 0.4 beside siblings framed at 200 is a 2x distortion with NO
// refusal anywhere.
//
// THE FIX IS NOT A FOURTH PATCH — IT DELETES THIS LANE'S OWN ORDERING in favour
// of the estate's single existing precedence, which `normaliseFactorValue`
// already uses at `d1-shared/normalise-factor-value.ts`:
//     resolveScaleFrame (stored -> pair) -> else, if the carriers do NOT
//     contradict each other, unitPinnedScaleFrame -> else raw.
// Adopting it is what finally makes the two writers AGREE, which was the whole
// point of the PR. The parity case below asserts that directly rather than
// restating it in a comment.
//
// ⚠ THE `incoherent` SUPPRESSION IS PART OF THE PRECEDENCE, NOT AN EXTRA.
// `resolveScaleFrame` collapses "no frame recorded" and "a frame was recorded
// and it CONTRADICTS the pair" to the same `undefined`. A contradicted frame is
// POSITIVE evidence the factor's scale is corrupt, and pinning a unit constant
// onto it produces a number incomparable to the siblings that were framed by
// the real frame — the same harm by another door. `normaliseFactorValue` guards
// this with `checkPairCoherence(...) === 'incoherent'`; so does this lane.
// ────────────────────────────────────────────────────────────────────────────

/** A capless percent factor whose PAIR encodes frame 200 (115 / 0.575). */
function framedPairGraph(extra: Record<string, unknown> = {}): unknown {
  return {
    nodes: [
      {
        id: TARGET,
        kind: 'factor',
        label: 'Net revenue retention',
        observed_state: { value: 0.575, raw_value: 115, unit: '%' },
        ...extra,
      },
      { id: DECOY, kind: 'factor', label: 'Decoy', observed_state: { value: 0.4, raw_value: 40, unit: '%' } },
    ],
  };
}

function applyTo(graph: unknown, to: number): Record<string, unknown> {
  const ops = [leafPatch(TARGET, to)];
  const applied = reconcileObservedValuePair(
    stampUserEditProvenance(canonicaliseValueOps(ops, graph).operations, ops),
    graph,
  );
  return ((applied[0]!.value as Record<string, unknown>).observed_state as Record<string, unknown>) ?? {};
}

describe('a frame the factor ALREADY carries outranks the unit-pinned constant', () => {
  it('⭐ PAIR-recovered frame 200 wins over the percent constant 100 (no stored scale_frame)', () => {
    const written = applyTo(framedPairGraph(), 40);
    // PRECONDITION PINNED IN-TEST: the fixture really has no stored frame, so
    // this case is genuinely about the PAIR and not about `scale_frame`.
    expect((framedPairGraph() as { nodes: Record<string, unknown>[] }).nodes[0]!.scale_frame).toBeUndefined();
    expect(written.value).toBeCloseTo(0.2, 12); // 40 / 200, NOT 40 / 100
    expect(written.raw_value).toBe(40);
  });

  it('its STORED-frame twin answers identically (scale_frame: 200)', () => {
    const written = applyTo(framedPairGraph({ scale_frame: 200 }), 40);
    expect(written.value).toBeCloseTo(0.2, 12);
    expect(written.raw_value).toBe(40);
  });

  it('⭐ CROSS-WRITER PARITY: this lane and `normaliseFactorValue` agree on the same factor', () => {
    for (const fixture of [framedPairGraph(), framedPairGraph({ scale_frame: 200 })]) {
      const node = (fixture as { nodes: Record<string, unknown>[] }).nodes[0]!;
      const obs = node.observed_state as Record<string, unknown>;
      const twin = normaliseFactorValue({
        rawInput: 40,
        unit: '%',
        inputHasUnit: true,
        factorUnit: '%',
        factorObservedValue: obs.value as number,
        factorObservedRawValue: obs.raw_value as number,
        factorScaleFrame: node.scale_frame as number | undefined,
      } as never);
      const mine = applyTo(fixture, 40);
      expect(mine.value).toBeCloseTo(twin.value as number, 12);
      expect(mine.raw_value).toBe(twin.raw_value);
    }
  });

  it('CONTRADICTED carriers are not unit-pinned — the corrupt factor keeps refusing', () => {
    // `{storedFrame: 5, value: 7, raw_value: 7}` is `incoherent`: a recorded
    // frame the code refuses to trust. Pinning 100 onto it would produce a
    // level incomparable to siblings framed by the real frame.
    const graph = {
      nodes: [
        { id: TARGET, kind: 'factor', label: 'Corrupt', scale_frame: 5, observed_state: { value: 7, raw_value: 7, unit: '%' } },
      ],
    };
    const written = applyTo(graph, 40);
    expect(written.value).toBe(40); // raw — never 0.4
  });
});
