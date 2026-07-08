/**
 * format-analysis-for-context — display-safe analysis projection tests
 * (brief brief-display-safe-analysis A2 v2).
 *
 * The formatter is the upstream boundary that prevents raw analysis
 * floats from reaching Sonnet. These tests pin:
 *   - probability rendering (`0.862` → `"86%"`)
 *   - sensitivity-band phrasing across boundaries + near-zero
 *   - structural fragile-edge passthrough (labels only)
 *   - omission semantics (no `null` keys when source is missing)
 *   - the structural no-raw-floats invariant (recursive walk asserts
 *     no `number` field at any depth — strongest test in the brief)
 */

import { describe, expect, it } from 'vitest';

import type {
  ContextPackAnalysis,
  ContextPackAnalysisDriver,
  ContextPackAnalysisFragileEdge,
} from '../../context/context-pack-assembler.js';
import {
  formatAnalysisForContext,
  influencePhrase,
  tippingRiskPhrase,
  voiBandPhrase,
  DISPLAY_ANALYSIS_CHAR_BUDGET,
  GOAL_FIT_NOT_SCORED_LINE,
  type DisplaySafeAnalysis,
} from '../format-analysis-for-context.js';
import { sanitiseAssistantTextProse } from '../numeric-prose-formatter.js';

function rawDriver(label: string, sensitivityValue: number): ContextPackAnalysisDriver {
  return { factor_label: label, sensitivity_value: sensitivityValue };
}

function rawAnalysis(overrides: Partial<ContextPackAnalysis> = {}): ContextPackAnalysis {
  return {
    status: 'complete',
    leading_option: { label: 'Option A', probability: 0.862 },
    runner_up: { label: 'Option B', probability: 0.791 },
    margin_pp: 7.1,
    robustness_band: 'moderate',
    top_drivers: [rawDriver('Price', 1.0), rawDriver('Demand', -0.4)],
    fragile_edges: [],
    ...overrides,
  };
}

/**
 * Recursive structural assertion: walk every value at every depth and
 * verify nothing is a `number`. Display-safe values are strings,
 * arrays of strings, or nested objects — never floats.
 */
function assertNoNumbersAnywhere(value: unknown, path: string = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') {
    throw new Error(`Found number at ${path}: ${value}`);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNumbersAnywhere(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoNumbersAnywhere(v, `${path}.${k}`);
    }
    return;
  }
}

