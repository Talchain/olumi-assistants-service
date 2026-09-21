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
import { BODY_BY_RATIONALE, selectLens } from '../lens-selector.js';
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
 * EXACTLY TWO lenses trigger: rule 1a-i fires (`fac_a` is `isolated`) AND rule
 * 2c fires (max win_probability 0.62 ∈ [0.4, 0.7)). `fac_a` resolves in GRAPH,
 * so the flip-risk lens has a focusable subject and the pre-mortem lens
 * (WIN_PROB_MODERATE) deliberately has none — which is what makes the directive
 * drift observable.
 *
 * ⚠ ROADMAP 2.490 — THE INFLUENCE SCORES ARE LOAD-BEARING AND WERE NOT, ONCE.
 * This fixture shipped as `fac_a: 1.0` / `fac_b: 0.9`, a 0.526 share — an
 * INCIDENTAL strict-majority dominance that the docstring above never declared
 * and that no test here is about. Once 2.490 made `devils_advocacy` reachable
 * from a displaced sensitivity head, that undeclared third lens took
 * pre_mortem's slot and twelve tests in this file changed meaning. The scores
 * are now equal, so there is NO dominant driver and the fixture triggers the
 * two lenses it names. `precondition — exactly two lenses` below fails loud if
 * that drifts again; the devils_advocacy promotion this file no longer sees is
 * pinned on the live captures in `lens-dsk-sequence-2490.test.ts`.
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
          { factor_id: 'fac_b', influence_score: 1.0, influence_rank: 2, confidence: 0.9 },
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
  it('PRECONDITION — the alternation fixture triggers EXACTLY the two lenses it names', () => {
    // ⚠ ROADMAP 2.490. Every test in this file reads as an assertion about the
    // REPLAY machinery, and each one silently assumes the fixture's eligible set
    // is {sensitivity_flip_risk, pre_mortem}. It was {…, devils_advocacy} for a
    // while without anyone declaring it, because a 1.0/0.9 influence split is a
    // 0.526 strict majority. Assert the assumption rather than trusting the
    // numbers to stay where they were put.
    const fact = bothTriggerFact('2026-07-31T10:00:00.000Z') as RunAnalysisHandlerFact;

    // No strict-majority driver ⇒ neither sensitivity rule 1b nor
    // devils_advocacy's shared dominance derivation can fire.
    const scores = (
      (fact.result as unknown as { enrichment: { factor_sensitivity: { influence_score: number }[] } })
        .enrichment.factor_sensitivity
    ).map((f) => f.influence_score);
    const total = scores.reduce((a, s) => a + s, 0);
    expect(Math.max(...scores) / total).toBeLessThanOrEqual(0.5);

    // …and the eligible set really is the pair, demonstrated by the cycle: each
    // lens takes the slot when the other one held it last.
    expect(selectLens(fact)!.lens).toBe('sensitivity_flip_risk');
    expect(selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' })!.lens).toBe(
      'pre_mortem',
    );
    expect(selectLens(fact, { previousAnalysisLens: 'pre_mortem' })!.lens).toBe(
      'sensitivity_flip_risk',
    );
  });

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


// ============================================================================
// 5. AMENDMENT A1 — WINDOW-EDGE BEHAVIOUR, DERIVED RATHER THAN ASSERTED.
//
// `prior_facts` is read through a bounded window (`SESSION_READ_WINDOW_DEFAULT
// = 20` turns, overridable by `SESSION_READ_WINDOW_TURNS` —
// `session/index.ts:40,93-96`). Once a scenario has more analysis facts than
// the window holds, the replay ALWAYS starts cold the same number of steps
// back, so its output stops depending on N — and the emitted lens becomes a
// CONSTANT. Consecutive repeats are therefore UNBOUNDED, not "at most one".
//
// These sequences are MEASURED, not predicted. `w` slices the visible history
// exactly as the store's `defaultReadLimit` does.
// ============================================================================

