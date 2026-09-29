/**
 * AN `in_model` VERDICT THAT NAMES NO NODE IS NOT THE SAME CLAIM AS ONE THAT
 * DOES — and until this spec there was no field in which to say so.
 *
 * ── THE TWO ROUTES, MEASURED ───────────────────────────────────────────────
 * `classify()` reaches the verdict `in_model` two structurally different ways:
 *
 *   ROUTE A  `matchCandidate()` names a modelled quantity whose VALUE equals
 *            the user's figure under a compatible unit. `matched_node_id` is
 *            set. Something in the model computes with this number.
 *
 *   ROUTE B  `appearsInStrings()` — a case-insensitive substring test of the
 *            user's literal against every non-prose string in the graph.
 *            `matched_node_id` is null. The CHARACTERS occur somewhere; no
 *            quantity carries the figure as a value.
 *
 * `QuantityVerdict`'s own doc-comment concedes the fold: "in_model = carried as
 * a value, cap, unit OR LABEL."
 *
 * ── WHY IT MATTERS, MEASURED ON THE DEPLOYED PRODUCT ───────────────────────
 * A brief said "59 per month"; the option was labelled "increase the Pro plan
 * price from 49 to 79 per month"; the receipt still read
 * `verdict: "in_model", matched_node_id: null`, and the coaching then told the
 * user about "the £59/£63 option" — a price the model does not hold. A
 * downstream reader that treats `in_model` as "the model holds this value" has
 * no field to read that would have stopped it.
 *
 * ── WHY ADDITIVE COUNTS AND NOT A FOURTH VERDICT ───────────────────────────
 * See the fields' own comment in `not-modelled-manifest.ts`. In short: the
 * verdict is wire-visible, and a consumer pinned to an older `@talchain/schemas`
 * silently drops an unknown FIELD but can fail validation outright on an
 * unknown ENUM MEMBER. The count degrades safely; the enum value does not.
 *
 * ── THE ORACLE IS NOT THIS MODULE'S OUTPUT ─────────────────────────────────
 * The predicate below (`verdict === "in_model" && matched_node_id === null`) is
 * written from the SPEC — the two routes above — not from the tally it checks,
 * and it is applied to the repo's committed real cold-read captures, never to a
 * fixture authored here (trap 16-inverse: a fixture you wrote yourself is not
 * evidence about the wire). The summary tally and this independent predicate
 * must agree on every capture; a tally that drifts from the rule REDs.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  deriveNotModelledManifest,
  type NotModelledItem,
  type NotModelledManifest,
} from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}

function loadCapture(name: string): ColdRead {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", `${name}.cold-read.json`), "utf8"),
  ) as ColdRead;
}

/** The four committed cold-read captures, unedited wire bytes. */
const CAPTURES = [
  ["b1-growth", loadCapture("b1-growth")],
  ["b2-restructuring", loadCapture("b2-restructuring")],
  ["b3-product-bet", loadCapture("b3-product-bet")],
  ["live-4day-week", loadCapture("live-4day-week")],
] as const;

function manifestFor(capture: ColdRead): NotModelledManifest {
  return deriveNotModelledManifest(capture.brief_text, capture.graph);
}

/**
 * ROUTE B, stated from the spec rather than read off the tally.
 *
 * This is deliberately NOT imported from the module under test. A predicate
 * borrowed from the producer would make the union assertion below a guard
 * agreeing with itself (trap 13b); restating the rule independently is what
 * lets it disagree.
 */
function isUnanchoredInModel(i: NotModelledItem): boolean {
  return i.verdict === "in_model" && i.matched_node_id === null;
}

function isAnchoredInModel(i: NotModelledItem): boolean {
  return i.verdict === "in_model" && i.matched_node_id !== null;
}

describe("the corpus is real, non-empty and untruncated", () => {
  // ANTI-VACUITY. Every assertion below is over `items`; a capture that
  // truncated, or that carried no `in_model` verdict at all, would let the
  // union assertions pass by having nothing to compare (trap 13).
  it.each(CAPTURES)("%s: reports items, none truncated", (_name, capture) => {
    const q = manifestFor(capture).quantities;
    expect(q, "the capture must derive").not.toBeNull();
    expect(q!.truncated, "a truncated capture invalidates every union assertion here").toBe(false);
    expect(q!.items.length).toBe(q!.total);
    expect(q!.in_model, "the capture must carry at least one in_model verdict").toBeGreaterThan(0);
  });
});

