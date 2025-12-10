import { describe, it, expect } from "vitest";
import {
  generateKeyInsight,
  validateKeyInsightInput,
  type RankedAction,
  type Driver,
  type KeyInsightInput,
} from "../../src/cee/key-insight/index.js";

describe("CEE Key Insight Generator", () => {
  const minimalGraph = {
    version: "1.0",
    nodes: [
      { id: "g1", kind: "goal", label: "Make decision" },
      { id: "d1", kind: "decision", label: "Choose option" },
      { id: "o1", kind: "option", label: "Option A" },
      { id: "o2", kind: "option", label: "Option B" },
    ],
    edges: [
      { from: "g1", to: "d1" },
      { from: "d1", to: "o1" },
      { from: "d1", to: "o2" },
    ],
  };

  describe("generateKeyInsight", () => {
    describe("headline generation", () => {
      it("generates clear winner headline when dominant", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Hire staff", expected_utility: 0.9, dominant: true },
          { node_id: "o2", label: "Use contractors", expected_utility: 0.4 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).toBe("Hiring staff is the clear best choice");
      });

      it("generates clear winner headline when margin is large (>20%)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Expand now", expected_utility: 0.85 },
          { node_id: "o2", label: "Wait and see", expected_utility: 0.60 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).toBe("Expanding now is the clear best choice");
      });

      it("generates stronger option headline when margin is significant (10-20%)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Implement software", expected_utility: 0.75 },
          { node_id: "o2", label: "Manual process", expected_utility: 0.60 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).toBe("Implementing software is the stronger option");
      });

      it("generates close call headline when margin is small (<5%)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A?", expected_utility: 0.72 },
          { node_id: "o2", label: "Option B", expected_utility: 0.70 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).toContain("edges ahead");
      });
    });

    describe("label sanitisation in output", () => {
      it("removes question marks from option labels in headline", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Implement time-tracking software?", expected_utility: 0.9, dominant: true },
          { node_id: "o2", label: "Keep manual tracking?", expected_utility: 0.3 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).not.toContain("?");
        expect(result.headline).toBe("Implementing time-tracking software is the clear best choice");
      });

      it("removes question prefixes from labels", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Should we hire more staff?", expected_utility: 0.85, dominant: true },
          { node_id: "o2", label: "Do we use contractors?", expected_utility: 0.3 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).not.toContain("Should we");
        expect(result.headline).not.toContain("?");
        expect(result.headline).toBe("Hiring more staff is the clear best choice");
      });

      it("removes 'Yes,' prefix from labels", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Yes, implement software", expected_utility: 0.9, dominant: true },
          { node_id: "o2", label: "No, skip it", expected_utility: 0.2 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).not.toContain("Yes,");
        expect(result.headline).toBe("Implementing software is the clear best choice");
      });
    });

    describe("driver statement generation", () => {
      it("generates statement with high impact percentage", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ];
        const drivers: Driver[] = [
          { node_id: "d1", label: "Revenue impact", impact_pct: 60 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          top_drivers: drivers,
        });

        expect(result.primary_driver.toLowerCase()).toContain("revenue impact");
        expect(result.primary_driver).toContain("60%");
        expect(result.primary_driver.toLowerCase()).toContain("dominant factor");
      });

      it("generates statement with medium impact percentage", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ];
        const drivers: Driver[] = [
          { node_id: "d1", label: "Cost savings", impact_pct: 35 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          top_drivers: drivers,
        });

        expect(result.primary_driver.toLowerCase()).toContain("cost savings");
        expect(result.primary_driver).toContain("35%");
        expect(result.primary_driver.toLowerCase()).toContain("primary differentiator");
      });

      it("handles drivers without impact percentage", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ];
        const drivers: Driver[] = [
          { node_id: "d1", label: "Market conditions", direction: "positive" },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          top_drivers: drivers,
        });

        expect(result.primary_driver.toLowerCase()).toContain("market conditions");
        expect(result.primary_driver.toLowerCase()).toContain("favouring");
      });

      it("handles negative direction drivers", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ];
        const drivers: Driver[] = [
          { node_id: "d1", label: "Implementation risk", direction: "negative" },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          top_drivers: drivers,
        });

        expect(result.primary_driver.toLowerCase()).toContain("implementation risk");
        expect(result.primary_driver.toLowerCase()).toContain("risk being mitigated");
      });

      it("generates fallback when no drivers provided", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.primary_driver).toContain("Further analysis");
      });
    });

    describe("confidence statement generation", () => {
      it("generates high confidence statement", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.85 },
          { node_id: "o2", label: "Option B", expected_utility: 0.65 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.confidence_statement).toContain("high confidence");
      });

      it("generates close alternatives confidence statement", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.82 },
          { node_id: "o2", label: "Option B", expected_utility: 0.80 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.confidence_statement).toContain("alternatives are close");
      });

      it("generates moderate confidence statement", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.55 },
          { node_id: "o2", label: "Option B", expected_utility: 0.40 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.confidence_statement).toContain("moderate confidence");
      });

      it("generates low confidence statement", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.30 },
          { node_id: "o2", label: "Option B", expected_utility: 0.20 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.confidence_statement).toContain("lower confidence");
      });
    });

    describe("caveat generation", () => {
      it("generates caveat for very close decisions", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.71 },
          { node_id: "o2", label: "Option B", expected_utility: 0.70 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.caveat).toBeDefined();
        expect(result.caveat!.toLowerCase()).toContain("option b");
      });

      it("does not generate caveat for clear decisions", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.90 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.caveat).toBeUndefined();
      });
    });

    describe("edge cases", () => {
      it("handles single ranked action", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Only Option", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline.toLowerCase()).toContain("only option");
        expect(result.headline.toLowerCase()).toContain("clear best choice");
      });

      it("handles empty ranked actions", () => {
        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: [],
        });

        expect(result.headline).toBe("Unable to generate recommendation");
        expect(result.primary_driver).toContain("No ranked actions");
      });

      it("handles equal utility options", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.5 },
          { node_id: "o2", label: "Option B", expected_utility: 0.5 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
        });

        expect(result.headline).toBeDefined();
        expect(result.caveat).toBeDefined();
      });
    });
  });

  describe("validateKeyInsightInput", () => {
    it("validates correct input", () => {
      const input: KeyInsightInput = {
        graph: minimalGraph as any,
        ranked_actions: [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ],
      };

      expect(validateKeyInsightInput(input)).toBe(true);
    });

    it("rejects null input", () => {
      expect(validateKeyInsightInput(null)).toBe(false);
    });

    it("rejects input without graph", () => {
      expect(
        validateKeyInsightInput({
          ranked_actions: [{ node_id: "o1", label: "A", expected_utility: 0.5 }],
        })
      ).toBe(false);
    });

    it("rejects input without ranked_actions", () => {
      expect(
        validateKeyInsightInput({
          graph: minimalGraph,
        })
      ).toBe(false);
    });

    it("rejects ranked_actions without required fields", () => {
      expect(
        validateKeyInsightInput({
          graph: minimalGraph,
          ranked_actions: [{ node_id: "o1" }],
        })
      ).toBe(false);
    });

    it("accepts input with optional top_drivers", () => {
      const input = {
        graph: minimalGraph,
        ranked_actions: [
          { node_id: "o1", label: "Option A", expected_utility: 0.8 },
        ],
        top_drivers: [{ node_id: "d1", label: "Driver", impact_pct: 50 }],
      };

      expect(validateKeyInsightInput(input)).toBe(true);
    });
  });

  describe("integration: real-world scenarios", () => {
    it("produces clean output for 'time-tracking software' scenario", () => {
      const rankedActions: RankedAction[] = [
        {
          node_id: "o1",
          label: "Implement time-tracking software?",
          expected_utility: 0.78,
        },
        {
          node_id: "o2",
          label: "Yes, implement software",
          expected_utility: 0.65,
        },
      ];
      const drivers: Driver[] = [
        {
          node_id: "d1",
          label: "Productivity improvement",
          impact_pct: 45,
          direction: "positive",
        },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        top_drivers: drivers,
      });

      // No question marks anywhere
      expect(result.headline).not.toContain("?");
      expect(result.primary_driver).not.toContain("?");
      expect(result.confidence_statement).not.toContain("?");

      // No "Yes," prefix
      expect(result.headline).not.toContain("Yes,");

      // Clean headline
      expect(result.headline).toBe(
        "Implementing time-tracking software is the stronger option"
      );
    });

    it("produces clean output for EU expansion scenario", () => {
      const rankedActions: RankedAction[] = [
        {
          node_id: "o1",
          label: "Should we expand to EU markets?",
          expected_utility: 0.82,
          dominant: true,
        },
        {
          node_id: "o2",
          label: "Stay in current markets",
          expected_utility: 0.45,
        },
      ];
      const drivers: Driver[] = [
        {
          node_id: "d1",
          label: "Market size",
          impact_pct: 55,
          direction: "positive",
        },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        top_drivers: drivers,
      });

      expect(result.headline).toBe(
        "Expanding to eu markets is the clear best choice"
      );
      expect(result.primary_driver.toLowerCase()).toContain("market size");
      expect(result.primary_driver).toContain("55%");
    });
  });
});
