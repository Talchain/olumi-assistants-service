/**
 * Validation pipeline — Pass 1 must report the values the model ACTUALLY uses.
 *
 * THE DEFECT THESE PIN (witnessed on deployed staging, 21 Aug 2026):
 * `edge.validation.pass1` was written as {0, 0, 0} on 27/27 edges of a real
 * guest graph. The UI renders that block under "What the model currently uses",
 * so the product showed zeros for values it was using correctly — and the
 * fabricated 0 → non-zero gap then manufactured 'strength_band_change' and
 * 'existence_boundary_crossing' on 17/27 edges, which the product presented to
 * the user as a review disagreement worth adjudicating.
 *
 * ROOT CAUSE: the pipeline read the canonical NESTED V3 shape
 * (`edge.strength.mean`) while running at Stage 4b, where the graph is still
 * V1_FLAT (`strength_mean`/`belief_exists`). Every read missed and every
 * `?? 0` fired. The nested shape is produced later, by transformResponseToV3.
 *
 * SCOPE NOTE: the pre-existing corpus in comparison.test.ts builds every
 * fixture edge in the NESTED shape, so it shares the code's blind spot exactly
 * and was structurally incapable of observing this (trap 22). These cases are
 * therefore written against the FLAT and LEGACY shapes, and the regression
 * corpus below is taken from a real capture rather than from this author.
 */
import { describe, it, expect } from 'vitest';
import {
  compareEdge,
  buildMissingPass2Metadata,
} from '../../../src/cee/validation-pipeline/comparison.js';
import { computeBiasOffsets } from '../../../src/cee/validation-pipeline/bias-correction.js';
import { readEdgeParams } from '../../../src/cee/unified-pipeline/utils/edge-format.js';
import type { LintedPass2Estimate } from '../../../src/cee/validation-pipeline/types.js';
import type { EdgeV3T } from '../../../src/schemas/cee-v3.js';

// ── Edge builders, one per wire shape ────────────────────────────────────────

/** V1_FLAT — the shape the graph is ACTUALLY in when the pipeline runs. */
function flatEdge(from: string, to: string, mean: number, std: number, ep: number): EdgeV3T {
  return { from, to, strength_mean: mean, strength_std: std, belief_exists: ep } as unknown as EdgeV3T;
}

/** LEGACY — weight/belief, no std equivalent. */
function legacyEdge(from: string, to: string, mean: number, ep: number): EdgeV3T {
  return { from, to, weight: mean, belief: ep } as unknown as EdgeV3T;
}

/** Canonical nested V3 — must keep working (no regression). */
function nestedEdge(from: string, to: string, mean: number, std: number, ep: number): EdgeV3T {
  return { from, to, strength: { mean, std }, exists_probability: ep } as unknown as EdgeV3T;
}

function p2(from: string, to: string, mean: number, std: number, ep: number): LintedPass2Estimate {
  return {
    from, to,
    strength: { mean, std },
    exists_probability: ep,
    reasoning: 'r', basis: 'domain_prior', needs_user_input: false, lint_corrected: false,
  };
}

