/**
 * Clarify v2 question composer — doctrine shape invariants (E0-B, ROADMAP
 * 1.94 Option A replacement).
 *
 * RED-first on base (module absent). Pins the ratified clarifier doctrine
 * as code-level invariants:
 *   - every question ships 2–5 tap-able candidate answers;
 *   - the bare "give me more details" class is BANNED (the retired
 *     clarifier's fallback templates are the canonical offenders);
 *   - every question carries a one-clause model impact;
 *   - TEMPLATE INVARIANT: every candidate answer, appended to a brief,
 *     satisfies its own rubric dimension — an answered question can never
 *     be re-asked, by construction.
 */
import { describe, it, expect } from "vitest";

import {
  composeClarifyQuestions,
  isBannedBareDetailRequest,
  validateQuestionShape,
  CLARIFY_V2_MIN_CANDIDATES,
  CLARIFY_V2_MAX_CANDIDATES,
} from "../../src/orchestrator-v5/clarify-v2/questions.js";
import {
  CLARIFY_V2_DIMENSIONS,
  CLARIFY_V2_DIMENSION_DETECTORS,
  assessBriefCompleteness,
} from "../../src/orchestrator-v5/clarify-v2/rubric.js";

describe("clarify_v2 questions — shape invariants (every dimension)", () => {
  const allQuestions = composeClarifyQuestions(CLARIFY_V2_DIMENSIONS, CLARIFY_V2_DIMENSIONS.length);

  it("composes one question per requested dimension, in order", () => {
    expect(allQuestions.map((q) => q.dimension)).toEqual([...CLARIFY_V2_DIMENSIONS]);
  });

  it.each(allQuestions.map((q) => [q.dimension, q] as const))(
    "'%s' question passes the doctrine shape validator",
    (_dim, q) => {
      expect(validateQuestionShape(q)).toEqual([]);
      expect(q.candidates.length).toBeGreaterThanOrEqual(CLARIFY_V2_MIN_CANDIDATES);
      expect(q.candidates.length).toBeLessThanOrEqual(CLARIFY_V2_MAX_CANDIDATES);
      expect(q.impact.trim().length).toBeGreaterThan(0);
      expect(isBannedBareDetailRequest(q.text)).toBe(false);
    },
  );

  it("TEMPLATE INVARIANT: every candidate answer satisfies its own dimension's detectors", () => {
    for (const q of allQuestions) {
      for (const candidate of q.candidates) {
        const satisfied = CLARIFY_V2_DIMENSION_DETECTORS[q.dimension].some((re) =>
          re.test(candidate.message),
        );
        expect(
          satisfied,
          `candidate '${candidate.id}' ("${candidate.message}") does not satisfy ` +
            `dimension '${q.dimension}' — tapping it would leave its own question re-askable`,
        ).toBe(true);
      }
    }
  });

  it("NO-REPEAT mechanism: appending any candidate answer to a thin brief removes that dimension from missing", () => {
    const thinBrief = "Should we expand into the German market?";
    for (const q of allQuestions) {
      for (const candidate of q.candidates) {
        const augmented = `${thinBrief} ${candidate.message}`;
        const verdict = assessBriefCompleteness(augmented);
        expect(
          verdict.missing.includes(q.dimension),
          `after answering '${candidate.id}', dimension '${q.dimension}' must not be re-askable`,
        ).toBe(false);
      }
    }
  });

  it("chip ids are unique across the full question surface", () => {
    const ids = allQuestions.flatMap((q) => q.candidates.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("budget caps the number of questions", () => {
    expect(composeClarifyQuestions(CLARIFY_V2_DIMENSIONS, 3)).toHaveLength(3);
    expect(composeClarifyQuestions(CLARIFY_V2_DIMENSIONS, 0)).toHaveLength(0);
  });
});

describe("clarify_v2 banned-class postcheck", () => {
  it("rejects the retired clarifier's canonical fallback template", () => {
    // question-generator.ts:99-135 (deleted in #486) emitted exactly this
    // dead-end class — "true but failed turn".
    expect(
      isBannedBareDetailRequest("Could you provide more details about: the decision context?"),
    ).toBe(true);
  });

  it.each([
    "Can you give more details?",
    "Could you please share additional context on this?",
    "Please tell me more about your situation.",
    "Would you elaborate?",
    "Can you provide further information about the timeline?",
  ])("rejects banned bare-detail request: %s", (text) => {
    expect(isBannedBareDetailRequest(text)).toBe(true);
  });

  it.each([
    "What outcome would make this decision a success?",
    "What alternatives are you weighing this against?",
    "Roughly what scale is at stake — budget, headcount, or revenue?",
    "What timeframe does this decision need to play out over?",
  ])("accepts a concrete path-opening question: %s", (text) => {
    expect(isBannedBareDetailRequest(text)).toBe(false);
  });

  it("shape validator flags a banned question and a candidate-less question", () => {
    const bad = {
      dimension: "goal" as const,
      text: "Could you provide more details about: your goal?",
      impact: "",
      candidates: [],
    };
    const violations = validateQuestionShape(bad);
    expect(violations).toContain("banned_bare_detail_request");
    expect(violations).toContain("too_few_candidates");
    expect(violations).toContain("missing_impact_clause");
  });
});
