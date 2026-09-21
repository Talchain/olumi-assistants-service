/**
 * Unit tests for the V5 product-state continuity (foamy-bee) post-mutation
 * chip rule in `generateChips`.
 *
 * Rule under test:
 *   - When `handlerFacts` carries a successful (non-noop) mutation OR
 *     `priorFacts` carries one, AND the model is structurally ready,
 *     emit a Run / Run analysis again chip.
 *   - The variant depends on prior analysis presence + freshness.
 *   - Suppress when not ready, when analysis is fresh, or when
 *     `run_analysis` is not registered.
 *
 * The two surfaces (mutation turn vs state-query turn) collapse onto
 * the same chip computation; tests cover both.
 */

import { describe, expect, it } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { generateChips } from '../chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { GraphPatchBlockData } from '../../../orchestrator/types.js';
import type { TurnOutcome } from '../../turn-outcome.js';

const REGISTRY = HANDLER_VALIDATION_REGISTRY;

type AnalysisReadyPayload = NonNullable<GraphPatchBlockData['analysis_ready']>;

const READY: AnalysisReadyPayload = {
  options: [],
  goal_node_id: 'goal',
  status: 'ready',
};

const NEEDS_USER_INPUT: AnalysisReadyPayload = {
  options: [],
  goal_node_id: 'goal',
  status: 'needs_user_input',
};

function addConstraintFact(opts: { noop?: boolean } = {}): HandlerFact {
  return {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: 'gc-x',
      status: opts.noop ? 'noop' : 'applied',
      before: null,
      after: { node_id: 'n', operator: '<=', value: 50000, label: 'Cost' },
    },
  };
}

function setFactorValueFact(opts: { noop?: boolean } = {}): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: 'factor_x',
      status: opts.noop ? 'noop' : 'applied',
      before: { value: 6 },
      after: { value: 9 },
    },
  };
}

function adjustEdgeFact(opts: { noop?: boolean } = {}): HandlerFact {
  return {
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      target_id: 'a→b',
      status: opts.noop ? 'noop' : 'applied',
      before: { from: 'a', to: 'b', strength: { mean: 0.3, std: 0.1 } },
      after: { from: 'a', to: 'b', strength: { mean: 0.6, std: 0.1 } },
    },
  };
}

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: 'opt-a',
      summary: 'Prior',
      win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
    },
  };
}

function turnOutcomeWithFreshness(
  freshness: 'fresh' | 'stale' | 'unknown' | 'none',
): TurnOutcome {
  return {
    graph_mutated: false,
    analysis_run: false,
    analysis_selected_fact_index: null,
    analysis_freshness: freshness,
    freshness_reason: 'no_successful_run_analysis_fact',
  };
}

describe('post-mutation chip rule (foamy-bee tranche)', () => {
  describe('mutation turn (handlerFacts carries the mutation)', () => {
    it('emits "Run analysis" when no prior analysis exists and model is ready', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [addConstraintFact()],
        priorFacts: [],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('none'),
      });
      expect(chips).toHaveLength(1);
      // Label comes from curatedHandlerChips for `run_analysis`.
      expect(chips[0]!.action_type).toBe('run_analysis');
      expect(chips[0]!.label.toLowerCase()).toContain('analysis');
    });

    it('emits "Run analysis again" when prior analysis exists and freshness is stale', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [addConstraintFact()],
        priorFacts: [runAnalysisFact()],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('stale'),
      });
      expect(chips).toHaveLength(1);
      expect(chips[0]!.label).toBe('Run analysis again');
      expect(chips[0]!.action_type).toBe('run_analysis');
    });

    it('emits the post-mutation chip for set_factor_value', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [setFactorValueFact()],
        priorFacts: [runAnalysisFact()],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('stale'),
      });
      expect(chips).toHaveLength(1);
      expect(chips[0]!.action_type).toBe('run_analysis');
    });

    it('emits the post-mutation chip for adjust_edge_strength', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [adjustEdgeFact()],
        priorFacts: [runAnalysisFact()],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('stale'),
      });
      expect(chips).toHaveLength(1);
      expect(chips[0]!.action_type).toBe('run_analysis');
    });

    it('suppresses when the mutation is a noop (no actual change)', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [addConstraintFact({ noop: true })],
        priorFacts: [],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('none'),
      });
      // No mutation chip; falls through to other rules. The analyse-stage
      // no-analysis rule fires the executable Run analysis chip — that's
      // a different rule and lives outside this test's scope. We just
      // assert the mutation-specific chip variant is NOT emitted.
      const mutationChip = chips.find(
        (c) => c.id === 'chip_action_rerun_analysis_after_mutation',
      );
      expect(mutationChip).toBeUndefined();
    });

    it('suppresses when model is not structurally ready', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [addConstraintFact()],
        priorFacts: [runAnalysisFact()],
        analysis: null,
        analysisReady: NEEDS_USER_INPUT,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('stale'),
      });
      // Our specific chip should not appear — the rule self-suppresses
      // because readiness is not 'ready'.
      const mutationChip = chips.find(
        (c) => c.id === 'chip_action_rerun_analysis_after_mutation',
      );
      expect(mutationChip).toBeUndefined();
    });

    it('falls through to other rules when prior analysis is fresh', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [addConstraintFact()],
        priorFacts: [runAnalysisFact()],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('fresh'),
      });
      // Fresh analysis means the user doesn't urgently need to rerun;
      // the chip self-suppresses. Other downstream rules may emit
      // something — the assertion here is just that the rerun chip
      // variant does not appear.
      const mutationChip = chips.find(
        (c) => c.id === 'chip_action_rerun_analysis_after_mutation',
      );
      expect(mutationChip).toBeUndefined();
    });
  });

  describe('NEGATIVE — chip-generator does NOT consult priorFacts for the post-mutation rule', () => {
    // Critical invariant: if a future regression re-introduces the
    // priorFacts surface here, every subsequent converse turn after a
    // mutation would surface a stale "Run analysis" chip until the
    // user reruns analysis. The continuity chip belongs to the
    // state-query guard (composeStateQueryChip), not this rule.
    it('suppresses the post-mutation chip when only priorFacts carries a mutation', () => {
      const chips = generateChips({
        stage: 'analyse',
        handlerFacts: [],
        priorFacts: [addConstraintFact(), runAnalysisFact()],
        analysis: null,
        analysisReady: READY,
        validationRegistry: REGISTRY,
        turnOutcome: turnOutcomeWithFreshness('stale'),
      });
      const mutationChip = chips.find(
        (c) =>
          c.id === 'chip_action_rerun_analysis_after_mutation' ||
          c.id === 'chip_action_run_analysis',
      );
      // The post-mutation chip variant is absent; other rules may
      // still emit chips for unrelated reasons (they are NOT the rule
      // under test). Specifically: the analyse-stage rule may fire
      // because analysis is null AND model is ready — that's expected
      // and out of scope for this assertion.
      expect(mutationChip?.id).not.toBe(
        'chip_action_rerun_analysis_after_mutation',
      );
    });
  });
});
