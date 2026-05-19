import { describe, it, expect } from 'vitest';
import type {
  HandlerFact,
  RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';

import { decideNoOpRecovery } from '../../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const COMPUTED_AT = '2026-05-09T10:00:00.000Z';

function makeRunAnalysisFact(): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.55, opt_b: 0.45 },
      graph_hash_at_run: 'abc123',
      computed_at: COMPUTED_AT,
    },
  };
}

const FORBIDDEN_INTERNAL = /validator|dispatcher|\bpatch\b|\bschema\b|tool\s+call/i;
const FORBIDDEN_PRESCRIPTIVE = /\bwinner|\brecommend|—/i;

describe('decideNoOpRecovery', () => {
  describe('analytical intent + fresh analysis fact', () => {
    const analyticalMessages = [
      'Walk me through the analysis.',
      'What drove this result?',
      'What would flip this?',
    ];
    for (const msg of analyticalMessages) {
      it(`takes analytical_fresh branch for "${msg}"`, () => {
        const result = decideNoOpRecovery({
          message: msg,
          priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
          freshness: 'fresh',
        });
        expect(result.branch).toBe('analytical_fresh');
        expect(result.has_run_analysis_fact).toBe(true);
        expect(result.assistantText).not.toBeNull();
        expect(result.assistantText).toContain("haven't changed the model");
        expect(result.suggestedActions).toHaveLength(1);
        expect(result.suggestedActions[0]?.action_type).toBe('explain_result');
      });
    }
  });

  describe('analytical intent + stale analysis fact', () => {
    it('takes analytical_stale branch and offers re-run chip', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'stale',
      });
      expect(result.branch).toBe('analytical_stale');
      expect(result.has_run_analysis_fact).toBe(true);
      expect(result.assistantText).toContain('earlier version');
      expect(result.suggestedActions[0]?.action_type).toBe('run_analysis');
    });
  });

  describe('analytical intent + no analysis fact', () => {
    it('takes analytical_none branch and offers run chip', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [],
        freshness: 'none',
      });
      expect(result.branch).toBe('analytical_none');
      expect(result.has_run_analysis_fact).toBe(false);
      expect(result.assistantText).toContain('Run analysis first');
      expect(result.suggestedActions[0]?.action_type).toBe('run_analysis');
    });
  });

  describe('vague edit-like message', () => {
    it('takes vague_edit branch and asks clarification', () => {
      const result = decideNoOpRecovery({
        message: 'Something needs to change here.',
        priorFacts: [],
        freshness: 'none',
      });
      expect(result.branch).toBe('vague_edit');
      expect(result.intent_class).toBeNull();
      expect(result.assistantText).toContain('Tell me which factor');
      expect(result.suggestedActions).toHaveLength(0);
    });
  });

  describe('ambiguous', () => {
    it('preserves existing copy when message has mutation signal (genuine edit intent)', () => {
      const result = decideNoOpRecovery({
        message: 'Set Pricing to 0.7.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'fresh',
      });
      expect(result.branch).toBe('ambiguous');
      expect(result.assistantText).toBeNull();
      expect(result.suggestedActions).toHaveLength(0);
    });

    it('preserves existing copy on analytical + unknown freshness with a fact', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'unknown',
      });
      expect(result.branch).toBe('ambiguous');
      expect(result.assistantText).toBeNull();
    });
  });

  describe('copy safety', () => {
    it('no branch leaks internal terms or prescriptive vocabulary', () => {
      const branches = [
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
          freshness: 'fresh',
        }),
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
          freshness: 'stale',
        }),
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [],
          freshness: 'none',
        }),
        decideNoOpRecovery({
          message: 'Something needs to change here.',
          priorFacts: [],
          freshness: 'none',
        }),
      ];
      for (const r of branches) {
        if (r.assistantText !== null) {
          expect(r.assistantText).not.toMatch(FORBIDDEN_INTERNAL);
          expect(r.assistantText).not.toMatch(FORBIDDEN_PRESCRIPTIVE);
        }
      }
    });

    it('no branch claims that a change happened', () => {
      const r = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'fresh',
      });
      expect(r.assistantText).not.toMatch(/successfully|I['']ve\s+(?:applied|updated|set|added|removed|changed|edited)/i);
      expect(r.assistantText).not.toMatch(/^\s*Done\b/m);
    });
  });
});
