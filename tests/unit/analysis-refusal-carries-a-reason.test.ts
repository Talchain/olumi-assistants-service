/**
 * A REFUSED RUN MUST SAY WHY — the silent-refusal defect.
 *
 * ── THE QUESTION THIS SUITE ANSWERS, AND THE ONE IT DOES NOT ───────────────
 * `tests/unit/decision-free-model.test.ts` answers *"is the zero-option SHAPE
 * admitted by the validators?"* — and the answer is yes, deliberately, for the
 * exploratory map. THIS suite answers a different question (trap 21): *"when
 * run admission REFUSES, does the product hand the user a reason?"* The two
 * must not be collapsed: a graph can be perfectly legal to hold and still be
 * un-analysable, and that refusal is where the product either coaches or goes
 * silent.
 *
 * ── THE DEFECT, MEASURED AT `1a3f8c56` BEFORE THE FIX ──────────────────────
 * A model with no alternatives to compare — the state a DIAGNOSIS brief should
 * legitimately reach, where the team has named explanations but no course of
 * action — produced this:
 *
 *   readiness   status: "analysis_ready"   safeToAnalyse: TRUE   nextStep: null
 *   admission   willProceed: FALSE         blockedNextStep: NULL
 *
 * The run is refused and the user is told NOTHING. Every other refusal in the
 * branch space carries a real sentence; only this one is silent, so the silence
 * is a genuine discrimination and not an artefact of the corpus.
 *
 * The refusing branch's own comment claims the opposite — *"A local refusal is
 * immediate and explicable"* (`analysis-ready-core.ts`, the IDENTICAL_OPTIONS
 * floor). It was immediate and it was not explicable. This suite pins the
 * property that comment asserts.
 *
 * ── WHY THE INVARIANT IS STRUCTURAL AND NOT A CASE LIST ────────────────────
 * The fix is ONE derivation in `resolveRunAdmission`, which is already the
 * module's designated single derivation point for `blockedNextStep`. So the
 * guard is written as a PROPERTY over the enumerated branch space — *every*
 * refusal carries a reason — rather than as an assertion about the one cell
 * that moved. A per-case list would pass while a NEW silent return site was
 * added; the property cannot.
 *
 * ── OPPOSITE-DIRECTION TWINS (the whole risk) ──────────────────────────────
 * The harm this fix could trade for is overwriting the SPECIFIC refusals with a
 * generic one, or attaching a refusal sentence to a run that proceeds. Both
 * directions are pinned below, by exact string identity, and both fail if the
 * `??` fallback is widened into an unconditional assignment.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRunAdmission,
  NO_COMPARISON_NEXT_STEP,
} from '../../src/orchestrator-v5/tools/handlers/analysis-ready-core.js';

// =============================================================================
// Shape builders — the branch space, enumerated rather than hand-picked
// =============================================================================

const edge = (from: string, to: string) => ({
  from,
  to,
  strength: { mean: 0.6, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const factor = (id: string, label: string, category = 'controllable') => ({
  id,
  kind: 'factor',
  label,
  category,
  data: { value: 0.5, extractionType: 'explicit' },
});

const GRAPH_BASE = { version: '1', default_seed: 42 };

/**
 * ZERO ALTERNATIVES — the exploratory map, and the cell that was silent.
 *
 * This is the shape a diagnosis brief should reach: a goal the team wants to
 * understand, the things they think are driving it as FACTORS, and no course of
 * action yet because nobody has proposed one.
 */
