import { describe, it, expect } from "vitest";
import {
  sanitiseLabel,
  labelForSentence,
  labelToNoun,
  labelForComparison,
  labelForDisplay,
} from "../../src/utils/label-sanitiser.js";

describe("Label Sanitiser", () => {
  describe("sanitiseLabel", () => {
    describe("basic cleaning", () => {
      it("removes trailing question marks", () => {
        expect(sanitiseLabel("Implement software?")).toBe("implement software");
        expect(sanitiseLabel("Hire more staff???")).toBe("hire more staff");
      });

      it("removes trailing exclamation marks", () => {
        expect(sanitiseLabel("Do it now!")).toBe("do it now");
        expect(sanitiseLabel("Act fast!!!")).toBe("act fast");
      });

      it("removes trailing periods", () => {
        expect(sanitiseLabel("Expand to EU.")).toBe("expand to eu");
        expect(sanitiseLabel("Launch product...")).toBe("launch product");
      });

      it("converts to lowercase", () => {
        expect(sanitiseLabel("IMPLEMENT SOFTWARE")).toBe("implement software");
        expect(sanitiseLabel("Hire Staff")).toBe("hire staff");
      });

      it("normalises whitespace", () => {
        expect(sanitiseLabel("  implement   software  ")).toBe("implement software");
        expect(sanitiseLabel("hire\t\tstaff")).toBe("hire staff");
      });

      it("handles empty and null input", () => {
        expect(sanitiseLabel("")).toBe("");
        expect(sanitiseLabel(null as any)).toBe("");
        expect(sanitiseLabel(undefined as any)).toBe("");
      });
    });

    describe("question prefix removal", () => {
      it("removes 'Should we' prefix", () => {
        expect(sanitiseLabel("Should we hire more staff?")).toBe("hire more staff");
        expect(sanitiseLabel("should we expand")).toBe("expand");
      });

      it("removes 'Do we' prefix", () => {
        expect(sanitiseLabel("Do we need this?")).toBe("need this");
        expect(sanitiseLabel("do we want it")).toBe("want it");
      });

      it("removes 'Can we' prefix", () => {
        expect(sanitiseLabel("Can we afford it?")).toBe("afford it");
      });

      it("removes 'Will we' prefix", () => {
        expect(sanitiseLabel("Will we succeed?")).toBe("succeed");
      });

      it("removes 'Would we' prefix", () => {
        expect(sanitiseLabel("Would we benefit?")).toBe("benefit");
      });

      it("removes 'Could we' prefix", () => {
        expect(sanitiseLabel("Could we improve?")).toBe("improve");
      });

      it("removes 'Shall we' prefix", () => {
        expect(sanitiseLabel("Shall we proceed?")).toBe("proceed");
      });

      it("removes 'Are we' prefix", () => {
        expect(sanitiseLabel("Are we ready?")).toBe("ready");
      });

      it("removes 'Is it' prefix", () => {
        expect(sanitiseLabel("Is it worth it?")).toBe("worth it");
      });

      it("removes 'Is there' prefix", () => {
        expect(sanitiseLabel("Is there a market?")).toBe("a market");
      });

      it("removes 'Does it' prefix", () => {
        expect(sanitiseLabel("Does it make sense?")).toBe("make sense");
      });

      it("removes 'What if we' prefix", () => {
        expect(sanitiseLabel("What if we tried something new?")).toBe("tried something new");
      });

      it("removes 'How about' prefix", () => {
        expect(sanitiseLabel("How about a different approach?")).toBe("a different approach");
      });

      it("removes 'Why not' prefix", () => {
        expect(sanitiseLabel("Why not do it now?")).toBe("do it now");
      });
    });

    describe("response prefix removal", () => {
      it("removes 'Yes,' prefix", () => {
        expect(sanitiseLabel("Yes, implement software")).toBe("implement software");
        expect(sanitiseLabel("yes implement it")).toBe("implement it");
      });

      it("removes 'No,' prefix", () => {
        expect(sanitiseLabel("No, don't do it")).toBe("don't do it");
        expect(sanitiseLabel("no skip it")).toBe("skip it");
      });

      it("removes 'Maybe,' prefix", () => {
        expect(sanitiseLabel("Maybe, consider alternatives")).toBe("consider alternatives");
      });
    });

    describe("real-world examples", () => {
      it("handles the problematic 'Implement time-tracking software?' case", () => {
        expect(sanitiseLabel("Implement time-tracking software?")).toBe(
          "implement time-tracking software"
        );
      });

      it("handles 'Yes, implement software' case", () => {
        expect(sanitiseLabel("Yes, implement software")).toBe("implement software");
      });

      it("handles complex question labels", () => {
        expect(sanitiseLabel("Should we expand into the European market?")).toBe(
          "expand into the european market"
        );
      });

      it("handles labels with hyphens and special characters", () => {
        expect(sanitiseLabel("Implement AI-powered analytics?")).toBe(
          "implement ai-powered analytics"
        );
      });

      it("handles multi-word options", () => {
        expect(sanitiseLabel("Hire 3 senior engineers by Q2")).toBe(
          "hire 3 senior engineers by q2"
        );
      });
    });
  });

  describe("labelForSentence", () => {
    describe("subject position (sentence start)", () => {
      it("capitalises first letter for subject position", () => {
        expect(labelForSentence("hire staff?", "subject")).toBe("Hiring staff");
        expect(labelForSentence("implement software", "subject")).toBe(
          "Implementing software"
        );
      });

      it("converts to gerund form", () => {
        expect(labelForSentence("expand to EU?", "subject")).toBe("Expanding to eu");
        expect(labelForSentence("reduce costs", "subject")).toBe("Reducing costs");
      });
    });

    describe("object position (mid-sentence)", () => {
      it("keeps lowercase for object position", () => {
        expect(labelForSentence("hire staff?", "object")).toBe("hiring staff");
        expect(labelForSentence("implement software", "object")).toBe(
          "implementing software"
        );
      });
    });

    describe("gerund conversion", () => {
      it("handles silent 'e' rule", () => {
        // make → making, hire → hiring
        expect(labelForSentence("make changes", "object")).toBe("making changes");
        expect(labelForSentence("hire staff", "object")).toBe("hiring staff");
      });

      it("handles 'ie' to 'ying' rule", () => {
        // die → dying, lie → lying
        expect(labelForSentence("die trying", "object")).toBe("dying trying");
      });

      it("handles already-gerund labels", () => {
        expect(labelForSentence("running tests", "object")).toBe("running tests");
        expect(labelForSentence("implementing features", "object")).toBe(
          "implementing features"
        );
      });

      it("handles common consonant-doubling verbs", () => {
        // run → running, stop → stopping, plan → planning
        expect(labelForSentence("run tests", "object")).toBe("running tests");
        expect(labelForSentence("stop production", "object")).toBe("stopping production");
        expect(labelForSentence("plan strategy", "object")).toBe("planning strategy");
      });

      it("does not double w, x, y endings", () => {
        expect(labelForSentence("show results", "object")).toBe("showing results");
        expect(labelForSentence("fix bugs", "object")).toBe("fixing bugs");
        expect(labelForSentence("play games", "object")).toBe("playing games");
      });
    });

    describe("edge cases", () => {
      it("handles empty input", () => {
        expect(labelForSentence("", "subject")).toBe("");
        expect(labelForSentence("", "object")).toBe("");
      });

      it("handles single word labels", () => {
        expect(labelForSentence("expand?", "subject")).toBe("Expanding");
        expect(labelForSentence("hire", "object")).toBe("hiring");
      });
    });
  });

  describe("labelToNoun", () => {
    it("converts imperative to gerund (noun form)", () => {
      expect(labelToNoun("implement software")).toBe("implementing software");
      expect(labelToNoun("hire staff")).toBe("hiring staff");
      expect(labelToNoun("expand operations")).toBe("expanding operations");
    });

    it("preserves already-gerund labels", () => {
      expect(labelToNoun("implementing software")).toBe("implementing software");
      expect(labelToNoun("hiring staff")).toBe("hiring staff");
    });

    it("handles question marks", () => {
      expect(labelToNoun("Implement software?")).toBe("implementing software");
    });

    it("handles empty input", () => {
      expect(labelToNoun("")).toBe("");
    });
  });

  describe("labelForComparison", () => {
    it("returns sanitised form suitable for comparisons (no gerund)", () => {
      expect(labelForComparison("Implement software?")).toBe("implement software");
      expect(labelForComparison("Option B")).toBe("option b");
    });

    it("produces consistent output for comparison prose", () => {
      const optionA = labelForComparison("Should we hire more staff?");
      const optionB = labelForComparison("Expand to new markets?");

      // Both should be suitable for "X vs Y" comparisons (sanitised, not gerund)
      expect(optionA).toBe("hire more staff");
      expect(optionB).toBe("expand to new markets");
    });
  });

  describe("labelForDisplay", () => {
    it("capitalises first letter for standalone display", () => {
      expect(labelForDisplay("implement time-tracking software")).toBe(
        "Implement time-tracking software"
      );
    });

    it("cleans the label first", () => {
      expect(labelForDisplay("Should we implement software?")).toBe("Implement software");
    });

    it("handles empty input", () => {
      expect(labelForDisplay("")).toBe("");
    });
  });

  describe("integration: no question marks in output", () => {
    const problematicLabels = [
      "Implement time-tracking software?",
      "Should we expand to EU?",
      "Do we need more staff?",
      "Can we afford this investment?",
      "Yes, implement software",
      "No, skip this option",
      "INCREASE PRICES???",
    ];

    it("never produces output containing question marks", () => {
      for (const label of problematicLabels) {
        expect(sanitiseLabel(label)).not.toContain("?");
        expect(labelForSentence(label, "subject")).not.toContain("?");
        expect(labelForSentence(label, "object")).not.toContain("?");
        expect(labelToNoun(label)).not.toContain("?");
        expect(labelForComparison(label)).not.toContain("?");
        expect(labelForDisplay(label)).not.toContain("?");
      }
    });

    it("never produces output starting with question prefixes", () => {
      for (const label of problematicLabels) {
        const result = sanitiseLabel(label);
        expect(result).not.toMatch(/^should\s+we\s+/i);
        expect(result).not.toMatch(/^do\s+we\s+/i);
        expect(result).not.toMatch(/^can\s+we\s+/i);
        expect(result).not.toMatch(/^yes,?\s+/i);
        expect(result).not.toMatch(/^no,?\s+/i);
      }
    });
  });

  describe("edge case: non-verb words preserved", () => {
    it("does not convert non-verb words to gerund", () => {
      expect(labelForSentence("only option", "subject")).toBe("Only option");
      expect(labelForSentence("the best choice", "subject")).toBe("The best choice");
      expect(labelForSentence("option a", "subject")).toBe("Option a");
      expect(labelForSentence("alternative approach", "subject")).toBe("Alternative approach");
    });
  });

  describe("edge case: gerund for unusual verbs", () => {
    it("handles verbs ending in double vowel + e", () => {
      // see → seeing (not seing), free → freeing
      expect(labelForSentence("see results", "object")).toBe("seeing results");
    });

    it("handles common business verbs", () => {
      expect(labelForSentence("invest in technology", "object")).toBe("investing in technology");
      expect(labelForSentence("launch product", "object")).toBe("launching product");
      expect(labelForSentence("scale operations", "object")).toBe("scaling operations");
      expect(labelForSentence("optimize process", "object")).toBe("optimizing process");
      expect(labelForSentence("build team", "object")).toBe("building team");
      expect(labelForSentence("cut costs", "object")).toBe("cutting costs");
      expect(labelForSentence("set targets", "object")).toBe("setting targets");
      expect(labelForSentence("get approval", "object")).toBe("getting approval");
    });
  });
});
