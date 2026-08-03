/**
 * ROADMAP 2.353 — ORDINARY NATURAL-LANGUAGE GOALS KEEP THEIR TARGETS.
 * (Absorbs 2.343.)
 *
 * A user who states a target in plain English must get a goal WITH that target.
 * Four measured shapes, all of which lost the target at `210c0ff`:
 *
 *   A  "Increase annual revenue from £4 million today to £6 million within
 *       12 months"                        → goal minted, NO threshold at all
 *   B  "Raise the target from £600,000 to £800,000"
 *                                         → value+baseline extracted onto a
 *                                            NON-goal label, no mint
 *   C  "Grow revenue from £4M to a target of 6M dollars"
 *                                         → pair FORMED and stamped GBP —
 *                                            a fabricated currency reading
 *   D  "Currently at 4M pounds, target 6M pounds"
 *                                         → pair formed, unit UNDEFINED,
 *                                            defaulting to `count` (the N7 class)
 *
 * ⚠ TWO REPORTED PREMISES WERE CORRECTED AT THE BYTES BEFORE THIS FILE WAS
 * WRITTEN, and the corrections are recorded because both changed the fix.
 *
 *   1. Case A was attributed to the now-qualifier ("`today` sits between the
 *      baseline and `to`"). MEASURED at pristine: the SAME brief WITHOUT
 *      "today" — "Increase annual revenue from £4 million to £6 million within
 *      12 months" — also yields `extractGoalTargetWithBaseline → null` and a
 *      goal node carrying `{}`. The now-qualifier is a SECOND blocker, not the
 *      cause. The cause is that no pattern in `GOAL_BASELINE_PATTERNS` accepts a
 *      from-to goal without a GOAL WORD after `to`. Fixing only the qualifier
 *      would have moved nothing, and the A3 case below is here permanently so
 *      that claim cannot be made again without a control.
 *
 *   2. Case B was attributed to `inferLabel` naming the factor "Revenue".
 *      MEASURED at pristine: the bare phrasing yields label **"Value"**, not
 *      "Revenue" — `inferLabel` returns "Revenue" only when the word "revenue"
 *      happens to fall in the 50 characters before the match ("Raise the
 *      REVENUE target from …"). `inferLabel` carries no target/goal pattern at
 *      ALL, so the label is whatever the surrounding prose suggests and is
 *      goal-ineligible either way. Both spellings are pinned below, because a
 *      repair aimed at the reported "Revenue" alone would have left the bare
 *      phrasing broken.
 *
 * WHAT IS ASSERTED, per case: the WHOLE UI-facing contract BY IDENTITY —
 * threshold, the raw trio (raw/unit/cap), frame, and the baseline pair — at
 * extraction, after the enricher mint, THROUGH Stage 4b (which strips a
 * round-raw threshold on a digit-free label unless the run attested its own
 * mint), and on the V3 node the UI reads. A case that mints and is then swept
 * away at 4b is not fixed, and only the end-to-end assertion can see that.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import {
  GOAL_BASELINE_PATTERN_SOURCES_FOR_DRIFT_GUARD,
  extractFactors,
  extractGoalTargetWithBaseline,
} from '../index.js';
import {
  AMOUNT_DIGITS,
  MAGNITUDE_ALTERNATION,
  MAGNITUDE_MULTIPLIERS,
} from '../../../utils/magnitude-alphabet.js';
import { runStageThresholdSweep } from '../../unified-pipeline/stages/threshold-sweep.js';
import { transformNodeToV3 } from '../../transforms/schema-v3.js';
import type { GraphT } from '../../../schemas/graph.js';
import type { V1Node } from '../../transforms/schema-v2.js';

/**
 * A digit-free goal label, deliberately. "Grow annual revenue" is the ordinary
 * label the model writes, and it is exactly what makes Stage 4b's
 * `rawIsRound && labelHasNoDigits` heuristic fire — so an end-to-end run over
 * this graph is the one that can see a mint being swept back off.
 */
function freshGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Grow annual revenue' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

/** The goal-threshold contract as it stands after enrichment + Stage 4b. */
interface GoalContract {
  readonly goal_threshold?: number;
  readonly goal_threshold_raw?: number;
  readonly goal_threshold_unit?: string;
  readonly goal_threshold_cap?: number;
  readonly goal_threshold_frame?: string;
  readonly goal_baseline?: number;
  readonly goal_baseline_raw?: number;
}

/**
 * Run the real draft path end to end: enricher mint → Stage 4b sweep (carrying
 * the mint ATTESTATION exactly as `runStageEnrich` does) → the V3 projection
 * the UI reads.
 */
async function runToWire(brief: string): Promise<{
  contract: GoalContract;
  v3: Record<string, unknown>;
  sweepStrips: number;
}> {
  const out = await enrichGraphWithFactorsAsync(freshGraph(), brief);

  const ctx = {
    graph: out.graph,
    requestId: 'test-2353',
    // Derived at the mint site and carried forward verbatim — see
    // stages/enrich.ts, ROADMAP 2.281.
    enricherMintedGoalIds: new Set(out.goalThresholdsMinted ?? []),
  } as unknown as Parameters<typeof runStageThresholdSweep>[0];

  await runStageThresholdSweep(ctx);

  const goal = (ctx as unknown as { graph: GraphT }).graph.nodes.find(
    (n) => n.kind === 'goal',
  ) as unknown as GoalContract;

  return {
    contract: {
      goal_threshold: goal.goal_threshold,
      goal_threshold_raw: goal.goal_threshold_raw,
      goal_threshold_unit: goal.goal_threshold_unit,
      goal_threshold_cap: goal.goal_threshold_cap,
      goal_threshold_frame: goal.goal_threshold_frame,
      goal_baseline: goal.goal_baseline,
      goal_baseline_raw: goal.goal_baseline_raw,
    },
    v3: transformNodeToV3(goal as unknown as V1Node) as Record<string, unknown>,
    sweepStrips:
      (ctx as unknown as { thresholdSweepTrace?: { strips_applied: number } })
        .thresholdSweepTrace?.strips_applied ?? -1,
  };
}

/* =========================================================================
 * THE FAMILY, EACH CASE END TO END AND BY IDENTITY
 * ======================================================================= */

/**
 * The hand-written corpus (CLAUDE.md 12d, second face).
 *
 * A DERIVED guard proves the patterns agree with the shared alphabet; it is
 * structurally incapable of noticing that the pattern SET is short one shape —
 * which is precisely the defect this row closes. Only a corpus of real
 * phrasings, with its values spelled out, can. Every entry is a shape a user
 * actually typed or a reviewer actually measured; the arithmetic beside each is
 * hand-computed from the cap doctrine (no '%' and no existing cap ⇒ 25%
 * headroom above the raw target), never copied from an output.
 */
