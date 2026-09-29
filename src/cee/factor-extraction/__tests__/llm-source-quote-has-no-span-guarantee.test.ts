/**
 * ⭐ THE LLM PATH GIVES `matchedText` NO SUBSTRING GUARANTEE AGAINST THE BRIEF.
 *
 * This file exists to PIN one structural fact that a comment in `enricher.ts`
 * rests on, so that the comment cannot go quietly false.
 *
 * `enhanceWriteIsSpanContained` compares `factor.matchedText` against a stated
 * node's `source_quote` as STRINGS, and its rationale is that string
 * containment is equivalent to (and more permissive than) an offset comparison.
 * That equivalence needs `matchedText` to be a literal span of the brief. It is,
 * on the REGEX path, where every site sets it to the match's own `m[0]`.
 *
 * It is NOT on the LLM-first path: `llm-extractor.ts:286` assigns the
 * model-authored `source_quote` straight through to `matchedText`. The contract
 * below is the only thing standing between the model and that field, and it
 * constrains LENGTH ONLY. A model that rephrases its own quote therefore
 * produces a `matchedText` with no occurrence in the brief at all.
 *
 * ⚠ WHAT THIS FILE DOES AND DOES NOT PIN. It pins the CONTRACT: the schema on
 * the live parse path admits a `source_quote` that appears nowhere in the brief.
 * It does NOT pin the downstream refusal in `enhanceWriteIsSpanContained` (that
 * predicate is not exported), and it does not pin the converter's field copy at
 * `llm-extractor.ts:286`. If a substring refinement is ever added to the schema,
 * the first test here goes RED and the `enricher.ts` non-coverage note must be
 * revisited. A filter added elsewhere in the chain would NOT red this file.
 */

import { describe, it, expect } from "vitest";
import { LLMFactorExtractionResponseSchema } from "../../../schemas/llmExtraction.js";

/** A brief with one figure, stated once, in one sentence. */
const BRIEF =
  "We spend £180,000 a year on the sales team, and I want to know whether " +
  "hiring two more reps is worth it.";

/**
 * A quote the model might return for that figure: the right FACT, rephrased.
 * Not a span of BRIEF — the model has normalised the currency and dropped the
 * separator, exactly the kind of tidy-up a model does unprompted.
 */
const PARAPHRASED_QUOTE = "we spend 180000 GBP a year on the sales team";

function responseWith(source_quote: string): unknown {
  return {
    factors: [
      {
        label: "Sales Team Spend",
        value: 180000,
        unit: "£",
        confidence: 0.9,
        source_quote,
      },
    ],
  };
}

describe("LLM source_quote carries no span guarantee", () => {
  it("admits a source_quote that appears nowhere in the brief", () => {
    // ⚠ PRECONDITION, PINNED IN-TEST. If BRIEF ever changes so that it DOES
    // contain the paraphrase, the assertion below would pass while proving
    // nothing — the fixture would have stopped reproducing the case (trap 13b).
    expect(
      BRIEF.includes(PARAPHRASED_QUOTE),
      "fixture no longer reproduces a non-span quote"
    ).toBe(false);

    const parsed = LLMFactorExtractionResponseSchema.safeParse(
      responseWith(PARAPHRASED_QUOTE)
    );

    // The schema is the only brief-facing gate on this field, and it lets the
    // paraphrase through untouched. This is the fact `enricher.ts` cites.
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.factors[0].source_quote).toBe(
      PARAPHRASED_QUOTE
    );
  });

  it("CONTRAST CONTROL: the same schema does reject a malformed factor", () => {
    // Without this, the test above is consistent with a schema that accepts
    // everything — an acceptance proves nothing unless a rejection is possible.
    const overLongQuote = "x".repeat(201);
    expect(overLongQuote.length).toBeGreaterThan(200);

    const rejected = LLMFactorExtractionResponseSchema.safeParse(
      responseWith(overLongQuote)
    );
    expect(rejected.success).toBe(false);

    // And it rejects on a DIFFERENT axis too, so the control is not itself
    // pinned to the single `max(200)` rule.
    const missingField = LLMFactorExtractionResponseSchema.safeParse({
      factors: [{ label: "Sales Team Spend", value: 180000, unit: "£" }],
    });
    expect(missingField.success).toBe(false);
  });

  it("the length bound is the ONLY constraint the quote must satisfy", () => {
    // A quote that is pure noise — no relation to any brief — still parses.
    // This is the sharpest form of the claim: the contract is length-only.
    const noise = "zzzz qqqq wwww";
    expect(BRIEF.includes(noise)).toBe(false);

    const parsed = LLMFactorExtractionResponseSchema.safeParse(
      responseWith(noise)
    );
    expect(parsed.success).toBe(true);
  });
});
