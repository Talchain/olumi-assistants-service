/**
 * orchestrator-eval — decision_review fixture types.
 *
 * A decision_review fixture differs from a routing fixture in both halves:
 *
 *   INPUT   a routing fixture carries a `ContextPackAnalysis` that the chassis
 *           runs through `formatAnalysisForContext`. A decision_review fixture
 *           carries the REVIEW INVOCATION INPUT — the same object the runtime
 *           hands `buildDecisionReviewUserMessage` — so the eval assembles the
 *           user message through the production function rather than a copy.
 *
 *   OUTPUT  a routing candidate is PROSE (`assistant_text`). A decision_review
 *           candidate is a JSON OBJECT with eleven required keys. So candidates
 *           are recorded as objects, and the scored surface is the parsed
 *           object, not a string.
 *
 * The input type is deliberately expressed in terms of the PRODUCTION types
 * (type-only imports from `src/`): it must satisfy `DecisionReviewInvokeInput`
 * (so the production assembler accepts it) AND `ReviewInputForGrounding` (so
 * the production number-grounding checker accepts it). Both directions are
 * asserted at compile time in `__tests__/decision-review-assembly.test.ts` — a
 * fixture shape that drifts from either production contract fails to typecheck
 * rather than quietly scoring against a shape the runtime never sees.
 */

import type { DecisionReviewInvokeInput } from '../../../../src/cee/decision-review/invoke.js';
import type { ReviewInputForGrounding } from '../../../../src/cee/decision-review/shape-check.js';

/**
 * `isl_results` narrowed enough for the production grounding checker.
 *
 * `DecisionReviewInvokeInput.isl_results` is `Record<string, unknown>` (the
 * runtime forwards an opaque envelope), which is NOT assignable to
 * `ReviewInputForGrounding['isl_results']`. Fixtures therefore declare the
 * narrower shape — narrower is assignable to the opaque one, so BOTH
 * production functions accept a fixture, and a fixture that omits a field the
 * grounding corpus reads is visible at the type level instead of silently
 * shrinking the corpus (an empty corpus makes `isGrounded` skip — a vacuous
 * pass).
 */
export interface DecisionReviewEvalIslResults {
  option_comparison?: Array<{
    option_id?: string;
    option_label?: string;
    win_probability?: number;
    outcome?: { mean?: number; p10?: number; p90?: number };
    [key: string]: unknown;
  }>;
  factor_sensitivity?: Array<{
    factor_id?: string;
    factor_label?: string;
    elasticity?: number;
    [key: string]: unknown;
  }>;
  fragile_edges?: Array<{
    edge_id?: string;
    switch_probability?: number;
    marginal_switch_probability?: number;
    [key: string]: unknown;
  }>;
  robustness?: {
    level?: string;
    recommendation_stability?: number;
    overall_confidence?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** A fixture's review-invocation input. Satisfies both production contracts. */
export interface DecisionReviewEvalInput
  extends Omit<DecisionReviewInvokeInput, 'isl_results' | 'flip_threshold_data'> {
  readonly isl_results: DecisionReviewEvalIslResults;
  /**
   * Post-v11 input field (`invoke.ts:123`). Mutable-typed because
   * `ReviewInputForGrounding` declares a mutable array and a readonly array is
   * not assignable to one.
   */
  flip_threshold_data?: Array<{
    factor_id?: string;
    factor_label?: string;
    current_value?: number;
    flip_value?: number | null;
    [key: string]: unknown;
  }>;
}

/**
 * Where a fixture came from. Recorded because a pack whose every fixture was
 * invented by the same author on the same afternoon measures that author's
 * imagination, not the product (the R3-M2 lesson). The pack asserts its own
 * provenance VARIETY in `__tests__/decision-review-fixtures.test.ts`.
 */
export type DecisionReviewFixtureOrigin =
  /** Revived from the 2026-03-06 `tools/graph-evaluator` graded pack. */
  | 'graph-evaluator-revival'
  /** Shaped from a real deployed-pair capture. */
  | 'live-capture-derived'
  /** Reproduces a specific recorded defect (ROADMAP row / staging incident). */
  | 'defect-reproduction'
  /** Exercises a post-v11 input field no other fixture reaches. */
  | 'input-field-coverage';

export interface DecisionReviewFixtureProvenance {
  readonly origin: DecisionReviewFixtureOrigin;
  /** Where it came from, concretely (path, ROADMAP row, incident id). */
  readonly source: string;
  /** What this fixture is FOR — the axis it exists to hold. */
  readonly note: string;
}

/**
 * One recorded decision_review candidate output.
 *
 * `output` is the parsed decision_review JSON object. Recording the OBJECT
 * (not a string) keeps fixtures readable and diffable; the mock playback path
 * re-serialises it, so the extraction contract is still exercised offline.
 */
export interface DecisionReviewCandidate {
  readonly label: string;
  readonly note: string;
  readonly source: 'recorded' | 'live';
  readonly output: Record<string, unknown>;
}

export interface DecisionReviewEvalFixture {
  readonly id: string;
  readonly description: string;
  readonly provenance: DecisionReviewFixtureProvenance;
  readonly input: DecisionReviewEvalInput;
  readonly candidates: readonly DecisionReviewCandidate[];
  /**
   * Expected gate verdict per candidate label: `true` = SHOULD pass every
   * dimension, `false` = SHOULD be caught. Disagreement exits non-zero — that
   * disagreement is what proves a dimension still catches what it was built
   * for.
   */
  readonly expected: Readonly<Record<string, boolean>>;
  /**
   * Per-candidate RED-first pin: the dimension names this candidate MUST fail.
   *
   * `expected` alone is too weak for a multi-dimension pack — a candidate
   * seeded to trip `no_em_dashes` could fail overall for an unrelated reason
   * (a typo that broke schema completeness) and the fixture would still agree.
   * Naming the dimension makes each seeded defect a RED-first proof of THAT
   * dimension: the pack asserts the named dimension is among the failures, so
   * a dimension that silently stops firing turns its fixture RED even though
   * the overall verdict is unchanged.
   */
  readonly expectedFailedDimensions?: Readonly<Record<string, readonly string[]>>;
}

/** Compile-time proof that a fixture input satisfies the grounding contract. */
export type AssertGroundingCompatible = DecisionReviewEvalInput extends ReviewInputForGrounding
  ? true
  : never;
