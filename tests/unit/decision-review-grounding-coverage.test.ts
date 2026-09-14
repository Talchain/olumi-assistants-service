/**
 * Decision Review — grounding COVERAGE (the "cannot check" third state)
 *
 * `isGrounded` fails OPEN on an empty corpus (`shape-check.ts`): with nothing to
 * ground against, every number in the prose passes VACUOUSLY and the result is
 * byte-identical to a run that was checked and found clean. "Did not look" and
 * "looked and found nothing" rendered the same, and nothing recorded which had
 * happened.
 *
 * This spec pins the third state that now distinguishes them, and — just as
 * importantly — pins that adding it changed NOTHING a consumer acts on:
 *
 *  - the retry filter          `assist.v1.decision-review.ts` → w.startsWith('UNGROUNDED_NUMBER')
 *  - the FATAL promotion       `decompose.ts`                 → w.startsWith('UNGROUNDED_NUMBER')
 *  - the degraded-status flag  `assist.v1.decision-review.ts` → shapeCheck.warnings.length > 0
 *
 * That third consumer is why the diagnostic is a FIELD and not a warning: a
 * differently-prefixed warning would slip past both `startsWith` filters and
 * still flip `logCeeCall status` from "ok" to "degraded" on a healthy run, and
 * populate `_meta.shape_warnings`. Inertness is asserted below, never assumed.
 *
 * ⚠ EVERY discriminator here PINS ITS OWN PRECONDITION. A test that asserts
 * `coverage === 'corpus_absent'` is worthless if the fixture silently stops
 * producing an empty corpus, so each such test first asserts what
 * `extractGroundedNumbers` actually returned. Without that, a change to the
 * corpus builder would leave this spec green while measuring nothing.
 */

import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Mock setup — must precede all imports from SUT
// ============================================================================

const { mockConfig, mockGetClaimById, mockGetProtocolById } = vi.hoisted(() => {
  const mockGetClaimById = vi.fn().mockReturnValue(null);
  const mockGetProtocolById = vi.fn().mockReturnValue(null);
  const mockConfig = { config: { features: { dskEnabled: false } } };
  return { mockConfig, mockGetClaimById, mockGetProtocolById };
});

vi.mock("../../src/config/index.js", () => mockConfig);
vi.mock("../../src/orchestrator/dsk-loader.js", () => ({
  getAllByType: vi.fn().mockReturnValue([]),
  getClaimById: mockGetClaimById,
  getProtocolById: mockGetProtocolById,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
  performShapeCheck,
  extractGroundedNumbers,
  checkNumberGrounding,
  type ReviewInputForGrounding,
} from "../../src/cee/decision-review/shape-check.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Minimal valid M2 shape. `numbers` is spliced into narrative_summary so a test
 * can control exactly how many numeric tokens the scan will inspect.
 */
function makeValidReviewOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    narrative_summary: "Option A leads on cost.",
    story_headlines: { "opt-a": "Wins on cost efficiency" },
    robustness_explanation: {
      summary: "Recommendation is stable.",
      primary_risk: "Market uncertainty",
      stability_factors: ["Low cost"],
      fragility_factors: ["Competitor response"],
    },
    readiness_rationale: "Sufficient evidence exists.",
    evidence_enhancements: {},
    scenario_contexts: {},
    flip_thresholds: [],
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
    ...overrides,
  };
}

/** An input that yields a NON-empty corpus. */
function makeGroundedInput(): ReviewInputForGrounding {
  return {
    winner: { win_probability: 0.77, outcome_mean: 59 },
    runner_up: { win_probability: 0.7, outcome_mean: 45 },
  };
}

/**
 * An input that yields an EMPTY corpus.
 *
 * Note what this demonstrates: `ReviewInputForGrounding` marks every numeric
 * field optional, so a corpus-free input is entirely well-typed. Both live
 * entry points happen to require `winner.win_probability`, which is why the
 * condition is rare in production — but the type, and therefore this function,
 * permits it, and the runtime must not certify numbers against nothing.
 */
function makeCorpuslessInput(): ReviewInputForGrounding {
  return { winner: { label: "Option A" } };
}

