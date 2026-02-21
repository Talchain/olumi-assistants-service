/**
 * Unit Tests for Prompt Sensitivity Transformations
 *
 * Validates that each transformation is deterministic and produces
 * the expected output.
 */

import { describe, it, expect } from "vitest";
import {
  applySynonymSwap,
  applyClauseReorder,
  applyPassiveVoice,
  generateTransformedBriefs,
} from "./prompt-sensitivity.js";
import { GOLD_BRIEF_SET } from "./gold-briefs/gold-briefs.js";

// ---------------------------------------------------------------------------
// applySynonymSwap
// ---------------------------------------------------------------------------

describe("applySynonymSwap", () => {
  it("replaces words with synonyms (case-insensitive, preserving case)", () => {
    const result = applySynonymSwap("The Competitor dropped their price.", {
      competitor: "rival",
      price: "rate",
    });
    expect(result).toBe("The Rival dropped their rate.");
  });

  it("respects word boundaries", () => {
    const result = applySynonymSwap("The pricing model uses price data.", {
      price: "rate",
    });
    // "pricing" should NOT be affected, only "price"
    expect(result).toBe("The pricing model uses rate data.");
  });

  it("is deterministic (same input → same output)", () => {
    const map = { customer: "client", revenue: "income" };
    const text = "Customer revenue is growing.";
    const r1 = applySynonymSwap(text, map);
    const r2 = applySynonymSwap(text, map);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// applyClauseReorder
// ---------------------------------------------------------------------------

describe("applyClauseReorder", () => {
  it("swaps clause halves at the split point", () => {
    const text = "We are a SaaS company. Should we lower our price?";
    const result = applyClauseReorder(text, 23);
    expect(result).toBe("Should we lower our price? We are a SaaS company.");
  });

  it("returns original text if split point is out of bounds", () => {
    const text = "Short text.";
    expect(applyClauseReorder(text, 0)).toBe(text);
    expect(applyClauseReorder(text, text.length)).toBe(text);
  });

  it("is deterministic", () => {
    const text = "First half. Second half.";
    const r1 = applyClauseReorder(text, 12);
    const r2 = applyClauseReorder(text, 12);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// applyPassiveVoice
// ---------------------------------------------------------------------------

describe("applyPassiveVoice", () => {
  it("wraps specified sentences in passive construction", () => {
    const text = "We saw a decline. The team responded quickly.";
    const result = applyPassiveVoice(text, [0]);
    expect(result).toContain("It is the case that");
    expect(result).toContain("we saw a decline");
    // Second sentence should be unchanged
    expect(result).toContain("The team responded quickly.");
  });

  it("does not modify unselected sentences", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const result = applyPassiveVoice(text, [1]);
    expect(result).toMatch(/^First sentence\./);
    expect(result).toContain("It is the case that second sentence.");
    expect(result).toContain("Third sentence.");
  });

  it("is deterministic", () => {
    const text = "A happened. B happened.";
    const r1 = applyPassiveVoice(text, [0, 1]);
    const r2 = applyPassiveVoice(text, [0, 1]);
    expect(r1).toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// generateTransformedBriefs
// ---------------------------------------------------------------------------

describe("generateTransformedBriefs", () => {
  it("generates 3 transformations for each sensitivity brief", () => {
    for (const sb of GOLD_BRIEF_SET.sensitivity_briefs) {
      const transformed = generateTransformedBriefs(sb);
      expect(transformed.length).toBe(3);

      const types = transformed.map((t) => t.transformation).sort();
      expect(types).toEqual(["clause_reorder", "passive_voice", "synonym_swap"]);

      // Each should produce different text from original
      for (const t of transformed) {
        expect(t.text).not.toBe(sb.brief_text);
        expect(t.original_id).toBe(sb.id);
      }
    }
  });

  it("produces stable outputs across calls", () => {
    const sb = GOLD_BRIEF_SET.sensitivity_briefs[0]!;
    const first = generateTransformedBriefs(sb);
    const second = generateTransformedBriefs(sb);

    for (let i = 0; i < first.length; i++) {
      expect(first[i]!.text).toBe(second[i]!.text);
    }
  });
});
