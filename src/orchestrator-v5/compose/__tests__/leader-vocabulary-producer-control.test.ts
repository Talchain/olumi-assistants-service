/**
 * G-CEE-1 — THE PRODUCER-TEMPLATE POSITIVE CONTROL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS — it caught a hole in the fix that shipped alongside it.
 *
 * `compose/withheld-explanation-answer.ts` claims to cover BOTH producers of an
 * explanation answer: Sonnet's `answer_text`, and the DETERMINISTIC fallback
 * the handler substitutes when Sonnet's text fails the side-band validator. Its
 * docstring even quotes the fallback's opening line as the thing being covered:
 *
 *     "${leading.label} performs best, with a probability of …"
 *
 * That string matched **NONE** of the guard's fourteen `LEADER_CLAIM_PATTERNS`.
 * The gate could not see the repo's own template. Corridor:
 *
 *     withheld turn
 *       → Sonnet's answer fails side-band validation
 *       → handler substitutes the deterministic fallback
 *       → the fallback names the leader, the gate's scanner does not see it
 *       → the APPEND branch fires instead of the REPLACE branch
 *       → leader claim AND withheld disclosure in ONE message
 *
 * — which is exactly the `case1g` shape the whole fix exists to prevent,
 * arriving through the producer the fix named as covered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MECHANISM, NOT THE INSTANCE.
 *
 * Adding `/\bperforms?\s+best\b/i` and calling it done would be the fourth
 * hand-maintained mirror in this defect's history (CLAUDE.md trap #12): a
 * vocabulary list a human must remember to sync with the templates it is
 * supposed to see. The templates are IN THIS REPO and they are PURE FUNCTIONS,
 * so the sync can be DERIVED instead:
 *
 *   drive the real composers over their whole branch space, and assert the
 *   enforcement scanner SEES every output that names a leading option.
 *
 * A future edit to `explanation-fallback.ts` that reworded the opening ("X is
 * the front-runner") fails THIS test, in the same PR, without anyone
 * remembering that a vocabulary exists. That is the property trap #12 asks for:
 * derived, not mirrored.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE, STATED. This control covers the DETERMINISTIC producers only —
 * `composeExplainResultsFallback`, `composeWhatWouldFlipFallback`, and (since
 * 2026-07-27) `composeComparison` in `routing/run-comparison-gate.ts`. Sonnet's
 * free prose is unbounded and cannot be enumerated; it remains covered by the
 * pattern list as a best-effort net, and the live walk is what measures the
 * residue there. What this file removes is the excuse for missing a string THE
 * REPO ITSELF WRITES.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';
import { tryRunComparisonGate } from '../../routing/run-comparison-gate.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

/**
 * The branch space of `composeRobustnessVerdict`, which both fallbacks route
 * through. Enumerated from that module's own exported axes rather than guessed:
 *   margin    ∈ near_tie | clear | indeterminate   (`RobustnessMarginCategory`)
 *   stability ∈ fragile | stable | moderate | unknown (`RobustnessStabilityCategory`)
 * crossed with runner-up present/absent, which gates `margin_clause` entirely.
 */
const MARGIN_CASES = [
  { name: 'near_tie', margin_pp: 0.4 },
  { name: 'clear', margin_pp: 34 },
  { name: 'indeterminate', margin_pp: null },
] as const;

const BAND_CASES = [
  { name: 'fragile', robustness_band: 'fragile' },
  { name: 'stable', robustness_band: 'stable' },
  { name: 'highly_stable', robustness_band: 'highly_stable' },
  { name: 'moderate', robustness_band: 'moderate' },
  { name: 'unknown', robustness_band: null },
] as const;

const RUNNER_CASES = [
  { name: 'with_runner', runner: { label: 'Standardise on Dell XPS', probability: 0.34 } },
  { name: 'no_runner', runner: null },
] as const;