const zeroAlternatives = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Understand why retention is slipping' },
    { id: 'out_1', kind: 'outcome', label: 'Retention' },
    // ⚠ `observable`, and the category is LOAD-BEARING for this fixture. A
    // CONTROLLABLE factor on the same shape produces a different, already
    // non-silent refusal ("Choose which option changes for ..."), so a fixture
    // built with the wrong category would pin a cell that was never broken and
    // report a fix for a defect it never reached. Measured both ways at
    // `1a3f8c56`; only the observable arm was silent.
    factor('fac_a', 'Onboarding quality', 'observable'),
  ],
  edges: [edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/**
 * TWIN OF THE FIXTURE ITSELF — the same zero-option shape with a CONTROLLABLE
 * factor. It was already explicable before this change and must stay that way:
 * proof that the new sentence is reached by the silent cell specifically, and
 * not by "any graph with no options".
 */
const zeroAlternativesControllable = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Understand why retention is slipping' },
    { id: 'out_1', kind: 'outcome', label: 'Retention' },
    factor('fac_a', 'Onboarding quality'),
  ],
  edges: [edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/** ONE alternative — a decision that is not yet a comparison. */
const oneAlternative = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow' },
    { id: 'dec_1', kind: 'decision', label: 'What to do' },
    { id: 'opt_1', kind: 'option', label: 'Do it' },
    { id: 'out_1', kind: 'outcome', label: 'Revenue' },
    factor('fac_a', 'Load'),
  ],
  edges: [edge('dec_1', 'opt_1'), edge('opt_1', 'fac_a'), edge('fac_a', 'out_1'), edge('out_1', 'goal_1')],
};

/** TWO alternatives but no goal — a differently-broken refusal. */
const twoAlternativesNoGoal = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'What to do' },
    { id: 'opt_1', kind: 'option', label: 'A' },
    { id: 'opt_2', kind: 'option', label: 'B' },
    factor('fac_a', 'Load'),
  ],
  edges: [edge('dec_1', 'opt_1'), edge('dec_1', 'opt_2'), edge('opt_1', 'fac_a')],
};

/** TWO alternatives, configured and distinct — this one must PROCEED. */
const twoAlternativesConfigured = {
  ...GRAPH_BASE,
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'dec_1', kind: 'decision', label: 'Which path' },
    { id: 'opt_1', kind: 'option', label: 'Raise price', data: { interventions: { fac_a: 0.8 } }, is_baseline: false },
    { id: 'opt_2', kind: 'option', label: 'Keep as is', data: { interventions: { fac_a: 0.2 } }, is_baseline: true },
    factor('fac_a', 'Price level'),
    { id: 'out_1', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [
    edge('dec_1', 'opt_1'),
    edge('dec_1', 'opt_2'),
    edge('opt_1', 'fac_a'),
    edge('opt_2', 'fac_a'),
    edge('fac_a', 'out_1'),
    edge('out_1', 'goal_1'),
  ],
};

const BRANCH_SPACE: ReadonlyArray<readonly [string, unknown]> = [
  ['no graph at all', null],
  ['zero alternatives (the exploratory map)', zeroAlternatives],
  ['zero alternatives, controllable factor', zeroAlternativesControllable],
  ['one alternative', oneAlternative],
  ['two alternatives, no goal', twoAlternativesNoGoal],
  ['two alternatives, configured', twoAlternativesConfigured],
];

// =============================================================================
// THE PROPERTY — a refusal is never silent
// =============================================================================

describe('run admission — every refusal carries a reason', () => {
  it.each(BRANCH_SPACE)(
    'PROPERTY: %s — willProceed false implies a non-empty next step',
    (_name, graph) => {
      const admission = resolveRunAdmission(graph as never);
      if (admission.willProceed) return; // the proceed case is pinned separately below
      expect(typeof admission.blockedNextStep).toBe('string');
      expect((admission.blockedNextStep ?? '').trim().length).toBeGreaterThan(0);
    },
  );

  it('THE DEFECT: a model with no alternatives is refused, and now says why', () => {
    const admission = resolveRunAdmission(zeroAlternatives as never);
    // Bound by IDENTITY on both terms: the refusal AND the sentence. A value
    // predicate ("some string is present") could be satisfied by a different
    // refusal reaching this graph for a different reason.
    expect(admission.willProceed).toBe(false);
    expect(admission.blockedNextStep).toBe(NO_COMPARISON_NEXT_STEP);
  });

  it('the sentence coaches toward NAMING alternatives rather than apologising', () => {
    // Pins the exported constant itself, so a rewrite that turns coaching into
    // an apology or an error message REDs here rather than shipping.
    expect(NO_COMPARISON_NEXT_STEP).toMatch(/\bname\b/i);
    expect(NO_COMPARISON_NEXT_STEP).toMatch(/\boptions\b/i);
    expect(NO_COMPARISON_NEXT_STEP.endsWith('.')).toBe(true);
    // British English, and none of the egress-forbidden furniture.
    expect(NO_COMPARISON_NEXT_STEP).not.toMatch(/[—–]/);
  });
});

