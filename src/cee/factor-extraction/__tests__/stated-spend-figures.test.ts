/**
 * A STATED SPEND FIGURE NEVER REACHED THE MODEL — `contextualNumber`'s context
 * vocabulary had no verb of spending.
 *
 * THE DEFECT, witnessed on the deployed build (staging `ac37890c`, 2026-08-31).
 * The brief "we spend 180000 a year on tooling" produced a graph with an
 * "Annual Tooling Spend" factor carrying NO value, and the assistant said, in
 * its own words:
 *
 *   "Figures from your brief I could not find in the model: 180000 a year.
 *    Tell me what they apply to and I'll add them."
 *
 * So the product was already HONEST about the loss — the reconciliation sweep
 * saw the figure, failed to bind it, and said so. What it could not do was
 * READ it. The user is then asked for a number they had already typed, which
 * is the programme's worst standing defect (CLAUDE.md: "the user's own data
 * does not reach the model") wearing a polite notice.
 *
 * WHERE IT DIVERGED, measured at `ac37890c` with `extractFactors` directly
 * (deployed extraction is regex-only: `CEE_LLM_FIRST_EXTRACTION_ENABLED` is
 * absent from all 119 staging env vars, so `config.cee.llmFirstExtractionEnabled`
 * takes its `false` default and the LLM extractor never runs):
 *
 *   "our tooling budget is 180000"   -> Budget 180000, explicit, 0.90   ✅
 *   "our tooling cost of 180000"     -> Cost   180000, explicit, 0.90   ✅
 *   "our tooling spend of 180000"    -> (nothing)                        ❌
 *   "we spend 180000 a year on tooling" -> (nothing)                     ❌
 *
 * ONE WORD apart, same syntactic frame, opposite outcome. The cause is not the
 * digit grammar and not the magnitude alphabet — both are shared and both are
 * correct here. It is the CLOSED CONTEXT VOCABULARY at `index.ts:188`, which
 * listed twelve nouns of measurement and no verb of spending. A bare digit run
 * is only read when a word from that list governs it (or a currency symbol
 * precedes it, which is why "£180,000" landed as an unlabelled "Value" at
 * 0.60 while the bare form landed as nothing at all).
 *
 * THE FIX REUSES RATHER THAN MINTS. There is exactly ONE context vocabulary in
 * this module and one place it is spelled; `spending|spend` joins it. No new
 * pattern, no second list, no new digit grammar, and nothing here re-types the
 * magnitude alphabet — "we spend 180k" is read by the SAME shared alternation
 * that already serves every other context word, which is why this file asserts
 * that too. Unlike `grand` (ROADMAP 2.330) there was no sibling vocabulary in
 * `src/` that already knew the word, so there is no union to widen: the single
 * canonical list was simply short.
 *
 * NO UNIT IS INVENTED. "we spend 180000" states no currency, so the factor
 * carries none — `unit` is set only where a `%` or a `£$€` is actually present
 * in the matched text. Committing a currency the user did not type would be
 * the fabrication this estate has ruled worse than a visible unknown.
 *
 * BINDING BY IDENTITY, NOT BY VALUE (CLAUDE.md trap 19). Every assertion below
 * finds its factor by LABEL and asserts the contrast control is still present
 * in the same result, so a factor that merely happens to share the number
 * cannot satisfy it.
 */

import { describe, it, expect } from "vitest";
import { extractFactors } from "../index.js";

/** The exact brief measured on the deployed build. */
const REPRO = "we spend 180000 a year on tooling";

/**
 * The reproduction brief PLUS the contrast control that was already working.
 * Every assertion about the spend figure is made against this brief, so a test
 * that starts passing because extraction broke wholesale cannot hide: the
 * control must keep landing.
 */
const REPRO_WITH_CONTROL = "we spend 180000 a year on tooling and churn is 4%";

type Factor = ReturnType<typeof extractFactors>[number];

const byLabel = (factors: readonly Factor[], label: string): Factor | undefined =>
  factors.find((f) => f.label === label);

