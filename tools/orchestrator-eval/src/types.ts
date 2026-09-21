/**
 * orchestrator-eval — shared types.
 *
 * The FOUNDATION slice of the orchestrator eval-pack. A fixture pairs a raw
 * analysis projection (fed through the REAL production assembly path) with one
 * or more candidate orchestrator responses to score. In the default path the
 * candidate responses are RECORDED (checked into the fixture) — the eval makes
 * NO paid LLM call. The seam where a live model produces the candidate, and
 * where a paid LLM judge scores it, is documented in `judge-seam.ts`.
 */

import type { ContextPackAnalysis } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';

/**
 * A single candidate orchestrator response under evaluation.
 *
 * `text` is the user-facing `assistant_text` — the surface the honesty guards
 * and the goal-fit-conflation detector scan. The foundation scores prose only;
 * structured-field scoring (insights[]/recommended_actions[]) is deferred to
 * the follow-up fixture set (see README "Deliberately deferred").
 */
export interface CandidateResponse {
  /** Stable label within the fixture, e.g. "good" | "regression". */
  readonly label: string;
  /** Human note on what this candidate demonstrates. */
  readonly note: string;
  /**
   * Where the response came from:
   *   - "recorded": checked into the fixture (default path — no paid call).
   *   - "live":     produced by a real model at run time (paid seam).
   */
  readonly source: 'recorded' | 'live';
  /** The user-facing assistant_text to score. */
  readonly text: string;
}

/**
 * One orchestrator-eval fixture.
 *
 * `analysis` is a raw {@link ContextPackAnalysis} — the post-projection,
 * pre-display-format handoff. The chassis runs it through the PRODUCTION
 * display formatter (`formatAnalysisForContext`), which is the exact assembly
 * stage the goal-fit fix lives in. This is the "real assembly path" the
 * candidate prompt is grounded on.
 */
export interface OrchestratorEvalFixture {
  readonly id: string;
  readonly description: string;
  /** The user turn that would drive the orchestrator (context/provenance only in the foundation). */
  readonly user_message: string;
  /** Raw analysis projection — fed through the REAL production assembly. */
  readonly analysis: ContextPackAnalysis;
  /** Candidate responses to score. */
  readonly candidates: readonly CandidateResponse[];
  /**
   * Expected gate verdict per candidate `label`: `true` = the candidate SHOULD
   * pass the gate, `false` = it SHOULD be caught (fail). The chassis exits
   * non-zero when an actual verdict disagrees with its expectation — that
   * disagreement is what proves the gate still catches the drift it was built
   * to catch.
   */
  readonly expected: Readonly<Record<string, boolean>>;
}

/**
 * Where a dimension's rule comes from.
 *   - `production-guard`     re-exported runtime code; eval and runtime cannot drift.
 *   - `served-prompt-derived` PARSED out of the served prompt text at run time,
 *                            so the rule tracks a prompt bump instead of
 *                            mirroring one moment of it (see
 *                            decision-review/served-contract.ts).
 *   - `eval-assertion`       this pack's own worked logic, with its reasoning
 *                            written down at the definition site.
 */
export type DimensionSource = 'production-guard' | 'served-prompt-derived' | 'eval-assertion';

/**
 * THREE states, not two. This is the correction that matters most in the pack.
 *
 * A dimension that could NOT be evaluated — because the input lacks the field
 * it reads, or the contract imposes no constraint on this run — is
 * `not_applicable`. It is NOT a pass.
 *
 * The first version of this pack had only pass/fail, so an unevaluable
 * dimension reported `pass: true, scanned: 0` and was counted in the
 * denominator. The committed baseline therefore read "18/19" when one of those
 * nineteen had measured nothing at all: `tone_alignment` resolves its row from
 * `deterministic_coaching`, which a response-only capture does not carry. An
 * unmeasured dimension counted as a pass — the exact dishonesty this pack
 * exists to catch, inside the pack.
 *
 * Consequences, all enforced:
 *   - NA is EXCLUDED from the measured denominator and reported out-of-band;
 *   - NA never contributes to `pass` (it is not a failure either);
 *   - a MEASURED-clean dimension that carries a `scanned` count must carry a
 *     NON-ZERO one, so "passed" and "did not look" can never render alike.
 *     Asserted for the whole pack in decision-review-anti-vacuity.test.ts.
 */
export type DimensionStatus = 'pass' | 'fail' | 'not_applicable';

/** What a dimension's `scanned` count actually counts. */
export type ScannedUnit =
  | 'prose_strings' // user-facing strings collected from the output
  | 'output_strings' // every string in the output, id-bearing fields included
  | 'graph_ids' // entity ids available to ground against
  | 'capped_items' // items the contract count-caps were applied to
  | 'entity_refs' // bias affected_elements references checked
  | 'descriptive_numbers' // numbers found in the runtime's descriptive fields
  | 'option_keys' // option ids the run defines
  | 'headlines' // story_headlines values available to compare
  | 'scenario_keys' // scenario_contexts keys examined
  | 'sibling_sections'; // sections compared against primary_risk

