/**
 * Clarify v2 rubric — table-driven completeness verdicts (E0-B, ROADMAP
 * 1.94 Option A replacement).
 *
 * RED-first: this file fails on base (module absent). The table pins the
 * capability's core promise against the retired clarifier's verified
 * failure mode: the old gate scored DRAFTER self-confidence and never
 * fired (0 questions in ≥7 days of staging logs); this rubric measures
 * the BRIEF, so thin briefs MUST be assessed incomplete and complete
 * briefs MUST pass silently.
 */
import { describe, it, expect } from "vitest";

import {
  assessBriefCompleteness,
  CLARIFY_V2_DIMENSIONS,
  CLARIFY_V2_DIMENSION_PRIORITY,
  CLARIFY_V2_DIMENSION_DETECTORS,
  isClarifyDimension,
} from "../../src/orchestrator-v5/clarify-v2/rubric.js";

describe("clarify_v2 rubric — completeness table", () => {
  // Each row: [name, brief, expected missing dimensions (priority order)].
  const TABLE: ReadonlyArray<[string, string, readonly string[]]> = [
    [
      "complete brief (goal + options + quantities + timeframe)",
      "Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?",
      [],
    ],
    [
      "complete brief with explicit goal clause",
      "Whether to launch in Germany or France next quarter — the goal is to increase revenue by 20%.",
      [],
    ],
    [
      "thin: bare decision question (nothing but the ask)",
      "Should we expand into the German market?",
      ["goal", "options", "timeframe", "quantities"],
    ],
    [
      "thin: options present, everything else missing",
      "Should we build the feature in-house or outsource it to an agency?",
      ["goal", "timeframe", "quantities"],
    ],
    [
      "thin: goal present, no alternatives, no scale, no horizon",
      "Should we adopt the new CRM in order to improve retention?",
      ["options", "timeframe", "quantities"],
    ],
    [
      "quantities only missing",
      "Should we hire a contractor or a permanent engineer this quarter? The goal is to reduce delivery risk.",
      ["quantities"],
    ],
    [
      "timeframe only missing",
      "Should we spend £50k on paid ads or on a sales hire? We want to increase qualified pipeline.",
      ["timeframe"],
    ],
    // ── Round-2 calibration corpus (PR #490 review P2) — permanent, both
    // directions. Direction A: natural complete briefs the launch batteries
    // missed ('choose between', 'success is defined as', 'weighing X
    // against Y') MUST be silent. Direction B: low-precision satisfiers
    // (adjectival 'target', bare year digits, determiner 'one', 'or not')
    // MUST NOT silence genuinely thin briefs.
    [
      "calibration A: 'choose between' + 'success is defined as' is complete",
      "We must choose between acquiring CompetitorX and building in-house; success is defined as 30% market share by 2027.",
      [],
    ],
    [
      "calibration A: 'weighing X against Y' + trying-to goal is complete",
      "We are weighing a merger against an IPO; we are trying to maximise shareholder value, roughly fifty million at stake, deadline end of March — which should we pursue?",
      [],
    ],
    [
      "calibration B: adjectival 'target' + bare year + 'one' do not fake goal/quantities",
      "Do we go after the target account list this 2026 or focus on the one big account?",
      ["goal", "quantities"],
    ],
    [
      "calibration B: 'one more review' is not a quantity",
      "To win, do we ship today or wait for one more review?",
      ["quantities"],
    ],
    [
      "calibration B: 'or not' is not a second alternative",
      "Should we renew the vendor contract or not this quarter?",
      ["goal", "options", "quantities"],
    ],
    [
      "calibration positive control: goal-construction 'the target is' still satisfies goal",
      "Should we double the sales team or invest in automation? The target is £2m ARR by Q4.",
      [],
    ],
    // ── a1/first-message-drafts (19 Jul journey probe) — a bare stated
    // duration / runway ("14 months") is a timeframe signal. Direction:
    // credit already-given horizon content so a brief that carries budget +
    // runway is not asked for a timeframe it already states. The probe brief
    // still misses GOAL (genuinely absent — asking it is legitimate); only
    // timeframe flips from missing → satisfied.
    [
      "runway credit: the journey probe (budget + 14-month runway) misses ONLY goal, not timeframe",
      "Should we hire a senior engineer now or wait until after our next funding round? Budget around £120k, current runway 14 months.",
      ["goal"],
    ],
    [
      "runway credit: a bare runway is the ONLY timeframe token and completes the brief",
      "Should we hire a senior engineer or wait, in order to extend our runway? The budget is around £120k and we have 14 months of cash left.",
      [],
    ],
    [
      "runway credit precision: the WORD compound 'four-day week' is NOT a timeframe (digit-anchored), so this thin brief still misses it",
      "Should we introduce a four-day week at the company?",
      ["goal", "options", "timeframe"],
    ],
  ];

  it.each(TABLE)("%s", (_name, brief, expectedMissing) => {
    const verdict = assessBriefCompleteness(brief);
    expect(verdict.missing).toEqual(expectedMissing);
    expect(verdict.complete).toBe(expectedMissing.length === 0);
  });

  it("NEVER-FIRES baseline is dead: at least one canonical thin brief is assessed incomplete", () => {
    // The retired clarifier's live behaviour was 0 questions on 100% of
    // firings. A rubric that returns complete for this brief would
    // reproduce that baseline and must fail here.
    const verdict = assessBriefCompleteness("Should we expand into the German market?");
    expect(verdict.complete).toBe(false);
    expect(verdict.missing.length).toBeGreaterThanOrEqual(1);
  });

  it("verdict is deterministic (identical input, identical output)", () => {
    const brief = "Should we build or buy the analytics stack?";
    const a = assessBriefCompleteness(brief);
    const b = assessBriefCompleteness(brief);
    expect(a).toEqual(b);
  });

  it("missing dimensions come back in priority order (goal > options > timeframe > quantities)", () => {
    const verdict = assessBriefCompleteness("Should we expand into the German market?");
    expect(verdict.missing).toEqual(CLARIFY_V2_DIMENSION_PRIORITY);
  });
});

describe("clarify_v2 rubric — surface integrity", () => {
  it("priority order covers exactly the dimension set (derived, no drift)", () => {
    expect([...CLARIFY_V2_DIMENSION_PRIORITY].sort()).toEqual(
      [...CLARIFY_V2_DIMENSIONS].sort(),
    );
  });

  it("every dimension has a non-empty detector battery", () => {
    for (const dim of CLARIFY_V2_DIMENSIONS) {
      expect(CLARIFY_V2_DIMENSION_DETECTORS[dim].length).toBeGreaterThan(0);
    }
  });

  it("isClarifyDimension accepts the set and rejects strangers", () => {
    for (const dim of CLARIFY_V2_DIMENSIONS) expect(isClarifyDimension(dim)).toBe(true);
    expect(isClarifyDimension("confidence")).toBe(false);
    expect(isClarifyDimension("")).toBe(false);
    expect(isClarifyDimension(42)).toBe(false);
  });
});
