/**
 * ROADMAP 2.1067 — PRODUCER CONTROL for the RUNNER-UP GAP STATISTIC on the
 * POST-ANALYSIS free-text surfaces.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS — the gap it closes is a GAP IN THE GUARDS, not a gap in
 * the vocabulary.
 *
 * PR #906 retired "{label} currently leads by {N} percentage points" from the
 * deterministic run_analysis HEADLINE, and `runner-up-gap-statistic.ts` became
 * the second line of defence over LLM decision-review prose. Neither reached
 * the six DETERMINISTIC composers below, and the reason is structural rather
 * than lexical: `leader-vocabulary-producer-control.test.ts` — the file that
 * exists precisely so a producer in this repo cannot emit prose a guard cannot
 * see — drives `composeExplainResultsFallback`, `composeWhatWouldFlipFallback`
 * and `composeComparison`, and asks them ONE question: *does the leader scanner
 * see this?* It never asks *does this state the size of the lead as a gap?*,
 * and it never drives the advice gate at all.
 *
 * So the frozen probe of 11 Aug 2026 measured, at `8e3ad916`, six live emitters
 * of the banned class on the ordinary permitted turn path — verbatim:
 *
 *   post-analysis-advice-gate.ts:1620  " It sits ahead of {runner} by {N} percentage points."
 *   post-analysis-advice-gate.ts:1736  " It sits ahead of "{runner}" by {N} percentage points."
 *   post-analysis-advice-gate.ts:1977  "That sits ahead of "{runner}" by {N} percentage points, so the lead is meaningful rather than marginal."
 *   post-analysis-advice-gate.ts:2184  "For "{runner}" to overtake it, the lead of {N} percentage points would need to close."
 *   explanation-fallback.ts:239        "That is ahead of {runner} by {N} percentage points, so the lead is meaningful rather than marginal."
 *   explanation-fallback.ts:240        "For "{runner}" to overtake it, the lead of {N} percentage points would need to close."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE MECHANISM, NOT THE INSTANCE (CLAUDE.md trap #12).
 *
 * The reader is NOT hand-written here. `findRunnerUpGapCodes` is the estate's
 * own detector, written against a corpus harvested from deployed captures — and
 * two of its patterns (`gap_ahead_of_by`, `gap_of`) were authored FROM these
 * very templates. Reusing it means a reworded emitter is covered on the commit
 * that writes it, and a widened detector immediately re-measures every producer
 * below. A hand list would be the fourth mirror in this defect's history.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EVERY SITE PINS ITS OWN PRECONDITION (CLAUDE.md trap 13b).
 *
 * A guard that asserts "no gap statistic" goes VACUOUS the moment a composer's
 * dispatch changes and the fixture stops reaching the branch that emitted one —
 * and it goes vacuous GREEN, which is the worst direction. So each site asserts,
 * before the absence:
 *
 *   (a) the shared verdict is on the CLEAR-margin arm with a runner-up present
 *       — the exact three-conjunct condition all six banned branches carry;
 *   (b) the emitted prose NAMES the runner-up by its exact injected label, so
 *       the comparison the sentence was about is demonstrably still being made;
 *   (c) the PRE-FIX sentence rebuilt from THIS fixture's own margin IS SEEN by
 *       the detector — i.e. this fixture would have produced a detected banned
 *       sentence before the fix. Without (c) a fixture whose margin quietly
 *       became undetectable would report a clean sweep.
 */
import { describe, it, expect } from 'vitest';

import { findRunnerUpGapCodes } from '../runner-up-gap-statistic.js';
import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
  composeRobustnessVerdict,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceClass,
  type AdviceGateAnalysis,
} from '../../routing/post-analysis-advice-gate.js';
import { formatPercentagePoints } from '../../format/format-analysis-value.js';

// ============================================================================
// The fixture — ONE analysis, driven through all six producers
// ============================================================================

const LEADING_LABEL = 'Standardise on MacBook Pro';
const RUNNER_LABEL = 'Standardise on Dell XPS';

/**
 * 34pp: unambiguously clear of the 1.0pp near-tie threshold in
 * `classifyNearTie`, so every site takes its CLEAR-margin arm — the one that
 * emitted the banned sentence. Chosen to match the `clear` case the sibling
 * producer control already uses, so the two files agree about what "clear" is.
 */
