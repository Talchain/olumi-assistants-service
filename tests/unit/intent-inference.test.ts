import { describe, it, expect } from "vitest";
import {
  inferIntent,
  isP0Intent,
  getIntentDescription,
} from "../../src/services/intent-inference.js";

describe("Intent Inference Service", () => {
  describe("inferIntent", () => {
    describe("explain intent", () => {
      it("detects 'why' keyword", () => {
        const result = inferIntent("Why is this node here?");
        expect(result.intent).toBe("explain");
        expect(result.matchedKeywords).toContain("Why");
        expect(result.isDefault).toBe(false);
      });

      it("detects 'explain' keyword", () => {
        const result = inferIntent("Can you explain this connection?");
        expect(result.intent).toBe("explain");
        expect(result.matchedKeywords).toContain("explain");
      });

      it("detects 'what does' phrase", () => {
        const result = inferIntent("What does this factor mean?");
        expect(result.intent).toBe("explain");
        expect(result.matchedKeywords).toContain("What does");
      });

      it("detects 'how does' phrase", () => {
        const result = inferIntent("How does this affect the outcome?");
        expect(result.intent).toBe("explain");
        expect(result.matchedKeywords).toContain("How does");
      });
    });

    describe("repair intent", () => {
      it("detects 'fix' keyword", () => {
        const result = inferIntent("Can you fix this edge?");
        expect(result.intent).toBe("repair");
        expect(result.matchedKeywords).toContain("fix");
      });

      it("detects 'wrong' keyword", () => {
        const result = inferIntent("This connection seems wrong");
        expect(result.intent).toBe("repair");
        expect(result.matchedKeywords).toContain("wrong");
      });

      it("detects 'improve' keyword", () => {
        const result = inferIntent("How can we improve this model?");
        expect(result.intent).toBe("repair");
        expect(result.matchedKeywords).toContain("improve");
      });

      it("detects 'problem' keyword", () => {
        const result = inferIntent("There's a problem with this");
        expect(result.intent).toBe("repair");
        expect(result.matchedKeywords).toContain("problem");
      });
    });

    describe("ideate intent", () => {
      it("detects 'what if' phrase", () => {
        const result = inferIntent("What if we consider a different approach?");
        expect(result.intent).toBe("ideate");
        expect(result.matchedKeywords).toContain("What if");
      });

      it("detects 'alternative' keyword", () => {
        const result = inferIntent("Are there alternative options?");
        expect(result.intent).toBe("ideate");
        expect(result.matchedKeywords).toContain("alternative");
      });

      it("detects 'suggest' keyword", () => {
        const result = inferIntent("Can you suggest something else?");
        expect(result.intent).toBe("ideate");
        expect(result.matchedKeywords).toContain("suggest");
      });

      it("detects 'brainstorm' keyword", () => {
        const result = inferIntent("Let's brainstorm more options");
        expect(result.intent).toBe("ideate");
        expect(result.matchedKeywords).toContain("brainstorm");
      });
    });

    describe("compare intent", () => {
      it("detects 'compare' keyword", () => {
        const result = inferIntent("Can you compare these options?");
        expect(result.intent).toBe("compare");
        expect(result.matchedKeywords).toContain("compare");
      });

      it("detects 'versus' keyword", () => {
        const result = inferIntent("Option A versus Option B");
        expect(result.intent).toBe("compare");
        expect(result.matchedKeywords).toContain("versus");
      });

      it("detects 'vs' abbreviation", () => {
        const result = inferIntent("Option A vs Option B");
        expect(result.intent).toBe("compare");
        expect(result.matchedKeywords.some((k) => k.toLowerCase() === "vs")).toBe(true);
      });

      it("detects 'tradeoff' keyword", () => {
        const result = inferIntent("What are the tradeoffs?");
        expect(result.intent).toBe("compare");
        expect(result.matchedKeywords).toContain("tradeoff");
      });

      it("detects 'pros and cons' phrase", () => {
        const result = inferIntent("What are the pros and cons?");
        expect(result.intent).toBe("compare");
        expect(result.matchedKeywords).toContain("pros and cons");
      });
    });

    describe("challenge intent", () => {
      it("detects 'challenge' keyword", () => {
        const result = inferIntent("I want to challenge this assumption");
        expect(result.intent).toBe("challenge");
        expect(result.matchedKeywords).toContain("challenge");
      });

      it("detects 'assumption' keyword", () => {
        const result = inferIntent("Is this assumption valid?");
        expect(result.intent).toBe("challenge");
        expect(result.matchedKeywords).toContain("assumption");
      });

      it("detects 'evidence' keyword", () => {
        const result = inferIntent("What's the evidence for this?");
        expect(result.intent).toBe("challenge");
        expect(result.matchedKeywords).toContain("evidence");
      });

      it("detects 'really' keyword", () => {
        const result = inferIntent("Is this really true?");
        expect(result.intent).toBe("challenge");
        expect(result.matchedKeywords).toContain("really");
      });
    });

    describe("clarify intent", () => {
      it("detects 'clarify' keyword", () => {
        const result = inferIntent("Can you clarify this?");
        expect(result.intent).toBe("clarify");
        expect(result.matchedKeywords).toContain("clarify");
      });

      it("detects 'confused' keyword", () => {
        const result = inferIntent("I'm confused about this");
        expect(result.intent).toBe("clarify");
        expect(result.matchedKeywords).toContain("confused");
      });

      it("detects 'more detail' phrase", () => {
        const result = inferIntent("Can you give more detail?");
        expect(result.intent).toBe("clarify");
        expect(result.matchedKeywords).toContain("more detail");
      });
    });

    describe("default behavior", () => {
      it("defaults to clarify when no keywords match", () => {
        const result = inferIntent("Hello there");
        expect(result.intent).toBe("clarify");
        expect(result.confidence).toBe(0.3);
        expect(result.matchedKeywords).toHaveLength(0);
        expect(result.isDefault).toBe(true);
      });

      it("defaults to clarify for empty message", () => {
        const result = inferIntent("");
        expect(result.intent).toBe("clarify");
        expect(result.isDefault).toBe(true);
      });
    });

    describe("priority ordering", () => {
      it("prioritizes repair over explain when both match", () => {
        // "wrong" (repair) and "why" (explain) both match
        const result = inferIntent("Why is this wrong?");
        // Both keywords match, but repair has higher priority
        expect(result.intent).toBe("repair");
      });

      it("uses score to determine winner with equal priority", () => {
        // Multiple matches for one intent should win over single match
        const result = inferIntent("Fix this error, it's wrong and broken");
        expect(result.intent).toBe("repair");
        expect(result.matchedKeywords.length).toBeGreaterThan(1);
      });
    });

    describe("selection context boost", () => {
      it("boosts confidence for explain with node selection", () => {
        const withoutSelection = inferIntent("Why is this here?");
        const withSelection = inferIntent("Why is this here?", { node_id: "n1" });

        expect(withSelection.confidence).toBeGreaterThan(withoutSelection.confidence);
      });

      it("boosts confidence for repair with edge selection", () => {
        const withoutSelection = inferIntent("This seems wrong");
        const withSelection = inferIntent("This seems wrong", { edge_id: "e1" });

        expect(withSelection.confidence).toBeGreaterThan(withoutSelection.confidence);
      });

      it("does not boost confidence for other intents", () => {
        const withoutSelection = inferIntent("What are alternatives?");
        const withSelection = inferIntent("What are alternatives?", { node_id: "n1" });

        // ideate doesn't get boosted
        expect(withSelection.confidence).toBe(withoutSelection.confidence);
      });
    });

    describe("case insensitivity", () => {
      it("matches keywords regardless of case", () => {
        expect(inferIntent("WHY is this here?").intent).toBe("explain");
        expect(inferIntent("FIX this").intent).toBe("repair");
        expect(inferIntent("COMPARE these").intent).toBe("compare");
      });
    });
  });

  describe("isP0Intent", () => {
    it("returns true for explain", () => {
      expect(isP0Intent("explain")).toBe(true);
    });

    it("returns true for clarify", () => {
      expect(isP0Intent("clarify")).toBe(true);
    });

    it("returns true for repair", () => {
      expect(isP0Intent("repair")).toBe(true);
    });

    it("returns false for ideate", () => {
      expect(isP0Intent("ideate")).toBe(false);
    });

    it("returns false for compare", () => {
      expect(isP0Intent("compare")).toBe(false);
    });

    it("returns false for challenge", () => {
      expect(isP0Intent("challenge")).toBe(false);
    });
  });

  describe("getIntentDescription", () => {
    it("returns description for explain", () => {
      const desc = getIntentDescription("explain");
      expect(desc).toContain("explain");
    });

    it("returns description for repair", () => {
      const desc = getIntentDescription("repair");
      expect(desc).toContain("fix");
    });

    it("returns description for ideate", () => {
      const desc = getIntentDescription("ideate");
      expect(desc).toContain("alternatives");
    });

    it("returns description for compare", () => {
      const desc = getIntentDescription("compare");
      expect(desc).toContain("compare");
    });

    it("returns description for challenge", () => {
      const desc = getIntentDescription("challenge");
      expect(desc).toContain("challenge");
    });

    it("returns description for clarify", () => {
      const desc = getIntentDescription("clarify");
      expect(desc).toContain("context");
    });

    it("returns generic description for unknown intent", () => {
      const desc = getIntentDescription("unknown" as any);
      expect(desc).toBe("process your request");
    });
  });
});
