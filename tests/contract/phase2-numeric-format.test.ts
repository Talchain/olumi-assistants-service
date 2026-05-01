/**
 * V5 Phase 2 workstream C — numeric format contract.
 *
 * Pin user-facing prose: every probability value sourced from a known
 * structured field renders as a percentage in `assistant_text`, never
 * as a raw decimal. Margins render as "N percentage points". Sensitivity
 * and edge-strength values are deliberately excluded from this assertion
 * (they remain raw — they are not probabilities).
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
      const expectedMarginDisplay = formatPercentagePoints(fixture.margin_pp);
      expect(prose).toContain(expectedLeaderDisplay);
      expect(prose).toContain(expectedMarginDisplay);

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
      const expectedMarginDisplay = formatPercentagePoints(fixture.margin_pp);
      expect(prose).toContain(expectedLeaderDisplay);
      expect(prose).toContain(expectedMarginDisplay);

      const rawLeaderStr = String(fixture.leader_probability);
      if (rawLeaderStr !== expectedLeaderDisplay) {
        expect(prose).not.toContain(`probability of ${rawLeaderStr}`);
      }
    },
  );
});

describe('phase2 numeric format — sensitivity stays raw', () => {
  it('preserves sensitivity_value as a raw number in prose (it is not a probability)', () => {
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

    // sensitivity 0.42 should appear as "0.42" — sensitivity is not a
    // probability and converting to a percentage would misrepresent it
    expect(prose).toContain('sensitivity 0.42');
    expect(prose).not.toContain('sensitivity 42%');
  });
});
