/**
 * SEPARABILITY — the product must not name a winner the model cannot support.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED (31 Aug 2026, deployed CEE `3a79b40`).
 *
 * The identical open-ended brief — a leadership team disagreeing about why
 * retention is slipping, three competing explanations — was run 15 times on one
 * build inside 35 minutes. It produced FOUR DIFFERENT declared winners, split
 * 6 / 4 / 3 / 2, with leader probabilities from 0.297 to 0.881.
 *
 * ⭐ WHAT THIS CHANGE FIXES, AND WHAT IT PROVABLY DOES NOT. Between-run winner
 * INSTABILITY is not observable inside one run: the headline builder sees one
 * envelope and cannot know what the previous draw said. So this change makes no
 * claim about the 0.881 draw, which is decisive WITHIN ITSELF and stays exactly
 * as it is. What it fixes is the other end of the same measured range — the
 * draws where the model does not separate the options and the product names a
 * winner anyway. Reporting this as a fix for the winner-stability metric would
 * be the "kill the symptom's metric, leave the defect alive" trap; the honest
 * metric is stated in the PR body.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE EXISTING MACHINERY DOES NOT ALREADY COVER IT — the first test below
 * pins this at pristine, and it is the RED this change was written against.
 *
 * A four-way field at 0.297 / 0.26 / 0.25 / 0.193 clears no honest gate:
 *   - top-two gap is 3.7pp, so `nearTieReasonByMargin` (≤ 1pp) says NOT a tie;
 *   - the gap is under MIN_LEAD_MARGIN, so `hasMeaningfulLead` is false;
 *   - the leader is under MIN_LEAD_PROBABILITY, so the near-tie branch (which
 *     requires ≥ 0.40) is skipped, and so is the soft-confidence band.
 *
 * Everything declines — and the result falls through to the Case E floor,
 * `"{Label} currently leads."` **The weakest evidence in the grammar produces
 * the most confident-reading sentence in it**, because every statistic and
 * every hedge has been stripped on the way down. That is the live lie.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE NUMBERS COME FROM — a corpus written from the author's own
 * intuition about "near-uniform" is how this codebase shipped eight instances
 * of the two-harms defect, so none of the load-bearing evidence here is
 * authored.
 *
 * `fixtures/measured-analysis-fields-2026-08-31.json` holds the FULL
 * win-probability field of **21 real analyses** captured on deployed CEE
 * `3a79b40` between 23:44Z on 30 Aug and 00:35Z on 31 Aug 2026 — 7 class-a
 * (support-headcount), 7 class-b (open-ended retention), 7 class-c
 * (build-vs-buy). Per run it carries every option's `win_probability`, the
 * producer's `robustness.level` and `near_tie.is_tie`, and **the summary
 * sentence the product actually shipped to the user**.
 *
 * ⚠ IT IS A HISTORIC RECORD AND IS APPEND-ONLY. `shipped_summary` is what a
 * dated build really said. Adding runs is fine; editing one to match a changed
 * expectation would falsify the evidence and leave a green suite agreeing with
 * a history that never happened.
 *
 * The synthetic fields appear ONLY in the pure-parameter twins below, where
 * their whole job is to vary one parameter at a time. Every claim about the
 * product's behaviour is made against the measured corpus.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWINS. Every case has its OPPOSITE-DIRECTION twin — one field that must be
 * withheld and one that must not, differing in ONE parameter. A corpus that
 * tests only the withhold direction is a guard watching one door, and closing
 * the gap in one direction while reopening the lie in the other is precisely
 * the four-round oscillation this design's two parameters exist to prevent.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  isAllowedRunAnalysisAssistantText,
} from '../analysis-result-headline.js';
import {
  MIN_FIELD_SEPARATION,
  contenderBandProbability,
  fieldSeparation,
  isFieldUnseparable,
} from '../option-separability.js';
// Plain JSON import, matching `blocked-slot-claim-guard.test.ts`. The
// `with { type: 'json' }` form four other specs use raises TS2823 under the
// repo's `typecheck:all-including-known-broken-tests` config; this form raises
// nothing, so the fixture adds zero diagnostics to the drift ratchet.
import measuredRuns from './fixtures/measured-analysis-fields-2026-08-31.json';

/** The contender band the headline module passes in — its own MIN_LEAD_MARGIN. */
const BAND = 0.05;

interface Opt {
  readonly id: string;
  readonly label: string;
  readonly p: number;
}

/**
 * Build an enrichment whose ONLY interesting property is the win-probability
 * field. Driver and fragility data are supplied so the enriched cases are
 * genuinely reachable — a fixture that starved them would make every case fall
 * to Case E for the wrong reason and the tests would pass while proving
 * nothing about the branch they name.
 */