describe('formatAnalysisForContext', () => {
  it('returns null when raw analysis is null', () => {
    expect(formatAnalysisForContext(null)).toBeNull();
  });

  it('formats probabilities as integer percent strings', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: 'Option A', probability: 0.862 },
        runner_up: { label: 'Option B', probability: 0.5 },
      }),
    );
    expect(out!.leading_option).toEqual({ label: 'Option A', win_probability: '86%' });
    expect(out!.runner_up).toEqual({ label: 'Option B', win_probability: '50%' });
  });

  it('omits leading_option / runner_up when source is missing (no null fields)', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({ leading_option: null, runner_up: null }),
    );
    expect(out!).not.toHaveProperty('leading_option');
    expect(out!).not.toHaveProperty('runner_up');
  });

  it('renders margin_pp via formatPercentagePoints (singular at 1, omits at 0)', () => {
    const seven = formatAnalysisForContext(rawAnalysis({ margin_pp: 7 }));
    expect(seven!.margin).toBe('7 percentage points');

    const rounded = formatAnalysisForContext(rawAnalysis({ margin_pp: 7.6 }));
    expect(rounded!.margin).toBe('8 percentage points');

    const one = formatAnalysisForContext(rawAnalysis({ margin_pp: 1 }));
    expect(one!.margin).toBe('1 percentage point');

    const zero = formatAnalysisForContext(rawAnalysis({ margin_pp: 0 }));
    expect(zero!).not.toHaveProperty('margin');

    const missing = formatAnalysisForContext(rawAnalysis({ margin_pp: null }));
    expect(missing!).not.toHaveProperty('margin');
  });

  it('passes robustness_band through verbatim', () => {
    for (const band of ['fragile', 'moderate', 'stable', 'highly_stable'] as const) {
      const out = formatAnalysisForContext(rawAnalysis({ robustness_band: band }));
      expect(out!.robustness_band).toBe(band);
    }
  });

  it('omits robustness_band when source is null', () => {
    const out = formatAnalysisForContext(rawAnalysis({ robustness_band: null }));
    expect(out!).not.toHaveProperty('robustness_band');
  });

  it('translates top_drivers into decision-language influence phrases', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        top_drivers: [
          rawDriver('Price', 1.0),
          rawDriver('Demand', -0.4),
          rawDriver('Risk', 0.85),
        ],
      }),
    );
    expect(out!.top_drivers).toEqual([
      { label: 'Price', influence: 'very strong positive influence' },
      { label: 'Demand', influence: 'moderate negative influence' },
      { label: 'Risk', influence: 'strong positive influence' },
    ]);
  });

  it('omits top_drivers when source is empty', () => {
    const out = formatAnalysisForContext(rawAnalysis({ top_drivers: [] }));
    expect(out!).not.toHaveProperty('top_drivers');
  });

  it('passes structured fragile_edges through — labels only, no numerics', () => {
    const fragile: ContextPackAnalysisFragileEdge[] = [
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
      { from_label: 'Pricing', to_label: 'Conversion' },
    ];
    const out = formatAnalysisForContext(rawAnalysis({ fragile_edges: fragile }));
    expect(out!.fragile_edges).toEqual([
      { from_label: 'Marketing Spend', to_label: 'New Leads' },
      { from_label: 'Pricing', to_label: 'Conversion' },
    ]);
  });

  it('omits fragile_edges when the source array is empty', () => {
    const empty = formatAnalysisForContext(rawAnalysis({ fragile_edges: [] }));
    expect(empty!).not.toHaveProperty('fragile_edges');
  });

  it('full analysis: every field formatted together, no raw floats survive', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
      }),
    );
    expect(out).toEqual<DisplaySafeAnalysis>({
      status: 'complete',
      leading_option: { label: 'Option A', win_probability: '86%' },
      runner_up: { label: 'Option B', win_probability: '79%' },
      margin: '7 percentage points',
      robustness_band: 'moderate',
      top_drivers: [
        { label: 'Price', influence: 'very strong positive influence' },
        { label: 'Demand', influence: 'moderate negative influence' },
      ],
      fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
      // Lane 30 — target-fit absence is DISCLOSED, never silent, so the LLM
      // cannot fill the gap with win probabilities.
      goal_fit: GOAL_FIT_NOT_SCORED_LINE,
    });

    // Pattern check (regex from brief).
    expect(JSON.stringify(out)).not.toMatch(/\b0\.\d{2,}/);

    // Structural check (recursive walk — strongest invariant).
    assertNoNumbersAnywhere(out);
  });

  it('JSON.stringify recursively contains no raw floats', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: 'A', probability: 0.123456 },
        runner_up: { label: 'B', probability: 0.999 },
        margin_pp: 12.4,
        top_drivers: [rawDriver('F1', -0.55), rawDriver('F2', 0.1234)],
        fragile_edges: [{ from_label: 'X', to_label: 'Y' }],
      }),
    );
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/\b0\.\d{2,}/);
    expect(json).not.toContain('sensitivity_value');
    expect(json).not.toContain('strength');
    expect(json).not.toContain('exists_probability');
    assertNoNumbersAnywhere(out);
  });
});

