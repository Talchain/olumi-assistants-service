/**
 * Deterministic fallback composers — unit tests.
 *
 * These run independently of any handler and assert that the composers
 * produce natural-paragraph output that meets the brief's copy rules:
 *  - sentence case, British English
 *  - no bullet lists
 *  - no internal terms (handler, validator, node, edge, fact, projection)
 *  - no "winner" / "recommended"
 *  - no mutation language
 *  - cites the values present in the projection
 */

import { describe, expect, it } from 'vitest';

import type {
  AnalysisProjectionSummary,
  StructureProjectionSummary,
} from '../../../context/projection-summaries.js';
import {
  composeExplainFromStructureFallback,
  composeExplainResultsFallback,
  composeWhatWouldFlipFallback,
} from '../explanation-fallback.js';

const ANALYSIS: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
  runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
  margin_pp: 35,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
    { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
  ],
  staleness_reason: null,
};

const STRUCTURE: StructureProjectionSummary = {
  goal_label: 'Q3 Throughput',
  top_causal_links: [
    { label_from: 'Engineering Capacity', label_to: 'Q3 Throughput', strength: 0.65 },
    { label_from: 'Hiring Cost', label_to: 'Q3 Throughput', strength: -0.42 },
  ],
  named_factor_label: undefined,
  named_factor_pathways: [],
  factor_count: 4,
  option_count: 2,
};

const FORBIDDEN_INTERNAL = [
  /\bhandlers?\b/i,
  /\bvalidators?\b/i,
  /\bnodes?\b/i,
  /\bedges?\b/i,
  /\bfacts?\b/i,
  /\bprojections?\b/i,
];
const FORBIDDEN_TONE = [/\bwinner\b/i, /\brecommended\b/i, /—/];

function expectNaturalProse(text: string) {
  expect(text.length).toBeGreaterThan(80);
  for (const pattern of FORBIDDEN_INTERNAL) expect(text).not.toMatch(pattern);
  for (const pattern of FORBIDDEN_TONE) expect(text).not.toMatch(pattern);
  // Sanity: paragraph not list.
  expect(text).not.toMatch(/^\s*[-*•]/m);
}

describe('composeExplainResultsFallback', () => {
  it('cites leading option label, probability as percentage, runner-up margin in percentage points, and top drivers with raw sensitivity values', () => {
    const text = composeExplainResultsFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Phase 2 workstream C: probabilities render as percentages, not raw
    // decimals. 0.62 → "62%". The legacy raw-decimal form must not appear
    // alongside the probability prose.
    expect(text).toContain('62%');
    expect(text).not.toContain('probability of 0.62');
    expect(text).not.toContain('per cent');
    // Runner-up label and margin in "N percentage points" prose form
    expect(text).toContain('Hire Two Mid-Level');
    expect(text).toContain('35 percentage points');
    // Driver labels AND sensitivity values both surfaced (sensitivity stays raw —
    // it is not a probability and converting would misrepresent the magnitude)
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('0.65');
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('-0.42');
    expect(text).toContain('robustness');
  });

  it('handles missing runner-up gracefully', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      runner_up: null,
      margin_pp: null,
    });
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    expect(text).not.toContain('runner_up');
  });

  it('returns generic fallback when projection lacks a leading option', () => {
    const text = composeExplainResultsFallback(undefined);
    expect(text).toContain('Would you like to');
  });

  it('does NOT include the staleness caveat (handler prepends it via applyStalenessPrefix)', () => {
    // The composer is no longer responsible for the staleness caveat — the
    // handler's applyStalenessPrefix helper prepends it to the final
    // assistant_text. Asserting absence here keeps prose ordering decisions
    // in one place (the helper), so a future composer change cannot
    // double-prepend.
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    expect(text.toLowerCase()).not.toContain('directional');
    expect(text.toLowerCase()).not.toContain('prior run');
  });
});