const FAMILY: ReadonlyArray<{
  readonly name: string;
  readonly brief: string;
  readonly target: number;
  readonly baseline: number;
  readonly unit: string;
  readonly cap: number;
  readonly threshold: number;
  readonly normalisedBaseline: number;
}> = [
  {
    // A — the Codex-confirmed live case, verbatim.
    name: 'A · "today" between the baseline and "to", no goal word after it',
    brief: 'Increase annual revenue from £4 million today to £6 million within 12 months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000, //          6_000_000 × 1.25
    threshold: 0.8, //          6_000_000 ÷ 7_500_000
    normalisedBaseline: 0.5333333333333333, // 4_000_000 ÷ 7_500_000
  },
  {
    name: 'A2 · "currently" as the now-qualifier',
    brief: 'Increase annual revenue from £4 million currently to £6 million within 12 months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    // ⚠ THE CONTROL FOR CORRECTION 1. No qualifier at all, and it was equally
    // broken at pristine. If this case ever starts passing while A fails, the
    // repair addressed the qualifier and not the grammar.
    name: 'A3 · NO now-qualifier — broken at pristine too (the refuted premise)',
    brief: 'Increase annual revenue from £4 million to £6 million within 12 months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'A4 · the two-word "at present" qualifier',
    brief: 'Increase annual revenue from £4 million at present to £6 million within 12 months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    // B — ROADMAP 2.343, the walk-measured case, BARE phrasing (label "Value").
    name: 'B · "Raise the target from X to Y" — bare (pristine label "Value")',
    brief: 'Raise the target from £600,000 to £800,000',
    target: 800_000,
    baseline: 600_000,
    unit: '£',
    cap: 1_000_000, //          800_000 × 1.25
    threshold: 0.8, //          800_000 ÷ 1_000_000
    normalisedBaseline: 0.6, // 600_000 ÷ 1_000_000
  },
  {
    // B2 — the SAME shape with "revenue" in the preceding 50 characters, which
    // is the only reason the walk saw the label "Revenue". Both must mint.
    name: 'B2 · the same shape with a metric word (pristine label "Revenue")',
    brief: 'Raise the revenue target from £600,000 to £800,000.',
    target: 800_000,
    baseline: 600_000,
    unit: '£',
    cap: 1_000_000,
    threshold: 0.8,
    normalisedBaseline: 0.6,
  },
  {
    // D — the N7 class: currency stated as a WORD on both sides. The pair
    // already formed at pristine; the UNIT was dropped and defaulted to
    // `count`, which is a lie about a pound figure.
    name: 'D · currency as a trailing WORD on both sides (N7 — unit was "count")',
    brief: 'Currently at 4M pounds, target 6M pounds',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'D2 · "dollars" on both sides folds to $, not to count',
    brief: 'Currently at 4M dollars, and our target is 6M dollars.',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '$',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
];

describe('ROADMAP 2.353 — a plainly-stated target survives to the wire', () => {
  it.each(FAMILY)('EXTRACTION · $name', ({ brief, target, baseline, unit }) => {
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair, `no (target, baseline) pair formed for: ${brief}`).not.toBeNull();
    expect(pair!.value, brief).toBe(target);
    expect(pair!.baseline, brief).toBe(baseline);
    expect(pair!.unit, brief).toBe(unit);
  });

  it.each(FAMILY)('LABEL ROUTING · $name', ({ brief, target, baseline, unit }) => {
    // The forced "Target" label is the ONLY thing `isTargetGoalLabel` accepts,
    // and it is what routes the factor to the goal-threshold mint. `inferLabel`
    // cannot produce it — it has no target pattern — so a from-to goal brief
    // reaches the mint only by forming a PAIR here.
    const factors = extractFactors(brief);
    const targets = factors.filter((f) => /^target$/i.test(f.label));
    expect(targets, `expected exactly one "Target" factor for: ${brief}`).toHaveLength(1);
    expect(targets[0].value, brief).toBe(target);
    expect(targets[0].baseline, brief).toBe(baseline);
    expect(targets[0].unit, brief).toBe(unit);
    expect(targets[0].confidence, brief).toBe(0.95);
    expect(targets[0].extractionType, brief).toBe('explicit');
  });

  it.each(FAMILY)(
    'END TO END · $name',
    async ({ brief, target, baseline, unit, cap, threshold, normalisedBaseline }) => {
      const { contract, v3, sweepStrips } = await runToWire(brief);

      // The whole contract, BY IDENTITY. Not `toBeDefined` — a wrong number is
      // the failure mode this row exists for, and it wears a confident badge.
      expect(contract, brief).toEqual({
        goal_threshold: threshold,
        goal_threshold_raw: target,
        goal_threshold_unit: unit,
        goal_threshold_cap: cap,
        goal_threshold_frame: 'level',
        goal_baseline: normalisedBaseline,
        goal_baseline_raw: baseline,
      });

      // Stage 4b must not sweep the mint back off. The label is digit-free and
      // the raw is round, so without the attestation this is exactly the node
      // the heuristic deletes.
      expect(sweepStrips, `Stage 4b stripped the mint for: ${brief}`).toBe(0);

      // The UI-facing projection.
      expect(v3.goal_threshold, brief).toBe(threshold);
      expect(v3.goal_threshold_raw, brief).toBe(target);
      expect(v3.goal_threshold_unit, brief).toBe(unit);
      expect(v3.goal_threshold_cap, brief).toBe(cap);
      expect(v3.goal_threshold_frame, brief).toBe('level');
      expect(v3.observed_state, brief).toMatchObject({
        baseline: normalisedBaseline,
        raw_value: baseline,
        cap,
        unit,
        source: 'brief_extraction',
      });
    },
  );

  it('THE SHARED DENOMINATOR — threshold and baseline are scored against ONE cap', async () => {
    // ISL computes `threshold − baseline + intercept`. The subtraction is only
    // meaningful when both operands were divided by the same number; a mismatch
    // returns a confident WRONG probability rather than an error, so it is
    // asserted rather than assumed.
    for (const { brief, cap, target, baseline } of FAMILY) {
      const { contract } = await runToWire(brief);
      expect(contract.goal_threshold_cap, brief).toBe(cap);
      expect(contract.goal_threshold! * cap, brief).toBeCloseTo(target, 6);
      expect(contract.goal_baseline! * cap, brief).toBeCloseTo(baseline, 6);
    }
  });
});