function compare(edge: EdgeV3T, est: LintedPass2Estimate) {
  return compareEdge(edge, est, { ...est, strength: { ...est.strength } }, [], 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The witnessed defect
// ─────────────────────────────────────────────────────────────────────────────

describe('pass1 reports the values the model actually uses', () => {
  it('reads a V1_FLAT edge instead of fabricating zeros (the witnessed e-0)', () => {
    // The exact triple witnessed in the store on edge e-0.
    const md = compare(flatEdge('e0a', 'e0b', 0.55, 0.132, 0.8), p2('e0a', 'e0b', 0.54, 0.15, 0.9));

    expect(md.pass1).toEqual({
      strength_mean: 0.55,
      strength_std: 0.132,
      exists_probability: 0.8,
    });
  });

  it('does not manufacture contestedness from a 0 it invented (0% vs 90% was never real)', () => {
    const md = compare(flatEdge('e0a', 'e0b', 0.55, 0.132, 0.8), p2('e0a', 'e0b', 0.54, 0.15, 0.9));

    // The real gap is 0.55 vs 0.54 and 0.8 vs 0.9 — minor on every rule.
    expect(md.status).toBe('agreed');
    expect(md.contested_reasons).toEqual([]);
    // max_divergence is a CONTINUOUS ordering score (types.ts: "0-1, higher =
    // more disagreement"), not a flag, so a small real gap correctly scores
    // small rather than exactly 0. The pre-fix value for these same edges was
    // 0.8 in the 19 Aug capture. Asserting `toBe(0)` here would have been this
    // author's reading of the field rather than the producer's semantics.
    expect(md.max_divergence).toBeLessThan(0.1);
  });

  it('reads a LEGACY edge (weight/belief)', () => {
    const md = compare(legacyEdge('la', 'lb', 0.55, 0.8), p2('la', 'lb', 0.54, 0.15, 0.9));
    expect(md.pass1.strength_mean).toBe(0.55);
    expect(md.pass1.exists_probability).toBe(0.8);
  });

  it('still reads the canonical nested V3 shape (no regression)', () => {
    const md = compare(nestedEdge('na', 'nb', 0.55, 0.132, 0.8), p2('na', 'nb', 0.54, 0.15, 0.9));
    expect(md.pass1).toEqual({
      strength_mean: 0.55, strength_std: 0.132, exists_probability: 0.8,
    });
  });

  it('buildMissingPass2Metadata reads the flat shape too', () => {
    const md = buildMissingPass2Metadata(flatEdge('ma', 'mb', 0.42, 0.11, 0.77), 1);
    expect(md.pass1).toEqual({
      strength_mean: 0.42, strength_std: 0.11, exists_probability: 0.77,
    });
    expect(md.pass2_missing).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE OPPOSITE DIRECTION — a genuinely contested edge must STILL be flagged.
//    Every case above gets its twin here. Silencing contestedness would trade a
//    false alarm for a blind spot, which is worse.
// ─────────────────────────────────────────────────────────────────────────────

describe('genuine disagreement is still flagged (opposite-direction twins)', () => {
  it('flags a real strength_band_change on a FLAT edge', () => {
    const md = compare(flatEdge('ga', 'gb', 0.12, 0.13, 0.8), p2('ga', 'gb', 0.7, 0.15, 0.8));
    expect(md.status).toBe('contested');
    expect(md.contested_reasons).toContain('strength_band_change');
  });

  it('flags a real existence_boundary_crossing on a FLAT edge', () => {
    const md = compare(flatEdge('ha', 'hb', 0.4, 0.13, 0.4), p2('ha', 'hb', 0.4, 0.13, 0.9));
    expect(md.status).toBe('contested');
    expect(md.contested_reasons).toContain('existence_boundary_crossing');
  });

  it('flags a real sign_flip on a FLAT edge, and marks it sign_unstable', () => {
    const md = compare(flatEdge('ia', 'ib', 0.4, 0.13, 0.8), p2('ia', 'ib', -0.4, 0.13, 0.8));
    expect(md.status).toBe('contested');
    expect(md.contested_reasons).toContain('sign_flip');
    expect(md.sign_unstable).toBe(true);
  });

  it('flags a real raw_magnitude gap on a LEGACY edge', () => {
    const md = compare(legacyEdge('ja', 'jb', 0.28, 0.8), p2('ja', 'jb', 0.58, 0.15, 0.8));
    expect(md.status).toBe('contested');
    expect(md.contested_reasons).toContain('raw_magnitude');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Absent ≠ zero. Do not weaken a true statement into silence, and do not
//    fabricate one either.
// ─────────────────────────────────────────────────────────────────────────────

describe('an absent value is reported as absent, never as 0.00', () => {
  it('treats a genuine 0 strength as a real value, not as missing', () => {
    const md = compare(flatEdge('za', 'zb', 0, 0.1, 0.6), p2('za', 'zb', 0.02, 0.1, 0.6));
    expect(md.pass1.strength_mean).toBe(0);
    expect(md.pass1_missing).toBe(false);
  });

  it('marks an edge carrying no readable numbers as pass1_missing', () => {
    const md = compare({ from: 'ua', to: 'ub' } as unknown as EdgeV3T, p2('ua', 'ub', 0.5, 0.15, 0.9));
    expect(md.pass1_missing).toBe(true);
  });

  it('never derives contestedness from an unreadable pass1', () => {
    // Pre-fix this produced ['strength_band_change','existence_boundary_crossing']
    // — both of which follow mechanically from a fabricated 0 → non-zero gap.
    const md = compare({ from: 'ua', to: 'ub' } as unknown as EdgeV3T, p2('ua', 'ub', 0.5, 0.15, 0.9));
    expect(md.status).toBe('agreed');
    expect(md.contested_reasons).toEqual([]);
    expect(md.max_divergence).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bias correction was corrupted by the same read. With pass1 == 0,
//    offset = median(0 - pass2) = -median(pass2), which then shifted every
//    pass2_adjusted value away from what the reviewer actually said. In the
//    21 Aug capture this zeroed pass2_adjusted.strength_std outright.
// ─────────────────────────────────────────────────────────────────────────────

describe('bias offsets are computed from real pass1 values', () => {
  it('does not read -median(pass2) off FLAT edges', () => {
    const edges = [
      flatEdge('a', 'b', 0.5, 0.15, 0.9),
      flatEdge('c', 'd', 0.5, 0.15, 0.9),
      flatEdge('e', 'f', 0.5, 0.15, 0.9),
    ];
    const ests = [p2('a', 'b', 0.5, 0.15, 0.9), p2('c', 'd', 0.5, 0.15, 0.9), p2('e', 'f', 0.5, 0.15, 0.9)];

    // Identical values on both passes ⇒ zero systematic bias.
    const { offsets } = computeBiasOffsets(edges, ests);
    expect(offsets.strength_mean).toBe(0);
    expect(offsets.strength_std).toBe(0);
    expect(offsets.exists_probability).toBe(0);
  });

  it('excludes unreadable edges rather than entering them as 0', () => {
    // ⚠ THE SHAPE OF THIS FIXTURE IS LOAD-BEARING, AND IT TOOK TWO GOES.
    // A mutant that enters unreadable edges as `?? 0` must RED here, and twice
    // it did not:
    //   (1) one unreadable edge among two readable ones -> deltas [0, -0.5, 0],
    //       median still 0. The assertion agreed with the defect.
    //   (2) two unreadable edges at magnitude 0.5 -> median -0.5, which EXCEEDS
    //       EXTREME_BIAS_OFFSET_LIMIT (0.3), so guardExtremeOffsets discarded it
    //       back to 0 and the assertion agreed with the defect AGAIN — this time
    //       via a guard one layer down that the fixture never mentioned.
    // Magnitude 0.25 keeps the fabricated offset INSIDE the limit, so it reaches
    // the output and the assertion can see it:
    //   skipping -> deltas [0]                -> median  0
    //   `?? 0`   -> deltas [0, -0.25, -0.25]  -> median -0.25, applied, RED.
    // The warnings assertion pins the precondition: if a future limit change
    // starts absorbing this again, THAT fails rather than silently restoring a
    // fixture that cannot bite (trap 13b).
    const edges = [
      flatEdge('a', 'b', 0.25, 0.15, 0.9),
      { from: 'c', to: 'd' } as unknown as EdgeV3T, // no readable numbers
      { from: 'e', to: 'f' } as unknown as EdgeV3T, // no readable numbers
    ];
    const ests = [
      p2('a', 'b', 0.25, 0.15, 0.9),
      p2('c', 'd', 0.25, 0.15, 0.9),
      p2('e', 'f', 0.25, 0.15, 0.9),
    ];

    const { offsets, warnings } = computeBiasOffsets(edges, ests);
    expect(offsets.strength_mean).toBe(0);
    expect(warnings).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REGRESSION CORPUS — from a real capture, not from this author.
//    Source: src/cee/transforms/__tests__/fixtures/
//            sendable-variance-draws-2026-08-19.json, draw-5,
//            POST https://cee-staging.onrender.com/proxy/v5/turn, captured 19 Aug 2026.
//    All 22 edges shipped validation.pass1 = {0,0,0} while the SAME edge object
//    carried these values. Each case binds to its edge BY IDENTITY (from->to),
//    never by a value predicate another edge could satisfy.
// ─────────────────────────────────────────────────────────────────────────────

const CAPTURE_20260819_DRAW5: ReadonlyArray<{
  from: string; to: string; mean: number; std: number; ep: number;
}> = [
  { from: '0ebb6657', to: '666659b7', mean: -0.5, std: 0.15, ep: 0.9 },
  { from: '28e61e4b', to: '666659b7', mean: -0.5, std: 0.15, ep: 0.9 },
  { from: '2a5df7c6', to: '666659b7', mean: -0.5, std: 0.15, ep: 0.9 },
  { from: '35a28812', to: '4900a5fd', mean: 0.8, std: 0.19199999999999995, ep: 0.8 },
  { from: '3a75cabd', to: '2a5df7c6', mean: 0.55, std: 0.132, ep: 0.8 },
  { from: '3a75cabd', to: '4900a5fd', mean: 0.6, std: 0.144, ep: 0.8 },
  { from: '3a75cabd', to: '732544c4', mean: 0.3886363636363636, std: 0.09327272727272726, ep: 0.8 },
  { from: '4900a5fd', to: 'aeb3f5b9', mean: 0.7, std: 0.16799999999999995, ep: 0.8 },
  { from: '4abad64d', to: '3a75cabd', mean: 1, std: 0.01, ep: 1 },
  { from: '6d178dfd', to: '28e61e4b', mean: 0.6, std: 0.144, ep: 0.8 },
  { from: '732544c4', to: '666659b7', mean: 0.7, std: 0.15, ep: 0.9 },
  { from: 'a94749f9', to: '0ebb6657', mean: 0.5, std: 0.11999999999999998, ep: 0.8 },
  { from: 'a94749f9', to: '4900a5fd', mean: 0.55, std: 0.132, ep: 0.8 },
  { from: 'a94749f9', to: '732544c4', mean: 0.5613636363636363, std: 0.1347272727272727, ep: 0.8 },
  { from: 'aeb3f5b9', to: '666659b7', mean: 0.75, std: 0.17999999999999997, ep: 0.8 },
  { from: 'e405d56a', to: '3a75cabd', mean: 1, std: 0.01, ep: 1 },
  { from: 'e405d56a', to: 'a94749f9', mean: 1, std: 0.01, ep: 1 },
  { from: 'e4e919d4', to: '4abad64d', mean: 1, std: 0.01, ep: 1 },
  { from: 'e4e919d4', to: 'e405d56a', mean: 1, std: 0.01, ep: 1 },
  { from: 'e4e919d4', to: 'e755ec33', mean: 1, std: 0.01, ep: 1 },
  { from: 'e755ec33', to: 'a94749f9', mean: 1, std: 0.01, ep: 1 },
  { from: '793be10e', to: '666659b7', mean: 0.7, std: 0.15, ep: 0.9 },
];

describe('regression: 19 Aug capture, all 22 edges (identity-bound)', () => {
  it('has 22 edges in the corpus', () => {
    expect(CAPTURE_20260819_DRAW5).toHaveLength(22);
  });

  it.each(CAPTURE_20260819_DRAW5)(
    'edge $from->$to reports its own values, not zeros',
    ({ from, to, mean, std, ep }) => {
      const md = compare(flatEdge(from, to, mean, std, ep), p2(from, to, mean, std, ep));

      expect(md.pass1).toEqual({
        strength_mean: mean,
        strength_std: std,
        exists_probability: ep,
      });
      // pass1 == pass2 here, so nothing can honestly be contested.
      expect(md.status).toBe('agreed');
    },
  );
});
