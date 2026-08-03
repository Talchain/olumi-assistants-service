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
  DURATION_NUMBER_WORDS,
  GOAL_BASELINE_PATTERN_SOURCES_FOR_DRIFT_GUARD,
  PROPOSAL_FRAME_MARKERS,
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
    [
      'the from-to goal-verb shape, mixed',
      'Increase annual revenue from £4 million today to 6 million dollars within 12 months',
    ],
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
      extractGoalTargetWithBaseline(
        'Increase our headcount from 50 employees to 800000 revenue within 12 months',
      ),
    ).toBeNull();
    expect(
      extractGoalTargetWithBaseline('Grow revenue from 50 employees to a target of 800000 customers'),
    ).toBeNull();
  });

  it('REFUSES a mixed percent pair in the from-to goal shape', () => {
    expect(
      extractGoalTargetWithBaseline(
        'Increase annual retention from 85 today to 95% within 12 months',
      ),
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

/* =========================================================================
 * A1 — THE GOAL ANCHOR: A LEVER IS NOT A GOAL
 * ======================================================================= */

describe('ROADMAP 2.353 — pattern 4 mints only for a sentence that names a goal', () => {
  /**
   * MEASURED at `c356531d` (the first cut of this row), on a graph whose goal
   * is "Grow annual revenue" — every one of these stamped a threshold on it,
   * where PRISTINE `210c0ff` minted nothing:
   *
   *   "We could increase the price from £49 to £59"  -> raw 59 / £ / cap 73.75
   *   "increasing ad spend from £200k to £300k"      -> raw 300,000
   *   "Drop the price from £49 to £39"               -> raw 39, goal_baseline
   *                                                     1.005 (ABOVE its cap)
   *   "Lower the cost from £200 to £150"             -> raw 150, baseline 1.067
   *
   * An honest absence replaced by a confident wrong number. The anchor restores
   * pristine parity for all four.
   */
  const LEVERS: ReadonlyArray<readonly [string, string]> = [
    ['modal proposal', 'We could increase the price from £49 to £59'],
    ['gerund option', 'increasing ad spend from £200k to £300k'],
    ['imperative', 'Drop the price from £49 to £39'],
    ['imperative, decrease', 'Lower the cost from £200 to £150'],
  ];

  it.each(LEVERS)('forms no goal pair: %s', (_n, brief) => {
    expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
  });

  it.each(LEVERS)('mints nothing on the wire (pristine parity): %s', async (_n, brief) => {
    const { contract } = await runToWire(brief);
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

  it.each(LEVERS)('emits no goal-labelled factor: %s', (_n, brief) => {
    const factors = extractFactors(brief);
    expect(factors.filter((f) => /^(?:target|goal|objective|threshold)$/i.test(f.label))).toHaveLength(0);
  });

  it('a LEVER sentence cannot steal the pair from a genuine goal that follows', async () => {
    // `exec` returns the FIRST match, so before the anchor the price lever won
    // and the revenue goal was never seen. The anchored scan skips unanchored
    // matches and keeps looking.
    const brief =
      'We could increase the price from £49 to £59. ' +
      'Increase annual revenue from £4 million today to £6 million within 12 months.';
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair?.value, 'the lever stole the pair').toBe(6_000_000);
    expect(pair?.baseline).toBe(4_000_000);

    const { contract } = await runToWire(brief);
    expect(contract.goal_threshold_raw).toBe(6_000_000);
    expect(contract.goal_baseline_raw).toBe(4_000_000);
  });

  it('a lever carrying a HORIZON is still excluded, by the modal guard', () => {
    // The anchor alone would admit this one; the optionality-modal guard is the
    // second, independent mechanism and this is the case that needs it.
    expect(
      extractGoalTargetWithBaseline('We could increase the price from £49 to £59 this year'),
    ).toBeNull();
  });

  it('an ANCHOR is what admits the goal — each kind, on its own', () => {
    // The three anchors, each exercised alone, so none of them is carried by
    // another. Same sentence shape as the levers above.
    const byHorizon = extractGoalTargetWithBaseline(
      'Increase annual revenue from £4 million to £6 million within 12 months',
    );
    expect(byHorizon?.value, 'horizon anchor').toBe(6_000_000);

    const byGoalWordAfterTo = extractGoalTargetWithBaseline(
      'Increase annual revenue from £4 million to a target of £6 million',
    );
    expect(byGoalWordAfterTo?.value, 'goal word after "to"').toBe(6_000_000);

    const byGoalWordInPhrase = extractGoalTargetWithBaseline(
      'Raise the target from £600,000 to £800,000',
    );
    expect(byGoalWordInPhrase?.value, 'goal word in the metric phrase').toBe(800_000);
  });
});

/* =========================================================================
 * A2 — A DECREASE IS REFUSED, BECAUSE THE SEAM INVERTS IT
 * ======================================================================= */

describe('ROADMAP 2.353 — decrease pairs are refused, not minted', () => {
  /**
   * ISL scores P(level >= threshold) and the goal contract carries NO direction
   * field — `goal_threshold_frame` is the code constant 'level'. A threshold
   * below its baseline therefore enters a >= seam that INVERTS the question,
   * and returns the wrong probability wearing the same confident badge.
   *
   * MEASURED at `c356531d`, before this refusal:
   *   "Decrease annual costs from £4 million today to £3 million within 12
   *    months"                -> threshold 0.8, goal_baseline 1.0667 (a
   *                              baseline ABOVE its own cap)
   *   "…to 0 within 12 months" -> threshold 0, cap undefined — an UN-NORMALISED
   *                              zero beside a normalised world
   *   "Our target is 3%, currently at 5%." -> 0.03 under 0.05, and this one is
   *                              PRE-EXISTING pattern-2 behaviour, which is why
   *                              the refusal sits at the shared resolution point
   *                              rather than on pattern 4 alone.
   */
  const DECREASES: ReadonlyArray<readonly [string, string]> = [
    ['decrease verb, currency', 'Decrease annual costs from £4 million today to £3 million within 12 months'],
    ['decrease to zero', 'Decrease annual waste from £4 million today to 0 within 12 months'],
    ['drop verb, percent', 'Drop annual churn from 5% to 3% within 12 months'],
    ['from-to-target shape', 'Grow revenue from 6000000 to a target of 4000000'],
    ['pattern 2 (PRE-EXISTING, not introduced here)', 'Our target is 3%, currently at 5%.'],
    ['pattern 3 (PRE-EXISTING, not introduced here)', 'Currently at 500 customers, target 300.'],
  ];

  it.each(DECREASES)('refuses: %s', (_n, brief) => {
    expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
  });

  it.each(DECREASES)('mints nothing on the wire: %s', async (_n, brief) => {
    const { contract } = await runToWire(brief);
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

  it('POSITIVE CONTROL — the same shapes INCREASING still extract', () => {
    // Trap 13: the refusals above must be the direction talking, not the shape
    // having stopped matching altogether.
    const up: ReadonlyArray<readonly [string, number, number]> = [
      ['Increase annual costs from £3 million today to £4 million within 12 months', 4_000_000, 3_000_000],
      ['Grow revenue from 4000000 to a target of 6000000', 6_000_000, 4_000_000],
      ['Our target is 5%, currently at 3%.', 0.05, 0.03],
      ['Currently at 300 customers, target 500.', 500, 300],
    ];
    for (const [brief, value, baseline] of up) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r, `expected a pair for: ${brief}`).not.toBeNull();
      expect(r!.value, brief).toBe(value);
      expect(r!.baseline, brief).toBe(baseline);
    }
  });

  it('EQUALITY is not refused — "hold the line" is a meaningful goal', () => {
    const r = extractGoalTargetWithBaseline('Currently at 500 customers, target 500.');
    expect(r?.value).toBe(500);
    expect(r?.baseline).toBe(500);
  });
});

/* =========================================================================
 * A3 — THE SUPPRESSION BINDS BY SPAN, NOT BY VALUE (trap 19)
 * ======================================================================= */

describe('ROADMAP 2.353 — a same-valued goal-word factor elsewhere survives', () => {
  it('an "Alert threshold is 6 million" beside a 6M target is NOT collateral', () => {
    // MEASURED at `c356531d`: the suppression compared VALUES, so a different
    // statement that merely shared the target's number satisfied it and
    // vanished. Trap 19 — bind by identity (here, position), never by a value
    // predicate another object can satisfy.
    const brief =
      'Increase annual revenue from £4 million today to £6 million within 12 months. ' +
      'Alert threshold is 6 million.';
    const factors = extractFactors(brief);

    const targets = factors.filter((f) => /^target$/i.test(f.label));
    expect(targets).toHaveLength(1);
    expect(targets[0].value).toBe(6_000_000);
    expect(targets[0].baseline).toBe(4_000_000);

    const thresholds = factors.filter((f) => /^threshold$/i.test(f.label));
    expect(thresholds, 'the alert threshold was suppressed as collateral').toHaveLength(1);
    expect(thresholds[0].value).toBe(6_000_000);
  });

  it('the duplicate INSIDE the resolved construction is still dropped', () => {
    // The control for the above: span-overlap must still suppress the
    // baseline-less duplicate the pair itself produced.
    const factors = extractFactors('Grow revenue from 4000000 to a target of 6000000 this year.');
    const targets = factors.filter((f) => /^target$/i.test(f.label));
    expect(targets).toHaveLength(1);
    expect(targets[0].baseline).toBe(4_000_000);
  });
});

/* =========================================================================
 * A4 — A TRAILING ADVERB IS NOT A METRIC NOUN
 * ======================================================================= */

describe('ROADMAP 2.353 — trailing adverbs do not manufacture a mismatch', () => {
  it('extracts through a trailing adverb, by MORPHOLOGY not by a list', () => {
    // MEASURED at `c356531d`: "eventually" was read as a metric noun, so a £
    // baseline against a noun-bearing target refused via currency_vs_metric_noun
    // and the 6M was lost entirely. The stopword list had already been patched
    // twice for -ly forms; it is now a derived rule.
    const cases: ReadonlyArray<readonly [string, number, number]> = [
      ['Increase revenue from £4M to 6M eventually', 6_000_000, 4_000_000],
      ['Increase revenue from £4M to 6M ultimately', 6_000_000, 4_000_000],
      ['Increase annual revenue from £4 million to 6M sustainably within 12 months', 6_000_000, 4_000_000],
      ['Increase annual revenue from £4 million to £6 million profitably by year end', 6_000_000, 4_000_000],
    ];
    for (const [brief, value, baseline] of cases) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r, `regressed — no pair for: ${brief}`).not.toBeNull();
      expect(r!.value, brief).toBe(value);
      expect(r!.baseline, brief).toBe(baseline);
      expect(r!.unit, brief).toBe('£');
    }
  });

  it('PRESERVED — the -ly forms the old hand-list carried still behave', () => {
    // "annually"/"quarterly" were hand-added stopwords; the derived rule must
    // cover exactly what they covered.
    for (const brief of [
      'Currently at £4M, and our target is 6M annually.',
      'Currently at £4M, and our target is 6M quarterly.',
      'Currently at £4M, and our target is 6M monthly.',
    ]) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r?.value, brief).toBe(6_000_000);
      expect(r?.baseline, brief).toBe(4_000_000);
    }
  });

  it('DISCLOSED IMPRECISION — an -ly NOUN reads as an adverb', () => {
    // "supply" ends in -ly and is a genuine noun. The derived rule reads it as
    // an adverb, so it stops contributing to a cross-metric refusal and this
    // pair now EXTRACTS where it previously refused. Bounded and
    // one-directional: it cannot invent a number or pair across clauses. Pinned
    // so the cost is visible rather than discovered.
    const r = extractGoalTargetWithBaseline(
      'Increase the supply from $50 to 800 supply within 12 months',
    );
    expect(r?.value, 'the disclosed imprecision changed — re-read the note').toBe(800);
    expect(r?.baseline).toBe(50);

    // The CONTROL: a non-"-ly" noun on the same shape still refuses, so the
    // cross-metric guard as a whole is intact.
    expect(
      extractGoalTargetWithBaseline(
        'Increase the supply from $50 to 800 widgets within 12 months',
      ),
      'the cross-signal refusal itself regressed',
    ).toBeNull();
  });
});

