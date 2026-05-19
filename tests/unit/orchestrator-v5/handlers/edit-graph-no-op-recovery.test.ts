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
          graphReady: true,
        });
        expect(result.branch).toBe('analytical_fresh');
        expect(result.has_run_analysis_fact).toBe(true);
        expect(result.assistantText).not.toBeNull();
        expect(result.assistantText).toContain("haven't changed the model");
        expect(result.suggestedActions).toHaveLength(1);
        // Plural — matches the registered V5 handler and the
        // deterministic chip-click whitelist. Singular would fall
        // through as a deprecated alias.
        expect(result.suggestedActions[0]?.action_type).toBe('explain_results');
      });
    }
  });

  describe('analytical intent + stale analysis fact', () => {
    it('takes analytical_stale branch and offers re-run chip', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'stale',
        graphReady: true,
      });
      expect(result.branch).toBe('analytical_stale');
      expect(result.has_run_analysis_fact).toBe(true);
      expect(result.assistantText).toContain('earlier version');
      expect(result.suggestedActions[0]?.action_type).toBe('run_analysis');
    });
  });

  describe('analytical intent + no analysis fact', () => {
    it('takes analytical_none branch and offers run chip when graph is ready', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [],
        freshness: 'none',
        graphReady: true,
      });
      expect(result.branch).toBe('analytical_none');
      expect(result.has_run_analysis_fact).toBe(false);
      expect(result.assistantText).toContain('Run analysis first');
      expect(result.suggestedActions[0]?.action_type).toBe('run_analysis');
    });

    it('suppresses run_analysis chip when graph is not ready and uses matching copy', () => {
      const result = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [],
        freshness: 'none',
        graphReady: false,
      });
      expect(result.branch).toBe('analytical_none');
      expect(result.has_run_analysis_fact).toBe(false);
      expect(result.assistantText).toContain('Once the model is ready');
      expect(result.suggestedActions).toHaveLength(0);
    });
  });

  describe('vague edit-like message', () => {
    const vagueEdits = [
      'Update something.',
      'Change this.',
      'Adjust the model.',
      'Fix the model please.',
      'Can you change something?',
      'Make a change.',
    ];
    for (const msg of vagueEdits) {
      it(`takes vague_edit branch for "${msg}"`, () => {
        const result = decideNoOpRecovery({
          message: msg,
          priorFacts: [],
          freshness: 'none',
          graphReady: true,
        });
        expect(result.branch).toBe('vague_edit');
        expect(result.intent_class).toBeNull();
        expect(result.assistantText).toContain('Tell me which factor');
        expect(result.suggestedActions).toHaveLength(0);
      });
    }
  });

  describe('ambiguous (preserves existing copy)', () => {
    it('does NOT match general conversational messages without a vague-edit signal', () => {
      const conversational = [
        'Hi.',
        "OK, thanks.",
        'Something needs to change here.', // no imperative edit verb pattern + abstract object
        'That is interesting.',
        'I see.',
        // Concrete-but-value-less target: a factor name is given, so
        // the message is NOT vague — falls through to ambiguous and
        // preserves the existing safe fallback rather than asking
        // "which factor?" when the user has already named one.
        'Change pricing factor',
        'Update the demand driver',
        'Adjust the supply chain edge',
      ];
      for (const msg of conversational) {
        const result = decideNoOpRecovery({
          message: msg,
          priorFacts: [],
          freshness: 'none',
          graphReady: true,
        });
        expect(result.branch, msg).toBe('ambiguous');
        expect(result.assistantText, msg).toBeNull();
        expect(result.suggestedActions, msg).toHaveLength(0);
      }
    });

    it('preserves existing copy when message has mutation signal (genuine edit intent)', () => {
      const result = decideNoOpRecovery({
        message: 'Set Pricing to 0.7.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'fresh',
        graphReady: true,
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
        graphReady: true,
      });
      expect(result.branch).toBe('ambiguous');
      expect(result.assistantText).toBeNull();
    });
  });

  describe('chip merging at call-site (dispatch-level semantics)', () => {
    // dispatchEditGraph merges recovery chips into the existing
    // response.suggested_actions and dedupes by action_type:
    //   - filter recovery chips whose action_type already appears in
    //     existing
    //   - append the survivors
    // These tests simulate that merge.
    function mergeRecoveryChips(
      existing: ReadonlyArray<{ readonly id: string; readonly action_type?: string }>,
      recovery: readonly { readonly id: string; readonly action_type?: string }[],
    ): ReadonlyArray<{ readonly id: string; readonly action_type?: string }> {
      const existingIntents = new Set<string>();
      for (const a of existing) {
        if (a.action_type) existingIntents.add(a.action_type);
      }
      const filtered = recovery.filter(
        (a) => !a.action_type || !existingIntents.has(a.action_type),
      );
      return [...existing, ...filtered];
    }

    it('preserves existing response actions when recovery appends a chip', () => {
      const existing = [
        { id: 'existing_chip_1', action_type: 'set_factor_value' },
        { id: 'existing_chip_2', action_type: 'explain_from_structure' },
      ];
      const recovery = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'fresh',
        graphReady: true,
      });
      const merged = mergeRecoveryChips(existing, recovery.suggestedActions);
      expect(merged).toHaveLength(3);
      expect(merged[0]?.id).toBe('existing_chip_1');
      expect(merged[1]?.id).toBe('existing_chip_2');
      expect(merged[2]?.action_type).toBe('explain_results');
    });

    it('suppresses run_analysis chip when graph is not ready (analytical_none)', () => {
      const existing = [{ id: 'existing_chip', action_type: 'set_factor_value' }];
      const recovery = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [],
        freshness: 'none',
        graphReady: false,
      });
      const merged = mergeRecoveryChips(existing, recovery.suggestedActions);
      expect(merged).toHaveLength(1);
      expect(merged.some((a) => a.action_type === 'run_analysis')).toBe(false);
    });

    it('dedupes by action_type: recovery chip is dropped when existing already has the same intent', () => {
      const existing = [
        { id: 'pre_existing_run', action_type: 'run_analysis' },
      ];
      const recovery = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [],
        freshness: 'none',
        graphReady: true,
      });
      // Recovery's chip action_type === 'run_analysis' which already
      // exists in `existing`. Dedupe drops the recovery chip; merged
      // length stays at 1.
      const merged = mergeRecoveryChips(existing, recovery.suggestedActions);
      expect(merged).toHaveLength(1);
      expect(merged[0]?.id).toBe('pre_existing_run');
    });

    it('does not dedupe across different action_types', () => {
      const existing = [
        { id: 'pre_existing_factor', action_type: 'set_factor_value' },
      ];
      const recovery = decideNoOpRecovery({
        message: 'Walk me through the analysis.',
        priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
        freshness: 'fresh',
        graphReady: true,
      });
      // Recovery's chip action_type === 'explain_results' which does
      // NOT clash with 'set_factor_value'. Both chips survive.
      const merged = mergeRecoveryChips(existing, recovery.suggestedActions);
      expect(merged).toHaveLength(2);
      expect(merged[0]?.action_type).toBe('set_factor_value');
      expect(merged[1]?.action_type).toBe('explain_results');
    });

    it('preserves response untouched on ambiguous branch (no chips appended)', () => {
      const existing = [{ id: 'existing_chip', action_type: 'set_factor_value' }];
      const recovery = decideNoOpRecovery({
        message: 'Hi there.',
        priorFacts: [],
        freshness: 'none',
        graphReady: true,
      });
      expect(recovery.branch).toBe('ambiguous');
      expect(recovery.assistantText).toBeNull();
      const merged = mergeRecoveryChips(existing, recovery.suggestedActions);
      expect(merged).toEqual(existing);
    });
  });

  describe('copy safety', () => {
    it('no branch leaks internal terms or prescriptive vocabulary', () => {
      const branches = [
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
          freshness: 'fresh',
          graphReady: true,
        }),
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [makeRunAnalysisFact()] as readonly HandlerFact[],
          freshness: 'stale',
          graphReady: true,
        }),
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [],
          freshness: 'none',
          graphReady: true,
        }),
        decideNoOpRecovery({
          message: 'Walk me through the analysis.',
          priorFacts: [],
          freshness: 'none',
          graphReady: false,
        }),
        decideNoOpRecovery({
          message: 'Update something.',
          priorFacts: [],
          freshness: 'none',
          graphReady: true,
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
        graphReady: true,
      });
      expect(r.assistantText).not.toMatch(/successfully|I['']ve\s+(?:applied|updated|set|added|removed|changed|edited)/i);
      expect(r.assistantText).not.toMatch(/^\s*Done\b/m);
    });
  });
});