describe('influencePhrase', () => {
  it('classifies positive sensitivities by absolute magnitude', () => {
    expect(influencePhrase(1.0)).toBe('very strong positive influence');
    expect(influencePhrase(0.95)).toBe('very strong positive influence');
    expect(influencePhrase(0.94)).toBe('strong positive influence');
    expect(influencePhrase(0.7)).toBe('strong positive influence');
    expect(influencePhrase(0.5)).toBe('moderate positive influence');
    expect(influencePhrase(0.3)).toBe('moderate positive influence');
    expect(influencePhrase(0.29)).toBe('weak positive influence');
    expect(influencePhrase(0.05)).toBe('weak positive influence');
  });

  it('mirrors bands for negative sensitivities', () => {
    expect(influencePhrase(-0.85)).toBe('strong negative influence');
    expect(influencePhrase(-0.4)).toBe('moderate negative influence');
    expect(influencePhrase(-0.95)).toBe('very strong negative influence');
    expect(influencePhrase(-0.29)).toBe('weak negative influence');
  });

  it('treats near-zero sensitivities as no material influence (no sign)', () => {
    expect(influencePhrase(0.0)).toBe('no material influence');
    expect(influencePhrase(0.01)).toBe('no material influence');
    expect(influencePhrase(-0.02)).toBe('no material influence');
    expect(influencePhrase(0.04)).toBe('no material influence');
    expect(influencePhrase(-0.049)).toBe('no material influence');
  });

  it('non-finite sensitivities resolve to no material influence', () => {
    expect(influencePhrase(Number.NaN)).toBe('no material influence');
    expect(influencePhrase(Number.POSITIVE_INFINITY)).toBe('no material influence');
    expect(influencePhrase(Number.NEGATIVE_INFINITY)).toBe('no material influence');
  });
});