describe('2.211 A1 — the replay degrades to a constant lens beyond the read window', () => {
  const SHORT: Record<string, string> = { sensitivity_flip_risk: 'F', pre_mortem: 'P' };

  /** The TRUE emitted-lens sequence over `turns` consecutive both-trigger
   *  analysis turns, when only the newest `windowSize` analysis facts are
   *  visible to the replay. `Infinity` = no window (the intended behaviour). */
  function emittedSequence(windowSize: number, turns: number): string {
    const history: HandlerFact[] = []; // newest-first, the loader convention
    const out: string[] = [];
    for (let t = 0; t < turns; t += 1) {
      const visible = windowSize === Infinity ? history : history.slice(0, windowSize);
      const previous = derivePreviousAnalysisLens(visible);
      const at = new Date(Date.UTC(2026, 6, 31, 10 + t)).toISOString();
      const selection = selectLens(bothTriggerFact(at) as RunAnalysisHandlerFact, {
        previousAnalysisLens: previous,
      });
      out.push(selection === null ? '-' : (SHORT[selection.lens] ?? selection.lens));
      history.unshift(bothTriggerFact(at));
    }
    return out.join('');
  }

  function longestRun(s: string): number {
    let best = 1;
    let cur = 1;
    for (let i = 1; i < s.length; i += 1) {
      cur = s[i] === s[i - 1] ? cur + 1 : 1;
      if (cur > best) best = cur;
    }
    return best;
  }

  it('POSITIVE CONTROL — with no window the lenses alternate perfectly', () => {
    expect(emittedSequence(Infinity, 10)).toBe('FPFPFPFPFP');
    expect(longestRun(emittedSequence(Infinity, 10))).toBe(1);
  });

  it('a window of 20 does not bind over 10 turns — still alternating', () => {
    expect(emittedSequence(20, 10)).toBe('FPFPFPFPFP');
  });

  it('beyond the window the emitted lens is CONSTANT — repeats are unbounded', () => {
    // The exact measured sequences. Note the run length grows as the window
    // SHRINKS, and is bounded only by the number of turns — never by 1.
    expect(emittedSequence(1, 10)).toBe('FPPPPPPPPP');
    expect(emittedSequence(2, 10)).toBe('FPFFFFFFFF');
    expect(emittedSequence(3, 10)).toBe('FPFPPPPPPP');
    expect(emittedSequence(4, 10)).toBe('FPFPFFFFFF');
    expect(emittedSequence(5, 10)).toBe('FPFPFPPPPP');
  });

  it('which constant it settles on is the PARITY of the in-window fact count', () => {
    // Odd window → the cold replay ends on flip-risk → the head is displaced →
    // pre-mortem forever. Even window → it ends on pre-mortem → flip-risk
    // forever. This is why the failure is invisible in testing: it depends on a
    // deployment value, not on the analysis.
    for (const odd of [1, 3, 5]) expect(emittedSequence(odd, 10).endsWith('P')).toBe(true);
    for (const even of [2, 4]) expect(emittedSequence(even, 10).endsWith('F')).toBe(true);
  });

  it('the degradation NEVER breaks the two load-bearing invariants', () => {
    // Whatever the window does to diversity, every emitted lens is still a
    // genuinely triggered, executor-available lens from the LOCKED order, and
    // may-recommend-nothing is never reached from a history value.
    for (const w of [1, 2, 3, 4, 5, 20, Infinity]) {
      const seq = emittedSequence(w, 10);
      expect(seq).toMatch(/^[FP]+$/); // never '-', i.e. never a spurious null
    }
  });

  it('the OTHER fail-safe mode really is "no change at all"', () => {
    // An absent history (unthreaded call site, empty prior facts, or a fact set
    // the replay cannot read) degrades to EXACTLY the pre-amendment selection —
    // this is the mode the "at most one" claim was true of.
    const base = selectLens(bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact);
    expect(
      selectLens(bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact, {
        previousAnalysisLens: derivePreviousAnalysisLens([]),
      }),
    ).toStrictEqual(base);
  });
});

// ============================================================================
// 6. AMENDMENT A2 — THE REPLAY'S FACT SET MUST BE THE EMISSION'S FACT SET.
//
// `selectLens` has no status gate, and compose's current-turn branch gates only
// on `graph_hash_at_run` (compose.ts:395-396). So a lens IS emitted off a
// degraded analysis. The replay must therefore see the same facts, or a lens
// emitted off one is invisible to the next turn's history and repeats.
//
// Reachability is not hypothetical: `run-analysis.ts:1221` accepts `partial`
// unconditionally, and `:1244` accepts an UNRECOGNISED status precisely WHEN a
// finite `option_comparison[].win_probability` is present — the same bytes rule
// 2c reads. On that arm, acceptance GUARANTEES a lens-bearing signal.
// ============================================================================