function envelope(
  options: readonly Opt[],
  robustness: Record<string, unknown> = { level: 'moderate' },
): Record<string, unknown> {
  return {
    results: options.map((o) => ({
      option_id: o.id,
      option_label: o.label,
      win_probability: o.p,
    })),
    factor_sensitivity: [
      { label: 'Time to Value', elasticity: 0.5, confidence: 0.8, influence_score: 0.6 },
      { label: 'Support Load', elasticity: -0.2, confidence: 0.7, influence_score: 0.2 },
    ],
    robustness,
  };
}

const headlineFor = (
  options: readonly Opt[],
  leaderId: string,
  robustness?: Record<string, unknown>,
): string | null =>
  buildAnalysisResultHeadline({
    enrichment: envelope(options, robustness),
    leading_option_id: leaderId,
    status_kind: 'ok',
  });

// ── The measured corpus ─────────────────────────────────────────────────────

interface MeasuredRun {
  readonly token: string;
  readonly brief_class: 'a' | 'b' | 'c';
  readonly leading_option_id: string | null;
  readonly options: readonly {
    readonly option_id: string;
    readonly option_label: string;
    readonly win_probability: number;
  }[];
  readonly robustness_level: string | null;
  readonly near_tie_is_tie: boolean;
  readonly shipped_summary: string;
}

const CORPUS = measuredRuns as readonly MeasuredRun[];

const runsOfClass = (c: 'a' | 'b' | 'c'): readonly MeasuredRun[] =>
  CORPUS.filter((r) => r.brief_class === c);

const fieldOf = (r: MeasuredRun): readonly number[] =>
  r.options.map((o) => o.win_probability);

/**
 * Run the real builder over a measured run, reproducing the routing signals the
 * deployed turn had: the producer's own `robustness.level` and
 * `near_tie.is_tie`. Omitting those would send every near-tie run down the
 * wrong branch and the corpus result would be an artefact of the fixture.
 *
 * The leader is the run's own `leading_option_id` — the argmax on the
 * production path. Re-designating a NON-argmax leader enters the separate
 * leader-trails-argmax branch, which this gate deliberately does not own.
 */
const headlineOf = (r: MeasuredRun): string | null =>
  headlineFor(
    r.options.map((o) => ({ id: o.option_id, label: o.option_label, p: o.win_probability })),
    r.leading_option_id ?? '',
    { level: r.robustness_level ?? 'moderate', near_tie: { is_tie: r.near_tie_is_tie } },
  );

/**
 * ⭐ THE ONE MEASURED RUN THIS CHANGE IS FOR, named so the corpus assertions
 * bind by IDENTITY and not by a value predicate another run could satisfy.
 *
 * Deployed CEE `3a79b40`, 31 Aug 2026 00:22:15Z. Four explanations at
 * 0.3045 / 0.2895 / 0.2177 / 0.1883, `near_tie.is_tie: true`,
 * `robustness.level: very_low` — and the product shipped
 * `"Selling to the Wrong Customers currently leads."`
 */
const LYING_RUN_TOKEN = '20260831T002215Z-fresh-6c5a96';

/** The class-B run whose FIELD is nearly as flat but which reaches honest
 *  near-tie copy first, and must therefore be left alone. The twin that proves
 *  this gate does not preempt a sibling authority. */
const CLOSE_CALL_RUN_TOKEN = '20260830T235845Z-fresh-5faab3';