describe("an in_model verdict that names no node is counted as unanchored", () => {
  /**
   * THE MEASURED SCALE, pinned by identity rather than by a total another
   * distribution could satisfy (trap 19). Derived at HEAD fe84f59e against the
   * four committed captures: 11 of 18 `in_model` verdicts (61%) name no node.
   *
   * Pinning the literals — not just the counts — is what makes this fail
   * readably if the classifier moves: a changed total says "something moved",
   * the literals say WHICH figure moved and in which direction.
   */
  const EXPECTED_UNANCHORED: Readonly<Record<string, readonly string[]>> = {
    "b1-growth": ["£20m", "FY28", "FY28"],
    "b2-restructuring": ["Q3 2027", "40%", "45 roles", "January 2027", "Q3 2027"],
    "b3-product-bet": ["15%"],
    "live-4day-week": ["4-day", "4-day"],
  };

  it.each(CAPTURES)(
    "%s: the summary's unanchored count equals the independently-derived one",
    (name, capture) => {
      const q = manifestFor(capture).quantities!;
      const unanchored = q.items.filter(isUnanchoredInModel);
      expect(
        unanchored.map((i) => i.literal),
        "the capture must still carry the measured unanchored figures",
      ).toEqual(EXPECTED_UNANCHORED[name]);
      expect(q.in_model_unanchored).toBe(unanchored.length);
    },
  );

  it.each(CAPTURES)(
    "%s: the summary's anchored count equals the independently-derived one",
    (_name, capture) => {
      const q = manifestFor(capture).quantities!;
      expect(q.in_model_anchored).toBe(q.items.filter(isAnchoredInModel).length);
    },
  );

  it.each(CAPTURES)(
    "%s: an unanchored figure is never also counted as anchored",
    (_name, capture) => {
      const q = manifestFor(capture).quantities!;
      // The partition, asserted rather than assumed: the two counts are
      // disjoint and exhaust `in_model`. A tally that double-counted, or that
      // quietly dropped a route, satisfies neither half.
      expect(q.in_model_anchored + q.in_model_unanchored).toBe(q.in_model);
      expect(q.in_model_anchored).toBe(q.in_model - q.in_model_unanchored);
    },
  );

  it("holds at the measured 11-of-18 scale across the whole corpus", () => {
    let inModel = 0;
    let unanchored = 0;
    let anchored = 0;
    for (const [, capture] of CAPTURES) {
      const q = manifestFor(capture).quantities!;
      inModel += q.in_model;
      unanchored += q.in_model_unanchored;
      anchored += q.in_model_anchored;
    }
    expect(inModel).toBe(18);
    expect(unanchored).toBe(11);
    expect(anchored).toBe(7);
  });
});

describe("the verdict union is unchanged — the additive guarantee", () => {
  /**
   * The repair adds COUNTS, never a fourth `QuantityVerdict`. This asserts the
   * guarantee by execution rather than by intention: a new member reaching the
   * wire would be read by a consumer pinned to an older `@talchain/schemas` as
   * an invalid enum value, which is a validation failure rather than a silently
   * dropped field.
   */
  it.each(CAPTURES)("%s: emits only the three published verdicts", (_name, capture) => {
    const q = manifestFor(capture).quantities!;
    const seen = new Set(q.items.map((i) => i.verdict));
    expect(seen.size, "the capture must exercise more than one verdict").toBeGreaterThan(1);
    for (const v of seen) expect(["in_model", "prose_only", "absent"]).toContain(v);
  });
});

/**
 * ⚠ DELIBERATELY SKIPPED — THIS IS A PRODUCT DECISION, NOT A DEFECT, AND
 * GUESSING AT IT WOULD SHIP COPY NOBODY RULED ON.
 *
 * `composeDroppedFigureNotice` (`brief-audit-answer.ts`) gates on
 * `q.absent === 0`. An unanchored figure is neither `absent` nor retained, so
 * the pushed draft-turn footer says nothing about it. The obvious repair — name
 * unanchored figures in that footer — is NOT obviously right, and the reason is
 * measured rather than aesthetic. At HEAD fe84f59e, across the four committed
 * captures, every unanchored figure resolves like this:
 *
 *   £20m          → goal label   "Reach £20m ARR by End of FY28"
 *   FY28          → goal label   "Reach £20m ARR by End of FY28"
 *   Q3 2027       → goal label   "Achieve EBITDA Breakeven by Q3 2027"
 *   40%, 45 roles → option label "45 roles offshored (~40% saving)"
 *   15%           → goal label   "Achieve 15% ARR Growth Without Worsening Attrition"
 *   4-day         → option/factor labels ("4-Day Work Week for Support Team", …)
 *   January 2027  → matched via month canonicalisation
 *
 * Two consequences, both of which a ruling has to weigh:
 *
 *  1. FIVE of the eleven are `date`/`period`. For those kinds a null match is
 *     the ONLY possible state — `brief-audit-answer.ts` measured exactly this
 *     ("EVERY date/period item carries matched_node_id: null, INCLUDING the
 *     ones verdicted in_model") and already excludes them from this footer via
 *     `isDisclosableInDraftNotice`. Counting them as not-retained would be
 *     false.
 *  2. Every one of the remaining six is carried in a GOAL or OPTION LABEL —
 *     i.e. the figure names the very thing the user is deciding about. A footer
 *     telling the user their £20m target was not bound is the cry-wolf
 *     direction that file already refuted with a measurement ("a notice that
 *     fires on a faithful model teaches the reader to skip it").
 *
 * THE OPEN QUESTION, for whoever rules: should the pushed footer name an
 * unanchored MAGNITUDE (£20m, 40%, 45 roles, 15%) — and if so, in what words,
 * given that "I could not find it in the model" is FALSE of it? The state is
 * now expressible (`in_model_unanchored`), so the decision is finally
 * available; this lane declined to make it.
 *
 * Un-skip and write the expectation once the copy is ruled. Until then a
 * skipped test with the question in it is honest; a guessed expectation is not.
 */
describe.skip("the pushed draft notice distinguishes unanchored from absent", () => {
  it("names an unanchored magnitude in words that are true of it", () => {
    expect.fail("copy not ruled — see the block comment above this describe");
  });
});
