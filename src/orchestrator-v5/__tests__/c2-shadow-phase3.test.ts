import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../compose.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH = 'c2-phase3-same-graph';
const OLDER_AT = '2026-09-30T00:00:00.000Z';
const NEWER_AT = '2026-09-30T00:01:00.000Z';

function run(at: string, status: 'completed' | 'partial', mayName: boolean): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO,
      graph_hash_at_run: HASH,
      computed_at: at,
      leading_option_id: 'option-a',
      summary: 'Run complete.',
      win_probabilities: { 'option-a': 0.7, 'option-b': 0.3 },
      constraint_verdict: {
        may_name_leading_option: mayName,
        constraint_verdict_state: mayName ? 'evaluated_feasible' : 'not_applicable',
      },
      enrichment: {
        analysis_status: status,
        graph: { nodes: [{ id: 'factor-a', label: 'Delivery risk', kind: 'factor' }] },
        factor_sensitivity: [{ factor_id: 'factor-a', confidence: 0.2 }],
        option_comparison: [
          { id: 'option-a', option_id: 'option-a', label: 'Plan A', option_label: 'Plan A', win_probability: 0.7 },
          { id: 'option-b', option_id: 'option-b', label: 'Plan B', option_label: 'Plan B', win_probability: 0.3 },
        ],
        decision_review: {
          narrative_summary: 'Plan A leads with a comfortable margin.',
          story_headlines: {},
          robustness_explanation: { summary: 'Stable.', primary_risk: null },
          readiness_rationale: 'Ready.',
          evidence_enhancements: {},
          scenario_contexts: {},
          flip_thresholds: [],
          bias_findings: [],
          key_assumptions: [],
          decision_quality_prompts: [],
        },
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function compose(priorFacts: readonly RunAnalysisHandlerFact[]) {
  return composeToolCallResponse({
    answerKind: 'functional', orientation: '', confirmation: 'Explained.', coaching: null,
    stage: 'analyse', handlerFacts: [],
    lifecycle: {
      priorFacts,
      freshness: deriveAnalysisFreshness(priorFacts, HASH),
      requestId: 'c2-shadow-phase3', scenarioId: SCENARIO,
    },
  });
}

describe('C2 Phase 3 prior-run rebuild', () => {
  it('keeps ordinary selected-current cards but emits no old cards after a newer claim-bearing partial Run', () => {
    const older = run(OLDER_AT, 'completed', true);
    const ordinary = compose([older]);
    expect(ordinary.blocks.some((block) => block.type === 'review_card' && JSON.stringify(block).includes('Plan A leads')))
      .toBe(true);

    const newer = run(NEWER_AT, 'partial', false);
    const shadow = compose([newer, older]);
    expect(shadow.blocks).toEqual([]);

    // Completion/currentness is a separate question from whether this partial
    // Run's own constraint verdict would have allowed a leader.
    expect(compose([run(NEWER_AT, 'partial', true), older]).blocks).toEqual([]);
  });
});