const MARGIN_PP = 34;

/**
 * The stability axis is ORTHOGONAL to the margin (see `RobustnessVerdict`), so
 * the banned sentence does not depend on it — but a band that silently started
 * gating the margin clause would make a single-band sweep vacuous. All five
 * band values the composers branch on are driven.
 */
const BANDS = ['fragile', 'stable', 'highly_stable', 'moderate', null] as const;

function gateAnalysis(band: string | null): AdviceGateAnalysis {
  return {
    status: 'success',
    leading_option: { label: LEADING_LABEL, probability: 0.61 },
    runner_up: { label: RUNNER_LABEL, probability: 0.27 },
    margin_pp: MARGIN_PP,
    robustness_band: band,
    top_drivers: [
      { factor_label: 'Engineering team size', sensitivity_value: 0.42 },
      { factor_label: 'Toolchain compatibility', sensitivity_value: -0.18 },
    ],
    fragile_edges: [
      { from_label: 'Toolchain compatibility', to_label: 'Team effectiveness' },
    ],
  };
}

function projection(band: string | null): AnalysisProjectionSummary {
  return {
    status: 'completed',
    leading_option: { label: LEADING_LABEL, probability: 0.61 },
    runner_up: { label: RUNNER_LABEL, probability: 0.27 },
    margin_pp: MARGIN_PP,
    robustness_band: band,
    top_drivers: [{ factor_label: 'Engineering team size', influence: 0.42 }],
    fragile_edges: [
      { from_label: 'Toolchain compatibility', to_label: 'Team effectiveness' },
    ],
  } as unknown as AnalysisProjectionSummary;
}

/**
 * The advice-gate composers are module-private by design, so each is reached
 * through the LIVE public entry with the message that classifies to its class —
 * the same corridor `turn-executor.ts:6617` uses. Binding to the entry rather
 * than to an exported internal is deliberate: it is the only way this control
 * can claim anything about what a user receives (CLAUDE.md trap 16).
 */
function driveGate(cls: AdviceClass, message: string, band: string | null): string {
  const out = tryPostAnalysisAdviceGate({
    message,
    analysis: gateAnalysis(band),
    freshness: 'fresh',
  });
  // THROW, not `expect`: this runs inside the sample builder, and a fixture
  // that stopped matching would otherwise make every assertion below pass on an
  // empty list (CLAUDE.md trap 2b / 13).
  if (!out.matched) {
    throw new Error(
      `advice gate stopped matching for ${cls} (band=${String(band)}): reason=${out.reason}. ` +
        'Every assertion in this file would be vacuous.',
    );
  }
  if (out.advice_class !== cls) {
    throw new Error(
      `message "${message}" now classifies as ${out.advice_class}, not ${cls} — ` +
        'this control would be measuring the wrong composer.',
    );
  }
  return out.assistant_text;
}

interface Site {
  /** The COMPOSER this site measures, named so a RED says which one leaked. */
  readonly producer: string;
  /** The frozen-probe site id, so the PR body and the suite use one vocabulary. */
  readonly probeSite: string;
  readonly mode: 'explain' | 'flip';
  readonly text: string;
  readonly band: string | null;
  /**
   * The sentence this site emitted BEFORE the fix, rebuilt from THIS fixture's
   * own margin — the precondition proof (c).
   */
  readonly preFixSentence: string;
}