// Lane 21 (P0-A) — breadth widening of the display-safe projection.
// Every option represented (ranked, integer-percent), tipping risks and VOI
// in banded phrasing only, goal-fit provenance as prose, fragile-edge count
// as a string. Doctrine A2 binding: NO raw numbers anywhere in the output.
describe('Lane 21 display-safe breadth', () => {
  it('renders ALL options with string ranks and integer-percent probabilities', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        options: [
          { label: 'Hire locally', probability: 0.719 },
          { label: 'Status quo', probability: 0.225 },
          { label: 'Offshore partner', probability: 0.054 },
          { label: 'Tiered pricing', probability: 0.001 },
        ],
      }),
    );
    expect(out!.options).toEqual([
      { rank: '1', label: 'Hire locally', win_probability: '72%' },
      { rank: '2', label: 'Status quo', win_probability: '23%' },
      { rank: '3', label: 'Offshore partner', win_probability: '5%' },
      { rank: '4', label: 'Tiered pricing', win_probability: '0%' },
    ]);
    assertNoNumbersAnywhere(out);
  });

  it('omits the options list when the source is missing or empty', () => {
    expect(formatAnalysisForContext(rawAnalysis())!).not.toHaveProperty('options');
    expect(
      formatAnalysisForContext(rawAnalysis({ options: [] }))!,
    ).not.toHaveProperty('options');
  });

  it('renders tipping points as banded risk phrases — never raw values', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        flip_thresholds: [
          // |88-100|/100 = 12% → moderate decrease
          { factor_label: 'Marketing Spend', current_value: 100, flip_value: 88, unit: 'GBP', no_flip_within_bounds: false },
          // |0.297-0.3|/0.3 = 1% → small decrease (close to tipping point)
          { factor_label: 'Engineering Capacity', current_value: 0.3, flip_value: 0.297, unit: null, no_flip_within_bounds: false },
          // producer-attested no-flip
          { factor_label: 'Offshore Engagement', current_value: 0, flip_value: null, unit: null, no_flip_within_bounds: true },
        ],
      }),
    );
    expect(out!.tipping_points).toEqual([
      { label: 'Marketing Spend', risk: 'a moderate decrease could flip the result' },
      { label: 'Engineering Capacity', risk: 'close to a tipping point — a small decrease could flip the result' },
      { label: 'Offshore Engagement', risk: 'no flip point found within the tested range' },
    ]);
    const json = JSON.stringify(out);
    expect(json).not.toContain('88');
    expect(json).not.toContain('0.297');
    assertNoNumbersAnywhere(out);
  });

  it('renders a large-shift tipping phrase and a direction-only phrase for zero current values', () => {
    expect(tippingRiskPhrase(10, 20, false)).toBe('only a large increase would flip the result');
    expect(tippingRiskPhrase(0, 5, false)).toBe('an increase in this factor could flip the result');
    expect(tippingRiskPhrase(null, null, true)).toBe('no flip point found within the tested range');
    expect(tippingRiskPhrase(null, null, false)).toBeNull();
    expect(tippingRiskPhrase(10, null, false)).toBeNull();
  });

  it('renders the fragile-edge count as a string alongside the label list', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        fragile_edges: [{ from_label: 'A', to_label: 'B' }],
        fragile_edge_count: 7,
      }),
    );
    expect(out!.fragile_edge_count).toBe('7');
    assertNoNumbersAnywhere(out);
  });

  it('bands evidence-gap VOI with the shared influence-band vocabulary', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        evidence_gaps: [
          { factor_label: 'Talent Market Tightness', voi_score: 0.63 },
          { factor_label: 'Hiring Cost', voi_score: 0.97 },
          { factor_label: 'Irrelevant Factor', voi_score: 0.01 },
        ],
      }),
    );
    expect(out!.value_of_information).toEqual([
      { label: 'Talent Market Tightness', value_of_information: 'moderate' },
      { label: 'Hiring Cost', value_of_information: 'very strong' },
      // near-zero VOI entries are dropped, not rendered as noise
    ]);
    assertNoNumbersAnywhere(out);
  });

  it('voiBandPhrase reuses the influence-band thresholds', () => {
    expect(voiBandPhrase(0.2)).toBe('weak');
    expect(voiBandPhrase(0.5)).toBe('moderate');
    expect(voiBandPhrase(0.8)).toBe('strong');
    expect(voiBandPhrase(0.96)).toBe('very strong');
    expect(voiBandPhrase(0.01)).toBeNull();
    expect(voiBandPhrase(Number.NaN)).toBeNull();
  });

  it('renders the goal-fit basis as prose — the fact it was scored, never values', () => {
    const modelled = formatAnalysisForContext(
      rawAnalysis({ goal_fit: { scored: true, basis: 'modelled_outcome_distribution' } }),
    );
    expect(modelled!.goal_fit).toContain(
      'goal fit was scored from the modelled outcome distribution',
    );

    const bare = formatAnalysisForContext(
      rawAnalysis({ goal_fit: { scored: true, basis: null } }),
    );
    expect(bare!.goal_fit).toContain('goal fit was scored');
  });

  it('keeps a maximal widened projection inside the display char budget with no numbers anywhere', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        options: Array.from({ length: 12 }, (_, i) => ({
          label: `Long Option Label Number ${String(i + 1).padStart(2, '0')} With Detail`,
          probability: Math.max(0.01, 0.9 - i * 0.07),
        })),
        top_drivers: [
          rawDriver('Marketing Spend Allocation Across Channels', 0.97),
          rawDriver('Engineering Capacity Constraints In Q3', -0.82),
          rawDriver('Customer Acquisition Cost Trend', 0.55),
          rawDriver('Local Talent Market Tightness', -0.31),
          rawDriver('Regulatory Approval Timeline', 0.12),
        ],
        fragile_edges: [
          { from_label: 'Marketing Spend Allocation', to_label: 'New Leads Generated' },
          { from_label: 'Engineering Capacity', to_label: 'Time to Market' },
          { from_label: 'Talent Market Tightness', to_label: 'Hiring Velocity' },
        ],
        fragile_edge_count: 9,
        flip_thresholds: [
          { factor_label: 'Marketing Spend', current_value: 100, flip_value: 88, unit: 'GBP', no_flip_within_bounds: false },
          { factor_label: 'Engineering Capacity', current_value: 0.3, flip_value: 0.297, unit: null, no_flip_within_bounds: false },
          { factor_label: 'Offshore Engagement', current_value: 0, flip_value: null, unit: null, no_flip_within_bounds: true },
        ],
        evidence_gaps: [
          { factor_label: 'Talent Market Tightness', voi_score: 0.63 },
          { factor_label: 'Hiring Cost Uncertainty', voi_score: 0.42 },
          { factor_label: 'Churn Rate Confidence', voi_score: 0.31 },
        ],
        goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
      }),
    );
    const serialised = JSON.stringify(out, null, 2);
    expect(serialised.length).toBeLessThan(DISPLAY_ANALYSIS_CHAR_BUDGET);
    expect(serialised).not.toMatch(/\b0\.\d{2,}/);
    assertNoNumbersAnywhere(out);

    // The Track 2A regex sanitiser must see nothing to rewrite.
    const result = sanitiseAssistantTextProse(serialised);
    expect(result.probability_rewrites).toBe(0);
    expect(result.sensitivity_rewrites).toBe(0);
  });
});