function projection(
  margin: number | null,
  band: string | null,
  runner: { label: string; probability: number } | null,
): AnalysisProjectionSummary {
  return {
    status: 'completed',
    leading_option: { label: 'Standardise on MacBook Pro', probability: 0.44 },
    runner_up: runner,
    margin_pp: margin,
    robustness_band: band,
    top_drivers: [{ factor_label: 'Engineering team size', influence: 0.42 }],
    fragile_edges: [{ from_label: 'Toolchain compatibility', to_label: 'Team effectiveness' }],
  } as unknown as AnalysisProjectionSummary;
}

interface Sample {
  readonly producer: string;
  readonly branch: string;
  readonly text: string;
}

function everyProducerOutput(): Sample[] {
  const out: Sample[] = [];
  for (const m of MARGIN_CASES) {
    for (const b of BAND_CASES) {
      for (const r of RUNNER_CASES) {
        const p = projection(m.margin_pp, b.robustness_band, r.runner);
        const branch = `${m.name}/${b.name}/${r.name}`;
        out.push({
          producer: 'composeExplainResultsFallback',
          branch,
          text: composeExplainResultsFallback(p, null, null),
        });
        out.push({
          producer: 'composeWhatWouldFlipFallback',
          branch,
          text: composeWhatWouldFlipFallback(p, null, null),
        });
      }
    }
  }
  return out;
}

