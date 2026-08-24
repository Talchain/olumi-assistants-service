/**
 * B1-b — WHAT THE WHOLE-BRIEF SCAN CANNOT TELL YOU ABOUT THE SUBJECT.
 *
 * ── THE ARCHITECTURAL LIMIT, STATED PLAINLY ───────────────────────────────
 * The stated-magnitude route asks "did the user write this number, and in which
 * denomination?" — over the WHOLE BRIEF. It is NOT bound to the factor the
 * intervention targets, and `intervention-extractor.ts`'s own header has said so
 * since #944: "FACTOR-LABEL BINDING DOES NOT EXIST". Unit-kind compatibility is
 * the only guard on the subject, and it is a guard on the KIND of quantity, never
 * on WHOSE quantity it is or WHICH THING it describes.
 *
 * ── WHY THIS FILE WAS REWRITTEN ───────────────────────────────────────────
 * Its previous frozen set named TWO misattribution classes and pinned them with
 *
 *     expect(KNOWN_MISATTRIBUTED.map((c) => c.id)).toEqual(["wrong-factor", "third-party"]);
 *     expect(KNOWN_MISATTRIBUTED).toHaveLength(2);
 *
 * — an assertion about the CONSTANT'S OWN CONTENTS. It can only RED when someone
 * edits the constant, so it was structurally incapable of noticing a THIRD class
 * in the wild: a guard agreeing with itself (CLAUDE.md trap 13b). Measured with a
 * candidate corpus written outside that set, SEVEN further classes misattribute,
 * and none of them moved the old pin by so much as a warning.
 *
 * The replacement pin is DERIVED BY RUNNING THE CORPUS. It REDs if the set GROWS
 * (a new class starts misattributing) and equally if it SHRINKS (one was closed
 * without telling the record, or the route silently stopped firing). It is an
 * assertion about KNOWN-BAD behaviour and must never be read as approval.
 *
 * FOLLOW-UP, named so it cannot be lost: binding a stated magnitude to its
 * SUBJECT — the factor and the actor it describes — is separate work and is
 * deliberately not attempted in this PR.
 */

import { describe, it, expect } from "vitest";
import type { NodeV3T } from "../../../schemas/cee-v3.js";
import { extractInterventionsForOption } from "../intervention-extractor.js";

const GOAL = "goal01";
const OPTION_NODE = "682a7e2d";
const F = "fd255d32";

function run(brief: string, raw: number, label = "Migration and Training Cost") {
  const nodes: NodeV3T[] = [
    { id: GOAL, kind: "goal", label: "Goal", provenance: "from_brief" } as unknown as NodeV3T,
    {
      id: F, kind: "factor", label, provenance: "ai_inferred",
      observed_state: { value: 0.5, source: "cee_inference" },
    } as unknown as NodeV3T,
  ];
  const o = extractInterventionsForOption(
    "switch CRM", undefined, nodes, [], GOAL, new Set<string>(), [],
    { [F]: 0.4 }, OPTION_NODE, brief, { [F]: raw }, undefined,
  );
  return o.interventions[F];
}

interface SubjectCase {
  readonly id: string;
  readonly brief: string;
  readonly raw: number;
  readonly factorLabel?: string;
  readonly why: string;
}

/**
 * THE SUBJECT CANDIDATE CORPUS — written from OUTSIDE the frozen set, which is
 * the only instrument that can notice the set is short (trap 12d, second face).
 * Every member is a sentence in which the magnitude is NOT the user's own
 * commitment for this factor. What each one currently DOES is derived below,
 * never asserted here.
 */
const SUBJECT_CANDIDATES: readonly SubjectCase[] = [
  {
    id: "wrong-factor",
    brief: "A full switch costs £20,000 in migration and training.",
    raw: 20000,
    factorLabel: "Q4 Bookings Lost",
    why: "the magnitude describes migration, not lost bookings; no factor-label binding exists",
  },
  {
    id: "third-party",
    brief: "A competitor paid £20,000 for the same migration.",
    raw: 20000,
    why: "the magnitude is a third party's, not the user's own commitment",
  },
  {
    id: "hypothetical-if",
    brief: "If we had £20,000 we would migrate this year.",
    raw: 20000,
    why: "a conditional antecedent is not an assertion that the money exists",
  },
  {
    id: "counterfactual-past",
    brief: "We would have spent £20,000 last year had we moved then.",
    raw: 20000,
    why: "a counterfactual is explicitly about what did NOT happen",
  },
  {
    id: "question",
    brief: "Should we spend £20,000 on migration?",
    raw: 20000,
    why: "an interrogative asks the amount, it does not state it",
  },
  {
    id: "vendor-claim",
    brief: "The vendor's brochure claims £20,000 for a full migration.",
    raw: 20000,
    why: "an attributed claim is present in the text without being the user's assertion",
  },
  {
    id: "industry-benchmark",
    brief: "The industry benchmark for a migration of this size is £20,000.",
    raw: 20000,
    why: "a benchmark describes the market, not this team's commitment",
  },
  {
    id: "uncertain-estimate",
    brief: "Migration might cost £20,000, or it might cost far more.",
    raw: 20000,
    why: "a hedged estimate is not a stated figure the user owns",
  },
  {
    id: "different-subject",
    brief: "We hold £20,000 in the contingency reserve.",
    raw: 20000,
    why: "a real user figure about an entirely different quantity",
  },
];