/**
 * The other route to an empty corpus, and the only one reachable through the
 * live schemas: a NON-FINITE number. `z.number()` admits ±Infinity, and the
 * corpus builder's `isFinite` guard silently drops it — so a run can satisfy
 * "win_probability is required" and still ground against nothing.
 */
function makeNonFiniteInput(): ReviewInputForGrounding {
  return { winner: { win_probability: Number.POSITIVE_INFINITY, label: "Option A" } };
}

// ============================================================================
// The fix: an empty corpus is reported, not silently passed
// ============================================================================

describe("grounding coverage — corpus_absent (the INPUT carried nothing to check against)", () => {
  it("reports corpus_absent, and says how many numbers were waved through", () => {
    const input = makeCorpuslessInput();

    // PRECONDITION PIN: without this the assertion below could pass on a
    // fixture that stopped producing an empty corpus.
    expect(
      extractGroundedNumbers(input),
      "fixture no longer yields an empty corpus — this test would assert nothing",
    ).toEqual([]);

    const data = makeValidReviewOutput({
      narrative_summary: "Option A wins 63% of the time with a mean of 41.",
    });

    const result = performShapeCheck(data, input);

    expect(result.grounding.coverage).toBe("corpus_absent");
    expect(result.grounding.corpusSize).toBe(0);
    // The point of the diagnostic: two numbers were certified against nothing.
    expect(result.grounding.scannedNumbers).toBe(2);
  });

  it("reports corpus_absent when a non-finite value is dropped by the corpus builder", () => {
    const input = makeNonFiniteInput();

    expect(
      extractGroundedNumbers(input),
      "Infinity is no longer dropped — the non-finite route to an empty corpus has changed",
    ).toEqual([]);

    const result = performShapeCheck(makeValidReviewOutput(), input);
    expect(result.grounding.coverage).toBe("corpus_absent");
    expect(result.grounding.corpusSize).toBe(0);
  });

  // OPPOSITE-DIRECTION TWIN of the two above.
  it("reports checked — NOT corpus_absent — whenever the input carries any number", () => {
    const input = makeGroundedInput();

    expect(
      extractGroundedNumbers(input).length,
      "fixture no longer yields a corpus — the twin would pass for the wrong reason",
    ).toBeGreaterThan(0);

    const result = performShapeCheck(makeValidReviewOutput(), input);
    expect(result.grounding.coverage).toBe("checked");
    expect(result.grounding.corpusSize).toBe(4);
  });
});

// ============================================================================
// Inertness — the safety property of this change
// ============================================================================