/* =========================================================================
 * C — MIXED CURRENCY IS REFUSED, NOT COERCED
 * ======================================================================= */

describe('ROADMAP 2.353 — a mixed-currency goal refuses honestly (#795 residual)', () => {
  /**
   * MEASURED AT PRISTINE, and this is the worst member of the family: the pair
   * FORMED and was stamped `unit: '£'` —
   *
   *   {"value":6000000,"baseline":4000000,"unit":"£",
   *    "matchedText":"from £4M to a target of 6M "}
   *
   * — because pattern 1 read its target with the bare `amountPattern`, which
   * stops before "dollars". The currency-mismatch refusal (2.288) was in place
   * and could not fire, because the signal it compares was never captured. A
   * dollar target served as a pound figure, at confidence 0.95, under a real
   * model card. There is no FX conversion in this codebase; inventing one would
   * be fabrication with extra steps.
   */
  const MIXED: ReadonlyArray<readonly [string, string]> = [
    ['symbol baseline, WORD target', 'Grow revenue from £4M to a target of 6M dollars'],
    ['symbol baseline, WORD target (reversed currencies)', 'Grow revenue from $4M to a target of 6M pounds'],
    ['WORD baseline, symbol target', 'Grow revenue from 4M dollars to a target of £6M'],
    ['WORD on both sides, disagreeing', 'Grow revenue from 4M dollars to a target of 6M pounds'],
    ['the from-to goal-verb shape, mixed', 'Increase annual revenue from £4 million today to 6 million dollars'],
  ];

  it.each(MIXED)('refuses: %s', (_name, brief) => {
    expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
  });

  it.each(MIXED)('mints NOTHING on the wire: %s', async (_name, brief) => {
    const { contract } = await runToWire(brief);
    // An honest refusal is an ABSENT contract, not a zero and not a default.
    expect(contract, brief).toEqual({
      goal_threshold: undefined,
      goal_threshold_raw: undefined,
      goal_threshold_unit: undefined,
      goal_threshold_cap: undefined,
      goal_threshold_frame: undefined,
      goal_baseline: undefined,
      goal_baseline_raw: undefined,
    });
  });

  it('the suppression is scoped to the REFUSED NUMBER, not to the brief', () => {
    // ⚠ THIS TEST'S CONTROL HALF CAUGHT THE FIRST CUT OF THE SUPPRESSION, which
    // dropped EVERY goal-word number in a brief the goal grammar had resolved —
    // so the unrelated "our threshold is 500" vanished too, on the refusal path
    // AND on the formed-pair path. The absence assertion alone was perfectly
    // happy; only asking it to see a PRESENCE exposed it (CLAUDE.md trap 13).
    const refused = extractFactors(
      'Grow revenue from £4M to a target of 6M dollars. Our threshold is 500.',
    );
    // The refused target is withheld …
    expect(refused.filter((f) => /^target$/i.test(f.label))).toHaveLength(0);
    // … and the unrelated number beside it is NOT collateral.
    const refusedThreshold = refused.filter((f) => /^threshold$/i.test(f.label));
    expect(refusedThreshold).toHaveLength(1);
    expect(refusedThreshold[0].value).toBe(500);

    // Same brief, currencies agreeing: the pair forms, its baseline-less
    // duplicate is dropped, and the unrelated number still survives.
    const agreeing = extractFactors(
      'Grow revenue from £4M to a target of 6M pounds. Our threshold is 500.',
    );
    const agreeingTargets = agreeing.filter((f) => /^target$/i.test(f.label));
    expect(agreeingTargets).toHaveLength(1);
    expect(agreeingTargets[0].baseline).toBe(4_000_000);
    const agreeingThreshold = agreeing.filter((f) => /^threshold$/i.test(f.label));
    expect(agreeingThreshold).toHaveLength(1);
    expect(agreeingThreshold[0].value).toBe(500);
  });

  it('POSITIVE CONTROL — the same shapes with ONE currency still extract', () => {
    // Trap 13. An absence assertion that cannot see a presence proves nothing;
    // these four are the mixed table with the disagreement removed.
    const agree: ReadonlyArray<readonly [string, number, number, string]> = [
      ['Grow revenue from £4M to a target of 6M pounds', 6_000_000, 4_000_000, '£'],
      ['Grow revenue from $4M to a target of 6M dollars', 6_000_000, 4_000_000, '$'],
      ['Grow revenue from 4M dollars to a target of $6M', 6_000_000, 4_000_000, '$'],
      ['Grow revenue from 4M pounds to a target of 6M pounds', 6_000_000, 4_000_000, '£'],
    ];
    for (const [brief, value, baseline, unit] of agree) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r, `expected a pair for: ${brief}`).not.toBeNull();
      expect(r!.value, brief).toBe(value);
      expect(r!.baseline, brief).toBe(baseline);
      expect(r!.unit, brief).toBe(unit);
    }
  });
});

