import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ContextPack } from '../../context/context-pack-assembler.js';
import type { SuccessfulHandlerOutcome } from '../../tools/handler-outcome.js';
import { detectCoachingSignal } from '../coaching-signals.js';

function makeContextPack(overrides: {
  topDrivers?: readonly string[];
  analysisPresent?: boolean;
} = {}): ContextPack {
  return {
    version: '2.0',
    stage: 'analyse',
    graph: {
      nodes: [],
      edges: [],
      options: [],
      goals: [],
      constraints: [],
      counts: { nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 },
    },
    analysis:
      overrides.analysisPresent === false
        ? null
        : {
            status: 'complete',
            leading_option: 'Option A',
            runner_up: 'Option B',
            robustness_band: 'moderate',
            top_drivers: overrides.topDrivers ?? ['Customer Churn'],
            fragile_edges: [],
            staleness_reason: null,
          },
    conversation: {
      recent_turns: [],
      turn_count: 1,
      last_tool_used: null,
      pending_confirmation: false,
    },
    coaching: {
      draft_coaching: null,
      decision_review: null,
      last_coaching_signal: null,
    },
    compound_detected: false,
    compound_pattern_matched: null,
    parsed_quantities: [],
    system_event: null,
  };
}

function runAnalysisOutcome(): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
    },
  };
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

function setFactorOutcome(targetId: string): SuccessfulHandlerOutcome {
  const fact: HandlerFact = {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: targetId,
      status: 'applied',
      before: { value: 1 },
      after: { value: 2 },
    },
  };
  return { assistant_text: 'done', handler_facts: [fact], llm_calls_used: 0 };
}

function priorRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'prior',
    },
  };
}

describe('detectCoachingSignal', () => {
  describe('FIRST_ANALYSIS_COMPLETE', () => {
    it('fires on the first successful run_analysis (no prior facts)', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      expect(detection?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
      expect(detection?.coaching_text).toMatch(/first analysis/i);
    });

    it('does not fire on a subsequent run_analysis', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection).toBeNull();
    });

    it('fires on first success even when prior run_analysis turn failed (no fact emitted)', () => {
      // Paul's Task C correction: failed handler turns throw and never emit
      // facts. A successful first analysis must therefore still see an empty
      // priorFacts array and fire FIRST_ANALYSIS_COMPLETE.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [], // prior failed attempt produced no fact
      });
      expect(detection?.signal_id).toBe('FIRST_ANALYSIS_COMPLETE');
    });
  });

  describe('STALE_ANALYSIS_AFTER_EDIT (dormant today)', () => {
    it('fires on an edit handler when a prior run_analysis fact exists', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('f-cost'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    });

    it('does not fire on an edit handler when no prior analysis exists', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ analysisPresent: false }),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });
  });

  describe('HIGH_SENSITIVITY_EDIT (dormant today)', () => {
    it('fires on an edit to a top driver when no prior analysis exists in facts', () => {
      // HIGH_SENSITIVITY branch: no prior run_analysis fact, but contextPack
      // carries top_drivers. The edit target matches a driver label.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn', 'Ad Spend'] }),
        priorFacts: [],
      });
      expect(detection?.signal_id).toBe('HIGH_SENSITIVITY_EDIT');
      expect(detection?.coaching_text).toContain('Customer Churn');
    });

    it('does not fire when the edit target is not among top drivers', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Unrelated Factor'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });
  });

  describe('priority order (STALE > HIGH_SENSITIVITY > FIRST_ANALYSIS)', () => {
    it('picks STALE over HIGH_SENSITIVITY when both are eligible', () => {
      // Edit a top driver AND a prior analysis exists in facts. STALE wins.
      const detection = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [priorRunAnalysisFact()],
      });
      expect(detection?.signal_id).toBe('STALE_ANALYSIS_AFTER_EDIT');
    });
  });

  describe('non-action handlers', () => {
    it('returns null for an unknown handler_id', () => {
      const detection = detectCoachingSignal({
        proposedHandlerId: 'explain_result',
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      expect(detection).toBeNull();
    });
  });

  describe('coaching text invariants', () => {
    it('never emits em-dashes in any signal text', () => {
      const firstAnalysis = detectCoachingSignal({
        proposedHandlerId: 'run_analysis',
        outcome: runAnalysisOutcome(),
        contextPack: makeContextPack(),
        priorFacts: [],
      });
      const stale = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack(),
        priorFacts: [priorRunAnalysisFact()],
      });
      const high = detectCoachingSignal({
        proposedHandlerId: 'set_factor_value',
        outcome: setFactorOutcome('Customer Churn'),
        contextPack: makeContextPack({ topDrivers: ['Customer Churn'] }),
        priorFacts: [],
      });

      for (const d of [firstAnalysis, stale, high]) {
        expect(d).not.toBeNull();
        expect(d!.coaching_text).not.toContain('—');
        expect(d!.coaching_text).not.toContain('–');
      }
    });
  });
});