describe('composeWhatWouldFlipFallback', () => {
  it('cites leading option, margin in percentage points, and top drivers WITH sensitivity values — no mutation language', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Phase 2 workstream C: probability rendered as percentage
    expect(text).toContain('62%');
    expect(text).not.toContain('probability of 0.62');
    expect(text).not.toContain('per cent');
    expect(text).toContain('Hire Two Mid-Level');
    // Margin rendered as full "N percentage points" prose
    expect(text).toContain('35 percentage points');
    // Driver labels AND sensitivity values (sensitivity stays raw)
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('0.65');
    expect(text).toContain('-0.42');
    expect(text).not.toMatch(/\bproposing to\b/i);
    expect(text).not.toMatch(/\bI'll\s+\b/i);
  });

  it('includes a robustness sentence when projection has a robustness band', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expect(text.toLowerCase()).toContain('robustness');
  });

  it('returns generic fallback without leading option', () => {
    const text = composeWhatWouldFlipFallback({
      ...ANALYSIS,
      leading_option: null,
    });
    expect(text).toContain('Would you like to run the analysis');
  });

  it('does NOT include the staleness caveat (handler prepends it via applyStalenessPrefix)', () => {
    // Same contract as composeExplainResultsFallback — the handler's
    // applyStalenessPrefix helper owns the caveat. Asserting absence here
    // prevents accidental double-prefix when a future change lands.
    const text = composeWhatWouldFlipFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    expect(text.toLowerCase()).not.toContain('directional');
    expect(text.toLowerCase()).not.toContain('prior run');
  });
});

describe('composeExplainFromStructureFallback', () => {
  it('cites the strongest causal links and the goal label when no factor named', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: true });
    expectNaturalProse(text);
    expect(text).toContain('Q3 Throughput');
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('strength');
    // Olumi-style explanatory tone, not a system report.
    expect(text).toContain('shaped by several causal mechanisms');
  });

  it('length lands in [300, 600] for a typical 5-factor / 4-option graph', () => {
    const text = composeExplainFromStructureFallback(
      { ...STRUCTURE, factor_count: 5, option_count: 4 },
      { canRunAnalysis: true },
    );
    expect(text.length).toBeGreaterThanOrEqual(300);
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('canRunAnalysis=true → next-step nudge mentions "Running the analysis"', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: true });
    expect(text).toContain('Running the analysis');
  });

  it('canRunAnalysis=false → no "Running the analysis" nudge', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE, { canRunAnalysis: false });
    expect(text).not.toContain('Running the analysis');
  });

  it('omitted options default to no nudge (safer than nudging on a non-runnable graph)', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE);
    expect(text).not.toContain('Running the analysis');
  });

  it('uses named-factor pathways when the user mentioned a factor (path reaches goal)', () => {
    const text = composeExplainFromStructureFallback(
      {
        ...STRUCTURE,
        named_factor_label: 'Engineering Capacity',
        named_factor_pathways: [
          {
            label_from: 'Engineering Capacity',
            label_to: 'Q3 Throughput',
            strength: 0.65,
          },
        ],
      },
      { canRunAnalysis: true },
    );
    expectNaturalProse(text);
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Q3 Throughput');
    // Goal-reaching pathway → reach-to-goal claim is allowed and surfaced.
    expect(text).toMatch(/runs to Q3 Throughput/);
  });

  it('does NOT claim a named factor reaches the goal when the cited pathway reaches a sibling', () => {
    // Over-claim guard: factor F is adjacent only to sibling F2 (no link
    // to the goal). The fallback must describe the structural connection
    // without asserting the factor reaches the goal — multi-hop
    // derivation would cross the F.6 line.
    const text = composeExplainFromStructureFallback(
      {
        ...STRUCTURE,
        named_factor_label: 'Hiring Cost',
        named_factor_pathways: [
          {
            label_from: 'Hiring Cost',
            label_to: 'Engineering Capacity', // sibling factor, NOT the goal
            strength: 0.3,
          },
        ],
      },
      { canRunAnalysis: false },
    );
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('Engineering Capacity');
    // No reach-to-goal phrasing — the new prose uses "runs to <goal>" only
    // when reachesGoal is true.
    expect(text).not.toMatch(/runs to Q3 Throughput/);
    expect(text).not.toMatch(/effect on your goal/);
  });

  it('drops the reach-to-goal claim when goal_label is null even if pathways exist', () => {
    const text = composeExplainFromStructureFallback({
      ...STRUCTURE,
      goal_label: null,
      named_factor_label: 'Engineering Capacity',
      named_factor_pathways: [
        {
          label_from: 'Engineering Capacity',
          label_to: 'Some other node',
          strength: 0.65,
        },
      ],
    });
    expect(text).not.toMatch(/effect on your goal/);
    expect(text).toContain('Engineering Capacity');
  });

  it('handles an empty graph gracefully without crashing or leaking internal terms', () => {
    const text = composeExplainFromStructureFallback({
      goal_label: null,
      top_causal_links: [],
      named_factor_pathways: [],
      factor_count: 0,
      option_count: 0,
    });
    for (const pattern of FORBIDDEN_INTERNAL) expect(text).not.toMatch(pattern);
    expect(text).toContain('empty');
  });
});
