/**
 * ROADMAP 2.273 — the goal node reaches the wire WITH a baseline, so ISL can
 * convert a 'level' threshold instead of refusing.
 *
 * SUCCESSOR TO `goal-baseline-absent-characterisation.test.ts`, deleted in the
 * same commit. That file pinned the absence and declared its own lifecycle:
 * "the moment anything starts populating a goal baseline, these assertions RED
 * and whoever did it must come here, delete this file, and close the follow-up
 * row." Both of its gap assertions REDed as designed
 * (`expected 4000000 to be undefined`, then
 * `expected { value: 0.5333333333333333, … } to be undefined`) before it was
 * retired. Its POSITIVE CONTROL — that `observed_state` is genuinely built for
 * nodes which have the data — is carried forward below rather than dropped,
 * because without it "the goal HAS a baseline" could pass in a world where the
 * transform stamped one on everything.
 *
 * WHAT ISL DOES WITH IT, derived at ISL staging head `29cb4e27`
 * (`src/services/robustness_analyzer_v2.py`,
 * `_resolve_goal_threshold_in_sample_frame`):
 *
 *     3206:  observed = goal_node.observed_state
 *     3207:  baseline = observed.baseline if observed is not None else None
 *     3208:  if baseline is None: refuse('missing_goal_baseline')
 *     3273:  NORMALISED_DOMAIN_LIMIT = 1.5   # |operand| > 1.5 → refuse
 *     3303:  converted = threshold - baseline + intercept
 *
 * PLoT FORWARDS IT: `baseline` is present in
 * `ISL_DECLARED_OBSERVED_STATE_FIELDS` at PLoT tip `7133bba1`
 * (`src/integrations/isl/translator-v3.ts:274`), the hand-maintained allowlist
 * `toISLObservedState` projects through. Verified read-only at that SHA; it is
 * a hand-mirror, so re-derive rather than trusting this comment.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import { extractFactors, extractGoalTargetWithBaseline } from '../index.js';
import { transformNodeToV3 } from '../../transforms/schema-v3.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
import type { GraphT } from '../../../schemas/graph.js';
import type { V1Node } from '../../transforms/schema-v2.js';

function freshGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

async function goalV3For(brief: string): Promise<Record<string, unknown>> {
  const out = await enrichGraphWithFactorsAsync(freshGraph(), brief);
  const goalV1 = out.graph.nodes.find((n) => n.kind === 'goal');
  return transformNodeToV3(goalV1 as unknown as V1Node) as Record<string, unknown>;
}

describe('ROADMAP 2.273 — goal baseline is EXTRACTED and reaches the wire', () => {
  it('extracts the stated current level as the target factor’s baseline', async () => {
    const factors = (await extractFactors(
      'Grow revenue from 4000000 to a target of 6000000 this year.',
    )) as ReadonlyArray<{ label: string; value: number; baseline?: number }>;

    const target = factors.find((f) => /target/i.test(f.label));
    expect(target?.value).toBe(6_000_000);
    expect(target?.baseline).toBe(4_000_000);
  });

  it('emits exactly ONE target factor (the baseline-less duplicate is deduped)', async () => {
    // The forced "Target" label exists so this extraction's dedup key collides
    // with `contextualNumber`'s for the same phrase. If the label ever drifts,
    // BOTH fire and a second, baseline-LESS target factor is injected — which
    // would then race the first to the goal-threshold mint.
    const factors = (await extractFactors(
      'Grow revenue from 4000000 to a target of 6000000 this year.',
    )) as ReadonlyArray<{ label: string; baseline?: number }>;

    const targets = factors.filter((f) => /^target$/i.test(f.label));
    expect(targets).toHaveLength(1);
    expect(targets[0].baseline).toBeDefined();
  });

  it('WORKED EXAMPLE — baseline and threshold share ONE denominator (hand-computed)', async () => {
    // Brief: "Grow revenue from 4000000 to a target of 6000000 this year."
    //
    //   extraction      target = 6_000_000        baseline = 4_000_000
    //   cap doctrine    no '%', no existing cap → rule 3: 25% headroom
    //                   cap = 6_000_000 * 1.25   = 7_500_000
    //   threshold       6_000_000 / 7_500_000    = 0.8
    //   baseline        4_000_000 / 7_500_000    = 0.5333333333333333
    //   ISL (:3303)     delta = 0.8 - 0.53333… + 0 (intercept)
    //                         = 0.26666666666666666   ( = 4/15 )
    //
    // Both operands are well inside ISL's |1.5| domain guard (:3273), so the
    // conversion is admitted rather than refused.
    const goalV3 = await goalV3For('Grow revenue from 4000000 to a target of 6000000 this year.');
    const observed = goalV3.observed_state as Record<string, number>;

    expect(goalV3.goal_threshold).toBe(0.8);
    expect(goalV3.goal_threshold_frame).toBe('level');
    expect(goalV3.goal_threshold_cap).toBe(7_500_000);

    expect(observed.baseline).toBe(0.5333333333333333);
    expect(observed.raw_value).toBe(4_000_000);
    expect(observed.cap).toBe(7_500_000);

    // The number ISL will actually compute.
    const delta = (goalV3.goal_threshold as number) - observed.baseline;
    expect(delta).toBeCloseTo(4 / 15, 12);
  });

  it('MIS-NORMALISATION GUARD — a raw baseline against a normalised threshold is caught', async () => {
    // THE WRONG-NUMBER CASE. If the mint site ever divides the threshold by the
    // cap but stamps the baseline RAW (or against a separately-derived cap),
    // nothing throws: ISL happily computes `0.8 - 4_000_000` and returns a
    // confident, absurd probability. These two assertions are what bite —
    // the first because a raw 4e6 baseline is not ~0.533, the second because
    // it would blow ISL's |1.5| domain guard at :3273.
    const goalV3 = await goalV3For('Grow revenue from 4000000 to a target of 6000000 this year.');
    const observed = goalV3.observed_state as Record<string, number>;

    const cap = goalV3.goal_threshold_cap as number;
    expect(observed.baseline).toBe(observed.raw_value / cap);
    expect(Math.abs(observed.baseline)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(goalV3.goal_threshold as number)).toBeLessThanOrEqual(1.5);
  });

  it('percentages normalise against 100 — baseline AND threshold together', async () => {
    //   extraction   target = 0.95 (fraction)   baseline = 0.85 (fraction)
    //   enricher     reconstructs raw percent:  95 and 85
    //   cap doctrine rule 2: '%' within 0-100 → cap = 100
    //   threshold    95 / 100 = 0.95            baseline 85 / 100 = 0.85
    //   ISL delta    0.95 - 0.85 = 0.10
    const goalV3 = await goalV3For('Improve retention from 85% to a target of 95%.');
    const observed = goalV3.observed_state as Record<string, number>;

    expect(goalV3.goal_threshold).toBe(0.95);
    expect(goalV3.goal_threshold_cap).toBe(100);
    expect(observed.baseline).toBe(0.85);
    expect(observed.raw_value).toBe(85);
    expect((goalV3.goal_threshold as number) - observed.baseline).toBeCloseTo(0.1, 12);
  });

  it('WIRE SURVIVAL — observed_state.baseline survives NodeV3.parse on a GOAL node', () => {
    // `NodeV3` is a strip-mode schema: an undeclared field is silently dropped
    // at any re-parse between here and PLoT. Presence in the transform output
    // is therefore NOT proof it reaches the wire — this parse is.
    const goalV3 = transformNodeToV3({
      id: 'g1',
      kind: 'goal',
      label: 'Revenue Goal',
      goal_threshold: 0.8,
      goal_threshold_raw: 6_000_000,
      goal_threshold_unit: 'count',
      goal_threshold_cap: 7_500_000,
      goal_threshold_frame: 'level',
      goal_baseline: 0.5333333333333333,
      goal_baseline_raw: 4_000_000,
    } as unknown as V1Node);

    const parsed = NodeV3.parse(goalV3);
    expect(parsed.observed_state?.baseline).toBe(0.5333333333333333);
    expect(parsed.observed_state?.value).toBe(0.5333333333333333);
    expect(parsed.goal_threshold_frame).toBe('level');
  });

  it('POSITIVE CONTROL — observed_state is still built for ordinary factor nodes', async () => {
    // Carried forward from the retired characterisation test. Without it, the
    // goal assertions above could pass in a world where the transform stamped
    // an observed_state on every node regardless of data (trap 13).
    const out = await enrichGraphWithFactorsAsync(
      freshGraph(),
      'Improve retention from 85% to a target of 95%.',
    );
    const factorV1 = out.graph.nodes.find((n) => n.kind === 'factor');
    expect(factorV1, 'no factor node was enriched').toBeDefined();
    const factorV3 = transformNodeToV3(factorV1 as unknown as V1Node) as Record<string, unknown>;
    expect((factorV3.observed_state as Record<string, unknown>).value).toBeDefined();
  });
});

describe('ROADMAP 2.273 — the extractor REFUSES rather than inventing a baseline', () => {
  it('returns null when the brief states a target but NO current level', () => {
    // The honest-absence case, and by far the commonest. ISL then refuses with
    // `missing_goal_baseline` and renders no probability. That gap is 2.215's
    // infer-or-elicit coaching moment, not a number to guess.
    expect(extractGoalTargetWithBaseline('Our target is 800 customers.')).toBeNull();
    expect(extractGoalTargetWithBaseline('Grow revenue to 6000000 this year.')).toBeNull();
  });

  it('returns null when a current level is stated with NO target word', () => {
    expect(extractGoalTargetWithBaseline('We are currently at 500 customers.')).toBeNull();
  });

  it('does NOT pair numbers across a sentence boundary', () => {
    // The cross-metric hazard: two unrelated metrics in adjacent sentences must
    // never be fused into one (target, baseline) pair. `[^.?!\n]` containment
    // is what prevents it.
    expect(
      extractGoalTargetWithBaseline('Our target is 800 customers. Churn is currently at 12.'),
    ).toBeNull();
  });

  it('leaves the goal node WITHOUT observed_state when no level was stated', async () => {
    const goalV3 = await goalV3For('Our target is 800 customers.');
    expect(goalV3.goal_threshold).toBeDefined();
    expect(goalV3.observed_state).toBeUndefined();
  });
});

describe('ROADMAP 2.273 — CROSS-METRIC BINDING is refused (adversarial review, #787)', () => {
  // THE DEFECT THIS CLOSES, found in adversarial review of the first cut.
  //
  // Patterns 2/3 bridged the target and the current level with a bare
  // `[^.?!\n]{0,40}?` window. `[^.?!\n]` excludes SENTENCE terminators but
  // happily admits `,` and `;` — so the window crossed CLAUSE boundaries and
  // bound a number belonging to an entirely different metric.
  //
  // Neither shape errors. Both mint a threshold and a baseline that are
  // individually plausible and comfortably inside ISL's |1.5| domain guard, so
  // ISL converts them and returns a CONFIDENT WRONG PROBABILITY — precisely
  // the failure mode the shared-denominator work exists to prevent, arriving
  // through the other door.
  //
  // The fix replaces the open window with a CLOSED CONNECTIVE GRAMMAR (at most
  // one unit noun, then a connective drawn from a closed set, then an optional
  // determiner). A closed ALLOW-list fails CLOSED on an unanticipated
  // connective — a block-list of bad connectives would fail OPEN, which is the
  // hand-maintained-mirror trap (CLAUDE.md #12) in its most dangerous
  // direction.

  it('S10 — refuses a concessive clause introducing a DIFFERENT metric', () => {
    // "though headcount is currently at 50" is about headcount, not revenue.
    // Before the fix this bound baseline=50 to an 800k revenue target: on the
    // wire threshold 0.8, baseline 0.00005 — both in-domain, silently wrong.
    expect(
      extractGoalTargetWithBaseline(
        'Our target is 800k revenue, though headcount is currently at 50',
      ),
    ).toBeNull();
  });

  it('S11 — refuses across a SEMICOLON clause break', () => {
    // "Marketing is currently 200k" is marketing spend; the target is revenue.
    expect(
      extractGoalTargetWithBaseline('Marketing is currently 200k; our revenue target is 800k'),
    ).toBeNull();
  });

  it('POSITIVE CONTROLS — every documented shape still extracts after the tightening', () => {
    // Without these, the blocking fix could "pass" by refusing everything —
    // a cross-metric guard that extracts nothing is not a fix, it is a
    // regression wearing a safety rationale.
    const MUST_STILL_EXTRACT: ReadonlyArray<readonly [string, number, number]> = [
      ['Grow revenue from 4000000 to a target of 6000000 this year.', 6_000_000, 4_000_000],
      ['Grow revenue from 4M to a target of 6M this year.', 6_000_000, 4_000_000],
      ['Improve retention from 85% to a target of 95%.', 0.95, 0.85],
      ['Increase revenue from £4000000 to a target of £6000000.', 6_000_000, 4_000_000],
      // The shape the review named explicitly as must-preserve — a comma plus
      // a unit noun is the ONE inter-clause bridge the grammar allows.
      ['Our target is 800 customers, currently at 500.', 800, 500],
      ['Currently at 500 customers, target 800.', 800, 500],
      ['Raise the revenue target to 6000000, currently at 4000000.', 6_000_000, 4_000_000],
      ['Our goal is 95%, currently around 85%.', 0.95, 0.85],
      ['Target: 800, currently 500.', 800, 500],
      ['We are currently at 500 and our objective is 800.', 800, 500],
    ];

    for (const [brief, target, baseline] of MUST_STILL_EXTRACT) {
      const r = extractGoalTargetWithBaseline(brief);
      expect(r, `regressed — no longer extracts: ${brief}`).not.toBeNull();
      expect(r!.value, brief).toBe(target);
      expect(r!.baseline, brief).toBe(baseline);
    }
  });

  it('refuses a MIXED percent pair rather than stamping a garbage scale', () => {
    // Amendment 1. Previously `isPercent = to || from` scaled BOTH sides by
    // 100 whenever EITHER carried a '%', so "from 85 to a target of 95%" wrote
    // baseline 0.85 from a number the user never expressed as a percentage.
    // Only ISL's magnitude guard stood between that and a wrong answer, and a
    // magnitude guard cannot see a UNIT error that lands in range. Refuse at
    // the source instead.
    expect(extractGoalTargetWithBaseline('Improve retention from 85 to a target of 95%.')).toBeNull();
    expect(extractGoalTargetWithBaseline('Our target is 95%, currently at 85.')).toBeNull();
  });

  it('"increase revenue from 4M by 2M" — the both-stated shape yields NO baseline', () => {
    // Amendment 2. A "from X by Y" message states a current level AND a
    // delta. The goal patterns require a TARGET word bound to the second
    // amount, which "by 2M" is not, so no pair is extracted and no baseline is
    // minted. The delta is separately caught by the increase-by backstop when
    // it is naively persisted as a level. Pinned so a future loosening of the
    // patterns cannot start pairing a baseline with a DELTA.
    expect(extractGoalTargetWithBaseline('Increase revenue from 4M by 2M.')).toBeNull();
  });
});

describe('ROADMAP 2.287 — CROSS-METRIC NOUN pairs are refused (Codex A4)', () => {
  // THE GAP #787 LEFT OPEN, proven by executable regex probes (Codex A4). #787
  // closed the open 40-char WINDOW (S10/S11 above), but the closed grammar it
  // installed still permits ONE unit noun beside the first amount and captures
  // NO noun at all beside the second — so the two probes below each bind a
  // HEADCOUNT number as the baseline of a REVENUE target. Normalisation then
  // puts both operands comfortably inside ISL's |1.5| domain guard (threshold
  // 0.8, baseline 0.0000625) and ISL returns a CONFIDENT WRONG PROBABILITY.
  //
  // THE FIX extends #787's own discipline one step: the metric noun attached
  // to EACH amount is now CAPTURED, and when both amounts carry explicit
  // metric phrases that disagree — noun vs noun, currency vs currency, or
  // currency vs count-noun — the pair is REFUSED with a named reason. Refusal
  // is honest: ISL keeps saying `missing_goal_baseline` and the user is asked
  // for the level rather than served arithmetic across two different metrics.
  //
  // A trailing word is only treated as a metric noun when it is NOT in the
  // closed function/time-word stopword set. That set fails CLOSED: an
  // unlisted function word can only cause a REFUSAL (a missing baseline),
  // never a fabricated pair — the safe direction of the trap-12 rule.

  it('A4 PROBE 1 (verbatim) — "Our target is 800k revenue, and currently at 50 employees"', () => {
    // Pristine tip binds baseline 50 (EMPLOYEES) to an 800,000 REVENUE target.
    expect(
      extractGoalTargetWithBaseline('Our target is 800k revenue, and currently at 50 employees'),
    ).toBeNull();
  });

  it('A4 PROBE 2 (verbatim) — "Currently at 50 employees, and our target is 800k revenue"', () => {
    // Same defect through pattern 3: the noun after the SECOND amount was
    // never captured, so nothing could disagree.
    expect(
      extractGoalTargetWithBaseline('Currently at 50 employees, and our target is 800k revenue'),
    ).toBeNull();
  });

  it('refuses a CURRENCY target against a bare COUNT-NOUN level (cross-signal)', () => {
    // "$800k" vs "50 employees": money on one side, an explicit non-currency
    // metric noun on the other. Same fabrication class as the probes.
    expect(
      extractGoalTargetWithBaseline('Our target is $800k, and currently at 50 employees'),
    ).toBeNull();
    expect(
      extractGoalTargetWithBaseline('Currently at 50 employees, and our target is $800k'),
    ).toBeNull();
  });

  it('END-TO-END — the probe brief leaves NO baseline on the goal node', async () => {
    // The wire-level consequence of probe 1. On the pristine tip this mints
    // goal_baseline 0.0000625 (= 50 / 800,000×1.25) — in-domain, confidently
    // wrong. Post-fix the baseline is absent and ISL refuses honestly.
    const goalV3 = await goalV3For('Our target is 800k revenue, and currently at 50 employees');
    expect(goalV3.goal_baseline).toBeUndefined();
    expect(goalV3.observed_state).toBeUndefined();
  });

  it('PRESERVED — the SAME metric noun on both amounts still extracts', () => {
    const a = extractGoalTargetWithBaseline('Our target is 800 customers, currently at 500 customers.');
    expect(a).not.toBeNull();
    expect(a!.value).toBe(800);
    expect(a!.baseline).toBe(500);

    const b = extractGoalTargetWithBaseline(
      'Currently at 500 customers, and our target is 800 customers this year.',
    );
    expect(b).not.toBeNull();
    expect(b!.value).toBe(800);
    expect(b!.baseline).toBe(500);
  });

  it('PRESERVED — singular/plural of one noun is the same metric', () => {
    const r = extractGoalTargetWithBaseline('Our target is 800 customers, currently at 500 customer.');
    expect(r).not.toBeNull();
    expect(r!.baseline).toBe(500);
  });

  it('PRESERVED — trailing FUNCTION/TIME words are not metric nouns', () => {
    // "this year", "within a year" must not manufacture a noun mismatch.
    const a = extractGoalTargetWithBaseline('Currently at 500 customers, target 800 this year.');
    expect(a).not.toBeNull();
    expect(a!.value).toBe(800);
    expect(a!.baseline).toBe(500);
  });

  it('PRESERVED — the witness-2258-THIRD prose briefs still extract, byte-identically', () => {
    // Run 3 (the first honest goal probability of the programme) and Run 4
    // (its reproduction), verbatim from the witness file. These are the live
    // proven shapes of the goal-probability train; regressing them would kill
    // the payoff the train exists for.
    const run3 = extractGoalTargetWithBaseline(
      'We want to grow our annual revenue. We are currently at £4,000,000 and our target is £6,000,000 within a year.',
    );
    expect(run3?.value).toBe(6_000_000);
    expect(run3?.baseline).toBe(4_000_000);
    expect(run3?.unit).toBe('£');

    const run4 = extractGoalTargetWithBaseline(
      "Improve our company's financial performance. Revenue is currently at £4,000,000, and our target is £6,000,000 within a year.",
    );
    expect(run4?.value).toBe(6_000_000);
    expect(run4?.baseline).toBe(4_000_000);
    expect(run4?.unit).toBe('£');
  });
});

describe('ROADMAP 2.288 — MIXED-CURRENCY pairs are refused (Codex A5)', () => {
  // The pristine code carried a NOTE calling a currency mismatch "display
  // only" and formed the pair anyway: "$4M → £6M" subtracted dollars from
  // pounds under one cap. There is no FX conversion in this codebase, so the
  // only honest treatments are refuse or convert — and convert would be
  // inventing a rate. Refuse, with a named reason.

  it('refuses "$4M → £6M" in the from-to-target construction', () => {
    expect(
      extractGoalTargetWithBaseline('Grow revenue from $4M to a target of £6M this year.'),
    ).toBeNull();
  });

  it('refuses mixed currencies across the clause-bridge shapes (both directions)', () => {
    expect(extractGoalTargetWithBaseline('Our target is $6M, currently at £4M.')).toBeNull();
    expect(extractGoalTargetWithBaseline('Currently at £4M, and our target is $6M.')).toBeNull();
  });

  it('refuses a mixed CURRENCY-WORD against a symbol', () => {
    // "dollars" is the same explicit signal as "$"; a closed 3-currency word
    // set folds it into the symbol alphabet the amount pattern accepts.
    expect(
      extractGoalTargetWithBaseline('Currently at 4M dollars, and our target is £6M.'),
    ).toBeNull();
  });

  it('PRESERVED — same currency on both amounts extracts, byte-identically', () => {
    const r = extractGoalTargetWithBaseline('Grow revenue from $4M to a target of $6M this year.');
    expect(r?.value).toBe(6_000_000);
    expect(r?.baseline).toBe(4_000_000);
    expect(r?.unit).toBe('$');

    const w = extractGoalTargetWithBaseline('Currently at 4M dollars, and our target is $6M.');
    expect(w?.value).toBe(6_000_000);
    expect(w?.baseline).toBe(4_000_000);
  });

  it('PRESERVED — a currency on ONE side only still extracts (no-currency side inherits)', () => {
    const r = extractGoalTargetWithBaseline('Grow revenue from 4M to a target of £6M this year.');
    expect(r?.value).toBe(6_000_000);
    expect(r?.baseline).toBe(4_000_000);
    expect(r?.unit).toBe('£');
  });
});