/** A degraded-but-accepted analysis: the permissive accept matrix's `partial`
 *  arm, carrying the same signals as `bothTriggerFact`. The win probability
 *  0.62 is the one used by the handler's own permissive-status test fixture
 *  (`tools/handlers/__tests__/run-analysis-permissive-status.test.ts:91-96`). */
function degradedFact(computedAt: string, status = 'partial'): HandlerFact {
  const fact = bothTriggerFact(computedAt) as unknown as {
    result: { enrichment: Record<string, unknown> };
  };
  fact.result.enrichment.analysis_status = status;
  return fact as unknown as HandlerFact;
}

/** A run_analysis fact with NO `graph_hash_at_run` — the contract marks it
 *  OPTIONAL (`@talchain/schemas` handler-fact.d.ts: `z.ZodOptional<z.ZodString>`),
 *  and compose's emission gate rejects it, so it emits no lens. */
function noGraphHashFact(computedAt: string): HandlerFact {
  const fact = bothTriggerFact(computedAt) as unknown as {
    result: Record<string, unknown>;
  };
  delete fact.result.graph_hash_at_run;
  return fact as unknown as HandlerFact;
}

describe('2.211 A2 — a lens emitted off a DEGRADED analysis is visible to the history', () => {
  it('POSITIVE CONTROL — a degraded analysis really does emit a lens today', () => {
    // The emission path has no status gate. If this ever goes RED the
    // divergence has been closed from the other side and the tests below
    // should be re-derived, not "fixed".
    const selection = selectLens(degradedFact('2026-07-31T10:00:00.000Z') as RunAnalysisHandlerFact);
    expect(selection?.lens).toBe('sensitivity_flip_risk');
  });

  it('the replay SEES a partial-status analysis', () => {
    expect(derivePreviousAnalysisLens([degradedFact('2026-07-31T10:00:00.000Z')])).toBe(
      'sensitivity_flip_risk',
    );
  });

  it('the replay SEES an unrecognised-status analysis (the accept-by-usable-fields arm)', () => {
    expect(
      derivePreviousAnalysisLens([degradedFact('2026-07-31T10:00:00.000Z', 'still_thinking')]),
    ).toBe('sensitivity_flip_risk');
  });

  it('so a lens emitted off a degraded analysis is NOT repeated on the next turn', () => {
    const previous = derivePreviousAnalysisLens([degradedFact('2026-07-31T10:00:00.000Z')]);
    const selection = selectLens(bothTriggerFact('2026-07-31T11:00:00.000Z') as RunAnalysisHandlerFact, {
      previousAnalysisLens: previous,
    });
    expect(selection?.lens).toBe('pre_mortem');
  });

  it('a degraded analysis mixes correctly into a longer history', () => {
    // successful → degraded → (this turn). The replay must alternate across
    // BOTH, so the newest (degraded) turn was displaced to pre-mortem.
    expect(
      derivePreviousAnalysisLens([
        degradedFact('2026-07-31T11:00:00.000Z'),
        bothTriggerFact('2026-07-31T10:00:00.000Z'),
      ]),
    ).toBe('pre_mortem');
  });
});

describe('2.211 A2 — a fact that CANNOT have emitted a lens is excluded, both sides measured', () => {
  it('EMISSION side: a fact with no graph_hash_at_run emits no lens block', () => {
    const response = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [noGraphHashFact('2026-07-31T10:00:00.000Z')],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
      priorTurnFactsForLensHistory: [],
    });
    const lensBlocks = response.blocks.filter((raw) => {
      const b = raw as Record<string, unknown>;
      return b.type === 'coaching' && b.source === 'deterministic_signal';
    });
    expect(lensBlocks).toHaveLength(0);
  });

  it('POSITIVE CONTROL — the same fact WITH a graph hash does emit one', () => {
    const response = composeToolCallResponse({
      ...BASE_INPUT,
      handlerFacts: [bothTriggerFact('2026-07-31T10:00:00.000Z')],
      persistedGraph: GRAPH,
      persistedGraphHash: GRAPH_HASH,
      priorTurnFactsForLensHistory: [],
    });
    const lensBlocks = response.blocks.filter((raw) => {
      const b = raw as Record<string, unknown>;
      return b.type === 'coaching' && b.source === 'deterministic_signal';
    });
    expect(lensBlocks).toHaveLength(1);
  });

  it('HISTORY side: the replay excludes it too — the two sides AGREE by measurement', () => {
    expect(derivePreviousAnalysisLens([noGraphHashFact('2026-07-31T10:00:00.000Z')])).toBeNull();
  });
});