// Lane 30 — per-option goal-fit (target-fit) truthfulness.
//
// THE LIVE DEFECT (scenario 90385279, 2026-07-08 ~01:00): asked "how does
// each option look against my 25% target?", the orchestrator LLM answered
// with WIN probabilities framed as target-fit ("leads comfortably at 89%")
// while the delivered probability_of_joint_goal was 29.3% — because the
// ContextPack carried only a global goal-fit provenance sentence, never the
// per-option values. These tests pin the fix: per-option target-fit percent
// strings, clearly distinguished from win probability, and a DISCLOSED
// absence line when target-fit was not scored (never a silent gap the LLM
// can fill with win%).
describe('Lane 30 per-option target-fit', () => {
  // The live divergence: leader wins 89% of comparisons but meets the
  // target only 29.3% of the time.
  const divergent = () =>
    rawAnalysis({
      leading_option: { label: 'Relocate to Manchester', probability: 0.89, goal_fit_probability: 0.293 },
      runner_up: { label: 'Stay in London', probability: 0.11, goal_fit_probability: 0.31 },
      options: [
        { label: 'Relocate to Manchester', probability: 0.89, goal_fit_probability: 0.293 },
        { label: 'Stay in London', probability: 0.11, goal_fit_probability: 0.31 },
      ],
      goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
    });

  it('renders per-option target_fit percent strings distinct from win_probability', () => {
    const out = formatAnalysisForContext(divergent());
    expect(out!.options).toEqual([
      { rank: '1', label: 'Relocate to Manchester', win_probability: '89%', target_fit: '29%' },
      { rank: '2', label: 'Stay in London', win_probability: '11%', target_fit: '31%' },
    ]);
    expect(out!.leading_option).toEqual({
      label: 'Relocate to Manchester',
      win_probability: '89%',
      target_fit: '29%',
    });
    assertNoNumbersAnywhere(out);
  });

  it('never attributes the win percent to the target', () => {
    const out = formatAnalysisForContext(divergent());
    // The target-fit value for the leader is the goal-fit percent — NOT the
    // win percent. This is the exact live-defect assertion (0.89 vs 0.293).
    expect(out!.options![0]!.target_fit).toBe('29%');
    expect(out!.options![0]!.target_fit).not.toBe(out!.options![0]!.win_probability);
    // The goal-fit prose must define the distinction and carry no percents.
    expect(out!.goal_fit).toContain('target_fit');
    expect(out!.goal_fit).toContain('win_probability');
    expect(out!.goal_fit).not.toContain('89%');
    expect(out!.goal_fit).not.toContain('29%');
  });

  it('states the modelled-outcome basis caveat once, in the goal_fit prose', () => {
    const out = formatAnalysisForContext(divergent());
    expect(out!.goal_fit).toContain('goal fit was scored from the modelled outcome distribution');
    // Basis caveat appears once, not per option.
    const serialised = JSON.stringify(out);
    expect(serialised.match(/modelled outcome distribution/g)).toHaveLength(1);
  });

  it('renders an explicit "target-fit not scored" line when goal-fit is absent — never silent', () => {
    const out = formatAnalysisForContext(rawAnalysis({ goal_fit: null }));
    expect(out!.goal_fit).toBe(GOAL_FIT_NOT_SCORED_LINE);
    expect(out!.goal_fit).toContain('target-fit not scored');
    // The absence line must warn that win% is not a substitute.
    expect(out!.goal_fit!.toLowerCase()).toContain('win');
  });

  it('discloses missing per-option values when provenance says scored but no values arrived', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        options: [{ label: 'A', probability: 0.7 }],
        goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
      }),
    );
    expect(out!.goal_fit).toContain('goal fit was scored from the modelled outcome distribution');
    expect(out!.goal_fit).toContain('per-option target-fit values are not available');
    expect(out!.options![0]!).not.toHaveProperty('target_fit');
  });

  it('drops an out-of-range goal_fit_probability rather than rendering a wrong percent', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        options: [{ label: 'A', probability: 0.7, goal_fit_probability: 4.2 }],
        goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
      }),
    );
    expect(out!.options![0]!).not.toHaveProperty('target_fit');
  });
});