/* =========================================================================
 * WHAT THE WIDENING MUST NOT ADMIT
 * ======================================================================= */

describe('ROADMAP 2.353 — the new grammar stays closed', () => {
  it('REFUSES a cross-metric from-to (both nouns present and disagreeing)', () => {
    // The from-to goal shape captures BOTH trailing nouns, so a target and a
    // level from two different metrics are refused rather than subtracted.
    expect(
      extractGoalTargetWithBaseline('Increase our headcount from 50 employees to 800000 revenue'),
    ).toBeNull();
    expect(
      extractGoalTargetWithBaseline('Grow revenue from 50 employees to a target of 800000 customers'),
    ).toBeNull();
  });

  it('REFUSES a mixed percent pair in the from-to goal shape', () => {
    expect(
      extractGoalTargetWithBaseline('Increase annual retention from 85 today to 95%'),
    ).toBeNull();
  });

  it('does NOT admit a bare change with no metric named', () => {
    // "We will increase from 10 to 20" states no metric. It is a change, not a
    // goal, and it must keep flowing through `changePattern` as a plain factor
    // — the canonical complete-array pin in currency-multiplier-magnitude
    // .test.ts depends on exactly this.
    expect(extractGoalTargetWithBaseline('We will increase from 10 to 20.')).toBeNull();
    const factors = extractFactors('We will increase from 10 to 20.');
    expect(factors.filter((f) => /^target$/i.test(f.label))).toHaveLength(0);
  });

  it('does NOT cross a clause boundary to find its "from"', () => {
    // The metric phrase between the verb and `from` admits letters and hyphens
    // only, so it cannot span a comma, a semicolon or a full stop — the
    // failure mode #787 removed when it deleted the `[^.?!\n]{0,40}?` window.
    expect(
      extractGoalTargetWithBaseline('Grow the team; margins fell from 10 to 5.'),
    ).toBeNull();
    expect(
      extractGoalTargetWithBaseline('Increase revenue. Headcount moved from 50 to 80.'),
    ).toBeNull();
  });

  it('does NOT admit a from-to with no "to" amount', () => {
    expect(extractGoalTargetWithBaseline('Increase annual revenue from 4M by 2M.')).toBeNull();
  });

  it('PRESERVED — pattern 1 still refuses to swallow a metric noun on its FROM side', () => {
    // The `to`-side noun capture was added; the FROM side was deliberately NOT
    // widened. Widening it would let this match and would then form the pair
    // (one noun only ⇒ no refusal fires), handing ISL 800k against 50
    // employees. Pinned so a later "symmetry" tidy-up cannot land silently.
    expect(
      extractGoalTargetWithBaseline('from 50 employees to a target of 800k'),
    ).toBeNull();
  });
});

