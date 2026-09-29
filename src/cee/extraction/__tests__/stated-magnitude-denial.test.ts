/**
 * B1-b — A MAGNITUDE THE USER DENIED IS NEVER ATTRIBUTED TO THE USER.
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE ───────
 * The spec is the sentence above. It is NOT "a sentence-initial `not` is
 * detected", which is the failure mode that happened to be in hand — an
 * invariant written with the same asymmetry as the code is a guard agreeing
 * with itself (CLAUDE.md trap 13d). So this file scans BOTH DIRECTIONS and
 * both ORDERS, and every case carries its opposite-direction twin.
 *
 * ── WHAT WAS MEASURED AT PRISTINE (`419a9684`, the PR's own head) ─────────
 * Driven at the EMITTED WIRE SHAPE (`toOptionV3`), not at the private helper:
 *   · 11 of the 15 ordinary-English denials below were attributed to the user,
 *     `source: brief_extraction`, `value_confidence: high`;
 *   · the discriminating pair below differed ONLY in the order of two figures
 *     and produced OPPOSITE provenance;
 *   · `T08` — a plain, unnegated assertion — was REFUSED, because the
 *     contraction alternative `\b\w+n['’]?t\b` matched the word *Procurement*.
 *     Every English word ending in "nt" (amount, payment, current, percent,
 *     investment, commitment, segment, client, point …) read as a negation.
 *
 * ── WHY THE SET BELOW IS FROZEN AND DERIVED, NOT ASSERTED ─────────────────
 * The residual misses are recorded in {@link KNOWN_DROPPED}, and the pin that
 * guards it is DERIVED BY RUNNING THE CORPUS — so it REDs when the set GROWS
 * (a phrasing starts fabricating) and equally when it SHRINKS (someone closed
 * one without telling the record). A guard that asserts its own contents can
 * do neither. A gap recorded in the suite is honest; a gap invisible to it is
 * how a predicate oscillates for four rounds (trap 22f).
 *
 * ⚠ CORPUS PROVENANCE, stated so nobody mistakes it for the original artefact:
 * fifteen of these phrasings are RECONSTRUCTED from the adversarial review's own
 * enumerated verbs (cannot · unable to · ruled out · rejected · declined by
 * finance · no longer · stopped · prevented · off the table · never approved)
 * plus the coordinator case it named decisive. The review's verbatim file is
 * not on the GitHub record for PR #1081 (zero reviews, zero inline comments).
 */

import { describe, it, expect } from "vitest";
import type { NodeV3T } from "../../../schemas/cee-v3.js";
import { extractInterventionsForOption, toOptionV3 } from "../intervention-extractor.js";
import { NEGATION_SCREEN_RE } from "../../compound-goal/direction-gate.js";
import {
  NEGATION_LEAD,
  NEGATION_OR_PREVENTION_LEAD,
} from "../../compound-goal/extractor.js";
import { DENIAL_SCREEN_RE } from "../intervention-extractor.js";

const GOAL = "goal01";
const OPTION_NODE = "682a7e2d";
const F = "fd255d32";

/**
 * Drive the PRODUCTION entry point and read the EMITTED WIRE SHAPE.
 * Bound to the factor ID, never to "the intervention whose value is 20000"
 * (trap 19) — two fixtures here carry the same magnitude.
 */
function wireIntervention(brief: string, raw: number, label = "Migration and Training Cost") {
  const nodes: NodeV3T[] = [
    { id: GOAL, kind: "goal", label: "Goal", provenance: "from_brief" } as unknown as NodeV3T,
    {
      id: F,
      kind: "factor",
      label,
      provenance: "ai_inferred",
      observed_state: { value: 0.5, source: "cee_inference" },
    } as unknown as NodeV3T,
  ];
  const wire = toOptionV3(
    extractInterventionsForOption(
      "switch CRM", undefined, nodes, [], GOAL, new Set<string>(), [],
      { [F]: 0.4 }, OPTION_NODE, brief, { [F]: raw }, undefined,
    ),
  );
  return wire.interventions?.[F];
}

/** Did the product claim the USER stated this magnitude? */
function attributed(brief: string, raw: number, label?: string): boolean {
  return wireIntervention(brief, raw, label)?.source === "brief_extraction";
}

interface Case { readonly id: string; readonly brief: string; readonly raw: number; }

