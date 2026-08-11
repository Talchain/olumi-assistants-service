/**
 * V5 Phase 2 workstream C — numeric format contract.
 *
 * Pin user-facing prose: every probability value sourced from a known
 * structured field renders as a percentage in `assistant_text`, never
 * as a raw decimal. Sensitivity and edge-strength values are deliberately
 * excluded from this assertion (they remain raw — they are not probabilities).
 *
 * ⚠ ROADMAP 2.1067 — THE MARGIN HALF OF THIS CONTRACT IS INVERTED. This file
 * used to assert `margins render as "N percentage points"`. The runner-up gap
 * is no longer rendered AT ALL: it is the difference between two P(argmax)
 * statistics, not a difference in outcome, and it inflates by construction when
 * any third option collapses (PR #906 retired the same family from the
 * run_analysis headline). Both fallbacks now report each option's OWN win
 * share. So the contract this file pins is stronger, not weaker: BOTH
 * probabilities must render as percentages, and the formatted margin must be
 * ABSENT. The absent-string is DERIVED from `formatPercentagePoints`, not hand
 * written, so a change to the formatter cannot make this assertion vacuous.
 *
 * The test does NOT use a global regex scan against the prose: that
 * approach would produce false positives on legitimate sensitivity /
 * strength values. Instead, for each known fixture, the test computes
 * the expected display string for every probability/margin field and
 * asserts each string appears in the prose.
 */

import { describe, expect, it } from 'vitest';

import {
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../../src/orchestrator-v5/tools/handlers/explanation-fallback.js';
import {
  formatPercentagePoints,
  formatProbability,
} from '../../src/orchestrator-v5/format/format-analysis-value.js';
import { isNearTieByMargin } from '../../src/orchestrator-v5/coaching/robustness-honesty.js';
import type { AnalysisProjectionSummary } from '../../src/orchestrator-v5/context/projection-summaries.js';

interface ProbabilityFixture {
  readonly leader_probability: number;
  readonly runner_probability: number;
  readonly margin_pp: number;
}

const FIXTURES: readonly ProbabilityFixture[] = [
  { leader_probability: 0.62, runner_probability: 0.38, margin_pp: 24 },
  { leader_probability: 0.964, runner_probability: 0.025, margin_pp: 94 },
  { leader_probability: 0.5, runner_probability: 0.499, margin_pp: 0.1 },
  { leader_probability: 0.999, runner_probability: 0.001, margin_pp: 99.8 },
  { leader_probability: 0.05, runner_probability: 0.04, margin_pp: 1 },
];

function buildProjection(f: ProbabilityFixture): AnalysisProjectionSummary {
  return {
    status: 'ready',
    leading_option: { label: 'Option A', probability: f.leader_probability },
    runner_up: { label: 'Option B', probability: f.runner_probability },
    margin_pp: f.margin_pp,
    robustness_band: 'moderate',
    top_drivers: [
      { factor_label: 'Cost', sensitivity_value: 0.42 },
    ],
  };
}

describe('phase2 numeric format — explain_results fallback', () => {
  it.each(FIXTURES)(
    'renders probabilities as percentages and margins as "percentage points" (leader=$leader_probability)',
    (fixture) => {
      const projection = buildProjection(fixture);
      const prose = composeExplainResultsFallback(projection);

      // Every probability value must appear in display form (never as raw decimal)
      const expectedLeaderDisplay = formatProbability(fixture.leader_probability);
      expect(prose).toContain(expectedLeaderDisplay);

      // Near-tie margins are a deliberate claim-honesty carve-out (S4 / PR
      // #270): a near-zero / sub-threshold margin reads "effectively tied".
      // ROADMAP 2.1067 — the CLEAR arm no longer cites a percentage-points
      // figure either; it states the runner-up's OWN win share. So both arms
      // now assert the ABSENCE of the formatted margin, and the clear arm
      // additionally pins the second probability that replaced it.
      if (isNearTieByMargin(fixture.margin_pp, null)) {
        expect(prose).toContain('effectively tied');
      } else {
        expect(prose).toContain(formatProbability(fixture.runner_probability));
      }
      expect(prose).not.toContain(formatPercentagePoints(fixture.margin_pp));
      expect(prose).not.toMatch(/percentage points?/i);

      // The raw leader probability must NOT appear in user-facing prose
      // when its display form differs from the raw stringification (e.g.
      // 0.62 → "62%", so "0.62" should be absent). This catches the
      // pre-Phase-2 "performs best, with a probability of 0.62" bug.
      const rawLeaderStr = String(fixture.leader_probability);
      if (rawLeaderStr !== expectedLeaderDisplay) {
        expect(prose).not.toContain(`probability of ${rawLeaderStr}`);
      }
    },
  );
});

describe('phase2 numeric format — what_would_flip fallback', () => {
  it.each(FIXTURES)(
    'renders probabilities as percentages and margins as "percentage points" (leader=$leader_probability)',
    (fixture) => {
      const projection = buildProjection(fixture);
      const prose = composeWhatWouldFlipFallback(projection);

      const expectedLeaderDisplay = formatProbability(fixture.leader_probability);
      expect(prose).toContain(expectedLeaderDisplay);

      // ROADMAP 2.1067 — "the lead of N percentage points would need to close"
      // was never emitted on the near-tie arm; it is now emitted on NO arm.
      // The contender is named with its own win share instead.
      if (isNearTieByMargin(fixture.margin_pp, null)) {
        expect(prose).toContain('effectively tied');
      } else {
        expect(prose).toContain(formatProbability(fixture.runner_probability));
      }
      expect(prose).not.toContain(formatPercentagePoints(fixture.margin_pp));
      expect(prose).not.toMatch(/percentage points?/i);

      const rawLeaderStr = String(fixture.leader_probability);
      if (rawLeaderStr !== expectedLeaderDisplay) {
        expect(prose).not.toContain(`probability of ${rawLeaderStr}`);
      }
    },
  );
});

describe('phase2 numeric format — sensitivity rendering', () => {
  it('sensitivity_value is rendered as bucketed lead-framing prose, never as a raw decimal and never as a percentage', () => {
    // Phase 2's original contract was "sensitivity stays raw — never
    // a percentage". The V5 interaction recovery tranche superseded
    // that with a stronger guarantee: sensitivity values must NEVER
    // appear as raw decimals in user-facing prose either, because
    // numbers like `-0.7346` were the source of the brief's evidence
    // #4 failure. The fallback composes adverbial lead-framing prose
    // via `formatSensitivityDirection` (delegates to
    // `bandFromMagnitude`).
    //
    // The original sub-claim "never as a percentage" remains and is
    // strengthened: not as a raw decimal either, AND specifically
    // bucketed prose appears.
    const projection: AnalysisProjectionSummary = {
      status: 'ready',
      leading_option: { label: 'A', probability: 0.6 },
      runner_up: { label: 'B', probability: 0.4 },
      margin_pp: 20,
      robustness_band: null,
      top_drivers: [
        { factor_label: 'Cost', sensitivity_value: 0.42 },
      ],
    };
    const prose = composeExplainResultsFallback(projection);

    // Original contract: never as a percentage.
    expect(prose).not.toContain('sensitivity 42%');
    // V5 interaction recovery: never as a raw decimal in prose.
    expect(prose).not.toContain('0.42');
    expect(prose).not.toMatch(/-?\d+\.\d{2,}/);
    // Bucketed lead-framing prose appears (0.42 falls in the
    // moderate band [0.3, 0.7), positive sign).
    expect(prose).toMatch(/moderately strengthens the lead/);
  });
});