// =============================================================================
// OPPOSITE-DIRECTION TWINS — the harm this fix could have traded for
// =============================================================================

describe('run admission — the specific refusals are NOT overwritten', () => {
  /**
   * ⭐ THE LOAD-BEARING TWIN. The fix is a `??` fallback. Widened to an
   * unconditional assignment it would replace every specific, actionable
   * refusal with one generic sentence — strictly worse than the defect, because
   * it would delete working guidance from three branches to fix one.
   *
   * Each expectation is an EXACT string, captured from the pristine tree at
   * `1a3f8c56` before the change, so any drift is visible rather than absorbed.
   */
  it.each([
    ['no graph at all', null, 'Draft or save a model first, then run analysis.'],
    ['one alternative', oneAlternative, 'Review all 2 readiness issues together before analysis.'],
    ['two alternatives, no goal', twoAlternativesNoGoal, 'Review all 2 readiness issues together before analysis.'],
  ] as ReadonlyArray<readonly [string, unknown, string]>)(
    'TWIN: %s keeps its own reason, byte for byte',
    (_name, graph, expected) => {
      const admission = resolveRunAdmission(graph as never);
      expect(admission.willProceed).toBe(false);
      expect(admission.blockedNextStep).toBe(expected);
      // And it is NOT the new sentence — the discrimination, stated positively.
      expect(admission.blockedNextStep).not.toBe(NO_COMPARISON_NEXT_STEP);
    },
  );

  it('TWIN: the same zero-option shape with a controllable factor keeps ITS reason', () => {
    // The discrimination is the silent cell, not "no options". If the fallback
    // were keyed on option count instead of on an absent reason, this would
    // wrongly flip to the new sentence.
    const admission = resolveRunAdmission(zeroAlternativesControllable as never);
    expect(admission.willProceed).toBe(false);
    expect(admission.blockedNextStep).not.toBe(NO_COMPARISON_NEXT_STEP);
    expect((admission.blockedNextStep ?? '').length).toBeGreaterThan(0);
  });

  it('TWIN: a run that PROCEEDS carries no next step at all', () => {
    // The other direction of the same harm: attaching a refusal sentence to a
    // graph that is going to run would put a "do this first" instruction on a
    // screen that is already analysing.
    const admission = resolveRunAdmission(twoAlternativesConfigured as never);
    expect(admission.willProceed).toBe(true);
    expect(admission.blockedNextStep).toBeNull();
  });
});

// =============================================================================
// WHAT THIS SUITE DOES NOT COVER — stated, not implied
// =============================================================================

/**
 * ⚠ SCOPE, so no later reader infers coverage this does not have.
 *
 *  · The corpus above is AUTHOR-BUILT. It enumerates the admission branch space
 *    rather than sampling real briefs, which is appropriate for a STRUCTURAL
 *    invariant over return sites but is not evidence about which shapes real
 *    drafts reach.
 *  · The 14 captured draws in
 *    `tools/graph-evaluator/governed/draft-graph-v5/baseline/` are deliberately
 *    NOT used here. Measured: all 14 are V1-shaped draft output, so all 14 fail
 *    `GraphV3.safeParse` and land in ONE cell (`SCHEMA_INVALID`). Fourteen cases
 *    that all exercise one branch would read as breadth and supply none.
 *  · This suite says nothing about whether a diagnosis brief REACHES the
 *    zero-alternative shape. That depends on how the draft model files an
 *    explanation, which is the records/projection seam and is not touched here.
 */
