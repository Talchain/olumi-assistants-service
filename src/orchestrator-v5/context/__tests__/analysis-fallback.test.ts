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
});