// Lane 30 fix 3 — confidence tier prose + banded per-option outcomes.
describe('Lane 30 confidence tier + outcome bands', () => {
  it('renders known confidence tiers as prose', () => {
    const needsWork = formatAnalysisForContext(rawAnalysis({ confidence_tier: 'needs_work' }));
    expect(needsWork!.confidence_tier).toBe('analysis confidence needs work');

    const fair = formatAnalysisForContext(rawAnalysis({ confidence_tier: 'fair' }));
    expect(fair!.confidence_tier).toBe('analysis confidence is fair');

    const strong = formatAnalysisForContext(rawAnalysis({ confidence_tier: 'strong' }));
    expect(strong!.confidence_tier).toBe('analysis confidence is strong');
  });

  it('humanises unknown tier tokens rather than echoing raw, omits when absent', () => {
    const unknown = formatAnalysisForContext(rawAnalysis({ confidence_tier: 'very_shaky' }));
    expect(unknown!.confidence_tier).toBe('analysis confidence: very shaky');

    const absent = formatAnalysisForContext(rawAnalysis({ confidence_tier: null }));
    expect(absent!).not.toHaveProperty('confidence_tier');

    const missing = formatAnalysisForContext(rawAnalysis());
    expect(missing!).not.toHaveProperty('confidence_tier');
  });

  it('bands per-option outcomes with the shared vocabulary — never raw means', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        options: [
          { label: 'A', probability: 0.72, outcome_mean: 0.237 },
          { label: 'B', probability: 0.2, outcome_mean: -0.4 },
          { label: 'C', probability: 0.05, outcome_mean: 0.01 },
          { label: 'D', probability: 0.03 },
        ],
      }),
    );
    expect(out!.options).toEqual([
      { rank: '1', label: 'A', win_probability: '72%', outcome_band: 'weak positive modelled outcome' },
      { rank: '2', label: 'B', win_probability: '20%', outcome_band: 'moderate negative modelled outcome' },
      { rank: '3', label: 'C', win_probability: '5%', outcome_band: 'roughly neutral modelled outcome' },
      { rank: '4', label: 'D', win_probability: '3%' },
    ]);
    const json = JSON.stringify(out);
    expect(json).not.toContain('0.237');
    expect(json).not.toContain('-0.4');
    assertNoNumbersAnywhere(out);
  });

  it('bands the leading option outcome too', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        leading_option: { label: 'A', probability: 0.86, outcome_mean: 0.97 },
      }),
    );
    expect(out!.leading_option).toEqual({
      label: 'A',
      win_probability: '86%',
      outcome_band: 'very strong positive modelled outcome',
    });
  });
});