/* =========================================================================
 * ROADMAP 2.371(b) — THE OPTIONALITY GUARD, AND THE CORPUS THAT SIZES IT
 *
 * #807's guard was `(?:could|might|may|can|perhaps|maybe)` consumed as a
 * LOOKBEHIND IMMEDIATELY BEFORE THE VERB. The re-review reported one escaping
 * phrasing; MEASURED at `7bdf30ff` there were TWENTY-TWO of twenty-five, and
 * six of them carried a LISTED modal — the adjacency was a bigger hole than
 * the vocabulary. Every entry below minted `{value: 59, baseline: 49,
 * unit: '£'}` at confidence 0.95 on a graph whose goal is "Grow annual
 * revenue": a fabricated goal contract out of a sentence proposing a PRICE.
 *
 * ⚠ THIS CORPUS IS THE HALF NO DERIVATION CAN SUPPLY (CLAUDE.md 12d, second
 * face). `PROPOSAL_FRAME_MARKERS` is a list, and a guard derived from a list
 * proves its consumers AGREE with the list — never that the list is RIGHT.
 * Only hand-written phrasings notice it is short. Deleting a marker from the
 * canonical array must turn entries here RED; that is the proof obligation,
 * and it is executed as a mutant, not asserted here.
 * ======================================================================= */

