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
  it('cites leading option label, raw probability, runner-up margin, and top drivers with sensitivity values', () => {
    const text = composeExplainResultsFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Raw probability value (0-1 fraction) — no per-cent conversion
    expect(text).toContain('0.62');
    expect(text).not.toContain('per cent');
    // Runner-up label and raw margin
    expect(text).toContain('Hire Two Mid-Level');
    expect(text).toContain('35');
    // Driver labels AND sensitivity values both surfaced
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

  it('mentions staleness when staleness_reason is present', () => {
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      staleness_reason: 'analysis_projection_loaded_with_unknown_freshness',
    });
    expect(text.toLowerCase()).toContain('directional');
  });

  it('staleness caveat appears BEFORE any figure when staleness_reason is present (Test H ordering)', () => {
    // Trust contract: the user reads "treat figures as directional" before
    // the figures themselves. Composer enforces this structurally by
    // placing the caveat as sentence #1.
    const text = composeExplainResultsFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    const caveatIdx = text.toLowerCase().indexOf('directional');
    const probabilityIdx = text.indexOf(String(ANALYSIS.leading_option!.probability));
    expect(caveatIdx).toBeGreaterThanOrEqual(0);
    expect(probabilityIdx).toBeGreaterThanOrEqual(0);
    expect(caveatIdx).toBeLessThan(probabilityIdx);
  });
});

describe('composeWhatWouldFlipFallback', () => {
  it('cites leading option, raw margin, and top drivers WITH sensitivity values — no mutation language', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS);
    expectNaturalProse(text);
    expect(text).toContain('Hire Senior Engineer');
    // Raw probability value
    expect(text).toContain('0.62');
    expect(text).not.toContain('per cent');
    expect(text).toContain('Hire Two Mid-Level');
    // Driver labels AND sensitivity values
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

  it('staleness caveat appears BEFORE any figure when staleness_reason is present (Test H ordering, what_would_flip path)', () => {
    // Brief task 3 layer 2: composeWhatWouldFlipFallback previously did
    // not handle staleness at all. Now it parallels
    // composeExplainResultsFallback — caveat as sentence #1 when present.
    const text = composeWhatWouldFlipFallback({
      ...ANALYSIS,
      staleness_reason: 'loaded_from_prior_run_freshness_unknown',
    });
    const caveatIdx = text.toLowerCase().indexOf('directional');
    const probabilityIdx = text.indexOf(String(ANALYSIS.leading_option!.probability));
    expect(caveatIdx).toBeGreaterThanOrEqual(0);
    expect(probabilityIdx).toBeGreaterThanOrEqual(0);
    expect(caveatIdx).toBeLessThan(probabilityIdx);
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

  it('uses named-factor pathways when the user mentioned a factor (path reaches goal)', () => {
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
    // Goal-reaching path → "feeds into" claim is allowed.
    expect(text).toMatch(/feeds into Q3 Throughput/);
  });

  it('does NOT claim a named factor "feeds into" the goal when the cited pathway reaches a sibling, not the goal', () => {
    // Over-claim guard: factor F is adjacent only to sibling F2 (no edge
    // to the goal). The fallback must describe the structural connection
    // without falsely asserting the factor reaches the goal — multi-hop
    // derivation would cross the F.6 line.
    const text = composeExplainFromStructureFallback({
      ...STRUCTURE,
      named_factor_label: 'Hiring Cost',
      named_factor_pathways: [
        {
          label_from: 'Hiring Cost',
          label_to: 'Engineering Capacity', // sibling factor, NOT the goal
          strength: 0.3,
        },
      ],
    });
    expect(text).toContain('Hiring Cost');
    expect(text).toContain('Engineering Capacity');
    expect(text).not.toMatch(/feeds into/);
    // Still mentions the goal elsewhere is fine, but must not assert the
    // named factor reaches it via the cited pathway.
    expect(text).toContain('connects to');
  });

  it('drops the "feeds into goal" claim when goal_label is null even if pathways exist', () => {
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
    expect(text).not.toMatch(/feeds into/);
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
    expect(text).toContain('Would you like');
  });
});