function everySite(): Site[] {
  const out: Site[] = [];
  for (const band of BANDS) {
    const qty = formatPercentagePoints(MARGIN_PP);
    out.push({
      producer: 'composeAdvice',
      probeSite: 'post-analysis-advice-gate.ts:1620',
      mode: 'explain',
      band,
      text: driveGate('advice', 'What would you recommend?', band),
      preFixSentence: `It sits ahead of ${RUNNER_LABEL} by ${qty}.`,
    });
    out.push({
      producer: 'composeMeaning',
      probeSite: 'post-analysis-advice-gate.ts:1736',
      mode: 'explain',
      band,
      text: driveGate('meaning', 'What does this mean?', band),
      preFixSentence: `It sits ahead of "${RUNNER_LABEL}" by ${qty}.`,
    });
    out.push({
      producer: 'composeExplainResults',
      probeSite: 'post-analysis-advice-gate.ts:1977',
      mode: 'explain',
      band,
      text: driveGate('explain_results_free_text', 'Explain the results.', band),
      preFixSentence: `That sits ahead of "${RUNNER_LABEL}" by ${qty}, so the lead is meaningful rather than marginal.`,
    });
    out.push({
      producer: 'composeWhatWouldFlip',
      probeSite: 'post-analysis-advice-gate.ts:2184',
      mode: 'flip',
      band,
      text: driveGate('what_would_flip_free_text', 'What would flip this?', band),
      preFixSentence: `For "${RUNNER_LABEL}" to overtake it, the lead of ${qty} would need to close.`,
    });
    out.push({
      producer: 'composeRobustnessVerdict/explain (composeExplainResultsFallback)',
      probeSite: 'explanation-fallback.ts:239',
      mode: 'explain',
      band,
      text: composeExplainResultsFallback(projection(band), null, null),
      preFixSentence: `That is ahead of ${RUNNER_LABEL} by ${qty}, so the lead is meaningful rather than marginal.`,
    });
    out.push({
      producer: 'composeRobustnessVerdict/flip (composeWhatWouldFlipFallback)',
      probeSite: 'explanation-fallback.ts:240',
      mode: 'flip',
      band,
      text: composeWhatWouldFlipFallback(projection(band), null, null),
      preFixSentence: `For "${RUNNER_LABEL}" to overtake it, the lead of ${qty} would need to close.`,
    });
  }
  return out;
}

const SITE_COUNT = 6;