/**
 * THE FROZEN KNOWN-MISATTRIBUTED SET.
 * Append or remove ONLY with an explicit ruling; never edit to make a run green.
 */
const KNOWN_MISATTRIBUTED: readonly string[] = [
  "wrong-factor",
  "third-party",
  "hypothetical-if",
  "counterfactual-past",
  "question",
  "vendor-claim",
  "industry-benchmark",
  "uncertain-estimate",
  "different-subject",
];

describe("B1-b — the scan is whole-brief, not subject-bound", () => {
  describe("DENIAL: a magnitude the user denied is not attributed to them", () => {
    // ⚠ THIS CLASS IS NOT CLOSED, AND THIS FILE NO LONGER SAYS IT IS.
    // The full 15-phrasing corpus, its opposite-direction twins and the frozen
    // KNOWN-DROPPED set of residual misses live in
    // `stated-magnitude-denial.test.ts`. What is pinned HERE is only that the
    // route refuses the phrasings this file already named.
    it("refuses an explicit refusal — 'we will NOT spend £20,000'", () => {
      const iv = run("We will not spend £20,000 on migration.", 20000);
      expect(iv?.source).toBe("cee_hypothesis");
      expect(iv?.reasoning).not.toContain("the brief states");
    });

    it("refuses a contracted negation — \"we won't spend £20,000\"", () => {
      expect(run("We won't spend £20,000 on migration.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("refuses 'without £20,000'", () => {
      expect(run("We can do the switch without £20,000 of spend.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("refuses when ANY statement of that magnitude is denied, even if another is not", () => {
      // Fail-closed across occurrences: one denial withdraws the claim.
      const iv = run("The vendor quoted £20,000. We will not spend £20,000.", 20000);
      expect(iv?.source).toBe("cee_hypothesis");
    });

    it("DISCRIMINATOR: a negation in a DIFFERENT clause does not suppress a real statement", () => {
      // This is the case a sentence-scoped window would get wrong, and it is the
      // frozen brief's own £45,000 sentence. Refusing here would destroy the one
      // figure the product already gets right.
      const brief =
        "Staying on Salesforce costs us nothing extra up front, and our annual Salesforce licensing is £45,000.";
      const iv = run(brief, 45000, "Annual CRM Licensing Cost");
      expect(iv?.source).toBe("brief_extraction");
      expect(iv?.unit).toBe("£");
    });

    it("DISCRIMINATOR: the decimal point of £1.5m does not end the clause and hide a negation", () => {
      // ⚠ THIS FIXTURE IS CHOSEN, NOT ILLUSTRATIVE. The obvious phrasing —
      // "We spent £1.5m already and will not spend £20,000 more" — does NOT
      // exercise the decimal guard at all: the " and " is a later boundary, so
      // the window is "will not spend" either way and the test passes for a
      // reason unrelated to its name. Mutation caught that (dropping the guard
      // left it green), which is the same defect as R6 one file over. Here the
      // decimal IS the last boundary before the amount, so the guard is the only
      // thing keeping "not" inside the window.
      const iv = run("We will not approve a £1.5m budget for a £20,000 migration.", 20000);
      expect(iv?.source).toBe("cee_hypothesis");
    });
  });

  describe("SUBJECT CLASSES (ACCEPTED): pinned exactly, so the gap cannot drift unobserved", () => {
    it.each(SUBJECT_CANDIDATES.filter((c) => KNOWN_MISATTRIBUTED.includes(c.id)))(
      "is STILL misattributed: $id — $why",
      ({ brief, raw, factorLabel }) => {
        // Asserting KNOWN-BAD behaviour. RED here means the gap CHANGED — either
        // it was closed (delete the row and say so) or the route stopped firing.
        expect(run(brief, raw, factorLabel)?.source).toBe("brief_extraction");
      },
    );

    it("the frozen set is EXACTLY what the corpus produces — REDs if it grows OR shrinks", () => {
      // ⚠ DERIVED BY RUNNING THE CORPUS, not read back off the constant. The
      // previous version of this test compared the constant to a copy of itself
      // and therefore could not observe a new class; seven of the nine ids above
      // were found by a corpus this pin could not have flagged.
      const misattributed = SUBJECT_CANDIDATES.filter(
        (c) => run(c.brief, c.raw, c.factorLabel)?.source === "brief_extraction",
      ).map((c) => c.id);
      expect([...misattributed].sort()).toEqual([...KNOWN_MISATTRIBUTED].sort());
    });

    it("the corpus is strictly wider than the frozen set, so the pin can observe growth", () => {
      // A positive control on the instrument: if the corpus ever shrank to the
      // frozen set, the pin above would pass vacuously (trap 13). It must always
      // carry at least one candidate that is NOT expected to misattribute.
      const outsideTheSet = SUBJECT_CANDIDATES.filter(
        (c) => !KNOWN_MISATTRIBUTED.includes(c.id),
      ).length;
      const denialProbe = run("We will not spend £20,000 on migration.", 20000)?.source;
      expect(outsideTheSet + (denialProbe === "cee_hypothesis" ? 1 : 0)).toBeGreaterThan(0);
    });
  });
});
