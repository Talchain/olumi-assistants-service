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
  it('cites leading option label, probability, runner-up margin, and top drivers', () => {
    const text = composeExplainResultsFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    expect(text).toContain('62 per cent');
    expect(text).toContain('Hire Two Mid-Level');
    expect(text).toContain('35');
    expect(text).toContain('Engineering Capacity');
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

  it('mentions staleness when staleness_reason is present', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      staleness_reason: 'analysis_projection_loaded_with_unknown_freshness',
    });
    expect(text.toLowerCase()).toContain('directional');
  });
});

describe('composeWhatWouldFlipFallback', () => {
  it('cites leading option, margin, and top drivers — no mutation language', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    expect(text).toContain('Hire Two Mid-Level');
    expect(text).toContain('Engineering Capacity');
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
});

describe('composeExplainFromStructureFallback', () => {
  it('cites the strongest causal links and the goal label when no factor named', () => {
    const text = composeExplainFromStructureFallback(STRUCTURE);
    expectNaturalProse(text);
    expect(text).toContain('Q3 Throughput');
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('strength');
  });

  it('uses named-factor pathways when the user mentioned a factor', () => {
    const text = composeExplainFromStructureFallback({
      ...STRUCTURE,
      named_factor_label: 'Engineering Capacity',
      named_factor_pathways: [
        {
          label_from: 'Engineering Capacity',
          label_to: 'Q3 Throughput',
          strength: 0.65,
        },
      ],
    });
    expectNaturalProse(text);
    expect(text).toContain('Engineering Capacity');
    expect(text).toContain('Q3 Throughput');
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
    expect(text).toContain('Would you like');
  });
});