describe('ROADMAP 2.371(b) — a proposal is not a commitment', () => {
  /**
   * Hand-written, one phrasing per marker family, each a shape a person
   * actually writes. The two flagged MEASURED-LISTED-MODAL entries are the
   * ones that prove the defect was positional as well as lexical: their marker
   * was already in #807's closed list and they minted anyway.
   */
  const LEVER_CORPUS: ReadonlyArray<readonly [string, string]> = [
    // — the re-review's reported case, verbatim —
    ['would consider', 'we would consider increasing the price from £49 to £59 this year'],
    // — MEASURED-LISTED-MODAL: the marker was listed; only its POSITION saved it —
    ['could consider (listed modal, non-adjacent)', 'We could consider increasing the price from £49 to £59 this year'],
    ['can also (listed modal, non-adjacent)', 'We can also increase the price from £49 to £59 this year'],
    ['may want to (listed modal, non-adjacent)', 'We may want to increase the price from £49 to £59 this year'],
    ['perhaps, fronted (listed modal, non-adjacent)', 'Perhaps we increase the price from £49 to £59 this year'],
    ['maybe, fronted (listed modal, non-adjacent)', 'Maybe we increase the price from £49 to £59 this year'],
    ['could + a decimal in between', 'We could raise it by 2.5x and increase the price from £49 to £59 this year'],
    // — epistemic modals and adverbs —
    ['would', 'We would increase the price from £49 to £59 this year'],
    ['possibly', 'We possibly increase the price from £49 to £59 this year'],
    ['potentially', 'We potentially increase the price from £49 to £59 this year'],
    // — deliberation verbs —
    ['considering', 'We are considering increasing the price from £49 to £59 this year'],
    ['thinking of', 'We are thinking of increasing the price from £49 to £59 this year'],
    ['weighing', 'We are weighing increasing the price from £49 to £59 this year'],
    ['exploring', 'We want to explore increasing the price from £49 to £59 this year'],
    ['evaluating', 'We are evaluating increasing the price from £49 to £59 this year'],
    ['contemplating', 'We are contemplating increasing the price from £49 to £59 this year'],
    ['debating', 'We are debating increasing the price from £49 to £59 this year'],
    ['mulling', 'We are mulling increasing the price from £49 to £59 this year'],
    ['looking at', 'We are looking at increasing the price from £49 to £59 this year'],
    ['toying with', 'We are toying with increasing the price from £49 to £59 this year'],
    ['tempted', 'We are tempted to increase the price from £49 to £59 this year'],
    // — proposal nouns and hypothetical frames —
    ['option to', 'We have the option to increase the price from £49 to £59 this year'],
    ['one option is', 'One option is to increase the price from £49 to £59 this year'],
    ['an alternative', 'An alternative is to increase the price from £49 to £59 this year'],
    ['the proposal', 'The proposal is to increase the price from £49 to £59 this year'],
    ['in one scenario', 'In one scenario we increase the price from £49 to £59 this year'],
    ['a possibility', 'A possibility is to increase the price from £49 to £59 this year'],
    ['suggestion', 'My suggestion is to increase the price from £49 to £59 this year'],
    ['what if', 'What if we increase the price from £49 to £59 this year?'],
    ['suppose', 'Suppose we increase the price from £49 to £59 this year'],
    ['if we', 'If we increase the price from £49 to £59 this year, revenue rises'],
    ['should we (INVERTED — bare "should" is a commitment)', 'Should we increase the price from £49 to £59 this year?'],
    ['could we (inverted)', 'Could we increase the price from £49 to £59 this year?'],
  ];

  it.each(LEVER_CORPUS)('forms no goal pair: %s', (_n, brief) => {
    expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
  });

  it.each(LEVER_CORPUS)('mints NOTHING goal-labelled: %s', (_n, brief) => {
    // Bound by IDENTITY to the labels `isTargetGoalLabel` routes to the mint —
    // not by a count, and not by a value predicate some other factor could
    // satisfy. The ordinary "Price" factor these sentences carry is expected
    // and must survive; only the goal contract is forbidden.
    const goalLabelled = extractFactors(brief).filter((f) =>
      /^(?:target|goal|objective|threshold)$/i.test(f.label),
    );
    expect(goalLabelled.map((f) => `${f.label}=${f.value}`), brief).toEqual([]);
  });

  it.each(LEVER_CORPUS)('mints nothing on the wire (pristine parity): %s', async (_n, brief) => {
    const { contract } = await runToWire(brief);
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

  /**
   * ⭐ THE POSITIVE CONTROL, and it is the load-bearing half of this describe
   * (CLAUDE.md trap 13). Every assertion above is an ABSENCE, and a guard that
   * refused EVERYTHING would satisfy all of them while destroying the
   * capability #807 shipped. These are commitment phrasings on the SAME
   * sentence shape: they must still mint, in full.
   *
   * ⚠ AND THEY ENCODE #807'S DELIBERATE EXCLUSIONS. Its note reads "Deliberately
   * NOT including 'should', 'must', 'need to' or 'aim to' — those state intent".
   * 2.371's brief proposed adding bare `should`; that would have broken
   * `should` below, so it was NOT added and the interrogative phrase `should we`
   * was added instead. The distinguishing signal is the subject-verb inversion,
   * not the modal. This block is what makes that a measured decision rather
   * than a preference.
   */
  const COMMITMENTS: ReadonlyArray<readonly [string, string, number, number]> = [
    ['should', 'We should increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['must', 'We must increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['aim to', 'We aim to increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['need to', 'We need to increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['will', 'We will increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['want to', 'We want to increase revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['committed to', 'We are committed to increasing revenue from £4M to £6M within 12 months', 6_000_000, 4_000_000],
    ['plan (goal-word anchored)', 'Our plan is to raise the target from £600,000 to £800,000', 800_000, 600_000],
    ['bare, case A', 'Increase annual revenue from £4 million today to £6 million within 12 months', 6_000_000, 4_000_000],
    ['bare, case B', 'Raise the target from £600,000 to £800,000', 800_000, 600_000],
  ];

  it.each(COMMITMENTS)('STILL MINTS — %s', (_n, brief, value, baseline) => {
    const r = extractGoalTargetWithBaseline(brief);
    expect(r, `the guard swallowed a commitment: ${brief}`).not.toBeNull();
    expect(r!.value, brief).toBe(value);
    expect(r!.baseline, brief).toBe(baseline);
  });

  /**
   * The DERIVED half (12d, first face): every marker the canonical array
   * carries is WIRED. It iterates the array itself, so a marker added tomorrow
   * is exercised the instant it lands — and it is structurally blind to the
   * array being short, which is what `LEVER_CORPUS` above is for. Neither
   * supersedes the other.
   */
  it('every canonical marker actually disarms the grammar', () => {
    expect(PROPOSAL_FRAME_MARKERS.length, 'the marker set is empty').toBeGreaterThan(0);
    for (const marker of PROPOSAL_FRAME_MARKERS) {
      const framed = `Right now ${marker} we increase annual revenue from £4 million to £6 million within 12 months`;
      expect(
        extractGoalTargetWithBaseline(framed),
        `the marker '${marker}' is listed but does not disarm the grammar`,
      ).toBeNull();
    }
    // The control for the frame itself: without a marker, the very same
    // sentence mints. Without this the loop above could pass on a sentence
    // that never extracted for an unrelated reason (trap 13).
    const unframed = extractGoalTargetWithBaseline(
      'Right now we increase annual revenue from £4 million to £6 million within 12 months',
    );
    expect(unframed?.value, 'the control frame does not extract — the loop above proves nothing').toBe(
      6_000_000,
    );
  });

  /**
   * ⚠ A UNION ASSERTION PINNED TO A HISTORICAL ARTEFACT, NOT TO "WHATEVER IS
   * CURRENT" (CLAUDE.md 12b). These six spellings are #807's shipped closed
   * list, copied here by value and permanently. Deriving this from the live
   * array would make it a tautology the moment the array changed — the exact
   * way the prompt-drift controls hollowed themselves out. Its job is to make
   * the guard a RATCHET: the set may only grow.
   */
  it('the canonical set can never shrink below what #807 shipped', () => {
    for (const shipped of ['could', 'might', 'may', 'can', 'perhaps', 'maybe']) {
      expect(
        PROPOSAL_FRAME_MARKERS,
        `#807's closed list lost '${shipped}' — the guard went backwards`,
      ).toContain(shipped);
    }
  });
});

describe('ROADMAP 2.371(b) — the guard reads ONE CLAUSE, not the brief', () => {
  /**
   * ⚠ THE SCOPE BOUND IS LOAD-BEARING IN BOTH DIRECTIONS, and getting it wrong
   * either way re-creates a measured defect:
   *
   *   TOO WIDE (brief-scoped) → a lever sentence's "could" deletes a genuine
   *     goal later in the same brief, which is review A1's steal case arriving
   *     by a different road.
   *   TOO NARROW (token-adjacent) → #807's lookbehind, i.e. the defect this row
   *     closes.
   */
  it('a lever sentence does not poison a genuine goal in the NEXT sentence', async () => {
    const brief =
      'We could consider increasing the price from £49 to £59 this year. ' +
      'Increase annual revenue from £4 million today to £6 million within 12 months.';
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair?.value, 'the proposal frame leaked across the full stop').toBe(6_000_000);
    expect(pair?.baseline).toBe(4_000_000);

    const { contract } = await runToWire(brief);
    expect(contract.goal_threshold_raw).toBe(6_000_000);
    expect(contract.goal_baseline_raw).toBe(4_000_000);
  });

  it('a NEWLINE ends the clause — briefs arrive as bulleted lists', () => {
    const r = extractGoalTargetWithBaseline(
      'We could cut costs\nIncrease annual revenue from £4 million to £6 million within 12 months',
    );
    expect(r?.value, 'a "could" on an earlier LINE deleted a goal').toBe(6_000_000);
  });

  it('a SEMICOLON ends the clause', () => {
    const r = extractGoalTargetWithBaseline(
      'We could cut costs; increase annual revenue from £4 million to £6 million within 12 months',
    );
    expect(r?.value).toBe(6_000_000);
  });

  it('a DECIMAL POINT does not end the clause — and the error direction is fabrication', () => {
    // Treating "2.5" as a sentence boundary would shorten the scope, drop the
    // `could`, and mint 59/49. MEASURED at `7bdf30ff` (where the lookbehind
    // could not see across "raise it by 2.5x and"): it minted exactly that.
    expect(
      extractGoalTargetWithBaseline(
        'We could raise it by 2.5x and increase the price from £49 to £59 this year',
      ),
    ).toBeNull();

    // The same shape with decimals INSIDE the amounts, so the scanner is
    // exercised on the numbers it must not treat as boundaries either.
    expect(
      extractGoalTargetWithBaseline('We could increase the price from £49.00 to £59.50 this year'),
    ).toBeNull();
  });

  it('a COMMA does not end the clause — the frame governs the whole sentence', () => {
    // Deliberately NOT a boundary, unlike `.` `;` `\n`: a comma separates parts
    // of ONE statement, and admitting it would let the marker fall out of scope
    // and mint the lever.
    //
    // ⚠ THE FIRST TWO BRIEFS ARE HERE BECAUSE THIS LANE'S OWN MUTANT BATTERY
    // CAUGHT THE ORIGINAL PIN NOT BINDING. It read "Revenue is flat, so we
    // could increase the price…", where `could` sits AFTER the comma — so the
    // comma rule made no difference to it and the mutant that adds `,` to the
    // boundary set left the whole file 207/207 GREEN. A pin for a rule must put
    // the rule's subject on the far side of the thing it governs. Both briefs
    // below carry their marker BEFORE the comma, and both minted 59/49 at
    // `7bdf30ff`.
    for (const brief of [
      'We could, if the board agrees, increase the price from £49 to £59 this year',
      'One option, which the team likes, is to increase the price from £49 to £59 this year',
      'Revenue is flat, so we could increase the price from £49 to £59 this year',
    ]) {
      expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();
    }

    // The control, so the rule is not proven by refusing everything with a
    // comma in it: an unframed sentence carrying a comma still mints.
    expect(
      extractGoalTargetWithBaseline(
        'Revenue is flat, and we will increase annual revenue from £4 million to £6 million within 12 months',
      )?.value,
    ).toBe(6_000_000);
  });

  it('DISCLOSED COST — a DECIDED statement about a lever metric still forms a pair', () => {
    // The guard's remit is FRAMING, not metric semantics. "We plan to increase
    // the price…" is a commitment by every signal the sentence carries; telling
    // a lever metric from a goal metric needs the GRAPH, not the sentence, and
    // is REPORTED as a residual of this slice, not fixed by it. Pinned so the
    // cost is visible rather than
    // discovered, and so a later widening of the marker list to cover it is a
    // decision someone has to make against this test.
    const r = extractGoalTargetWithBaseline(
      'We plan to increase the price from £49 to £59 this year',
    );
    expect(r?.value, 'the disclosed cost changed — re-read the note').toBe(59);
    expect(r?.baseline).toBe(49);
  });

  it('DISCLOSED SCOPE — the guard is on the ANCHORED pattern, not on patterns 1-3', () => {
    // Patterns 1-3 require an EXPLICIT goal word ("to a TARGET of £6M"), which
    // is a far stronger signal than pattern 4's anchor, and #807 put the
    // optionality guard on pattern 4 alone. MEASURED at `7bdf30ff` and
    // unchanged here, so the slice's blast radius is stated rather than
    // implied: a proposal-framed sentence that NAMES its target still pairs.
    const r = extractGoalTargetWithBaseline('We could grow revenue from £4M to a target of £6M');
    expect(r?.value, 'pattern 1 behaviour moved — that is not this slice').toBe(6_000_000);
    expect(r?.baseline).toBe(4_000_000);
  });
});

/* =========================================================================
 * THE HORIZON ANCHOR READS ORDINARY DEADLINES
 * (2.353 family — found by Codex on 4 Aug, live, on BOTH briefs it wrote)
 *
 * The horizon is not decoration: since #807/#809 it is a GOAL ANCHOR, and a
 * from-to sentence carrying no anchor mints NOTHING. So a gap in the horizon
 * vocabulary is not a lost date — it is a LOST TARGET, and the user is then
 * asked to supply a number their brief already contained. Codex hit exactly
 * that, twice out of two:
 *
 *   "Grow MRR from £180k to £250k by 31 Dec 2026"     -> null at `a6f52ac6`
 *   "Grow ARR from £4.2m to £6m by 30 June 2027"      -> null at `a6f52ac6`
 *
 * Two classes were missing, and both are measured RED at `a6f52ac6` in the
 * evidence file (PHASE0-EVIDENCE-2026-07-28/l59-horizon-dates.md):
 *
 *   1. CALENDAR DATES. The `by` branch took a broad period, an H/Q, or a bare
 *      four-digit year, and nothing else.
 *   2. FIVE OF THE TWELVE NUMBER WORDS. Three branches each hand-typed
 *      `one|two|three|four|six|nine|twelve` — three copies of one list, all
 *      three short of five/seven/eight/ten/eleven (trap 12).
 *
 * ⚠ THE DIRECTION OF THIS WIDENING, stated because widening a goal grammar is
 * how the 2.353 family's worst defects arrived: the anchor asks whether a
 * sentence NAMES a goal. `isProposalFramed` (#809), the direction refusal and
 * the comparability refusals are all DOWNSTREAM and untouched by this slice. A
 * wider anchor therefore admits more GOALS; it cannot admit a lever that those
 * guards would otherwise have caught. The negative control at the foot of this
 * block is what holds that claim to account, and it is paired with a positive
 * control so it cannot pass by the date simply going unrecognised (trap 13).
 * ======================================================================= */

/** Hand-computed from the cap doctrine: no '%' and no existing cap ⇒ raw × 1.25. */
const HORIZON_FAMILY: ReadonlyArray<{
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
    // ⭐ CODEX'S FIRST LIVE BRIEF, VERBATIM.
    name: 'CODEX-1 · "by 31 Dec 2026" — abbreviated month, day first',
    brief: 'Grow MRR from £180k to £250k by 31 Dec 2026',
    target: 250_000,
    baseline: 180_000,
    unit: '£',
    cap: 312_500, //             250_000 × 1.25
    threshold: 0.8, //           250_000 ÷ 312_500
    normalisedBaseline: 0.576, // 180_000 ÷ 312_500
  },
  {
    // ⭐ CODEX'S SECOND LIVE BRIEF, VERBATIM.
    name: 'CODEX-2 · "by 30 June 2027" — full month, day first',
    brief: 'Grow ARR from £4.2m to £6m by 30 June 2027',
    target: 6_000_000,
    baseline: 4_200_000,
    unit: '£',
    cap: 7_500_000, //            6_000_000 × 1.25
    threshold: 0.8,
    normalisedBaseline: 0.56, //  4_200_000 ÷ 7_500_000
  },
  {
    name: 'DATE · "by 31 December 2026" — full month spelled out',
    brief: 'Increase annual revenue from £4 million to £6 million by 31 December 2026',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'DATE · "by 31/12/2026" — all-numeric, slashes',
    brief: 'Increase annual revenue from £4 million to £6 million by 31/12/2026',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'DATE · "by December 2026" — month and year, no day',
    brief: 'Increase annual revenue from £4 million to £6 million by December 2026',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'DATE · "by Dec 31, 2026" — month first, comma',
    brief: 'Increase annual revenue from £4 million to £6 million by Dec 31, 2026',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'DATE · "by 31st March 2027" — ordinal suffix',
    brief: 'Increase annual revenue from £4 million to £6 million by 31st March 2027',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    // ⚠ DISCLOSED: this ONE entry was already GREEN at `a6f52ac6`, because
    // "2026-12-31" satisfied the bare `\d{4}` alternative on its first four
    // characters and left "-12-31" trailing. It is in the corpus as a
    // REGRESSION PIN, not as part of the RED set — the evidence file records
    // which entries were red and which were not, so the RED-first claim for
    // this block is not inflated by it.
    name: 'DATE · "by 2026-12-31" — ISO (already anchored at base, pinned anyway)',
    brief: 'Increase annual revenue from £4 million to £6 million by 2026-12-31',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'WORD · "within five months" — the smallest missing number word',
    brief: 'Increase annual revenue from £4 million to £6 million within five months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'WORD · "in eleven months"',
    brief: 'Increase annual revenue from £4 million to £6 million in eleven months',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'WORD · "within seven weeks" — a different unit',
    brief: 'Increase annual revenue from £4 million to £6 million within seven weeks',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'WORD · "over the next ten years" — the third branch',
    brief: 'Increase annual revenue from £4 million to £6 million over the next ten years',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
  {
    name: 'WORD · "within eight quarters"',
    brief: 'Increase annual revenue from £4 million to £6 million within eight quarters',
    target: 6_000_000,
    baseline: 4_000_000,
    unit: '£',
    cap: 7_500_000,
    threshold: 0.8,
    normalisedBaseline: 0.5333333333333333,
  },
];

describe('2.353 family — a dated or spelled deadline anchors the goal', () => {
  it.each(HORIZON_FAMILY)('EXTRACTION · $name', ({ brief, target, baseline, unit }) => {
    const pair = extractGoalTargetWithBaseline(brief);
    expect(pair, `no (target, baseline) pair formed for: ${brief}`).not.toBeNull();
    expect(pair!.value, brief).toBe(target);
    expect(pair!.baseline, brief).toBe(baseline);
    expect(pair!.unit, brief).toBe(unit);
  });

  it.each(HORIZON_FAMILY)('LABEL ROUTING · $name', ({ brief, target, baseline, unit }) => {
    const factors = extractFactors(brief);
    const targets = factors.filter((f) => /^target$/i.test(f.label));
    expect(targets, `expected exactly one "Target" factor for: ${brief}`).toHaveLength(1);
    expect(targets[0].value, brief).toBe(target);
    expect(targets[0].baseline, brief).toBe(baseline);
    expect(targets[0].unit, brief).toBe(unit);
    expect(targets[0].confidence, brief).toBe(0.95);
    expect(targets[0].extractionType, brief).toBe('explicit');
  });

  it.each(HORIZON_FAMILY)(
    'END TO END · $name',
    async ({ brief, target, baseline, unit, cap, threshold, normalisedBaseline }) => {
      const { contract, v3, sweepStrips } = await runToWire(brief);

      // The whole contract BY IDENTITY, exactly as the 2.353 FAMILY above does.
      // Extraction alone is not the fix: a mint that Stage 4b sweeps back off
      // is still a user with no target, and only this can see that.
      expect(contract, brief).toEqual({
        goal_threshold: threshold,
        goal_threshold_raw: target,
        goal_threshold_unit: unit,
        goal_threshold_cap: cap,
        goal_threshold_frame: 'level',
        goal_baseline: normalisedBaseline,
        goal_baseline_raw: baseline,
      });
      expect(sweepStrips, `Stage 4b stripped the mint for: ${brief}`).toBe(0);

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
});

describe('2.353 family — the spelled-duration map is ONE list, and it is complete', () => {
  /**
   * THE DERIVED HALF (12d, first face). It iterates the canonical map, so a
   * word added tomorrow is exercised in all three duration branches the instant
   * it lands — and, as 12d says in as many words, it is structurally blind to
   * the map being SHORT. That blindness is why the two tests below it exist.
   */
  it('EVERY word in the map anchors a goal, in all three duration branches', () => {
    expect(Object.keys(DURATION_NUMBER_WORDS).length, 'the map is empty').toBeGreaterThan(0);
    for (const word of Object.keys(DURATION_NUMBER_WORDS)) {
      for (const frame of [
        `within ${word} months`,
        `in ${word} months`,
        `over the next ${word} months`,
      ]) {
        const brief = `Increase annual revenue from £4 million to £6 million ${frame}`;
        const r = extractGoalTargetWithBaseline(brief);
        expect(r, `the number word '${word}' does not anchor: ${brief}`).not.toBeNull();
        expect(r!.value, brief).toBe(6_000_000);
        expect(r!.baseline, brief).toBe(4_000_000);
      }
    }
  });

  /**
   * ⭐ THE COMPLETENESS HALF, AND IT IS THE ONE 12d SAYS A DERIVATION CANNOT
   * SUPPLY.
   *
   * Iterating the keys can only ever ask about words the map ALREADY HAS —
   * delete `five` and the test above stays green, exactly as deleting
   * `million` left the magnitude alphabet's per-key guard green. What makes
   * this map different is that its VALUES carry the completeness contract: a
   * spelled-number list is complete iff its values are the contiguous run
   * 1…12. That is checkable without a second copy of the words, so it is not a
   * hand-maintained mirror — and it REDs on a deleted key where the derived
   * guard above cannot.
   *
   * It is still not the whole answer: it would not notice the RANGE being
   * wrong (a map of 1…6 is internally consistent). `HORIZON_FAMILY` is the
   * third check, and it spells five/seven/eight/ten/eleven by hand.
   */
  it('the values are the contiguous run 1…12 — a deleted word is a HOLE, not a shorter list', () => {
    const values = Object.values(DURATION_NUMBER_WORDS).slice().sort((a, b) => a - b);
    expect(values, 'the spelled-number map is no longer 1…12 — a word was lost or the range moved').toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
  });

  it('every word maps to its own number — no two words share a value', () => {
    expect(new Set(Object.values(DURATION_NUMBER_WORDS)).size).toBe(
      Object.keys(DURATION_NUMBER_WORDS).length,
    );
  });

  it('PRESERVED — the digit and article forms the branches already took still work', () => {
    // The three branches were rewritten onto one shared count slot. Everything
    // they accepted before must still be accepted, or this "de-duplication"
    // quietly cost a capability.
    //
    // ⚠ "an" is NOT exercised here, and the reason is a finding rather than an
    // omission: the pristine `within` and `in` branches both listed it, but the
    // unit set is day/week/month/quarter/year and none of those is
    // vowel-initial, so no sentence can reach it. It is carried forward
    // verbatim in `DURATION_COUNT` rather than dropped, because removing dead
    // vocabulary is a separate decision from fixing a live gap.
    for (const frame of [
      'within 12 months',
      'within the next 6 months',
      'in a month',
      'within a quarter',
      'over the next 3 years',
      'by year end',
      'by the end of this quarter',
      'by Q4',
      'by H2',
      'by 2026',
      'this year',
      'eventually',
    ]) {
      const brief = `Increase annual revenue from £4 million to £6 million ${frame}`;
      expect(extractGoalTargetWithBaseline(brief)?.value, brief).toBe(6_000_000);
    }
  });
});

describe('2.353 family — a wider horizon does not widen the LEVER class', () => {
  /**
   * ⭐ THE NEGATIVE CONTROL AND ITS TRAP-13 PARTNER, WHICH ONLY MEAN ANYTHING
   * TOGETHER.
   *
   * The negative control on its own is worthless here: at `a6f52ac6` the
   * modal-framed sentence returned null because the DATE WAS NOT A HORIZON, and
   * a control that passes for the wrong reason is the shape this programme
   * keeps finding. So the same sentence is asserted twice — once framed as a
   * proposal (must mint nothing, and that must be `isProposalFramed` talking)
   * and once unframed (must anchor, proving the date is genuinely live).
   */
  it('a LEVER with a calendar date mints NOTHING — the proposal guard still fires', async () => {
    const brief = 'We could raise the price from £49 to £59 by 31 Dec 2026';
    expect(extractGoalTargetWithBaseline(brief), brief).toBeNull();

    const { contract } = await runToWire(brief);
    expect(contract, brief).toEqual({
      goal_threshold: undefined,
      goal_threshold_raw: undefined,
      goal_threshold_unit: undefined,
      goal_threshold_cap: undefined,
      goal_threshold_frame: undefined,
      goal_baseline: undefined,
      goal_baseline_raw: undefined,
    });

    const factors = extractFactors(brief);
    expect(
      factors.filter((f) => /^(?:target|goal|objective|threshold)$/i.test(f.label)),
    ).toHaveLength(0);
  });

  it('every proposal-framed marker still disarms a DATED sentence', () => {
    // The derived guard, re-run on the new horizon class: the anchor widened,
    // so every marker must still hold against it. Blind to the marker list
    // being short — `LEVER_CORPUS` above is that half — but not blind to the
    // date having routed around the guard entirely.
    for (const marker of PROPOSAL_FRAME_MARKERS) {
      expect(
        extractGoalTargetWithBaseline(
          `Right now ${marker} we increase annual revenue from £4 million to £6 million by 31 Dec 2026`,
        ),
        `the marker '${marker}' stopped disarming once the horizon was a date`,
      ).toBeNull();
    }
  });

  it('POSITIVE CONTROL — the same date DOES anchor once the modal is removed', () => {
    // ⚠ Trap 13, and it is load-bearing: without this, the two assertions above
    // would pass unchanged on a build where the calendar-date alternative was
    // deleted. It also DISCLOSES a pre-existing cost rather than hiding it —
    // see the next test.
    const r = extractGoalTargetWithBaseline('Raise the price from £49 to £59 by 31 Dec 2026');
    expect(r?.value, 'the calendar date is not anchoring — the controls above prove nothing').toBe(59);
    expect(r?.baseline).toBe(49);
  });

  it('DISCLOSED, PRE-EXISTING — a bare-imperative lever with ANY horizon already pairs', () => {
    // MEASURED at `a6f52ac6`, BEFORE this slice: an imperative lever carrying an
    // ALREADY-ACCEPTED horizon forms a pair. The horizon anchor admits it and
    // no modal is present for `isProposalFramed` to catch.
    //
    //   "Raise the price from £49 to £59 this year"        -> 59 / 49  (at base)
    //   "Raise the price from £49 to £59 by 2026"          -> 59 / 49  (at base)
    //   "increasing ad spend from £200k to £300k this year" -> 300k / 200k (at base)
    //
    // This slice extends that EXISTING class to dated deadlines; it does not
    // create it, and it is out of scope here (fixing it means telling a lever
    // metric from a goal metric, which needs the GRAPH — the residual already
    // rowed at 2.371's "decided-lever statements still pair"). Pinned so the
    // cost is visible rather than discovered, and so the next lane cannot
    // mistake it for something this one introduced.
    for (const [brief, value, baseline] of [
      ['Raise the price from £49 to £59 this year', 59, 49],
      ['Raise the price from £49 to £59 by 2026', 59, 49],
      ['increasing ad spend from £200k to £300k this year', 300_000, 200_000],
    ] as ReadonlyArray<readonly [string, number, number]>) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r?.value, `PRE-EXISTING behaviour moved — re-read the note: ${brief}`).toBe(value);
      expect(r?.baseline, brief).toBe(baseline);
    }
  });

  it('a date does not make a DECREASE mintable — the direction refusal is upstream-independent', () => {
    expect(
      extractGoalTargetWithBaseline(
        'Decrease annual costs from £4 million to £3 million by 31 Dec 2026',
      ),
    ).toBeNull();
  });

  it('a date does not reconcile a MIXED percent pair', () => {
    expect(
      extractGoalTargetWithBaseline(
        'Increase annual retention from 85 today to 95% by 31 Dec 2026',
      ),
    ).toBeNull();
  });

  it('a bare year without a month is NOT a date — a two-digit year cannot pass as one', () => {
    // The date shapes are bounded to FOUR-digit years on purpose. "12/26" is a
    // price, a ratio or a reference — not a deadline — and admitting it would
    // turn arbitrary slashed numbers into goal anchors.
    expect(
      extractGoalTargetWithBaseline(
        'Increase annual revenue from £4 million to £6 million by 12/26',
      ),
      'a two-digit year was accepted as a calendar date',
    ).toBeNull();
  });
});