// Lane 30 fix 4 — DISPLAY_ANALYSIS_CHAR_BUDGET becomes RUNTIME-ENFORCED.
// Before this lane the budget was test-asserted only: a live pack with long
// labels could blow the ~21k-char routing prompt's analysis share silently.
// Truncation is graceful (keep-priority: leader/runner-up + goal-fit, then
// sensitivities, then flip/VOI) and ALWAYS disclosed via truncation_note.
describe('Lane 30 runtime char-budget enforcement', () => {
  const LONG = (i: number) =>
    `Extremely Long Option Label ${String(i).padStart(2, '0')} ` +
    'With An Enormous Amount Of Repeated Qualifier Text That Inflates The Serialised Projection '.repeat(3);

  const oversized = () =>
    rawAnalysis({
      leading_option: { label: LONG(1), probability: 0.62, goal_fit_probability: 0.31 },
      runner_up: { label: LONG(2), probability: 0.38, goal_fit_probability: 0.22 },
      options: Array.from({ length: 12 }, (_, i) => ({
        label: LONG(i + 1),
        probability: Math.max(0.01, 0.62 - i * 0.05),
        goal_fit_probability: 0.31,
        outcome_mean: 0.4,
      })),
      top_drivers: Array.from({ length: 5 }, (_, i) =>
        rawDriver(`Driver ${LONG(i + 1)}`, 0.9 - i * 0.1),
      ),
      fragile_edges: Array.from({ length: 3 }, (_, i) => ({
        from_label: `From ${LONG(i + 1)}`,
        to_label: `To ${LONG(i + 1)}`,
      })),
      fragile_edge_count: 9,
      flip_thresholds: Array.from({ length: 3 }, (_, i) => ({
        factor_label: `Flip ${LONG(i + 1)}`,
        current_value: 100,
        flip_value: 88,
        unit: 'GBP',
        no_flip_within_bounds: false,
      })),
      evidence_gaps: Array.from({ length: 3 }, (_, i) => ({
        factor_label: `Gap ${LONG(i + 1)}`,
        voi_score: 0.63,
      })),
      goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
      confidence_tier: 'needs_work',
    });

  it('keeps the serialised projection inside the budget at runtime (long-label fixture)', () => {
    const out = formatAnalysisForContext(oversized());
    const serialised = JSON.stringify(out, null, 2);
    expect(serialised.length).toBeLessThanOrEqual(DISPLAY_ANALYSIS_CHAR_BUDGET);
    assertNoNumbersAnywhere(out);
  });

  it('truncation is DISCLOSED, never silent, and preserves the priority sections', () => {
    const out = formatAnalysisForContext(oversized());
    expect(out!.truncation_note).toBeDefined();
    expect(out!.truncation_note).toContain('truncated');
    // Highest keep-priority content survives.
    expect(out!.leading_option).toBeDefined();
    expect(out!.leading_option!.target_fit).toBe('31%');
    expect(out!.runner_up).toBeDefined();
    expect(out!.goal_fit).toBeDefined();
    expect(out!.status).toBe('complete');
  });

  it('drops flip/VOI before sensitivities, and sensitivities before the option list', () => {
    const out = formatAnalysisForContext(oversized());
    // VOI + tipping must be gone before top_drivers is touched; if
    // top_drivers is absent then flip/VOI must also be absent.
    if (out!.top_drivers !== undefined) {
      expect(out!.value_of_information).toBeUndefined();
      expect(out!.tipping_points).toBeUndefined();
    }
    // The ranked option list (carrier of per-option goal-fit) outlives the
    // low-priority sections; when trimmed it keeps at least the top two.
    if (out!.options !== undefined) {
      expect(out!.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('emits no truncation_note when the projection fits the budget', () => {
    const out = formatAnalysisForContext(rawAnalysis());
    expect(out!).not.toHaveProperty('truncation_note');
  });

  it('discloses which sections were omitted', () => {
    const out = formatAnalysisForContext(oversized());
    // The oversized fixture cannot fit with VOI + tipping present; both are
    // named in the disclosure once dropped.
    expect(out!.truncation_note).toContain('value_of_information');
    expect(out!.truncation_note).toContain('tipping_points');
  });
});

// brief brief-display-safe-analysis A2 — negative test
// Formatted analysis serialised through the Track 2A regex sanitiser must
// produce zero probability_rewrites and zero sensitivity_rewrites. Proves
// the upstream display-safe projection eliminates the defect class
// (raw decimals + raw sensitivities) that the post-compose rewriter targets.
describe('display-safe projection drives Track 2A rewrites to zero', () => {
  it('serialised display-safe analysis is invisible to the Track 2A regex sanitiser', () => {
    const out = formatAnalysisForContext(
      rawAnalysis({
        fragile_edges: [{ from_label: 'Marketing Spend', to_label: 'New Leads' }],
      }),
    );
    const serialised = JSON.stringify(out, null, 2);
    const result = sanitiseAssistantTextProse(serialised);
    expect(result.probability_rewrites).toBe(0);
    expect(result.sensitivity_rewrites).toBe(0);
  });

  it('display-safe phrases verbatim do not match the sanitiser regexes', () => {
    const phrases = [
      '"86%"',
      '"79%"',
      '"7 percentage points"',
      '"very strong positive influence"',
      '"moderate negative influence"',
      '"no material influence"',
      '"weak positive influence"',
      '"strong negative influence"',
    ].join(' ');
    const result = sanitiseAssistantTextProse(phrases);
    expect(result.probability_rewrites).toBe(0);
    expect(result.sensitivity_rewrites).toBe(0);
  });
});