/** Sixteen ordinary-English denials. NONE may be attributed. */
const DENIALS: readonly Case[] = [
  { id: "D01-cannot",         brief: "We cannot spend £20,000 on migration and training.", raw: 20000 },
  { id: "D02-unable-to",      brief: "We are unable to fund £20,000 for migration and training.", raw: 20000 },
  { id: "D03-ruled-out",      brief: "The board ruled out £20,000 of migration spend.", raw: 20000 },
  { id: "D04-rejected",       brief: "Finance rejected £20,000 for the migration.", raw: 20000 },
  { id: "D05-declined-by",    brief: "The £20,000 migration budget was declined by finance.", raw: 20000 },
  { id: "D06-no-longer",      brief: "We no longer have £20,000 for migration.", raw: 20000 },
  { id: "D07-stopped",        brief: "We stopped the £20,000 migration programme last quarter.", raw: 20000 },
  { id: "D08-prevented",      brief: "Procurement prevented the £20,000 migration purchase.", raw: 20000 },
  { id: "D09-off-the-table",  brief: "A £20,000 migration is off the table for this year.", raw: 20000 },
  { id: "D10-never-approved", brief: "The £20,000 migration was never approved.", raw: 20000 },
  { id: "D11-coordinator",    brief: "We will not approve £45,000 or £20,000.", raw: 20000 },
  { id: "D12-denied",         brief: "The £20,000 migration request was denied by the CFO.", raw: 20000 },
  { id: "D13-scrapped",       brief: "We scrapped the £20,000 migration plan.", raw: 20000 },
  { id: "D14-plain-not",      brief: "We will not spend £20,000 on migration.", raw: 20000 },
  { id: "D15-contracted",     brief: "We won't spend £20,000 on migration.", raw: 20000 },
  // ⚠ D16 WAS FOUND BY A SURVIVING MUTANT, NOT BY THIS CORPUS. M10 (the forward
  // coordinator cutting unconditionally) survived the first kit, which is a
  // CLAIM either way — so it was demonstrated rather than asserted, and the
  // discriminating input it produced showed the corpus was short here.
  { id: "D16-vp-coordination", brief: "We reviewed £45,000 or £20,000 and rejected both.", raw: 45000 },
];

/**
 * OPPOSITE-DIRECTION TWINS — the same sentence with the denial removed. Every
 * one IS the user's own assertion and MUST be attributed. Without these, a fix
 * that simply refuses everything would score full marks (trap 22b).
 */
const TWINS: readonly Case[] = [
  { id: "T01-cannot",         brief: "We can spend £20,000 on migration and training.", raw: 20000 },
  { id: "T02-unable-to",      brief: "We are able to fund £20,000 for migration and training.", raw: 20000 },
  { id: "T03-ruled-out",      brief: "The board approved £20,000 of migration spend.", raw: 20000 },
  { id: "T04-rejected",       brief: "Finance approved £20,000 for the migration.", raw: 20000 },
  { id: "T05-declined-by",    brief: "The £20,000 migration budget was approved by finance.", raw: 20000 },
  { id: "T06-no-longer",      brief: "We still have £20,000 for migration.", raw: 20000 },
  { id: "T07-stopped",        brief: "We started the £20,000 migration programme last quarter.", raw: 20000 },
  { id: "T08-prevented",      brief: "Procurement authorised the £20,000 migration purchase.", raw: 20000 },
  { id: "T09-off-the-table",  brief: "A £20,000 migration is on the table for this year.", raw: 20000 },
  { id: "T10-never-approved", brief: "The £20,000 migration was approved last month.", raw: 20000 },
  { id: "T11-coordinator",    brief: "We will approve £45,000 or £20,000.", raw: 20000 },
  { id: "T12-denied",         brief: "The £20,000 migration request was signed off by the CFO.", raw: 20000 },
  { id: "T13-scrapped",       brief: "We funded the £20,000 migration plan.", raw: 20000 },
  { id: "T14-plain-not",      brief: "We will spend £20,000 on migration.", raw: 20000 },
  { id: "T15-contracted",     brief: "We are spending £20,000 on migration.", raw: 20000 },
];

/**
 * THE RESIDUAL MISSES, FROZEN.
 *
 * These five denial VERBS are outside both the estate's negation/prevention
 * screen and this module's own marker. They are recorded rather than patched:
 * extending a natural-language lexicon case-by-case is the move that burned
 * four rounds, and the exit ruled on then was to record the ambiguity instead
 * of guessing (trap 22f).
 */