/* =========================================================================
 * 12d — THE DERIVED HALF (it proves agreement; it can never prove completeness)
 * ======================================================================= */

describe('ROADMAP 2.353 — the goal-baseline patterns share the ONE alphabet', () => {
  /**
   * `PATTERN_SOURCES_FOR_DRIFT_GUARD` is derived from `PATTERNS`, and
   * `GOAL_BASELINE_PATTERNS` is NOT a member of `PATTERNS` — so every
   * goal-baseline pattern has been outside the digit- and magnitude-drift
   * guards since 2.273 shipped them. This closes that, DERIVED from the array
   * itself so a fifth pattern is inside the guard the instant it lands.
   *
   * ⚠ And this guard is exactly half the job (CLAUDE.md 12d). It proves the
   * patterns AGREE with the canonical alphabet; it is structurally blind to the
   * pattern SET being short a shape, which is the whole of what 2.353 fixes.
   * The hand-written FAMILY corpus above is the other half. Neither supersedes
   * the other.
   */
  it('every goal-baseline pattern is built from the shared digit grammar', () => {
    const entries = Object.entries(GOAL_BASELINE_PATTERN_SOURCES_FOR_DRIFT_GUARD);
    expect(entries.length, 'the drift-guard surface is empty').toBeGreaterThan(0);
    for (const [name, source] of entries) {
      expect(source, `${name} hand-spells its digit grammar`).toContain(AMOUNT_DIGITS);
    }
  });

  it('every goal-baseline pattern reads the ONE magnitude alternation', () => {
    for (const [name, source] of Object.entries(GOAL_BASELINE_PATTERN_SOURCES_FOR_DRIFT_GUARD)) {
      expect(source, `${name} hand-spells its magnitude alphabet`).toContain(
        MAGNITUDE_ALTERNATION,
      );
    }
  });

  it('EVERY key in the alphabet resolves identically on BOTH amounts of a pair', () => {
    // The per-key derived guard, iterating the canonical map rather than a
    // copy of it: a key the alphabet gains is exercised through the goal
    // grammar the instant it lands, on the target AND on the baseline, so the
    // two sides cannot drift onto different magnitude vocabularies.
    //
    // ⚠ Its blindness is the point of the corpus above: deleting a key from
    // the map leaves this test GREEN, because it only ever asks about keys the
    // map already has (measured on `million`, CLAUDE.md 12d).
    for (const [key, multiplier] of Object.entries(MAGNITUDE_MULTIPLIERS)) {
      const brief = `Currently at 4 ${key}, and our target is 6 ${key}.`;
      const r = extractGoalTargetWithBaseline(brief);
      expect(r, `the alphabet key '${key}' does not resolve: ${brief}`).not.toBeNull();
      expect(r!.value, key).toBe(6 * multiplier);
      expect(r!.baseline, key).toBe(4 * multiplier);
    }
  });
});