describe('PRODUCER CONTROL — no post-analysis surface states the lead as a gap between options', () => {
  const samples = everySite();

  it('drives all SIX emitters across the full robustness-band space', () => {
    // Non-vacuity for the enumeration itself.
    expect(samples).toHaveLength(BANDS.length * SITE_COUNT);
    for (const s of samples) {
      expect(
        s.text.length,
        `${s.producer} @ band=${String(s.band)} produced empty prose`,
      ).toBeGreaterThan(40);
    }
    // Every one of the six producers is represented — a refactor that collapsed
    // two sites into one must not silently shrink this control.
    expect(new Set(samples.map((s) => s.producer)).size).toBe(SITE_COUNT);
  });

  // ==========================================================================
  // PRECONDITION (a) — the shared verdict is on the arm that emitted the class
  // ==========================================================================
  it('PRECONDITION: every band puts the shared verdict on the CLEAR arm with a runner-up', () => {
    for (const band of BANDS) {
      for (const mode of ['explain', 'flip'] as const) {
        const verdict = composeRobustnessVerdict(
          {
            leading_option: { label: LEADING_LABEL },
            runner_up: { label: RUNNER_LABEL, probability: 0.27 },
            margin_pp: MARGIN_PP,
            robustness_band: band,
          },
          null,
          mode,
        );
        expect(
          verdict.margin_category,
          `band=${String(band)} mode=${mode}: the fixture no longer selects the clear-margin ` +
            'arm, so this control is measuring a branch that never emitted the banned sentence',
        ).toBe('clear');
      }
    }
    expect(Number.isFinite(MARGIN_PP)).toBe(true);
  });

  // ==========================================================================
  // PRECONDITION (b) — the comparison is still being made in the prose
  // ==========================================================================
  it('PRECONDITION: every site still names the runner-up by its injected label', () => {
    const silent = samples
      .filter((s) => !s.text.includes(RUNNER_LABEL))
      .map((s) => `${s.producer} @ band=${String(s.band)}`);
    expect(
      silent,
      'A site stopped naming the runner-up entirely. The absence assertion below would ' +
        'then pass because the COMPARISON vanished, not because the gap statistic did — ' +
        'and a surface that no longer answers "ahead of what?" is a separate regression. ' +
        'Bind this site to its new prose or row the behaviour change; do NOT delete this check.',
    ).toEqual([]);
  });

  // ==========================================================================
  // PRECONDITION (c) — this fixture's margin WOULD have produced a detected
  // banned sentence pre-fix
  // ==========================================================================
  it('PRECONDITION: each site\'s PRE-FIX sentence, rebuilt from this fixture, IS seen', () => {
    const unseen = [...new Map(samples.map((s) => [s.probeSite, s])).values()]
      .filter((s) => findRunnerUpGapCodes(s.preFixSentence).length === 0)
      .map((s) => `${s.producer} (${s.probeSite})\n      "${s.preFixSentence}"`);
    expect(
      unseen,
      'The sentence this site emitted BEFORE the fix is invisible to ' +
        '`findRunnerUpGapCodes`. That makes the absence assertion below vacuous for ' +
        'this site: it would read clean whether the emitter was fixed or not. Either ' +
        'the detector regressed (fix it in runner-up-gap-statistic.ts) or this ' +
        'fixture\'s margin stopped rendering a detectable quantity.',
    ).toEqual([]);
  });

  // ==========================================================================
  // THE GUARD
  // ==========================================================================
  it('NO site states the runner-up gap as a percentage-point magnitude', () => {
    const leaking = samples
      .map((s) => ({ ...s, codes: findRunnerUpGapCodes(s.text) }))
      .filter((s) => s.codes.length > 0)
      .map(
        (s) =>
          `${s.producer} (${s.probeSite}) @ band=${String(s.band)} — codes=[${s.codes.join(',')}]\n` +
          `      ${s.text.replace(/\n+/g, ' ⏎ ').slice(0, 320)}`,
      );

    expect(
      leaking,
      'A DETERMINISTIC post-analysis producer in THIS REPO states the size of the lead ' +
        'as a gap between two win frequencies. That number is not a difference in outcome, ' +
        'and it INFLATES BY CONSTRUCTION — a third option collapsing widens it with no ' +
        'improvement in the leader at all. State the leader\'s OWN result ("came out ahead ' +
        'in N% of runs of this model") or each option\'s own share separately. Do NOT relax ' +
        'this test, and do NOT narrow `findRunnerUpGapCodes` to make it pass.',
    ).toEqual([]);
  });

  // ==========================================================================
  // CONTROLS — the detector discriminates rather than saturating
  // ==========================================================================
  describe('detector controls (CLAUDE.md trap 13 — an absence probe needs a positive control)', () => {
    /** The six verbatim sentences the frozen probe measured live at `8e3ad916`. */
    const PROBE_VERBATIM: readonly string[] = [
      'It sits ahead of Standardise on Dell XPS by 34 percentage points.',
      'It sits ahead of "Standardise on Dell XPS" by 34 percentage points.',
      'That sits ahead of "Standardise on Dell XPS" by 34 percentage points, so the lead is meaningful rather than marginal.',
      'For "Standardise on Dell XPS" to overtake it, the lead of 34 percentage points would need to close.',
      'That is ahead of Standardise on Dell XPS by 34 percentage points, so the lead is meaningful rather than marginal.',
      'For "Standardise on Dell XPS" to overtake it, the lead of 34 percentage points would need to close.',
    ];

    it('POSITIVE CONTROL: the detector sees every sentence the probe measured live', () => {
      const missed = PROBE_VERBATIM.filter((s) => findRunnerUpGapCodes(s).length === 0);
      expect(
        missed,
        'The detector cannot see a sentence this product DEMONSTRABLY emitted. Every ' +
          'green in this file is then a green about nothing.',
      ).toEqual([]);
    });

    it('CONTRAST CONTROL: the RATIFIED honest forms are NOT seen', () => {
      // The other direction, and it has teeth: a detector that says yes to
      // everything would make the guard above pass only by deleting the
      // replacement copy too. These are the #906 forms this fix composes with.
      for (const honest of [
        'Standardise on MacBook Pro came out ahead in 61% of runs of this model.',
        'Based on this model, Standardise on MacBook Pro currently leads.',
        'Standardise on Dell XPS came out ahead in 27% of runs of this model.',
        'Standardise on MacBook Pro and Standardise on Dell XPS are effectively tied.',
      ]) {
        expect(
          findRunnerUpGapCodes(honest),
          `the detector fired on a RATIFIED-CORRECT sentence: "${honest}"`,
        ).toEqual([]);
      }
    });
  });
});
