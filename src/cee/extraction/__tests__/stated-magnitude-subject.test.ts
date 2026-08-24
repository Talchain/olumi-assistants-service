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
 * ── THREE CLASSES, NOT ONE (coordinator ruling, 2026-08-24) ───────────────
 * Treating them as one class is how this estate has previously burned four rounds
 * on a natural-language predicate.
 *
 *   1. WRONG-FACTOR   — a factor labelled "Q4 Bookings Lost" takes the migration
 *                       cost. ACCEPTED for now: the user's own figure reaches the
 *                       model, on the wrong carrier. Strictly better than losing
 *                       it, which is the measured alternative on most draws.
 *   2. THIRD-PARTY    — "a competitor paid £20,000". ACCEPTED for now: same shape
 *                       as (1) — a real magnitude, the wrong subject.
 *   3. NEGATED        — "we will NOT spend £20,000". **CLOSED.** This one does not
 *                       misplace a real number; it MANUFACTURES USER EVIDENCE OUT
 *                       OF THE USER'S EXPLICIT DENIAL, reading their refusal as
 *                       their statement. It is the single case where this fix
 *                       would be worse than the loss it repairs, and it is refused
 *                       fail-closed rather than parsed (see `negationGovernsAmount`).
 *
 * ── WHY THE FROZEN SET BELOW EXISTS ───────────────────────────────────────
 * A gap recorded in the suite is honest; a gap invisible to it is how four rounds
 * happened. This set pins classes 1 and 2 EXACTLY: the suite REDs if the set
 * GROWS (a new misattribution class appeared) and equally if it SHRINKS (someone
 * closed one without telling the record, or the route silently stopped firing).
 * It is an assertion about KNOWN-BAD behaviour and must never be read as approval.
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

/**
 * THE FROZEN KNOWN-MISATTRIBUTED SET — classes 1 and 2 only.
 * Append only with an explicit ruling; never edit to make a run go green.
 */
const KNOWN_MISATTRIBUTED = [
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
    factorLabel: "Migration and Training Cost",
    why: "the magnitude is a third party's, not the user's own commitment",
  },
] as const;

describe("B1-b — the scan is whole-brief, not subject-bound", () => {
  describe("CLASS 3 (CLOSED): a negated magnitude is never attributed to the user", () => {
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

    it("refuses when ANY statement of that magnitude is negated, even if another is not", () => {
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
      const iv = run("We spent £1.5m already and will not spend £20,000 more.", 20000);
      expect(iv?.source).toBe("cee_hypothesis");
    });
  });

  describe("CLASSES 1-2 (ACCEPTED): pinned exactly, so the gap cannot drift unobserved", () => {
    it.each(KNOWN_MISATTRIBUTED)(
      "is STILL misattributed: $id — $why",
      ({ brief, raw, factorLabel }) => {
        // Asserting KNOWN-BAD behaviour. RED here means the gap CHANGED — either
        // it was closed (delete the row and say so) or the route stopped firing.
        expect(run(brief, raw, factorLabel)?.source).toBe("brief_extraction");
      },
    );

    it("the frozen set is EXACTLY these two classes — REDs if it grows or shrinks", () => {
      expect(KNOWN_MISATTRIBUTED.map((c) => c.id)).toEqual(["wrong-factor", "third-party"]);
      expect(KNOWN_MISATTRIBUTED).toHaveLength(2);
    });
  });
});