describe("grounding coverage — the diagnostic is inert for every existing consumer", () => {
  /** An empty-corpus run whose prose cites numbers that are pure invention. */
  function corpuslessRunWithFabricatedNumbers() {
    const input = makeCorpuslessInput();
    const data = makeValidReviewOutput({
      narrative_summary: "Option A wins 63% of the time with a mean of 41.",
    });
    return performShapeCheck(data, input);
  }

  it("adds NO warning at all, so the degraded-status predicate stays false", () => {
    const result = corpuslessRunWithFabricatedNumbers();

    // `logCeeCall({ status: shapeCheck.warnings.length > 0 ? "degraded" : "ok" })`
    // and `_meta.shape_warnings` both key off this exact expression.
    expect(result.warnings.length > 0).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("is invisible to the retry filter and the FATAL promotion", () => {
    const result = corpuslessRunWithFabricatedNumbers();

    // Both consumers use precisely this predicate.
    const ungrounded = result.warnings.filter((w) => w.startsWith("UNGROUNDED_NUMBER"));
    expect(ungrounded).toEqual([]);

    // Belt and braces: no warning anywhere carries the prefix that would arm them.
    expect(result.warnings.some((w) => w.startsWith("UNGROUNDED_NUMBER"))).toBe(false);
  });

  it("leaves the verdict untouched — an empty corpus still passes", () => {
    const result = corpuslessRunWithFabricatedNumbers();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("still flags fabricated numbers when a corpus DOES exist (the rule is unchanged)", () => {
    const input = makeGroundedInput();
    const data = makeValidReviewOutput({
      narrative_summary: "Option A returns 8321 on average.",
    });

    const result = performShapeCheck(data, input);

    expect(result.grounding.coverage).toBe("checked");
    expect(result.warnings.some((w) => w.startsWith("UNGROUNDED_NUMBER"))).toBe(true);
  });

  it("keeps checkNumberGrounding's string-only contract for its existing callers", () => {
    // tools/orchestrator-eval and the existing unit spec both destructure this
    // as a plain string[]; the coverage report must not leak into it.
    const warnings = checkNumberGrounding(makeValidReviewOutput(), makeCorpuslessInput());
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toEqual([]);
  });
});

// ============================================================================
// The other two "cannot check" states, kept apart from corpus_absent
// ============================================================================

describe("grounding coverage — the remaining not-scanned states are named apart", () => {
  it("reports not_requested when the caller supplied no reviewInput", () => {
    const result = performShapeCheck(makeValidReviewOutput());
    expect(result.grounding.coverage).toBe("not_requested");
    expect(result.grounding.corpusSize).toBe(0);
    expect(result.grounding.scannedNumbers).toBe(0);
  });

  it("reports skipped_shape_invalid when grounding was asked for but the shape failed", () => {
    const broken = makeValidReviewOutput({ narrative_summary: 123 });
    const result = performShapeCheck(broken, makeGroundedInput());

    // PRECONDITION PIN: the shape must actually be invalid, or this test is
    // asserting the wrong branch.
    expect(result.valid, "fixture is no longer shape-invalid").toBe(false);
    expect(result.grounding.coverage).toBe("skipped_shape_invalid");
  });

  it("distinguishes the two on a non-object response", () => {
    expect(performShapeCheck(null).grounding.coverage).toBe("not_requested");
    expect(performShapeCheck(null, makeGroundedInput()).grounding.coverage).toBe(
      "skipped_shape_invalid",
    );
  });

  it("never reports corpus_absent for a run that was simply not scanned", () => {
    // corpus_absent is a claim about the INPUT. A run that never scanned must
    // not borrow it — that would recreate the conflation this spec exists to end.
    expect(performShapeCheck(makeValidReviewOutput()).grounding.coverage).not.toBe("corpus_absent");
    expect(
      performShapeCheck(makeValidReviewOutput({ narrative_summary: 123 }), makeGroundedInput())
        .grounding.coverage,
    ).not.toBe("corpus_absent");
  });
});

// ============================================================================
// scannedNumbers — "measured, found none" vs "did not measure"
// ============================================================================

describe("grounding coverage — scannedNumbers separates a clean scan from no scan", () => {
  it("reports checked with scannedNumbers 0 when the output cites no numbers", () => {
    const result = performShapeCheck(makeValidReviewOutput(), makeGroundedInput());

    expect(result.grounding.coverage).toBe("checked");
    expect(result.grounding.scannedNumbers).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("counts every numeric token the rule inspected, across fields", () => {
    const data = makeValidReviewOutput({
      narrative_summary: "Option A wins 77% of runs.",
      readiness_rationale: "A mean of 59 is sufficient.",
    });

    const result = performShapeCheck(data, makeGroundedInput());

    expect(result.grounding.coverage).toBe("checked");
    expect(result.grounding.scannedNumbers).toBe(2);
  });

  // The discrimination that makes the field worth having: identical empty
  // warnings, different coverage — which is exactly the pair that was
  // indistinguishable before this change.
  it("gives two runs with identical empty warnings DIFFERENT coverage", () => {
    const scanned = performShapeCheck(
      makeValidReviewOutput({ narrative_summary: "Option A wins 77% of runs." }),
      makeGroundedInput(),
    );
    const vacuous = performShapeCheck(
      makeValidReviewOutput({ narrative_summary: "Option A wins 63% of runs." }),
      makeCorpuslessInput(),
    );

    expect(scanned.warnings).toEqual([]);
    expect(vacuous.warnings).toEqual([]);
    expect(scanned.valid).toBe(vacuous.valid);

    // Identical on every field a consumer reads today...
    expect(scanned.grounding.coverage).toBe("checked");
    expect(vacuous.grounding.coverage).toBe("corpus_absent");
    // ...and both scanned exactly one number, so the counts cannot be what
    // separates them. Only the coverage verdict can.
    expect(scanned.grounding.scannedNumbers).toBe(1);
    expect(vacuous.grounding.scannedNumbers).toBe(1);
  });
});
