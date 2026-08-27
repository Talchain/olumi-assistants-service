/**
 * Unit tests for `composeStateQueryChip`.
 *
 * The state-query continuity chip lives on the guard module rather
 * than the chip-generator so it cannot accidentally fire on every
 * subsequent converse turn after a mutation. The chip-generator's
 * post-mutation rule is intentionally scoped to the CURRENT turn's
 * handlerFacts; THIS helper covers the other side: a state-query
 * turn that just dispatched a deterministic answer about a recent
 * change.
 *
 * Variant matrix:
 *   - prior run_analysis exists + freshness === 'stale' → "Run analysis again"
 *   - no prior run_analysis exists                       → "Run analysis"
 *   - fresh analysis                                     → no chip
 *   - model not ready                                    → no chip
 *   - run_analysis not registered                        → no chip
 *   - recent_changes empty                               → no chip
 */

import { describe, expect, it } from 'vitest';

import { composeStateQueryChip } from '../state-query-guard.js';
import { HANDLER_VALIDATION_REGISTRY } from '../validation-registry.js';

const REGISTRY = HANDLER_VALIDATION_REGISTRY;

const COMPLETE_WITH_ANALYSIS = {
  status: 'complete' as const,
  hasSuccessfulAnalysis: true,
};
const COMPLETE_WITHOUT_ANALYSIS = {
  status: 'complete' as const,
  hasSuccessfulAnalysis: false,
};

describe('composeStateQueryChip', () => {
  it('emits "Run analysis again" when a prior run_analysis exists and freshness is stale', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITH_ANALYSIS,
      analysisFreshness: 'stale',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe('Run analysis again');
    expect(chips[0]!.action_type).toBe('run_analysis');
  });

  it('emits "Run analysis" when no prior run_analysis exists and the model is ready', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'none',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label).toBe('Run analysis');
    expect(chips[0]!.action_type).toBe('run_analysis');
  });

  it('suppresses when prior analysis is fresh', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITH_ANALYSIS,
      analysisFreshness: 'fresh',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
  });

  it('suppresses when the model is not structurally ready', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'none',
      analysisReadyStatus: 'needs_user_input',
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
  });

  it('suppresses when recent_changes is empty', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 0,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'none',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
  });

  it('suppresses when run_analysis handler is not registered', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'none',
      analysisReadyStatus: 'ready',
      // Empty registry → run_analysis not registered.
      validationRegistry: {} as typeof REGISTRY,
    });
    expect(chips).toEqual([]);
  });

  it('chip ids are namespaced as state_query so analytics can join them separately from the mutation-turn chip', () => {
    const stale = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITH_ANALYSIS,
      analysisFreshness: 'stale',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    const fresh = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'none',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(stale[0]!.id).toBe('chip_action_rerun_analysis_after_state_query');
    expect(fresh[0]!.id).toBe('chip_action_run_analysis_after_state_query');
  });

  it.each(['capped', 'degraded'] as const)(
    'does not turn %s durable history into a first-run claim',
    (status) => {
      const chips = composeStateQueryChip({
        recentChangeCount: 1,
        analysisHistory: { status },
        analysisFreshness: 'unknown',
        analysisReadyStatus: 'ready',
        validationRegistry: REGISTRY,
      });
      expect(chips).toEqual([]);
    },
  );

  it('fails weak when complete-zero history contradicts a fresh verdict', () => {
    const chips = composeStateQueryChip({
      recentChangeCount: 1,
      analysisHistory: COMPLETE_WITHOUT_ANALYSIS,
      analysisFreshness: 'fresh',
      analysisReadyStatus: 'ready',
      validationRegistry: REGISTRY,
    });
    expect(chips).toEqual([]);
  });
});
