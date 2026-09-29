/**
 * ROADMAP 2.299 — extraction dedupe prefers ROLE and CONFIDENCE at equal
 * value, not push order.
 *
 * THE DEFECT, proven by the #791 review and pinned (as current-not-desirable)
 * by its COLLISION PATH PARITY test: `qualifyExtractedFactors` kept whichever
 * colliding factor was PUSHED FIRST. `genericRange` pushes before
 * `contextualNumber`, so when a range's midpoint lands within 10% of the
 * user's stated target — "Output ranges between 5500000 and 6500000; our
 * target is 6000000" collides EXACTLY — the generic {Factor, 6M, conf 0.80}
 * swallowed the user's {Target, 6M, conf 0.90} and the goal target was never
 * minted on EITHER path. The user stated a target; the product rendered
 * "Target: Not set".
 *
 * THE FIX: when two extractions collide as the same quantity, the survivor is
 * chosen by (1) ROLE — a goal/target-labelled factor beats a generic one,
 * because only a target-labelled factor can reach the goal-threshold mint —
 * then (2) CONFIDENCE, and only on a full tie does push order decide (which
 * preserves every previously-pinned tie outcome).
 *
 * These tests drive the PUBLIC enricher API, not the private helper, so they
 * pin the user-visible consequence: the mint fires / the better label wins.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import type { GraphT, FactorDataT } from '../../../schemas/graph.js';

function freshGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Output decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

/** The #791 collision brief, byte-identical. */
const COLLISION_BRIEF =
  'Output ranges between 5500000 and 6500000 most years; our target is 6000000.';

describe('ROADMAP 2.299 — a colliding generic range no longer swallows the user’s Target', () => {
  it('COLLISION — the Target survives and the goal threshold is MINTED', async () => {
    // Pristine tip: genericRange {Factor, 6M, 0.80} pushes first, dedupe drops
    // the later {Target, 6M, 0.90}, no mint, goal_threshold undefined.
    //   post-fix   target = 6_000_000, no '%', no existing cap → 25% headroom
    //              cap = 7_500_000 → threshold 0.8, frame 'level'
    const out = await enrichGraphWithFactorsAsync(freshGraph(), COLLISION_BRIEF);
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>;

    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_raw).toBe(6_000_000);
    expect(goal.goal_threshold_cap).toBe(7_500_000);
    expect(goal.goal_threshold_frame).toBe('level');
    // A range statement is NOT a stated current level; nothing may invent one.
    expect(goal.goal_baseline).toBeUndefined();
    expect(goal.goal_baseline_raw).toBeUndefined();
  });

  it('COLLISION — the superseded range is not ALSO injected as a factor (no double-count)', async () => {
    // The two extractions are the SAME quantity (that is what the collision
    // means). The Target wins it and is redirected to the goal; injecting the
    // range beside it would register the one number twice.
    const out = await enrichGraphWithFactorsAsync(freshGraph(), COLLISION_BRIEF);
    const factors = out.graph.nodes.filter((n) => n.kind === 'factor');
    expect(factors).toHaveLength(0);
    expect(out.factorsAdded).toBe(0);
  });

  it('CONFIDENCE — at equal role, the higher-confidence extraction wins the collision', async () => {
    // Same collision, no goal word: {Factor, 6M, 0.80, range} pushed first,
    // {Revenue, 6M, 0.90} later. Pristine keeps "Factor"; the fix keeps the
    // higher-confidence, better-labelled "Revenue".
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Output ranges between 5500000 and 6500000 most years; revenue is 6000000.',
    );
    const factors = out.graph.nodes.filter((n) => n.kind === 'factor');
    expect(factors).toHaveLength(1);
    expect(factors[0].label).toBe('Revenue');
    const data = factors[0].data as FactorDataT;
    expect(data.confidence).toBe(0.9);
    expect(data.extractionType).toBe('explicit');
    // The survivor is the contextual extraction, not the range wearing its label.
    expect(data.rangeMin).toBeUndefined();
  });

  it('TIE — equal role AND equal confidence keeps the FIRST (push order preserved)', async () => {
    // Two generic ranges with colliding midpoints (60 and 61, within the 10%
    // tolerance) and equal confidence. The fix must not invert pre-existing
    // tie behaviour: first pushed still wins, proven by the surviving factor
    // carrying the FIRST range's bounds. (Midpoints deliberately DIFFER so the
    // second survives `extractFactors`' own exact-value dedup and the tie is
    // genuinely decided here — an identical midpoint never reaches this code.)
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Output is between 50 and 70 most days, sometimes between 55 and 67.',
    );
    const factors = out.graph.nodes.filter((n) => n.kind === 'factor');
    expect(factors).toHaveLength(1);
    const data = factors[0].data as FactorDataT;
    expect(data.rangeMin).toBe(50);
    expect(data.rangeMax).toBe(70);
  });

  it('ROLE GUARD — a later same-value generic factor cannot displace the baseline-bearing Target', async () => {
    // The inverse direction, and the vacuity guard on the preference logic: a
    // naive "later wins" rewrite would let the currency from-to factor
    // (conf 0.95, same value, same unit) displace the goal pair and take its
    // baseline with it. Role must protect the Target regardless of order.
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Grow revenue from £4000000 to a target of £6000000. Pricing moved from £5900000 to £6000000.',
    );
    const goal = out.graph.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>;
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_baseline).toBe(0.5333333333333333);
    expect(goal.goal_baseline_raw).toBe(4_000_000);
  });
});
