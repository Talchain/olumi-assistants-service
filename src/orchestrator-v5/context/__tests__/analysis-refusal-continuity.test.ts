import { describe, expect, it } from 'vitest';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildAnalysisRefusalFact,
  isAnalysisRefusalFact,
  isAnalysisRefusalContinuityCause,
} from '../analysis-refusal-continuity.js';
import {
  selectCanonicalAnalysisState,
  summariseCoachingStatePack,
} from '../canonical-analysis-state.js';
import { checkCoachingOutput } from '../../coaching/coaching-output-postcheck.js';

const SCENARIO_ID = 'b2000000-0000-4000-8000-000000000002';

describe('analysis refusal continuity', () => {
  it('is scoped to science/readiness refusals, not transient recovery causes', () => {
    expect(isAnalysisRefusalContinuityCause('analysis_not_ready')).toBe(true);
    expect(isAnalysisRefusalContinuityCause('analysis_blocked')).toBe(true);
    expect(isAnalysisRefusalContinuityCause('options_not_configured')).toBe(false);
    expect(isAnalysisRefusalContinuityCause('analysis_engine_busy')).toBe(false);
  });

  it('builds a schema-valid non-success fact without inventing a result', () => {
    const fact = buildAnalysisRefusalFact({
      scenarioId: SCENARIO_ID,
      reasonCode: 'mixed_scale_unresolved',
      graphHash: 'aag_v1:test',
      computedAt: '2026-08-23T19:40:14.000Z',
    });

    expect(RunAnalysisHandlerFactSchema.safeParse(fact).success).toBe(true);
    expect(isAnalysisRefusalFact(fact)).toBe(true);
    expect(fact).toMatchObject({
      fact_type: 'run_analysis',
      noop: false,
      result: {
        leading_option_id: null,
        enrichment: {
          analysis_status: 'refused',
          refusal_reason_code: 'mixed_scale_unresolved',
        },
      },
    });
    expect('win_probabilities' in fact.result).toBe(false);
  });

  it('projects only the current refusal into the prompt-safe coaching pack', () => {
    const refused = buildAnalysisRefusalFact({
      scenarioId: SCENARIO_ID,
      reasonCode: 'mixed_scale_unresolved',
      graphHash: 'aag_v1:test',
      computedAt: '2026-08-23T19:40:14.000Z',
    });
    const state = selectCanonicalAnalysisState({
      priorFacts: [refused],
      readiness: { status: 'ready' },
      currentGraphHash: 'aag_v1:test',
    });

    expect(state.degraded_fact_status).toBe('refused');
    expect(summariseCoachingStatePack(state)).toMatchObject({
      analysis_present: false,
      latest_run_attempt_refused: true,
    });
  });

  it('a newer successful run clears refusal continuity', () => {
    const refused = buildAnalysisRefusalFact({
      scenarioId: SCENARIO_ID,
      reasonCode: 'mixed_scale_unresolved',
      graphHash: 'aag_v1:test',
      computedAt: '2026-08-23T19:40:14.000Z',
    });
    const succeeded = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_new',
        summary: 'Latest analysis completed.',
        enrichment: { analysis_status: 'completed' },
        graph_hash_at_run: 'aag_v1:test',
        computed_at: '2026-08-23T20:00:00.000Z',
      },
    } as HandlerFact;
    const state = selectCanonicalAnalysisState({
      priorFacts: [succeeded, refused],
      readiness: { status: 'ready' },
      currentGraphHash: 'aag_v1:test',
    });
    const pack = summariseCoachingStatePack(state);

    expect(state.degraded_fact_status).toBeNull();
    expect(pack.analysis_present).toBe(true);
    expect(pack).not.toHaveProperty('latest_run_attempt_refused');
  });

  it.each([
    'Running now is safe, the result just needs to be read as provisional.',
    'Running the analysis would show how these relationships translate into option-level probabilities.',
  ])('rejects run-availability claims while the latest attempt remains refused: %s', (prose) => {
    expect(
      checkCoachingOutput(prose, {
        analysis_present: false,
        freshness: 'none',
        readiness_status: 'ready',
        rerun_required: false,
        usable_for_prose: false,
        usable_for_chips: false,
        blocked: false,
        actionable_blocker_count: 0,
        latest_run_attempt_refused: true,
      }),
    ).toEqual({
      safe: false,
      violation: 'run_availability_claim_after_refusal',
    });
  });

  it('does not constrain a ready path with no current refusal', () => {
    const prose =
      'No, not on its own. Local Pipeline Conversion Rate could reverse the result; the model excludes first-year budget and hub costs.';
    expect(
      checkCoachingOutput(prose, {
        analysis_present: true,
        freshness: 'fresh',
        readiness_status: 'ready',
        rerun_required: false,
        usable_for_prose: true,
        usable_for_chips: true,
        blocked: false,
        actionable_blocker_count: 0,
      }),
    ).toEqual({ safe: true });
  });
});