describe("a stated spend figure reaches the model", () => {
  it("reads the bare digit run governed by the verb 'spend'", () => {
    const factors = extractFactors(REPRO);
    const spend = byLabel(factors, "Spend");

    expect(spend, `no "Spend" factor in ${JSON.stringify(factors)}`).toBeDefined();
    expect(spend?.value).toBe(180_000);
    expect(spend?.extractionType).toBe("explicit");
    expect(spend?.confidence).toBe(0.9);
  });

  it("invents no currency for a figure the user stated without one", () => {
    const spend = byLabel(extractFactors(REPRO), "Spend");
    expect(spend?.unit).toBeUndefined();
  });

  it("keeps the user's own words as the origin of the figure", () => {
    const spend = byLabel(extractFactors(REPRO), "Spend");
    expect(spend?.matchedText).toContain("180000");
    expect(spend?.matchedText?.toLowerCase()).toContain("spend");
  });

  it("reads the spend figure WITHOUT disturbing the contrast control", () => {
    const factors = extractFactors(REPRO_WITH_CONTROL);

    // The target: previously absent entirely.
    const spend = byLabel(factors, "Spend");
    expect(spend?.value).toBe(180_000);

    // The control: was already landing at ac37890c and must still land.
    const churn = byLabel(factors, "Churn");
    expect(churn, "contrast control lost — this suite can no longer see a success").toBeDefined();
    expect(churn?.value).toBe(0.04);
  });

  it("reads the noun frame too, the one that diverged from 'cost' and 'budget'", () => {
    const spend = byLabel(extractFactors("our tooling spend of 180000"), "Spend");
    expect(spend?.value).toBe(180_000);
  });

  it("reads the gerund the same way", () => {
    const factors = extractFactors("we are spending 180000 a year on tooling");
    const spending = byLabel(factors, "Spending");
    expect(spending?.value).toBe(180_000);
  });

  /**
   * The magnitude alphabet is REUSED, not re-typed. If a future edit gave this
   * context word its own suffix handling, this REDs.
   */
  it("reads a magnitude suffix on a spend figure through the shared alternation", () => {
    expect(byLabel(extractFactors("we spend 180k a year on tooling"), "Spend")?.value).toBe(180_000);
    expect(byLabel(extractFactors("we spend 1.8m a year on tooling"), "Spend")?.value).toBe(1_800_000);
  });

  /**
   * And the refusal is inherited too: an unreadable suffix must still withhold
   * rather than publish bare digits (ROADMAP 2.303's property, now reachable
   * through a spend verb).
   */
  it("refuses a spend figure carrying a magnitude it cannot read", () => {
    expect(byLabel(extractFactors("we spend 500kg a year on tooling"), "Spend")).toBeUndefined();
  });

  /**
   * THE CONTRAST CONTROL FOR THE FIX ITSELF (CLAUDE.md trap 13e). These landed
   * before the change and must land after it, unchanged. A vocabulary edit that
   * broke a sibling word would otherwise be invisible to the assertions above.
   */
  it.each([
    ["our tooling budget is 180000", "Budget"],
    ["our tooling cost of 180000", "Cost"],
    ["churn is 4%", "Churn"],
  ])("leaves the pre-existing context word intact: %s", (brief, label) => {
    expect(byLabel(extractFactors(brief), label)).toBeDefined();
  });
});

/**
 * THE HAND-WRITTEN HALF (this module's own doctrine, ROADMAP 2.330).
 *
 * A derived guard proves agreement and can never prove COMPLETENESS; only a
 * hand-written corpus notices that a list is SHORT. This vocabulary is short by
 * construction — it is a closed list of English words standing in for an open
 * class — so the honest thing is to pin what it does NOT read, exactly, and
 * make the set fail loud in BOTH directions (CLAUDE.md trap 22f: "a gap
 * recorded in the suite is honest; a gap invisible to it" is how a defect
 * survives four rounds of fixes).
 *
 * If a later change reads one of these, this REDs and the entry moves up into
 * the covered set above — deliberately, with its own assertion. If a change
 * silently stops reading one, that REDs too.
 *
 * ⚠ These are NOT acceptable losses to leave forever. They are the measured
 * remainder of one defect, scoped to the verb that was reported. Widening this
 * vocabulary further is predicate-breadth work over natural language, which
 * this estate has ruled needs a corpus sourced from OUTSIDE the author's head
 * (CLAUDE.md traps 22, 22b, 22c) rather than another word guessed by the lane
 * that just added one.
 */
const KNOWN_UNREAD_SPEND_PHRASINGS: readonly string[] = [
  "we pay 180000 a year for tooling",
  "tooling costs us 180000 a year",
  "our tooling outlay is 180000",
  "we invest 180000 a year in tooling",
  "180000 a year goes on tooling",
  "we spend one hundred and eighty thousand a year on tooling",
];

describe("figures this vocabulary still cannot read (pinned, both directions)", () => {
  it("reads none of the pinned phrasings, and the set is exactly this size", () => {
    const unread = KNOWN_UNREAD_SPEND_PHRASINGS.filter(
      (brief) => !extractFactors(brief).some((f) => f.value === 180_000),
    );

    expect(unread).toEqual(KNOWN_UNREAD_SPEND_PHRASINGS);
    expect(unread).toHaveLength(6);
  });

  /**
   * The positive control WITHOUT which the assertion above is vacuous
   * (CLAUDE.md trap 13): prove the probe can see a 180000 when one is there.
   */
  it("positive control: the same probe DOES see the figure in the repaired form", () => {
    expect(extractFactors(REPRO).some((f) => f.value === 180_000)).toBe(true);
  });
});
