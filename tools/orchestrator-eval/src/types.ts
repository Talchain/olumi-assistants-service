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

/** One scored dimension of a candidate. */
export interface DimensionResult {
  /** Dimension name (stable key for reporting). */
  readonly name: string;
  /** Whether this dimension passed. */
  readonly pass: boolean;
  /** Where the check comes from. */
  readonly source: DimensionSource;
  /** Human-readable evidence, e.g. the offending phrase or "clean". */
  readonly detail: string;
  /**
   * ANTI-VACUITY INSTRUMENT — how many units this dimension actually examined
   * (prose strings scanned, keys compared, numbers checked).
   *
   * Every absence check ("no banned term", "no fabricated callback") passes
   * trivially when there is nothing to look at, so a green absence dimension is
   * only meaningful alongside proof that it SAW something. Trap 13 in miniature:
   * a leak test that captured 0 bytes passed every "no raw value present"
   * assertion by testing nothing. Recording the corpus size makes that visible
   * in the report AND assertable in a test (`decision-review-anti-vacuity.test.ts`
   * requires `scanned > 0` for every absence dimension on every good candidate).
   *
   * Optional because presence dimensions (`substance_present`) have no corpus.
   */
  readonly scanned?: number;
}

/** The deterministic score for one candidate. */
export interface ScoreResult {
  readonly candidate: string;
  /** Overall pass = every dimension passed. */
  readonly pass: boolean;
  readonly dimensions: readonly DimensionResult[];
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
