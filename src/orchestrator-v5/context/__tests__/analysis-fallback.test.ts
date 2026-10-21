/**
 * Unit tests for hasBuildableAnalysisProjection — the prior-facts summary
 * builder cut off at its null decision (deletion 10, 22 Oct 2026). Each row
 * pins one branch of that decision. The rows on the deleted summary's CONTENT
 * (labels, margins, drivers, fragile edges, signals) went with it; the HEAD
 * file is kept in `evidence/track2-deletion10-20261022/deleted/`.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { hasBuildableAnalysisProjection } from '../analysis-fallback.js';

function runAnalysisFact(overrides: {
  leadingOptionId?: string | null;
  winProbabilities?: Record<string, number>;
  noop?: boolean;
  summary?: string;
  enrichment?: Record<string, unknown>;
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
      ...(overrides.enrichment !== undefined ? { enrichment: overrides.enrichment } : {}),
    },
  } as unknown as HandlerFact;
}

/** A V2RunResponseEnvelope whose `results[]` compactAnalysis turns into two options. */
const ENRICHMENT_WITH_OPTIONS: Record<string, unknown> = {
  meta: { seed_used: 42, n_samples: 1000, response_hash: 'h1' },
  results: [
    { option_id: 'opt-launch', option_label: 'Launch Now', win_probability: 0.62, outcome_mean: 1500000 },
    { option_id: 'opt-wait', option_label: 'Wait', win_probability: 0.38, outcome_mean: 1100000 },
  ],
  analysis_status: 'complete',
};

describe('hasBuildableAnalysisProjection', () => {
  it('false when no facts present', () => {
    expect(hasBuildableAnalysisProjection([])).toBe(false);
  });

  it('false when no run_analysis fact is present', () => {
    // Any HandlerFact variant that isn't run_analysis will do; the selector rejects it.
    const explainFact = {
      fact_type: 'explain_result',
      fact_version: 1,
      noop: false,
      result: { narrative: 'x', referenced_option_ids: [] },
    } as unknown as HandlerFact;
    expect(hasBuildableAnalysisProjection([explainFact])).toBe(false);
  });

  it('false when the only run_analysis fact is a noop', () => {
    const fact = runAnalysisFact({ noop: true });
    expect(hasBuildableAnalysisProjection([fact])).toBe(false);
  });

  it('true from a declared leading_option_id alone (no probabilities, no enrichment)', () => {
    const fact = runAnalysisFact({ leadingOptionId: 'opt-a', winProbabilities: undefined });
    expect(hasBuildableAnalysisProjection([fact])).toBe(true);
  });

  it('true when leading_option_id is null but win_probabilities present', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: { 'opt-b': 0.6, 'opt-a': 0.4 },
    });
    expect(hasBuildableAnalysisProjection([fact])).toBe(true);
  });

  it('false when neither leading_option_id nor win_probabilities extractable', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: undefined,
    });
    expect(hasBuildableAnalysisProjection([fact])).toBe(false);
  });

  it('true when the stored enrichment yields options, with no leader and no probabilities', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: undefined,
      enrichment: ENRICHMENT_WITH_OPTIONS,
    });
    expect(hasBuildableAnalysisProjection([fact])).toBe(true);
  });

  it('CONTRAST: false for the same fact when the stored enrichment yields no options', () => {
    const fact = runAnalysisFact({
      leadingOptionId: null,
      winProbabilities: undefined,
      enrichment: { ...ENRICHMENT_WITH_OPTIONS, results: [] },
    });
    expect(hasBuildableAnalysisProjection([fact])).toBe(false);
  });
});