describe('PRODUCER CONTROL — the enforcement scanner sees the repo\'s own templates', () => {
  const samples = everyProducerOutput();

  it('drives BOTH fallbacks across the FULL margin x stability x runner-up space', () => {
    // Non-vacuity for the enumeration itself: if a future refactor made the
    // composers return '' the sweep below would pass by testing nothing.
    expect(samples).toHaveLength(MARGIN_CASES.length * BAND_CASES.length * RUNNER_CASES.length * 2);
    for (const s of samples) {
      expect(s.text.length, `${s.producer} @ ${s.branch} produced empty prose`).toBeGreaterThan(40);
    }
  });

  it('EVERY deterministic fallback output is SEEN as naming a leading option', () => {
    // Each of these outputs opens by naming the leading option by label. On a
    // withheld turn none of them may ship, so the enforcement scanner MUST see
    // all of them — a miss silently downgrades REPLACE to APPEND and puts the
    // leader claim and the withheld disclosure in one message.
    const unseen = samples
      .filter((s) => !textAssertsLeadingOption(s.text))
      .map((s) => `${s.producer} @ ${s.branch}\n      ${s.text.slice(0, 160)}`);

    expect(
      unseen,
      'A deterministic producer in THIS REPO names a leading option in prose the ' +
        'enforcement scanner cannot see. Add the phrasing to LEADER_CLAIM_PATTERNS ' +
        '(compose/leading-option-egress-guard.ts) — do NOT relax this test. On a ' +
        'withheld turn this exact gap routes the answer down the APPEND branch and ' +
        'ships the leader claim beside the disclosure that denies it.',
    ).toEqual([]);
  });

  /**
   * ⚠ THE ASSERTION ABOVE IS NOT SUFFICIENT ON ITS OWN, and finding out why is
   * what this file earned its keep for.
   *
   * Run whole-output, it passed while `performs best` was still invisible —
   * because a LATER sentence ("…which has little effect on **the lead**")
   * tripped `the_lead` and saturated the scan. The leader CLAIM was unseen; the
   * blob around it was seen. That is precisely the incidental-catch pattern the
   * production logs showed on the four live no-op turns (`hit_codes:
   * ['the_lead']`, never a code matching the actual leader sentence).
   *
   * A whole-blob control therefore cannot prove the vocabulary sees the claim.
   * The claim has to be isolated. Both fallbacks put it in the FIRST sentence,
   * by construction, so that is what is scanned here — alone.
   *
   * This matters operationally, not just aesthetically: the scanner is applied
   * to whatever text the handler produces, and a shorter variant carrying ONLY
   * the leader claim is exactly the answer that would slip to APPEND.
   */
  it('the LEADER SENTENCE ALONE is seen — not merely the blob around it', () => {
    const firstSentence = (text: string): string => {
      const m = /^[^.!?]*[.!?]/.exec(text.trim());
      return (m ? m[0] : text).trim();
    };

    const unseen = samples
      .map((s) => ({ ...s, sentence: firstSentence(s.text) }))
      .filter((s) => !textAssertsLeadingOption(s.sentence))
      .map((s) => `${s.producer} @ ${s.branch}\n      "${s.sentence}"`);

    expect(
      unseen,
      'The leading-option CLAIM sentence emitted by a producer in this repo is ' +
        'invisible to the enforcement scanner. The whole-output assertion above ' +
        'can pass anyway when a neighbouring sentence happens to trip a pattern — ' +
        'that is how this hole survived review. Add the phrasing to ' +
        'LEADER_CLAIM_PATTERNS; do not weaken this assertion.',
    ).toEqual([]);
  });

  /**
   * ENFORCEMENT PRECISION — the other direction, and it has teeth.
   *
   * The two enforcing consumers DELETE user content when they fire: one
   * replaces the whole answer with withheld copy, the other drops an evidence
   * block. A false positive there is not noise, it is destroyed content on a
   * turn the user is already being told less than usual.
   *
   * `\bleads\b` is the offender. POST-710 §7.1 recorded "team leads" as a known
   * false positive of exactly this pattern, and "X leads to Y" is ordinary
   * causal English that this estate's prose uses constantly. The alarm keeps
   * both (it only logs); the enforcer carves them out.
   */
  describe('enforcement precision — carve-outs the ALARM deliberately does not have', () => {
    const FALSE_POSITIVES = [
      'Higher engineering capacity leads to faster delivery.',
      'Your team leads will need to agree before this can proceed.',
      'The tech leads flagged toolchain risk as the main unknown.',
    ];

    for (const text of FALSE_POSITIVES) {
      it(`enforcement does NOT fire on: "${text.slice(0, 42)}…"`, () => {
        expect(textAssertsLeadingOption(text)).toBe(false);
      });
    }

    it('the ALARM still sees them — the two readers are meant to differ here', () => {
      // Non-vacuity for the carve-out: proves these strings really do trip the
      // shared vocabulary, so the negatives above are the CARVE-OUT working and
      // not the patterns silently failing to match anything.
      for (const text of FALSE_POSITIVES) {
        expect(textNamesLeadingOption(text)).toBe(true);
      }
    });

    it('the carve-out does NOT blind enforcement to a real claim in the same string', () => {
      // The dangerous over-correction: neutralising "leads to" must not swallow
      // a genuine leader claim sitting beside it.
      expect(
        textAssertsLeadingOption(
          'Higher capacity leads to faster delivery, and Standardise on MacBook Pro performs best overall.',
        ),
      ).toBe(true);
      expect(
        textAssertsLeadingOption('Your team leads agree that MacBook Pro currently leads.'),
      ).toBe(true);
    });
  });

  it('MUTATION SENTINEL: prose stripped of leader phrasing is NOT seen', () => {
    // The sweep above would pass vacuously if the scanner returned true for
    // everything. Feed it the same shape of sentence with the leader phrasing
    // removed and require a NEGATIVE — proving it discriminates rather than
    // just saturating.
    expect(
      textAssertsLeadingOption(
        'The result rests on how toolchain compatibility feeds into team effectiveness, ' +
          'and that link is estimated rather than measured.',
      ),
    ).toBe(false);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THIRD DETERMINISTIC PRODUCER — `composeComparison`, added 2026-07-27.
 *
 * WHY IT BELONGS HERE AND NOT IN A GATE-LOCAL TEST. The two fallbacks above are
 * covered because they are templates THIS REPO WRITES, and the file's whole
 * argument is that a vocabulary list cannot be hand-synced to the templates it
 * is supposed to see. `composeComparison` is the same kind of object — pure,
 * deterministic, in-repo, leader-naming, with zero LLM in the path — and it was
 * outside every derivation. The `performs_best` hole is what that costs.
 *
 * THE HOLE THIS SECTION FOUND, stated so a reader does not have to re-derive it.
 * `LEADER_CLAIM_PATTERNS`'s `comes_out_ahead` read
 * `/\bcomes?\s+out\s+(?:ahead|on\s+top)\b/i` — come / comes, and NOT the past
 * tense. `composeComparison`'s #731 mixed branch emits, verbatim:
 *
 *     "${prior_leading_label} came out ahead in the earlier run."
 *
 * That sentence matched **NOTHING** in the list. Its sibling, the both-permitted
 * template, emits "${prior} came out ahead before, and ${current} now leads." —
 * seen today ONLY because the trailing clause says "now leads". The leader claim
 * about the PRIOR run was invisible in both, and in the mixed branch there is no
 * neighbouring clause to catch it. Byte-for-byte the incidental-catch pattern
 * this file already records for `performs best`, arriving through a producer
 * that shipped the day before.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ASSERTION IS PER-CLAUSE, NOT PER-OUTPUT, AND THAT IS THE WHOLE POINT.
 *
 * A whole-answer assertion passes here without the fix: every arm of
 * `composeComparison` that names the prior leader ALSO carries a sentence with
 * `leads` in it, or a withheld substitution that does not. Scanning the blob
 * measures the blob. The property that actually matters is that the CLAUSE
 * carrying the claim is visible on its own, because that is the granularity the
 * enforcing consumers work at — `context/withheld-history-redaction.ts` redacts
 * per sentence, and `compose/withheld-explanation-answer.ts` decides
 * REPLACE-vs-APPEND on whether it can see a claim at all.
 *
 * THE RULE IS DERIVED FROM THE FIXTURE, NOT FROM A LIST OF SENTENCES: every
 * independent clause containing an OPTION LABEL THIS TEST INJECTED must be seen
 * by the scanner. No template is named, so a reworded or newly-added branch is
 * covered on the commit that writes it.
 *
 * SCOPE LIMIT, STATED HONESTLY. The rule assumes that in a COMPARISON answer a
 * clause naming an option is designating its rank. That is true of every branch
 * `composeComparison` has, and it is true by the gate's own construction — its
 * job is to state what moved between two runs. A future branch that names an
 * option WITHOUT ranking it (say, "X was ruled out by the budget constraint")
 * would fail here, and that failure is correct behaviour for this control: it
 * is a new claim class in a leader-gated composer and it wants a deliberate
 * decision, not a silent pass.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('PRODUCER CONTROL — composeComparison (run-comparison gate)', () => {
  /** The two option labels the fixture injects. Nothing else names an option. */
  const OPTION_LABELS = ['Standardise on MacBook Pro', 'Standardise on Dell XPS'] as const;

  function envelope(
    options: ReadonlyArray<{ id: string; label: string; win: number }>,
    band: string,
  ): V2RunResponseEnvelope {
    return {
      analysis_status: 'completed',
      results: options.map((o) => ({
        option_id: o.id,
        option_label: o.label,
        win_probability: o.win,
      })),
      robustness_synthesis: { overall_assessment: band },
    } as unknown as V2RunResponseEnvelope;
  }

  /**
   * How a run's claim-safety verdict is recorded on the persisted fact — the
   * axis #731 introduced. `unstamped` is NOT a synonym for `withheld`: it is
   * the legacy shape (every run persisted before #710) and reaches `false`
   * through the reader's fail-closed default.
   */
  type VerdictShape = 'permitted' | 'withheld' | 'unstamped';
  const VERDICT_SHAPES = ['permitted', 'withheld', 'unstamped'] as const;

  function runFact(
    env: V2RunResponseEnvelope,
    shape: VerdictShape,
    computedAt: string,
  ): HandlerFact {
    return {
      fact_type: 'run_analysis',
      noop: false,
      result: {
        enrichment: env,
        computed_at: computedAt,
        graph_hash_at_run: 'h',
        ...(shape === 'unstamped'
          ? {}
          : {
              constraint_verdict: {
                may_name_leading_option: shape === 'permitted',
                constraint_verdict_state:
                  shape === 'permitted' ? 'evaluated_feasible' : 'evaluated_infeasible',
              },
            }),
      },
    } as unknown as HandlerFact;
  }

  /**
   * The gate's branch space for LEADER-DESIGNATING prose, enumerated from the
   * composer's own conditionals rather than guessed:
   *   prior verdict   x current verdict     — the four permission arms (#731)
   *   ordering        ∈ changed | unchanged — "has changed …" vs "still leads"
   *   margin          ∈ widened | narrowed | unchanged — the three lead sentences
   * `MARGIN_EPSILON_PP` is 0.5 in `coaching/compare-runs.ts`, so these gaps are
   * chosen to land unambiguously either side of it.
   */
  const ORDERING = [
    { name: 'changed', currentTop: 1 },
    { name: 'unchanged', currentTop: 0 },
  ] as const;

  const MARGIN = [
    { name: 'widened', top: 0.7, runner: 0.3 },
    { name: 'narrowed', top: 0.55, runner: 0.45 },
    { name: 'unchanged', top: 0.62, runner: 0.38 },
  ] as const;

  interface ComparisonSample {
    readonly branch: string;
    readonly text: string;
  }

  function everyComparisonOutput(): ComparisonSample[] {
    const out: ComparisonSample[] = [];
    // Prior run: MacBook Pro ahead by 24pp, band 'low'.
    const priorEnv = envelope(
      [
        { id: 'a', label: OPTION_LABELS[0], win: 0.62 },
        { id: 'b', label: OPTION_LABELS[1], win: 0.38 },
      ],
      'low',
    );
    for (const prior of VERDICT_SHAPES) {
      for (const current of VERDICT_SHAPES) {
        for (const order of ORDERING) {
          for (const margin of MARGIN) {
            const topLabel = OPTION_LABELS[order.currentTop];
            const runnerLabel = OPTION_LABELS[order.currentTop === 0 ? 1 : 0];
            const currentEnv = envelope(
              [
                { id: order.currentTop === 0 ? 'a' : 'b', label: topLabel, win: margin.top },
                {
                  id: order.currentTop === 0 ? 'b' : 'a',
                  label: runnerLabel,
                  win: margin.runner,
                },
              ],
              'high',
            );
            const outcome = tryRunComparisonGate({
              message: 'What changed?',
              // Newest-first, per the loader convention the pair selector relies on.
              priorFacts: [
                runFact(currentEnv, current, '2026-06-07T00:00:00.000Z'),
                runFact(priorEnv, prior, '2026-06-06T00:00:00.000Z'),
              ],
              freshness: 'fresh',
              mayNameLeadingOption: true,
            });
            // THROW, not `expect`. This runs at COLLECT time, and a
            // collect-time `expect` is the shape that makes a suite report a
            // smaller run as green (CLAUDE.md trap 2b). An explicit Error kills
            // the file loudly and names the branch that stopped comparing.
            if (!outcome.matched || outcome.mode !== 'compared') {
              throw new Error(
                `fixture stopped producing a comparison at ${prior}/${current}/${order.name}/` +
                  `margin-${margin.name} — every assertion in this file would be vacuous. ` +
                  `matched=${outcome.matched}` +
                  (outcome.matched ? ` mode=${outcome.mode}` : ` reason=${outcome.reason}`),
              );
            }
            out.push({
              branch: `${prior}/${current}/${order.name}/margin-${margin.name}`,
              text: outcome.assistant_text,
            });
          }
        }
      }
    }
    return out;
  }

  /**
   * Split prose into INDEPENDENT CLAUSES — sentences, then coordinated halves.
   *
   * The coordination split is not cosmetic: "${prior} came out ahead before,
   * and ${current} now leads." is ONE sentence carrying TWO claims, and the
   * second one saturating the scan is exactly how the first stayed invisible.
   */
  function independentClauses(text: string): string[] {
    const out: string[] = [];
    for (const sentence of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
      for (const clause of sentence.split(/,\s+(?:and|but|while|whereas)\s+|;\s+/)) {
        const trimmed = clause.trim();
        if (trimmed.length > 0) out.push(trimmed);
      }
    }
    return out;
  }

  const namesAnOption = (clause: string): boolean =>
    OPTION_LABELS.some((label) => clause.includes(label));

  const samples = everyComparisonOutput();

  const optionNamingClauses = samples.flatMap((s) =>
    independentClauses(s.text)
      .filter(namesAnOption)
      .map((clause) => ({ branch: s.branch, clause })),
  );

  it('drives the gate across the FULL permission x ordering x margin space', () => {
    // Non-vacuity for the enumeration itself: an empty or collapsed sweep would
    // make every assertion below pass by testing nothing.
    expect(samples).toHaveLength(
      VERDICT_SHAPES.length * VERDICT_SHAPES.length * ORDERING.length * MARGIN.length,
    );
    for (const s of samples) {
      expect(s.text.length, `${s.branch} produced empty prose`).toBeGreaterThan(40);
    }
  });

  it('the fixture actually produces leader-naming prose to measure', () => {
    // Trap #13 — an absence assertion must first prove it can see a presence.
    // If the gate stopped naming options at all, the per-clause assertion below
    // would pass on an empty list. Shapes are counted with the labels blanked,
    // so this counts DISTINCT TEMPLATES rather than fixture permutations.
    const shapes = new Set(
      optionNamingClauses.map(({ clause }) =>
        OPTION_LABELS.reduce((acc, label) => acc.split(label).join('<OPTION>'), clause),
      ),
    );
    expect(
      shapes.size,
      `distinct leader-clause shapes found:\n  ${[...shapes].join('\n  ')}`,
    ).toBeGreaterThanOrEqual(4);
  });

  it('EVERY clause that names an option is SEEN by the enforcement scanner', () => {
    const unseen = optionNamingClauses
      .filter(({ clause }) => !textAssertsLeadingOption(clause))
      .map(({ branch, clause }) => `composeComparison @ ${branch}\n      "${clause}"`);

    expect(
      unseen,
      'A clause emitted by `composeComparison` (routing/run-comparison-gate.ts) ' +
        'designates a leading option in prose the ENFORCEMENT scanner cannot see. ' +
        'Add the phrasing to LEADER_CLAIM_PATTERNS ' +
        '(compose/leading-option-egress-guard.ts) — do NOT relax this test. The ' +
        'enforcing consumers decide REPLACE-vs-APPEND on whether they can see a ' +
        'claim, so a clause they cannot see is a leader claim that ships beside ' +
        'the disclosure denying it.',
    ).toEqual([]);
  });

  it('EVERY clause that names an option is SEEN by the ALARM too', () => {
    // The two readers are deliberately different (the enforcer carves out
    // "leads to" / "team leads"), and BOTH consume this gate's output: the
    // egress guard scans `assistant_text` with the alarm's wide reader, and
    // `withheld-history-redaction.ts` reads the same prose back as prior-turn
    // context on a later withheld turn. Asserting only one leaves the other
    // free to drift.
    const unseen = optionNamingClauses
      .filter(({ clause }) => !textNamesLeadingOption(clause))
      .map(({ branch, clause }) => `composeComparison @ ${branch}\n      "${clause}"`);

    expect(unseen, 'A leader clause is invisible to the ALARM vocabulary.').toEqual([]);
  });

  it('MUTATION SENTINEL: the fully-withheld arms name NO option at all', () => {
    // Proves the clause filter DISCRIMINATES rather than matching everything —
    // and re-pins, from this file's angle, that the withheld substitutions do
    // not leak a label. If this ever goes red the assertions above are
    // measuring the wrong thing and their greens are worthless.
    const withheldBranches = optionNamingClauses.filter(({ branch }) =>
      /^(?:withheld|unstamped)\/(?:withheld|unstamped)\//.test(branch),
    );
    expect(
      withheldBranches.map(({ branch, clause }) => `${branch}: "${clause}"`),
      'a both-withheld arm named an option',
    ).toEqual([]);
  });

  it('MUTATION SENTINEL: the leader-FREE sentences are NOT seen', () => {
    // The other half of discrimination: the band shift and the follow-up ship
    // on every arm and rank nothing. If the scanner saw them, "every clause is
    // seen" would be true of a scanner that says yes to everything.
    for (const clause of [
      'The result is now stable, where before it was sensitive to your assumptions',
      'If you want to test this further, ask what would change the result',
    ]) {
      expect(textAssertsLeadingOption(clause), `scanner fired on: "${clause}"`).toBe(false);
      expect(textNamesLeadingOption(clause), `alarm fired on: "${clause}"`).toBe(false);
    }
  });
});
