/**
 * ROADMAP 2.211 — the DERIVED lens history, and the two call sites it must feed.
 *
 * Three things are pinned here, in increasing scope:
 *   1. `derivePreviousAnalysisLens` REPLAYS the selector over the prior
 *      `run_analysis` facts oldest→newest, so the amendment's own effect is
 *      carried forward. A one-step look-back would emit pre-mortem twice in a
 *      row from turn 3 onward; the alternation test is that mutant's witness.
 *   2. The end-to-end compose path: two consecutive analysis turns, the second
 *      one shipping the pre-mortem lens card.
 *   3. ⚠ THE DRIFT PIN. `selectLens` is called TWICE per turn — once for the
 *      lens block, once for the `focus` ui_directive. Both must receive the
 *      same history, or the card announces one lens while the canvas is told to
 *      point at another's factor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../../compose.js';
import { derivePreviousAnalysisLens } from '../lens-history.js';
import { BODY_BY_RATIONALE } from '../lens-selector.js';
import { buildFocusInspectorDirective } from '../ui-directive.js';
import { buildGraphNodeLookupFromGraph, buildLensSurface } from '../phase3-blocks.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';

// ============================================================================
// Fixtures
// ============================================================================

const GRAPH_HASH = 'gh_2211_history_0001';

const GRAPH = {
  nodes: [
    { id: 'goal_g', label: 'Launch success', kind: 'goal' },
    { id: 'fac_a', label: 'Delivery risk', kind: 'factor' },
    { id: 'fac_b', label: 'Team size', kind: 'factor' },
    { id: 'opt_x', label: 'Hire locally', kind: 'option' },
    { id: 'opt_y', label: 'Outsource', kind: 'option' },
  ],
  edges: [{ id: 'edge_ab', from: 'fac_a', to: 'goal_g', label: 'Delivery risk → Launch success' }],
};

/**
 * BOTH lenses trigger: rule 1a-i fires (`fac_a` is `isolated`) AND rule 2c fires
 * (max win_probability 0.62 ∈ [0.4, 0.7)). `fac_a` resolves in GRAPH, so the
 * flip-risk lens has a focusable subject and the pre-mortem lens (WIN_PROB_
 * MODERATE) deliberately has none — which is what makes the directive drift
 * observable.
 */
function bothTriggerFact(computedAt: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2211-history',
      leading_option_id: 'opt_x',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      computed_at: computedAt,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'fair',
        __cee_claim_safety: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' },
          { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
      },
    },
  } as unknown as HandlerFact;
}

/** Balanced, decisive, non-fragile — the may-recommend-nothing case. */
function noLensFact(computedAt: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2211-history',
      leading_option_id: 'opt_x',
      summary: 'Ran analysis.',
      graph_hash_at_run: GRAPH_HASH,
      computed_at: computedAt,
      enrichment: {
        graph: GRAPH,
        confidence_tier: 'strong',
        __cee_claim_safety: {
          may_name_leading_option: true,
          constraint_verdict_state: 'evaluated_feasible',
        },
        factor_sensitivity: [
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
          { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
          { factor_id: 'goal_g', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
        ],
        option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      },
    },
  } as unknown as HandlerFact;
}

function mutationFact(): HandlerFact {
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: { scenario_id: 'scen-2211-history', target_id: 'fac_a', before: 1, after: 2 },
  } as unknown as HandlerFact;
}

const BASE_INPUT = {
  answerKind: 'functional' as const,
  orientation: 'Done.',
  confirmation: 'Applied.',
  coaching: null as string | null,
  stage: 'analyse' as const,
};

// ============================================================================
// 1. derivePreviousAnalysisLens — the replay
// ============================================================================

describe('2.211 — derivePreviousAnalysisLens', () => {
  it('returns null when there are no prior facts at all', () => {
    expect(derivePreviousAnalysisLens([])).toBeNull();
  });

  it('returns null when the prior facts carry no run_analysis fact', () => {
    expect(derivePreviousAnalysisLens([mutationFact(), mutationFact()])).toBeNull();
  });

  it('after ONE prior analysis, the previous lens is the head lens', () => {
    expect(derivePreviousAnalysisLens([bothTriggerFact('2026-07-31T10:00:00.000Z')])).toBe(
      'sensitivity_flip_risk',
    );
  });

  it('after TWO prior analyses, the replay reports the DISPLACED lens (not the head)', () => {
    // Turn 1 selected flip-risk; turn 2 was displaced to pre-mortem. A one-step
    // look-back would answer 'sensitivity_flip_risk' here and cause pre-mortem
    // to repeat on turn 3 — the exact defect the replay exists to prevent.
    const priors = [
      bothTriggerFact('2026-07-31T11:00:00.000Z'),
      bothTriggerFact('2026-07-31T10:00:00.000Z'),
    ]; // newest-first, the loader convention
    expect(derivePreviousAnalysisLens(priors)).toBe('pre_mortem');
  });

  it('after THREE prior analyses the alternation continues', () => {
    const priors = [
      bothTriggerFact('2026-07-31T12:00:00.000Z'),
      bothTriggerFact('2026-07-31T11:00:00.000Z'),
      bothTriggerFact('2026-07-31T10:00:00.000Z'),
    ];
    expect(derivePreviousAnalysisLens(priors)).toBe('sensitivity_flip_risk');
  });

  it('is ordered by computed_at, not by array position', () => {
    // Same two facts, handed in the WRONG order. The canonical ordering
    // (`orderSuccessfulRunAnalysisFactsNewestFirst`) must still replay
    // 10:00 → 11:00, giving the displaced lens.
    const shuffled = [
      bothTriggerFact('2026-07-31T10:00:00.000Z'),
      bothTriggerFact('2026-07-31T11:00:00.000Z'),
    ];
    expect(derivePreviousAnalysisLens(shuffled)).toBe('pre_mortem');
  });

  it('a prior analysis that recommended NOTHING resets the history to null', () => {
    // "No lens last turn" is not "the lens from two turns ago" — so the newest
    // analysis recommending nothing must clear the history, not fall back.
    const priors = [
      noLensFact('2026-07-31T11:00:00.000Z'),
      bothTriggerFact('2026-07-31T10:00:00.000Z'),
    ];
    expect(derivePreviousAnalysisLens(priors)).toBeNull();
  });

  it('ignores noop run_analysis facts', () => {
    const noop = bothTriggerFact('2026-07-31T12:00:00.000Z') as { noop: boolean };
    noop.noop = true;
    expect(derivePreviousAnalysisLens([noop as unknown as HandlerFact])).toBeNull();
  });
});

