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
 * `composeExplainResultsFallback` and `composeWhatWouldFlipFallback`. Sonnet's
 * free prose is unbounded and cannot be enumerated; it remains covered by the
 * pattern list as a best-effort net, and the live walk is what measures the
 * residue there. What this file removes is the excuse for missing a string THE
 * REPO ITSELF WRITES.
 */
import { describe, it, expect } from 'vitest';

import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';

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
