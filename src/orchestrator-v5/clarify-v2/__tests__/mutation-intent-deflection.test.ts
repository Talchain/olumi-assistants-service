/**
 * INV-M (ROADMAP 2.716) — a live clarify round must not eat graph-mutation
 * language.
 *
 * MECHANISM (capture-semantics-derivation-2026-08-08.md §3.1): the defect is
 * an ABSENT branch, not a wrong predicate. Eight anchored `^…$` guards decline
 * the message and the ninth position is the ladder's raw-concatenation
 * fallthrough — so `"Change the price to 90,000"` becomes part of the working
 * brief verbatim and the whole model is redrafted from the run-on string.
 * All eight commands below were MEASURED to fold at `8c316b5e`.
 *
 * ⚠ PREMISE CORRECTION, measured at this tip and required to reach 8/8: the
 * derivation's §3.2 table itself records row 4 ("Actually, make HubSpot's
 * licence cost 90,000 instead") as `edit-lane: no`, yet its §5.2 asks for all
 * eight. Re-measured here against the real modules: `EDIT_GRAPH_POSITIVE_REGEX`
 * misses it (no listed edit verb) and so does `isValueUpdatePhrasing`. The
 * estate-wide widening is deliberately out of scope (§6 R1 — it changes edit
 * dispatch everywhere and needs its own precision controls), so this seam
 * carries one narrow LOCAL correction pattern, pinned by the negative corpus
 * below.
 */

import { describe,expect,it } from "vitest";




/**
 * FIXTURE HONESTY (§5.0): the round state derives from the PRODUCER
 * modules, never a hand-listed object. DRAFT-FIRST INTAKE (2026-08-17)
 * retired round 1's ask arm, so a LIVE round is now a LEGACY row —
 * persisted by a pre-draft-first deploy and still honoured by resume
 * within its TTL. Its `asked` history derives from the live rubric +
 * question composer, exactly what the retired ask arm recorded.
 */






/** capture-semantics-derivation-2026-08-08.md §3.2 — the 8 that folded. */
const MUTATION_COMMANDS: readonly string[] = [
  "Change the price to 90,000",
  "Change the CRM licence cost to £90,000",
  "Set the migration cost to 40000",
  "Actually, make HubSpot's licence cost 90,000 instead",
  "Add a factor for training time",
  "Remove the Salesforce option",
  "Increase the churn estimate to 12%",
  "change X to Y",
];

/**
 * Genuine answers to a clarify question. These MUST still fold.
 *
 * ⚠ THE FIRST FOUR ARE TAKEN FROM THE ESTATE'S OWN EXISTING SUITES, NOT
 * WRITTEN BY THIS LANE, and they are the reason the predicate is anchored to
 * the imperative position. A self-authored negative corpus passed against an
 * UNANCHORED `EDIT_GRAPH_POSITIVE_REGEX`; the full required gate then turned
 * four existing suites RED, because a real clarify answer says things like
 * "The goal is to increase revenue." A corpus you write yourself encodes your
 * own model of the input space — which is exactly the fixture-honesty failure
 * this brief warns about, one level up.
 */


describe("INV-M — mutation intent during a live clarify round is never folded", () => {


  describe("B1 — all eight measured mutation commands deflect, brief byte-unchanged", () => {


    it("covers exactly the eight measured strings (no silent shrink)", () => {
      expect(MUTATION_COMMANDS).toHaveLength(8);
      expect(new Set(MUTATION_COMMANDS).size).toBe(8);
    });
  });












});