/** One scored dimension of a candidate. */
export interface DimensionResult {
  /** Dimension name (stable key for reporting). */
  readonly name: string;
  /**
   * False ONLY when `status === 'fail'`. A `not_applicable` dimension does not
   * fail a candidate — but it does not pass one either; read `status` for that
   * distinction and NEVER infer "measured and clean" from this boolean alone.
   */
  readonly pass: boolean;
  /** pass | fail | not_applicable — see {@link DimensionStatus}. */
  readonly status: DimensionStatus;
  /** Where the check comes from. */
  readonly source: DimensionSource;
  /** Human-readable evidence, e.g. the offending phrase or "clean". */
  readonly detail: string;
  /**
   * ANTI-VACUITY INSTRUMENT — how many units this dimension actually examined.
   *
   * Every absence check ("no banned term", "no fabricated callback") passes
   * trivially when there is nothing to look at, so a green absence dimension is
   * only meaningful alongside proof that it SAW something. Trap 13 in miniature:
   * a leak test that captured 0 bytes passed every "no raw value present"
   * assertion by testing nothing.
   *
   * ⚠ ALWAYS THE CONTENT EXAMINED — never the number of rules applied.
   *
   * An earlier draft let this field mean either, and the ambiguity flattered
   * exactly the dimensions that needed watching: `no_banned_lexicon` reported
   * `scanned: 10` (ten parsed banned terms) on an output containing no prose at
   * all, which reads as thoroughly measured when nothing was checked. Ten rules
   * applied to zero strings is zero checks. Rule-set sizes now live in
   * `detail` ("clean against 10 banned terms"), where they inform without
   * inflating.
   *
   * So a non-zero value here is always real anti-vacuity evidence, and the
   * assertion over it needs no per-dimension interpretation. {@link scannedUnit}
   * says WHICH content was counted.
   *
   * Optional because some presence dimensions (`shape_valid`,
   * `review_card_coverage`) inspect a single field rather than a corpus.
   */
  readonly scanned?: number;

  /** What {@link scanned} counts — CONTENT or RULES. See the note above. */
  readonly scannedUnit?: ScannedUnit;
}

/** The deterministic score for one candidate. */
export interface ScoreResult {
  readonly candidate: string;
  /** Overall pass = no dimension FAILED. `not_applicable` does not fail. */
  readonly pass: boolean;
  readonly dimensions: readonly DimensionResult[];
  /**
   * Dimensions actually evaluated. THE DENOMINATOR for any "N/M" statement —
   * never `dimensions.length`, which silently counts the unevaluable ones.
   */
  readonly measured: number;
  /** Dimensions that could not be evaluated. Reported OUT OF BAND, never as passes. */
  readonly notApplicable: number;
  /** Measured dimensions that passed. The NUMERATOR. */
  readonly passed: number;
}

/**
 * Build a {@link ScoreResult} from its dimensions, deriving the verdict and the
 * measured/NA split in ONE place.
 *
 * Centralised deliberately: every "N/M" figure this tool reports — CLI output,
 * committed report JSON, the baseline README — comes from here, so a
 * `not_applicable` dimension cannot be counted as a pass in one reader and not
 * another. That divergence is precisely how the first baseline came to claim
 * 18/19.
 */
export function finaliseScore(
  candidate: string,
  dimensions: readonly DimensionResult[],
): ScoreResult {
  const notApplicable = dimensions.filter((d) => d.status === 'not_applicable').length;
  const failed = dimensions.filter((d) => d.status === 'fail').length;
  const measured = dimensions.length - notApplicable;
  return {
    candidate,
    pass: failed === 0,
    dimensions,
    measured,
    notApplicable,
    passed: measured - failed,
  };
}

/** The result of evaluating one fixture (assembly + every candidate scored). */
export interface FixtureReport {
  readonly fixtureId: string;
  /**
   * Assembly-fidelity summary: what the PRODUCTION formatter emitted for the
   * leading option's win% vs target-fit, proving the two are kept distinct in
   * the context the prompt actually sees.
   */
  readonly assembly: {
    readonly leadingWinProbability: string | null;
    readonly leadingTargetFit: string | null;
    readonly goalFitProse: string | null;
    /** True when win% and target-fit are rendered as distinct values (the fix). */
    readonly distinguishesWinFromTargetFit: boolean;
  };
  readonly scores: readonly ScoreResult[];
  /**
   * Per-candidate agreement between the gate's verdict and the fixture's
   * `expected` map. `false` for any candidate means the gate no longer behaves
   * as the fixture asserts — a real regression in the gate itself.
   */
  readonly agreement: Readonly<Record<string, boolean>>;
  /** True when every candidate's verdict matched its expectation. */
  readonly ok: boolean;
}