const KNOWN_DROPPED: readonly string[] = [
  "D02-unable-to",
  "D03-ruled-out",
  "D09-off-the-table",
  "D12-denied",
  "D13-scrapped",
  // ⚠ NOT A LEXICON MISS — A WINDOW MISS, AND IT IS RECORDED RATHER THAN CHASED.
  // "We reviewed £45,000 or £20,000 and rejected both": the second " and " joins
  // two VERB PHRASES, so its far side is not an amount, the coordinator cuts,
  // and the postposed "rejected" falls outside the window. Closing it needs the
  // window to know a VP coordination from an NP one, which is the parse this
  // module deliberately does not attempt. Two reversals on one predicate is the
  // signal to stop; "one more rule" here is the sunk-cost fallacy wearing
  // engineering clothes (trap 22f).
  "D16-vp-coordination",
];

describe("B1-b — a denied magnitude is never attributed to the user", () => {
  describe("the 15-denial corpus", () => {
    it.each(DENIALS.filter((c) => !KNOWN_DROPPED.includes(c.id)))(
      "refuses $id — $brief",
      ({ brief, raw }) => {
        const iv = wireIntervention(brief, raw);
        expect(iv?.source).toBe("cee_hypothesis");
        expect(iv?.value_confidence).toBe("low");
        expect(iv?.reasoning).not.toContain("the brief states");
      },
    );

    it("the KNOWN-DROPPED set is EXACTLY these — DERIVED, so it REDs if it grows OR shrinks", () => {
      // ⚠ DERIVED BY RUNNING THE CORPUS, never asserted against itself. A test
      // that compares a constant to a copy of the constant cannot observe a new
      // miss, which is the defect this replaces.
      const stillAttributed = DENIALS.filter((c) => attributed(c.brief, c.raw)).map((c) => c.id);
      expect([...stillAttributed].sort()).toEqual([...KNOWN_DROPPED].sort());
    });
  });

  describe("opposite-direction twins — the same sentences WITHOUT the denial", () => {
    it.each(TWINS)("attributes $id — $brief", ({ brief, raw }) => {
      const iv = wireIntervention(brief, raw);
      expect(iv?.source).toBe("brief_extraction");
      expect(iv?.value_confidence).toBe("high");
      expect(iv?.unit).toBe("£");
    });
  });

  describe("THE DISCRIMINATING PAIR — same sentence, same negation, figures swapped", () => {
    // A coordinator must not cut a governing negation off a coordinand. These
    // two differ ONLY in the order of two amounts, so any answer that differs
    // between them is an answer about the WINDOW, not about the sentence.
    it("refuses when the denied amount is the FIRST coordinand", () => {
      expect(wireIntervention("We will not approve £20,000 or £45,000.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("refuses when the denied amount is the SECOND coordinand", () => {
      expect(wireIntervention("We will not approve £45,000 or £20,000.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("refuses BOTH coordinands of one governing negation", () => {
      expect(wireIntervention("We will not approve £45,000 or £20,000.", 45000)?.source).toBe("cee_hypothesis");
      expect(wireIntervention("We will not approve £20,000 or £45,000.", 45000)?.source).toBe("cee_hypothesis");
    });

    it("a POSTPOSED denial reaches back across a coordinand", () => {
      // ⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED. Making the FORWARD
      // coordinator cut unconditionally left the whole kit green, and a
      // surviving mutant is a claim either way — so it was DEMONSTRATED, not
      // asserted: with the forward coordinand rule this refuses, without it the
      // same sentence returns `brief_extraction`. The corpus was short, and the
      // instrument said so before a reviewer had to.
      expect(wireIntervention("£45,000 or £20,000 was never approved.", 45000)?.source).toBe("cee_hypothesis");
      expect(wireIntervention("£45,000 or £20,000 was never approved.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("...and a THREE-way coordination is not a special case", () => {
      const brief = "We will not approve £45,000, £30,000 or £20,000.";
      for (const raw of [45000, 30000, 20000]) {
        expect(wireIntervention(brief, raw)?.source).toBe("cee_hypothesis");
      }
    });
  });

  describe("BOTH SIDES — a denial that follows the amount governs it too", () => {
    it("refuses a postposed passive denial", () => {
      expect(wireIntervention("The £20,000 migration budget was declined by finance.", 20000)?.source).toBe(
        "cee_hypothesis",
      );
    });

    it("refuses a postposed 'never'", () => {
      expect(wireIntervention("The £20,000 migration was never approved.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("DISCRIMINATOR: a denial in the NEXT sentence does not reach backwards", () => {
      // The forward window must stop at the sentence boundary, or every brief
      // that mentions a figure and later declines something else loses it.
      const iv = wireIntervention("The migration costs £20,000. We will not switch vendors.", 20000);
      expect(iv?.source).toBe("brief_extraction");
    });
  });

  describe("OVER-REFUSAL CONTROLS — a widened window must not eat real statements", () => {
    it("the frozen brief's own £45,000 still binds across ', and'", () => {
      // The second coordinand here is an INDEPENDENT CLAUSE, not a coordinand of
      // the amount, so 'nothing' does not govern it. Refusing here would destroy
      // the one figure the product already gets right.
      const iv = wireIntervention(
        "Staying on Salesforce costs us nothing extra up front, and our annual Salesforce licensing is £45,000.",
        45000,
        "Annual CRM Licensing Cost",
      );
      expect(iv?.source).toBe("brief_extraction");
      expect(iv?.unit).toBe("£");
    });

    it("a negation in a PRECEDING sentence does not govern", () => {
      expect(wireIntervention("We are not switching vendors. The migration quote is £20,000.", 20000)?.source).toBe(
        "brief_extraction",
      );
    });

    it("a word ending in 'nt' is not a contraction", () => {
      // ⚠ MEASURED AT PRISTINE: `\b\w+n['’]?t\b` — an OPTIONAL apostrophe —
      // matched *Procurement*, *amount*, *payment*, *current*, *percent* and
      // every other English word ending in "nt". The apostrophe is mandatory.
      for (const word of ["Procurement", "The payment department", "Our current investment"]) {
        expect(attributed(`${word} covers the £20,000 migration.`, 20000)).toBe(true);
      }
    });

    it("...while a REAL contracted negation still refuses, in both apostrophe forms", () => {
      expect(wireIntervention("We won't spend £20,000 on migration.", 20000)?.source).toBe("cee_hypothesis");
      expect(wireIntervention("We won’t spend £20,000 on migration.", 20000)?.source).toBe("cee_hypothesis");
      expect(wireIntervention("We don’t have £20,000 for migration.", 20000)?.source).toBe("cee_hypothesis");
    });

    it("the decimal point of £1.5m still does not end the clause and hide a negation", () => {
      expect(wireIntervention("We will not approve a £1.5m budget for a £20,000 migration.", 20000)?.source).toBe(
        "cee_hypothesis",
      );
    });

    it("...but a full stop AFTER A DIGIT still ends the sentence", () => {
      // ⚠ THE DISCRIMINATING TWIN OF THE LINE ABOVE, and the reason the clause
      // guard is a lookahead only. `(?<!\d)\.(?!\d)` swallowed the full stop of
      // every sentence ending in a number — which is most sentences that state
      // money — so with a forward window a denial in the NEXT sentence reached
      // backwards. Both directions are pinned here: the decimal must NOT cut,
      // and the sentence end MUST.
      expect(wireIntervention("We cannot delay past Q3. The migration budget is £20,000.", 20000)?.source).toBe(
        "brief_extraction",
      );
      expect(
        wireIntervention("Our annual licensing is £45,000. We will not switch vendors.", 45000)?.source,
      ).toBe("brief_extraction");
    });
  });

  describe("THE SCREEN IS CONSUMED, NOT MINTED (trap 21 / the two-generateGraphHash scar)", () => {
    it("every alternative of the estate's negation alphabets is screened here too", () => {
      // A UNION ASSERTION, derived: if someone teaches the compound-goal
      // extractor a new negation, this module learns it or this test REDs.
      // Derivation proves agreement; the corpus above is what notices the list
      // is short (trap 12d — ship both, neither supersedes the other).
      const alternatives = [NEGATION_LEAD, NEGATION_OR_PREVENTION_LEAD.source]
        .join("|")
        .replace(/[()?:\\bi]|\[[^\]]*\]/g, (m) => (m === "\\b" ? "|" : m))
        .split("|")
        .map((a) => a.replace(/\\s\+/g, " ").replace(/[(?:)\\b]/g, "").trim())
        .filter((a) => a.length > 2 && /^[a-z' ]+$/i.test(a));
      expect(alternatives.length).toBeGreaterThan(15); // the probe must SEE something
      const unscreened = alternatives.filter((a) => !DENIAL_SCREEN_RE.test(a));
      expect(unscreened).toEqual([]);
    });

    it("this module's screen is at least as wide as the estate's", () => {
      // A positive control on the imported authority itself: if
      // NEGATION_SCREEN_RE ever stopped matching, the union above would pass
      // vacuously (trap 13 — an absence probe needs to prove it can see a
      // presence).
      expect(NEGATION_SCREEN_RE.test("we cannot")).toBe(true);
      expect(NEGATION_SCREEN_RE.test("Procurement")).toBe(false);
      expect(DENIAL_SCREEN_RE.test("we cannot")).toBe(true);
      expect(DENIAL_SCREEN_RE.test("Procurement")).toBe(false);
    });
  });
});
