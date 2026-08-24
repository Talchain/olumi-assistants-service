/**
 * THE REVIEWER'S 72-CASE CORPUS, RUN AGAINST THE DRAFTER'S OWN EXTRACTOR.
 *
 * ⚠ THE FIXTURE IS AN ORACLE, NOT A FIXTURE. `expect` is an independent
 * reviewer's adjudication of what a user actually stated, written outside this
 * lane's head (CLAUDE.md trap 22c: for a predicate over natural language the
 * AUTHOR's corpus is a development aid and the REVIEWER's corpus is the
 * load-bearing evidence). Cases may be ADDED; none may be edited, narrowed or
 * re-authored to suit a fix. If a fix cannot pass a case, the honest output is
 * a recorded gap, not a rewritten expectation.
 *
 * ── WHY THE COUNTS ARE PINNED IN BOTH DIRECTIONS ──────────────────────────
 * `toBe`, not `toBeLessThanOrEqual`. A ceiling-only assertion goes green when a
 * change silently drops rows, which is the exact failure this extractor keeps
 * shipping. Pinning the EXACT counts means the suite REDs when the numbers get
 * worse AND when they get better — and a better number is a finding to record
 * here deliberately, per the #888 KNOWN-DROPPED discipline.
 *
 * ── THE HARNESS THIS RE-DERIVES ───────────────────────────────────────────
 * `evidence/implementation/1086-drafter-vs-predicate.probe.test.ts` ran TWO
 * detectors side by side. Its second column
 * (`deriveIntakeConstraintReconciliation`) lives only on PR #1086's branch and
 * does NOT exist at this tip — verified with a contrast control in the same
 * sweep (`extractCompoundGoals` returns many files, the #1086 symbol returns
 * zero), so this is a real absence and not a blind probe. The DRAFTER column
 * is re-derived here from the same oracle with the same accounting; the #1086
 * column is not measurable from this branch and is deliberately absent rather
 * than quoted.
 */

import { describe, it, expect } from "vitest";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
} from "../index.js";
import corpus from "./fixtures/intake-constraint-reviewer-corpus.json" with { type: "json" };

interface ReviewerCase {
  id: string;
  origin: string;
  class: string;
  brief: string;
  expect: "fire" | "silent";
  source?: string;
}

const CASES = (corpus as { cases: ReviewerCase[] }).cases;

/** Does the drafter mint at least one `goal_constraints[]` row for this brief? */
function drafterFires(brief: string): { fired: boolean; rows: string[] } {
  const result = extractCompoundGoals(brief, { includeProxies: false });
  const rows = toGoalConstraints(normaliseConstraintUnits(result.constraints));
  return {
    fired: rows.length > 0,
    rows: rows.map((r) => `${r.operator}${r.value}${r.unit ?? ""}@${r.node_id}`),
  };
}

/**
 * THE FALSE POSITIVES THIS LANE INHERITED AND DID NOT CLOSE.
 *
 * ⚠ AN EXPLICIT, EXACT SET — not a tolerance. Every member is a case where the
 * drafter mints a row the reviewer adjudicated `silent`, on a VERB form that
 * predates this lane (`capped at`, `cannot exceed`, `limited to`, `stay
 * under`). Closing them means re-opening the #888 direction predicate, which
 * this lane is explicitly forbidden to touch — so they are pinned here, honestly,
 * rather than left invisible to the suite.
 *
 * Asserting the exact SET (not a count) is what makes this honest in both
 * directions: a NEW false positive REDs even if some old one is fixed in the
 * same change, which a count could never see.
 */
const KNOWN_FALSE_POSITIVES = new Set([
  "B3", // "capped at 4 people right now, which is why delivery is slow"  — descriptive
  "C4", // "the regulator says platforms cannot exceed 30 days"           — other subject
  "D3", // "We are not limited to £50,000 — finance has been flexible"    — negated
  "F1", // 'Legal quoted us "you cannot exceed £250,000"'                 — quoted
  "G1", // "Ideally we'd stay under £50,000 but it is not fixed"          — soft
]);

/**
 * THE FALSE NEGATIVES THIS LANE DID NOT CLOSE, AND WHY EACH IS OUT OF SCOPE.
 *
 * Every member states a real limit the drafter still misses. None is a NOUN
 * form — that is the whole point of the set. They are recorded so the suite
 * REDs if the set grows, and REDs if it shrinks without this comment moving.
 */
const KNOWN_FALSE_NEGATIVES = new Set([
  "I2", // "We can spend up to £50,000 and no more."          — "up to" verb form
  "I5", // "Stay within £50,000."                             — bare "within", no limit noun
  "I6", // "Spend less than £50,000."                         — "less than" comparative
  "I11", // "cannot cost more than £50,000"                   — verb form
  "I12", // "must complete no later than March 2027"          — temporal, deadline extractor
  "I13", // "We cannot lose any of our 40 existing staff."    — floor stated as a prohibition
  "R4", // "Plan for at least 25 people on site"              — bare lower bound
]);

describe("reviewer corpus — the drafter's goal_constraints[] minting", () => {
  it("collects the reviewer's 72 cases (a shrunk corpus voids every number below)", () => {
    expect(CASES).toHaveLength(72);
    expect(CASES.filter((c) => c.expect === "fire")).toHaveLength(33);
    expect(CASES.filter((c) => c.expect === "silent")).toHaveLength(39);
  });

  it("mints a row for every case the reviewer adjudicated as a stated limit, except the recorded gaps", () => {
    const falseNegatives = CASES.filter(
      (c) => c.expect === "fire" && !drafterFires(c.brief).fired,
    ).map((c) => c.id);

    expect(new Set(falseNegatives)).toEqual(KNOWN_FALSE_NEGATIVES);
  });

  it("stays silent on every case the reviewer adjudicated as NOT a stated limit, except the recorded gaps", () => {
    const falsePositives = CASES.filter(
      (c) => c.expect === "silent" && drafterFires(c.brief).fired,
    ).map((c) => c.id);

    expect(new Set(falsePositives)).toEqual(KNOWN_FALSE_POSITIVES);
  });

  it("scores exactly the measured totals — pinned in BOTH directions", () => {
    let fp = 0;
    let fn = 0;
    for (const c of CASES) {
      const { fired } = drafterFires(c.brief);
      if (fired && c.expect === "silent") fp++;
      if (!fired && c.expect === "fire") fn++;
    }
    expect({ fp, fn, correct: CASES.length - fp - fn }).toEqual({
      fp: 5,
      fn: 7,
      correct: 60,
    });
  });
});