// ============================================================================
// 2. End-to-end through compose — the two-turn journey
// ============================================================================

describe('2.211 — two consecutive analysis turns through composeToolCallResponse', () => {
  function lensBodyOf(response: { blocks: readonly unknown[] }): string | null {
    for (const raw of response.blocks) {
      const b = raw as Record<string, unknown>;
      if (b.type === 'coaching' && b.source === 'deterministic_signal' && b.coaching_kind === 'strengthen') {
        return typeof b.body === 'string' ? b.body : null;
      }
    }
    return null;
  }

  it('turn 1 (no history) ships the flip-risk lens', () => {
    const response = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [bothTriggerFact('2026-07-31T10:00:00.000Z')],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
      priorTurnFactsForLensHistory: [],
    });
    expect(lensBodyOf(response)).toBe(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED);
  });

  it('turn 2 (same shape, flip-risk last turn) ships the PRE-MORTEM lens', () => {
    const response = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [bothTriggerFact('2026-07-31T11:00:00.000Z')],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
      priorTurnFactsForLensHistory: [bothTriggerFact('2026-07-31T10:00:00.000Z')],
    });
    expect(lensBodyOf(response)).toBe(BODY_BY_RATIONALE.WIN_PROB_MODERATE);
  });

  it('an UNTHREADED call site is byte-identical to turn 1 (fail-safe, not fail-open)', () => {
    const withoutHistory = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [bothTriggerFact('2026-07-31T11:00:00.000Z')],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
    });
    expect(lensBodyOf(withoutHistory)).toBe(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED);
  });
});

// ============================================================================
// 3. ⚠ THE DRIFT PIN — both selectLens call sites see the same history
// ============================================================================

describe('2.211 — the lens block and the ui_directive cannot disagree', () => {
  const lookup = buildGraphNodeLookupFromGraph(GRAPH);

  function directiveFor(previousLens: 'sensitivity_flip_risk' | null) {
    const fact = bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact;
    const surface = buildLensSurface(
      fact,
      { created_at: '2026-07-31T11:00:01.000Z', graph_hash_at_generation: GRAPH_HASH, freshness: 'fresh' },
      previousLens,
    );
    expect(surface).not.toBeNull();
    const directive = buildFocusInspectorDirective(fact, lookup, [surface!.suggestion], previousLens);
    return { lens: surface!.selection.lens, directive };
  }

  it('POSITIVE CONTROL — with no history the flip-risk lens focuses its own factor', () => {
    const { lens, directive } = directiveFor(null);
    expect(lens).toBe('sensitivity_flip_risk');
    expect(directive?.verb).toBe('focus');
    expect(directive?.targets[0]?.id).toBe('fac_a');
  });

  it('after displacement the directive no longer focuses the DISPLACED lens’s factor', () => {
    const { lens, directive } = directiveFor('sensitivity_flip_risk');
    expect(lens).toBe('pre_mortem');
    // The pre-mortem WIN_PROB_MODERATE rationale has no single-factor subject,
    // so the ladder falls through to the v1 winner highlight — never a `focus`
    // on the factor belonging to the lens that was just displaced.
    expect(directive?.verb).not.toBe('focus');
    expect(directive?.targets[0]?.id).not.toBe('fac_a');
  });
});

// ============================================================================
// 4. The displaced/chosen telemetry pair
// ============================================================================

describe('2.211 — displaced-lens telemetry', () => {
  let sink: { event: string; data: Record<string, unknown> }[] = [];
  beforeEach(() => {
    sink = [];
    setTestSink((event, data) => sink.push({ event, data: data as Record<string, unknown> }));
  });
  afterEach(() => setTestSink(null));

  const ctx = {
    created_at: '2026-07-31T11:00:01.000Z',
    graph_hash_at_generation: GRAPH_HASH,
    freshness: 'fresh' as const,
  };

  it('emits the (displaced, chosen) pair exactly once on a displacement', () => {
    buildLensSurface(
      bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact,
      ctx,
      'sensitivity_flip_risk',
    );
    const events = sink.filter((e) => e.event === TelemetryEvents.V5LensNoRepeatDisplaced);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      displaced_lens_id: 'sensitivity_flip_risk',
      chosen_lens_id: 'pre_mortem',
      rationale_code: 'WIN_PROB_MODERATE',
      graph_hash_at_generation: GRAPH_HASH,
    });
  });

  it('does NOT emit when the head lens won normally (no broken alarm either way)', () => {
    buildLensSurface(bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact, ctx, null);
    expect(sink.filter((e) => e.event === TelemetryEvents.V5LensNoRepeatDisplaced)).toHaveLength(0);
    // Positive control (trap 13): the sink is NOT dark — the suggestion event
    // fired on the same call.
    expect(sink.filter((e) => e.event === TelemetryEvents.V5LensSuggestionEmitted)).toHaveLength(1);
  });
});