describe('separability — the statistic and its two parameters', () => {
  it('scores a uniform field at 0 and a winner-takes-all field at 1', () => {
    expect(fieldSeparation([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0, 10);
    expect(fieldSeparation([1, 0, 0, 0])).toBeCloseTo(1, 10);
  });

  it('is scale-free: 0.55 of two and 0.2875 of four score the same', () => {
    // The whole reason P1 is not a raw probability floor. Both fields are the
    // same distance from uniform; no single probability threshold says so.
    const two = fieldSeparation([0.55, 0.45]) as number;
    const four = fieldSeparation([0.2875, 0.2425, 0.2400, 0.2300]) as number;
    expect(two).toBeCloseTo(0.1, 6);
    expect(four).toBeCloseTo(0.05, 6);
    // Same statistic, different n, both far below the floor.
    expect(two).toBeLessThan(MIN_FIELD_SEPARATION);
    expect(four).toBeLessThan(MIN_FIELD_SEPARATION);
  });

  it('returns null — not 0 — for a field too small to have a shape', () => {
    // Fail-safe direction: unanswerable must never read as "not separated".
    expect(fieldSeparation([0.9])).toBeNull();
    expect(fieldSeparation([])).toBeNull();
    expect(isFieldUnseparable([0.9], BAND).unseparable).toBe(false);
    expect(isFieldUnseparable([], BAND).unseparable).toBe(false);
  });

  it('counts contenders within the band, leader included', () => {
    expect(contenderBandProbability([0.297, 0.26, 0.25, 0.193], BAND)).toBe(3);
    expect(contenderBandProbability([0.34, 0.22, 0.22, 0.22], BAND)).toBe(1);
  });
});

describe('the two parameters guard different populations — twins', () => {
  it('P1 TWIN — flat field withheld, lifted field kept, P2 identical in both', () => {
    // Both fields have a rival inside the band, so P2 fires on BOTH. Only P1
    // differs. This is what proves P1 is doing work of its own.
    const flat = [0.297, 0.26, 0.25, 0.193];
    const lifted = [0.42, 0.39, 0.1, 0.09];

    expect(contenderBandProbability(flat, BAND)).toBeGreaterThanOrEqual(2);
    expect(contenderBandProbability(lifted, BAND)).toBeGreaterThanOrEqual(2);

    expect(isFieldUnseparable(flat, BAND).unseparable).toBe(true);
    expect(isFieldUnseparable(lifted, BAND).unseparable).toBe(false);
  });

  it('P2 TWIN — rival level with the leader withheld, leader alone kept, P1 identical in both', () => {
    // Both fields are BELOW the separation floor, so P1 fires on BOTH. Only P2
    // differs. Without P2, `clearOfField` would be silenced — that is the GAP
    // this parameter exists to prevent, shown as a passing case rather than
    // asserted in prose.
    const rivalLevel = [0.3, 0.29, 0.21, 0.2];
    const clearOfField = [0.34, 0.22, 0.22, 0.22];

    expect(fieldSeparation(rivalLevel) as number).toBeLessThan(MIN_FIELD_SEPARATION);
    expect(fieldSeparation(clearOfField) as number).toBeLessThan(MIN_FIELD_SEPARATION);

    expect(isFieldUnseparable(rivalLevel, BAND).unseparable).toBe(true);
    expect(isFieldUnseparable(clearOfField, BAND).unseparable).toBe(false);
  });
});

describe('the measured corpus — 21 real runs from deployed CEE 3a79b40', () => {
  it('the fixture is the corpus it claims to be', () => {
    // A corpus assertion that never checked its own shape would pass just as
    // happily on an empty file, and every "unharmed" claim below would then be
    // vacuous. Assert the counts BY NAME before trusting anything derived.
    expect(CORPUS).toHaveLength(21);
    expect(runsOfClass('a')).toHaveLength(7);
    expect(runsOfClass('b')).toHaveLength(7);
    expect(runsOfClass('c')).toHaveLength(7);
    for (const r of CORPUS) expect(r.options.length).toBeGreaterThanOrEqual(2);
  });

  it('RED AT PRISTINE — the one run that named a winner on a flat field', () => {
    // Before this change the deployed product emitted exactly this, and the
    // fixture records it because it is what a dated build really said:
    const run = CORPUS.find((r) => r.token === LYING_RUN_TOKEN) as MeasuredRun;
    expect(run.shipped_summary).toContain(
      'Selling to the Wrong Customers currently leads.',
    );
    // The producer had already called it a tie on its own evidence.
    expect(run.near_tie_is_tie).toBe(true);
    expect(run.robustness_level).toBe('very_low');

    // And the field it said that about.
    const v = isFieldUnseparable(fieldOf(run), BAND);
    expect(v.unseparable).toBe(true);
    expect(v.separation as number).toBeLessThan(MIN_FIELD_SEPARATION);
    expect(v.contenders).toBeGreaterThanOrEqual(2);
  });

  it('⭐ EXACTLY ONE of the 21 measured runs loses its headline, and it is that one', () => {
    // ⚠ THE ASSERTION IS ABOUT THE HEADLINE, NOT ABOUT THE PREDICATE, and the
    // difference is the whole design. TWO measured runs have unseparable
    // FIELDS; only ONE loses its sentence, because the other reaches honest
    // near-tie copy before this gate is consulted. An earlier draft of this
    // test asserted over the predicate and read the second run as a regression
    // it is not — a claim about a component generalised into a claim about the
    // product.
    const withheldFields = CORPUS.filter(
      (r) => isFieldUnseparable(fieldOf(r), BAND).unseparable,
    ).map((r) => r.token);
    expect(withheldFields).toEqual([CLOSE_CALL_RUN_TOKEN, LYING_RUN_TOKEN]);

    const lostHeadline = CORPUS.filter((r) => headlineOf(r) === null).map((r) => r.token);
    expect(lostHeadline).toEqual([LYING_RUN_TOKEN]);
  });

  it('TWIN — the near-uniform run that already says something honest keeps it', () => {
    // 0.3608 / 0.3229 / 0.2221 / 0.0941 with `is_tie: true`: a field almost as
    // flat as the lying one, whose separation (0.148) sits a hair under the
    // floor — and it must NOT lose its sentence, because the near-tie authority
    // reaches it first and says something true and useful.
    //
    // ⭐ THIS IS THE CASE THAT DECIDED WHERE THE GATE GOES. Placing it at the
    // top of the function with the four sibling withholds would silence this
    // run: honest, informative copy replaced by the bland locked template — a
    // loss to the user and no gain in honesty. It is pinned here so that moving
    // the call site fails loudly instead of quietly costing the user a sentence.
    const run = CORPUS.find((r) => r.token === CLOSE_CALL_RUN_TOKEN) as MeasuredRun;
    expect(run.near_tie_is_tie).toBe(true);
    expect(run.shipped_summary).toContain('the analysis treats this as a close call');
    // Its field IS unseparable — so it is kept by PLACEMENT, not by the predicate.
    expect(isFieldUnseparable(fieldOf(run), BAND).unseparable).toBe(true);
    // And it still gets a sentence, and that sentence still flags the closeness.
    const text = headlineOf(run);
    expect(text).not.toBeNull();
    expect(text as string).toContain('close call');
  });
});

describe('MANDATORY CONTROL — class-a and class-c measured runs are unharmed', () => {
  it.each(['a', 'c'] as const)(
    'no class-%s measured run becomes unseparable',
    (briefClass) => {
      const runs = runsOfClass(briefClass);
      expect(runs).toHaveLength(7);
      for (const r of runs) {
        const v = isFieldUnseparable(fieldOf(r), BAND);
        expect(
          v.unseparable,
          `${r.token} (${briefClass}) separation=${v.separation} contenders=${v.contenders}`,
        ).toBe(false);
      }
    },
  );

  it('names the closest class-a and class-c run to the floor, so a retune goes red', () => {
    // The margin of safety, stated as a number rather than assumed. If someone
    // later raises MIN_FIELD_SEPARATION past the tightest real decisive run,
    // this test says which run it broke instead of the regression shipping.
    const decisive = [...runsOfClass('a'), ...runsOfClass('c')];
    const tightest = decisive
      .map((r) => ({ token: r.token, sep: fieldSeparation(fieldOf(r)) as number }))
      .sort((x, y) => x.sep - y.sep)[0] as { token: string; sep: number };
    expect(tightest.token).toBe('20260831T001516Z-fresh-4d753d');
    expect(tightest.sep).toBeGreaterThan(MIN_FIELD_SEPARATION);
    // Headroom: the floor could rise by half again before touching it.
    expect(tightest.sep).toBeGreaterThan(MIN_FIELD_SEPARATION * 1.5);
  });
});

describe('the headline withholds an unsupportable winner, end to end', () => {
  /** The lying run's real field, rebuilt as an enrichment the builder accepts. */
  const lyingRun = CORPUS.find((r) => r.token === LYING_RUN_TOKEN) as MeasuredRun;
  const LYING_FIELD: readonly Opt[] = lyingRun.options.map((o) => ({
    id: o.option_id,
    label: o.option_label,
    p: o.win_probability,
  }));

  it('returns null, under its own reason code', () => {
    const leader = lyingRun.leading_option_id as string;
    expect(headlineFor(LYING_FIELD, leader)).toBeNull();

    const d = describeAnalysisHeadline({
      enrichment: envelope(LYING_FIELD),
      leading_option_id: leader,
      status_kind: 'ok',
    });
    expect(d.case).toBeNull();
    expect(d.reason).toBe('options_not_separable');
  });

  it('binds to the FIELD, not to one option carrying a particular value', () => {
    // Permuting the field's ORDER must not change the verdict — the statistic
    // is a property of the multiset, and a test that happened to key on
    // `options[0]` would pass on a different object entirely.
    const reversed = [...LYING_FIELD].reverse();
    expect(headlineFor(reversed, lyingRun.leading_option_id as string)).toBeNull();
    expect(isFieldUnseparable(reversed.map((o) => o.p), BAND).unseparable).toBe(true);
  });

  it('⚠ DISCLOSED RESIDUAL — a non-argmax designated leader is NOT covered', () => {
    // Naming a leader that is not the argmax enters the leader-trails-argmax
    // branch, which returns its own disambiguation copy BEFORE this gate is
    // reached. So on the very same flat field the product still says
    // "X leads overall, though Y has marginally better raw probability."
    //
    // ⭐ PINNED RATHER THAN FIXED, DELIBERATELY. That branch is a different
    // authority answering a different question, and the module's own comment
    // states it "cannot happen when leader == argmax (the production run
    // path)". Extending this gate over it would be scope creep into a seam I
    // have no measured evidence about — there is no such run in the corpus.
    // Recorded as a known gap so the suite stays green for the RIGHT reason and
    // goes red if the set of uncovered shapes ever grows.
    // Pick the trailing option by the branch's OWN entry condition — a raw-odds
    // gap to the argmax inside its [1pp, 10pp] "marginally better" window.
    // Choosing merely "some option below the max" selects one outside that
    // window, the branch returns null, and the test would then record the
    // residual as already-covered. Bind to the branch's precondition, in-test.
    const max = Math.max(...LYING_FIELD.map((x) => x.p));
    const trailing = LYING_FIELD.find((o) => {
      const gap = max - o.p;
      return gap >= 0.01 && gap <= 0.1;
    }) as Opt;
    expect(trailing).toBeDefined();
    const text = headlineFor(LYING_FIELD, trailing.id);
    expect(text).not.toBeNull();
    expect(text as string).toContain('leads overall');
  });

  it('TWIN — lift ONE option and the same field keeps its winner', () => {
    // The minimal opposite-direction twin: identical labels, identical ids,
    // identical leader — the leader's mass raised until the field separates.
    // Everything else about the input is byte-identical to the withheld case.
    const lifted = LYING_FIELD.map((o, i) =>
      i === 0 ? { ...o, p: 0.62 } : { ...o, p: (1 - 0.62) / (LYING_FIELD.length - 1) },
    );
    const text = headlineFor(lifted, lifted[0]!.id);
    expect(text).not.toBeNull();
    expect(text as string).toContain(lifted[0]!.label);
    expect(text as string).toContain('62% of runs of this model');
    expect(isAllowedRunAnalysisAssistantText(text as string)).toBe(true);
  });
});

describe('STRUCTURAL GUARANTEE — a confident run can never be withheld', () => {
  /**
   * ⭐ THIS IS THE LOAD-BEARING SAFETY PROPERTY, and it is proved over the
   * whole input space rather than sampled.
   *
   * A confident headline (cases A/B/C/D) requires `hasMeaningfulLead`, which
   * requires margin ≥ MIN_LEAD_MARGIN. The contender band IS MIN_LEAD_MARGIN.
   * So a confident run has NO rival inside the band, so P2 cannot fire, so the
   * verdict cannot be `unseparable` — at ANY value of MIN_FIELD_SEPARATION.
   *
   * The sweep below is the executable form of that argument: every field with
   * a genuine ≥ 5pp lead, across field sizes and shapes, must be kept.
   */
  it('no field with a margin at or above the band is ever unseparable', () => {
    let checked = 0;
    for (let n = 2; n <= 6; n += 1) {
      for (let lead = 5; lead <= 60; lead += 1) {
        // Leader clears the runner-up by exactly `lead` points; the rest of the
        // mass is spread evenly behind the runner-up.
        const leader = 1 / n + lead / 100;
        if (leader > 1) continue;
        const rest = (1 - leader) / (n - 1);
        const field = [leader, ...Array<number>(n - 1).fill(rest)];
        const margin = leader - rest;
        if (margin < BAND) continue;
        checked += 1;
        expect(isFieldUnseparable(field, BAND).unseparable).toBe(false);
      }
    }
    // The sweep must actually have swept. A silently-empty loop would pass.
    expect(checked).toBeGreaterThan(150);
  });

  it('and the flat-field defect still bites inside that same sweep space', () => {
    // Contrast control for the sweep above: the same generator, below the band,
    // must produce withheld fields. A sweep that could only ever return "kept"
    // would prove nothing about the guarantee.
    let withheld = 0;
    for (let n = 3; n <= 6; n += 1) {
      for (let lead = 0; lead < 5; lead += 1) {
        const leader = 1 / n + lead / 100;
        const rest = (1 - leader) / (n - 1);
        if (isFieldUnseparable([leader, ...Array<number>(n - 1).fill(rest)], BAND).unseparable) {
          withheld += 1;
        }
      }
    }
    expect(withheld).toBeGreaterThan(0);
  });
});
