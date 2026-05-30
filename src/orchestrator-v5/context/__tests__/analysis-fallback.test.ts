/**
 * Unit tests for buildAnalysisFromPriorFacts — V5 Task 1.4.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildAnalysisFromPriorFacts,
  FALLBACK_STALENESS_REASON,
} from '../analysis-fallback.js';

function runAnalysisFact(overrides: {
  leadingOptionId?: string | null;
  winProbabilities?: Record<string, number>;
  noop?: boolean;
  summary?: string;
}): HandlerFact {
  const leadingOptionId =
    'leadingOptionId' in overrides ? overrides.leadingOptionId! : 'opt-a';
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: overrides.noop ?? false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: leadingOptionId,
      win_probabilities: overrides.winProbabilities,
      summary: overrides.summary ?? 'Prior run',
    },
  };
}

describe('buildAnalysisFromPriorFacts', () => {
  it('returns null when no facts present', () => {
    expect(buildAnalysisFromPriorFacts([])).toBeNull();
  });

  it('returns null when no run_analysis fact is present', () => {
    // Build a non-run_analysis fact shape — any HandlerFact variant that
    // isn't run_analysis will do; buildAnalysisFromPriorFacts.find()
    // rejects it.
    const explainFact = {
      fact_type: 'explain_result',
      fact_version: 1,
      noop: false,
      result: { narrative: 'x', referenced_option_ids: [] },
    } as unknown as HandlerFact;
    expect(buildAnalysisFromPriorFacts([explainFact])).toBeNull();
  });

  it('returns null when the only run_analysis fact is a noop', () => {
    const fact = runAnalysisFact({ noop: true });
    expect(buildAnalysisFromPriorFacts([fact])).toBeNull();
  });

  it('projects winner from leading_option_id + its win probability', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 0.62, 'opt-b': 0.38 },
    });
    const summary = buildAnalysisFromPriorFacts([fact]);
    expect(summary).not.toBeNull();
    expect(summary!.winner.option_id).toBe('opt-a');
    expect(summary!.winner.win_probability).toBeCloseTo(0.62);
  });

  it('projects all options sorted descending by probability', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-c': 0.2, 'opt-a': 0.5, 'opt-b': 0.3 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    expect(summary.options.map((o) => o.option_id)).toEqual(['opt-a', 'opt-b', 'opt-c']);
  });

  it('computes margin as winner minus runner-up', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 0.7, 'opt-b': 0.3 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    expect(summary.margin).toBeCloseTo(0.4);
  });

  it('returns null margin when fewer than 2 options', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 1.0 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    expect(summary.margin).toBeNull();
  });

  it('uses option_id as option_label (fact does not carry labels)', () => {
    const fact = runAnalysisFact({
      winProbabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    for (const opt of summary.options) {
      expect(opt.option_label).toBe(opt.option_id);
    }
  });

  it('defaults top_drivers / fragile_edge_count / robustness_level when fact omits them', () => {
    const fact = runAnalysisFact({
      winProbabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    expect(summary.top_drivers).toEqual([]);
    expect(summary.fragile_edge_count).toBe(0);
    expect(summary.robustness_level).toBe('unknown');
    expect(summary.analysis_status).toBe('complete');
  });

  it('picks the FIRST run_analysis fact when multiple present (newest-first order)', () => {
    const newest = runAnalysisFact({
      leadingOptionId: 'opt-new',
      winProbabilities: { 'opt-new': 0.9, 'opt-old': 0.1 },
    });
    const older = runAnalysisFact({
      leadingOptionId: 'opt-old',
      winProbabilities: { 'opt-old': 0.9, 'opt-new': 0.1 },
    });
    const summary = buildAnalysisFromPriorFacts([newest, older])!;
    expect(summary.winner.option_id).toBe('opt-new');
  });

  it('still returns a summary when leading_option_id is null but win_probabilities present', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: { 'opt-b': 0.6, 'opt-a': 0.4 },
    });
    const summary = buildAnalysisFromPriorFacts([fact])!;
    expect(summary).not.toBeNull();
    expect(summary.winner.option_id).toBe('opt-b');
  });

  it('returns null when neither leading_option_id nor win_probabilities extractable', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: undefined,
    });
    expect(buildAnalysisFromPriorFacts([fact])).toBeNull();
  });

  it('exports the staleness reason constant for caller use', () => {
    expect(FALLBACK_STALENESS_REASON).toBe('loaded_from_prior_run_freshness_unknown');
  });

  it('resolves option labels from the current graph when provided', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
    });
    const summary = buildAnalysisFromPriorFacts([fact], [
      { id: 'opt-a', label: 'Plan A: Expand EU' },
      { id: 'opt-b', label: 'Plan B: Hold' },
    ])!;
    expect(summary.winner.option_label).toBe('Plan A: Expand EU');
    expect(summary.options.map((o) => o.option_label)).toEqual([
      'Plan A: Expand EU',
      'Plan B: Hold',
    ]);
  });

  it('falls back to option_id when the graph has no matching label', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 0.6, 'opt-unknown': 0.4 },
    });
    const summary = buildAnalysisFromPriorFacts([fact], [
      { id: 'opt-a', label: 'Plan A' },
      // opt-unknown has no label source entry
    ])!;
    expect(summary.winner.option_label).toBe('Plan A');
    const unknown = summary.options.find((o) => o.option_id === 'opt-unknown')!;
    expect(unknown.option_label).toBe('opt-unknown');
  });

  it('trims whitespace labels and falls back to id when label is empty', () => {
    const fact = runAnalysisFact({
      leadingOptionId: 'opt-a',
      winProbabilities: { 'opt-a': 1.0 },
    });
    const summary = buildAnalysisFromPriorFacts([fact], [
      { id: 'opt-a', label: '   ' },
    ])!;
    expect(summary.winner.option_label).toBe('opt-a');
  });

  describe('enrichment passthrough — V2RunResponseEnvelope shape', () => {
    function runAnalysisFactWithEnrichment(enrichment: Record<string, unknown>): HandlerFact {
      return {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: '00000000-0000-4000-8000-000000000001',
          leading_option_id: 'opt-launch',
          win_probabilities: { 'opt-launch': 0.62, 'opt-wait': 0.38 },
          summary: 'Prior run',
          enrichment,
        },
      } as unknown as HandlerFact;
    }

    const RICH_ENRICHMENT: Record<string, unknown> = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: 'h1' },
      results: [
        {
          option_id: 'opt-launch',
          option_label: 'Launch Now',
          win_probability: 0.62,
          outcome_mean: 1500000,
          outcome_p10: 1200000,
          outcome_p90: 1800000,
          factor_sensitivity: [
            { node_id: 'fac-marketing', label: 'Marketing Spend', sensitivity: 0.45, direction: 'positive' },
            { node_id: 'fac-eng-cap',   label: 'Eng Capacity',    sensitivity: -0.32, direction: 'negative' },
          ],
          robustness: {
            overall_robustness: 'moderate',
            fragile_edges: [
              { from_node_id: 'fac-marketing', to_node_id: 'goal-revenue', from_label: 'Marketing Spend', to_label: 'Revenue' },
            ],
          },
        },
        {
          option_id: 'opt-wait',
          option_label: 'Wait',
          win_probability: 0.38,
          outcome_mean: 1100000,
          outcome_p10: 900000,
          outcome_p90: 1300000,
        },
      ],
      robustness: { level: 'moderate' },
      analysis_status: 'complete',
    };

    it('populates top_drivers from enrichment.results[].factor_sensitivity', () => {
      const fact = runAnalysisFactWithEnrichment(RICH_ENRICHMENT);
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.top_drivers.length).toBeGreaterThan(0);
      const labels = summary.top_drivers.map((d) => d.factor_label);
      expect(labels).toContain('Marketing Spend');
      expect(labels).toContain('Eng Capacity');
    });

    it('populates robustness_level (canonicalised) from enrichment robustness data', () => {
      const fact = runAnalysisFactWithEnrichment(RICH_ENRICHMENT);
      const summary = buildAnalysisFromPriorFacts([fact])!;
      // compactAnalysis maps 'moderate' through ROBUSTNESS_MAP → 'moderate'
      expect(summary.robustness_level).toBe('moderate');
    });

    it('populates options with full win_probability and outcome data from enrichment.results', () => {
      const fact = runAnalysisFactWithEnrichment(RICH_ENRICHMENT);
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.options.length).toBe(2);
      const launch = summary.options.find((o) => o.option_id === 'opt-launch')!;
      expect(launch.option_label).toBe('Launch Now');
      expect(launch.win_probability).toBeCloseTo(0.62);
      expect(launch.outcome_mean).toBeCloseTo(1500000);
    });

    it('falls back to minimal extraction when enrichment is missing entirely', () => {
      const fact = runAnalysisFact({
        leadingOptionId: 'opt-a',
        winProbabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.top_drivers).toEqual([]);
      expect(summary.robustness_level).toBe('unknown');
      expect(summary.options).toHaveLength(2);
    });

    it('falls back to minimal extraction when enrichment is malformed (string)', () => {
      const fact: HandlerFact = {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: '00000000-0000-4000-8000-000000000001',
          leading_option_id: 'opt-a',
          win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
          summary: 'Prior run',
          enrichment: 'not an object' as unknown as Record<string, unknown>,
        },
      } as unknown as HandlerFact;
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.top_drivers).toEqual([]);
      expect(summary.robustness_level).toBe('unknown');
      expect(summary.options).toHaveLength(2);
    });

    it('falls back to minimal extraction when enrichment has empty results[]', () => {
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1, response_hash: 'h' },
        results: [],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      // compactAnalysis returns a summary with empty options; fallback path takes over.
      // Either way: minimal options from win_probabilities, top_drivers empty.
      expect(summary.options.length).toBeGreaterThan(0);
      expect(summary.top_drivers).toEqual([]);
    });

    it('regression: populates top_drivers from TOP-LEVEL enrichment.factor_sensitivity[] (staging shape)', () => {
      // PLoT/staging publishes factor_sensitivity at the TOP LEVEL of the
      // V2RunResponseEnvelope, with entries shaped { label, elasticity,
      // direction } per the type contract. compactAnalysis() only walks
      // per-option results[].factor_sensitivity and would miss this entirely.
      // This test guards the dual-shape path in deriveTopDriversFromTopLevel.
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-top' },
        results: [
          {
            option_id: 'opt-launch',
            option_label: 'Launch Now',
            win_probability: 0.62,
            outcome_mean: 1500000,
            // NOTE: deliberately no per-option factor_sensitivity here —
            // top_drivers must come from the top-level array below.
          },
          {
            option_id: 'opt-wait',
            option_label: 'Wait',
            win_probability: 0.38,
            outcome_mean: 1100000,
          },
        ],
        factor_sensitivity: [
          { label: 'Marketing Spend',  elasticity: 0.45,  direction: 'positive' },
          { label: 'Eng Capacity',     elasticity: -0.32, direction: 'negative' },
          { label: 'Customer Acq Cost', elasticity: 0.21, direction: 'negative' },
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.top_drivers.length).toBeGreaterThan(0);
      const labels = summary.top_drivers.map((d) => d.factor_label);
      expect(labels).toContain('Marketing Spend');
      expect(labels).toContain('Eng Capacity');
      // Sorted by absolute magnitude; |0.45| > |0.32| > |0.21|
      expect(summary.top_drivers[0].factor_label).toBe('Marketing Spend');
    });

    it('top-level factor_sensitivity tolerates `factor_label`/`sensitivity` field names', () => {
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-alt' },
        results: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.4, outcome_mean: 80 },
        ],
        factor_sensitivity: [
          { factor_label: 'Alt Field A', sensitivity: 0.7, direction: 'positive', factor_id: 'fac-a' },
          { factor_label: 'Alt Field B', sensitivity: 0.4, direction: 'negative', factor_id: 'fac-b' },
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      const labels = summary.top_drivers.map((d) => d.factor_label);
      expect(labels).toContain('Alt Field A');
      expect(labels).toContain('Alt Field B');
    });

    it('top-level factor_sensitivity: signed elasticity with no direction → sign inferred from value', () => {
      // PLoT contract per V2RunResponseEnvelope says { label, elasticity, direction }
      // but real payloads sometimes drop `direction`. The deterministic
      // fallback infers sign from the elasticity value itself — magnitude is
      // stored as |value| in DriverSummary, sign reattached at projection.
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-signed' },
        results: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.4, outcome_mean: 80 },
        ],
        factor_sensitivity: [
          { label: 'Drag',   elasticity: -0.45 }, // no direction
          { label: 'Boost',  elasticity:  0.30 }, // no direction
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      const drag = summary.top_drivers.find((d) => d.factor_label === 'Drag')!;
      const boost = summary.top_drivers.find((d) => d.factor_label === 'Boost')!;
      expect(drag.direction).toBe('negative');
      expect(boost.direction).toBe('positive');
      // DriverSummary.sensitivity is the absolute value (compactAnalysis contract).
      expect(drag.sensitivity).toBeCloseTo(0.45);
      expect(boost.sensitivity).toBeCloseTo(0.30);
    });

    it('top-level factor_sensitivity: explicit direction OVERRIDES elasticity sign', () => {
      // Some upstreams emit positive elasticity magnitudes with semantic
      // direction in a separate field. The explicit `direction` field wins.
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-override' },
        results: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.4, outcome_mean: 80 },
        ],
        factor_sensitivity: [
          // Magnitude positive, but direction says negative — driver hurts the goal.
          { label: 'Cost Pressure', elasticity: 0.45, direction: 'negative' },
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      const driver = summary.top_drivers.find((d) => d.factor_label === 'Cost Pressure')!;
      expect(driver.direction).toBe('negative');
      expect(driver.sensitivity).toBeCloseTo(0.45);
    });

    it('top-level factor_sensitivity: explicit neutral direction is preserved, not collapsed to positive', () => {
      // 'neutral' is an authoritative enum value (sensitivity contract). It must
      // survive as 'neutral' even with a non-trivial magnitude — pre-fix the
      // fallback dropped it to the sign and rendered a positive ("strengthens").
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-neutral' },
        results: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.4, outcome_mean: 80 },
        ],
        factor_sensitivity: [
          { label: 'Mixed Signal', elasticity: 0.5, direction: 'neutral' },
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      const driver = summary.top_drivers.find((d) => d.factor_label === 'Mixed Signal')!;
      expect(driver.direction).toBe('neutral');
      expect(driver.sensitivity).toBeCloseTo(0.5);
    });

    it('top-level factor_sensitivity excludes entries with non-finite values', () => {
      const fact = runAnalysisFactWithEnrichment({
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-bad' },
        results: [
          { option_id: 'opt-a', option_label: 'A', win_probability: 0.6, outcome_mean: 100 },
          { option_id: 'opt-b', option_label: 'B', win_probability: 0.4, outcome_mean: 80 },
        ],
        factor_sensitivity: [
          { label: 'Good',     elasticity: 0.5, direction: 'positive' },
          { label: 'NaN-y',    elasticity: Number.NaN, direction: 'positive' },
          { label: 'Inf-y',    elasticity: Number.POSITIVE_INFINITY, direction: 'positive' },
          { label: 'No-elast', direction: 'positive' },
        ],
        analysis_status: 'complete',
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      expect(summary.top_drivers).toHaveLength(1);
      expect(summary.top_drivers[0].factor_label).toBe('Good');
    });

    it('per-result factor_sensitivity wins when both top-level and per-result exist (non-empty per-result preferred)', () => {
      // compactAnalysis fills top_drivers from per-result; the top-level
      // path only kicks in as a fallback when per-result is empty.
      const fact = runAnalysisFactWithEnrichment({
        ...RICH_ENRICHMENT,
        factor_sensitivity: [
          { label: 'Top-Level Only', elasticity: 0.99, direction: 'positive' },
        ],
      });
      const summary = buildAnalysisFromPriorFacts([fact])!;
      const labels = summary.top_drivers.map((d) => d.factor_label);
      // From RICH_ENRICHMENT per-result section
      expect(labels).toContain('Marketing Spend');
      expect(labels).toContain('Eng Capacity');
      // Top-level entry NOT used because per-result returned non-empty
      expect(labels).not.toContain('Top-Level Only');
    });

    it('relabels options from optionLabelSource even when enrichment provided its own labels', () => {
      const fact = runAnalysisFactWithEnrichment(RICH_ENRICHMENT);
      const summary = buildAnalysisFromPriorFacts([fact], [
        { id: 'opt-launch', label: 'Plan A: Ship This Quarter' },
      ])!;
      const launch = summary.options.find((o) => o.option_id === 'opt-launch')!;
      expect(launch.option_label).toBe('Plan A: Ship This Quarter');
      // Winner gets the relabel too (when winner is the relabelled option).
      expect(summary.winner.option_label).toBe('Plan A: Ship This Quarter');
    });
  });
});
