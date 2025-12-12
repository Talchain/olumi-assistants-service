import { describe, it, expect } from "vitest";
import {
  generateKeyInsight,
  validateKeyInsightInput,
  type RankedAction,
  type Driver,
  type KeyInsightInput,
  type GoalInfo,
  type Identifiability,
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

        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("hiring staff");
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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

        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("expanding now");
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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

        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("implementing software");
        expect(result.headline.toLowerCase()).toMatch(/stronger option|best supports/i);
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
        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("implementing time-tracking software");
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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
        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("hiring more staff");
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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
        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toContain("implementing software");
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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
        // Headline now includes goal context when goal is present
        expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
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

      // Clean headline - now includes goal context when present
      expect(result.headline.toLowerCase()).toContain("implementing time-tracking software");
      expect(result.headline.toLowerCase()).toMatch(/stronger option|best supports/i);
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

      // Headline now includes goal context when present
      expect(result.headline.toLowerCase()).toContain("expanding to eu markets");
      expect(result.headline.toLowerCase()).toMatch(/clear best (choice|path)/i);
      expect(result.primary_driver.toLowerCase()).toContain("market size");
      expect(result.primary_driver).toContain("55%");
    });
  });

  describe("goal-anchored headlines", () => {
    describe("binary goal type", () => {
      it("generates 'To [goal], proceed with...' for positive outcomes", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Increase price", expected_utility: 0.85, outcome_quality: "positive" },
          { node_id: "o2", label: "Keep price", expected_utility: 0.60 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "reach profitability",
          goal_type: "binary",
        });

        expect(result.headline).toMatch(/to reach profitability, proceed with/i);
        expect(result.headline).toContain("Increasing price");
      });

      it("generates 'gives you the best chance' for negative outcomes (winner only)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Reduce costs", expected_utility: 0.55, outcome_quality: "negative" },
          { node_id: "o2", label: "Maintain spending", expected_utility: 0.40 }, // Not marked negative
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "survive the downturn",
          goal_type: "binary",
        });

        expect(result.headline).toContain("gives you the best chance of");
        expect(result.headline).toContain("survive the downturn");
      });
    });

    describe("continuous goal type", () => {
      it("generates 'best path to [goal]' for positive outcomes with clear margin", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Increase price to £59", expected_utility: 0.75, outcome_quality: "positive" },
          { node_id: "o2", label: "Keep price at £49", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "Reach £20k MRR in 12 months",
          goal_type: "continuous",
        });

        expect(result.headline).toContain("best path to");
        expect(result.headline.toLowerCase()).toContain("reach £20k mrr in 12 months");
        expect(result.headline).toContain("% better than alternatives");
      });

      it("generates 'minimises risk' for negative outcomes (not all negative)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Scale back operations", expected_utility: 0.45, outcome_quality: "negative" },
          { node_id: "o2", label: "Maintain current scale", expected_utility: 0.30 }, // Not marked negative
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "achieving positive cash flow",
          goal_type: "continuous",
        });

        expect(result.headline).toContain("minimises risk to achieving");
        expect(result.headline).toContain("achieving positive cash flow");
      });
    });

    describe("compound goal type", () => {
      it("generates 'best balances' for multiple goals", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Hybrid approach", expected_utility: 0.70 },
          { node_id: "o2", label: "Full automation", expected_utility: 0.55 },
        ];
        const goals: GoalInfo[] = [
          { id: "g1", text: "reduce costs", type: "compound", is_primary: true },
          { id: "g2", text: "maintain quality", type: "compound", is_primary: false },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "reduce costs",
          goal_type: "compound",
          goals,
        });

        expect(result.headline).toContain("best balances");
        expect(result.headline.toLowerCase()).toContain("reduce costs");
        expect(result.headline.toLowerCase()).toContain("maintain quality");
      });
    });

    describe("close race scenarios", () => {
      it("acknowledges similar paths when margin < 5%", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.52 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "maximize revenue",
          goal_type: "continuous",
        });

        expect(result.headline).toContain("similar paths to");
        expect(result.headline).toContain("consider other factors");
      });
    });

    describe("edge cases", () => {
      it("falls back to generic headlines when no goal provided", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.85 },
          { node_id: "o2", label: "Option B", expected_utility: 0.60 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          // No goal_text provided
        });

        expect(result.headline).not.toContain("path to");
        expect(result.headline.toLowerCase()).toContain("option a");
        expect(result.headline.toLowerCase()).toMatch(/clear best choice/i);
      });

      it("handles long goal text by truncating", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Strategy A", expected_utility: 0.80, outcome_quality: "positive" },
          { node_id: "o2", label: "Strategy B", expected_utility: 0.55 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "achieve sustainable growth while maintaining profitability and ensuring customer satisfaction across all market segments",
          goal_type: "continuous",
        });

        // Goal text should be truncated with ellipsis
        expect(result.headline).toContain("…");
        expect(result.headline.length).toBeLessThan(200);
      });

      it("handles all negative outcomes with appropriate messaging", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Cut costs", expected_utility: 0.35, outcome_quality: "negative" },
          { node_id: "o2", label: "Reduce staff", expected_utility: 0.25, outcome_quality: "negative" },
          { node_id: "o3", label: "Close division", expected_utility: 0.20, outcome_quality: "negative" },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "profitability",
          goal_type: "continuous",
        });

        expect(result.headline).toContain("All options carry risk");
        expect(result.headline).toContain("minimises potential downside");
      });

      it("handles baseline option as winner", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Do nothing", expected_utility: 0.75 },
          { node_id: "o2", label: "Expand aggressively", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "stability",
          goal_type: "continuous",
        });

        expect(result.headline).toContain("safest path to");
        expect(result.headline.toLowerCase()).not.toContain("do nothing");
        expect(result.headline.toLowerCase()).toContain("maintaining current state");
      });

      it("uses primary_goal_id to select from multiple goals", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.80 },
          { node_id: "o2", label: "Option B", expected_utility: 0.60 },
        ];
        const goals: GoalInfo[] = [
          { id: "g1", text: "increase revenue", type: "continuous", is_primary: false },
          { id: "g2", text: "reduce costs", type: "continuous", is_primary: false },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goals,
          primary_goal_id: "g2",
        });

        expect(result.headline.toLowerCase()).toContain("reduce costs");
      });
    });
  });

  describe("headline_structured output", () => {
    it("includes structured data in response", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.75, outcome_quality: "positive" },
        { node_id: "o2", label: "Do nothing", expected_utility: 0.50 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        goal_text: "grow revenue",
        goal_type: "continuous",
      });

      expect(result.headline_structured).toBeDefined();
      expect(result.headline_structured!.goal_text).toBe("grow revenue");
      expect(result.headline_structured!.action.toLowerCase()).toContain("option a");
      expect(result.headline_structured!.outcome_type).toBe("positive");
      expect(result.headline_structured!.likelihood).toBe(0.75);
      expect(result.headline_structured!.ranking_confidence).toBe("high");
      expect(result.headline_structured!.is_close_race).toBe(false);
    });

    it("includes vs_baseline delta when baseline exists", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "New strategy", expected_utility: 0.80 },
        { node_id: "o2", label: "Status quo", expected_utility: 0.55 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        goal_text: "growth",
        goal_type: "continuous",
      });

      expect(result.headline_structured).toBeDefined();
      expect(result.headline_structured!.vs_baseline).toBe(0.25);
      expect(result.headline_structured!.vs_baseline_direction).toBe("better");
    });

    it("has null goal_text when no goal provided", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.75 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
      });

      expect(result.headline_structured).toBeDefined();
      expect(result.headline_structured!.goal_text).toBeNull();
    });

    it("marks close race correctly", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.52 },
        { node_id: "o2", label: "Option B", expected_utility: 0.50 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
      });

      expect(result.headline_structured!.is_close_race).toBe(true);
    });
  });

  describe("evidence and next_steps output", () => {
    it("generates evidence points", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.85, outcome_quality: "positive" },
        { node_id: "o2", label: "Option B", expected_utility: 0.60 },
      ];
      const drivers: Driver[] = [
        { node_id: "d1", label: "Market demand", impact_pct: 45 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        top_drivers: drivers,
        goal_text: "growth",
        goal_type: "continuous",
      });

      expect(result.evidence).toBeDefined();
      expect(result.evidence!.length).toBeGreaterThan(0);
      expect(result.evidence!.some(e => e.includes("85%"))).toBe(true);
      expect(result.evidence!.some(e => e.includes("Market demand"))).toBe(true);
    });

    it("generates next steps", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        { node_id: "o2", label: "Option B", expected_utility: 0.60 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
        goal_text: "revenue growth",
        goal_type: "continuous",
      });

      expect(result.next_steps).toBeDefined();
      expect(result.next_steps!.length).toBeLessThanOrEqual(3);
      expect(result.next_steps!.some(s => s.includes("stakeholders"))).toBe(true);
    });

    it("suggests sensitivity analysis for close races", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.52 },
        { node_id: "o2", label: "Option B", expected_utility: 0.50 },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
      });

      expect(result.next_steps).toBeDefined();
      expect(result.next_steps!.some(s => s.toLowerCase().includes("sensitivity"))).toBe(true);
    });

    it("suggests contingency plans for negative outcomes", () => {
      const rankedActions: RankedAction[] = [
        { node_id: "o1", label: "Option A", expected_utility: 0.45, outcome_quality: "negative" },
        { node_id: "o2", label: "Option B", expected_utility: 0.30, outcome_quality: "negative" },
      ];

      const result = generateKeyInsight({
        graph: minimalGraph as any,
        ranked_actions: rankedActions,
      });

      expect(result.next_steps).toBeDefined();
      expect(result.next_steps!.some(s => s.toLowerCase().includes("contingency"))).toBe(true);
    });
  });

  describe("identifiability-aware narratives", () => {
    describe("recommendation_status field", () => {
      it("returns 'actionable' when identifiable (default)", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          // No identifiability provided - defaults to identifiable=true
        });

        expect(result.recommendation_status).toBe("actionable");
      });

      it("returns 'actionable' when explicitly identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: true,
            method: "backdoor",
          },
        });

        expect(result.recommendation_status).toBe("actionable");
      });

      it("returns 'exploratory' when non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.recommendation_status).toBe("exploratory");
      });
    });

    describe("identifiability_note field", () => {
      it("includes method note when identifiable with method", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: true,
            method: "backdoor",
          },
        });

        expect(result.identifiability_note).toBeDefined();
        expect(result.identifiability_note).toContain("backdoor");
      });

      it("returns undefined when identifiable without method", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          // No identifiability provided
        });

        expect(result.identifiability_note).toBeUndefined();
      });

      it("uses custom explanation when non-identifiable with explanation", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
            explanation: "Unmeasured confounder between X and Y prevents causal identification.",
          },
        });

        expect(result.identifiability_note).toBe("Unmeasured confounder between X and Y prevents causal identification.");
      });

      it("provides default explanation when non-identifiable without explanation", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.identifiability_note).toContain("not definitively established");
      });
    });

    describe("non-identifiable headlines", () => {
      it("uses exploratory language for non-identifiable cases", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.80 },
          { node_id: "o2", label: "Option B", expected_utility: 0.55 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.headline).toContain("appears most promising");
        expect(result.headline).toContain("causal effect cannot be confirmed");
      });

      it("uses exploratory language with goal context", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.80 },
          { node_id: "o2", label: "Option B", expected_utility: 0.55 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "increase revenue",
          goal_type: "continuous",
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.headline).toContain("appears most promising for");
        expect(result.headline.toLowerCase()).toContain("increase revenue");
        expect(result.headline).toContain("causal effect cannot be confirmed");
      });

      it("generates strong caution for close race + non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.52 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "growth",
          goal_type: "continuous",
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.headline).toContain("similar potential");
        expect(result.headline).toContain("causal effects remain unconfirmed");
      });
    });

    describe("non-identifiable confidence statement", () => {
      it("recommends scenario analysis for non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.80 },
          { node_id: "o2", label: "Option B", expected_utility: 0.55 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.confidence_statement).toContain("scenario analysis");
      });

      it("mentions close ranking for close race + non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.52 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.confidence_statement).toContain("ranking is close");
        expect(result.confidence_statement).toContain("causal effects are not confirmed");
      });
    });

    describe("evidence adjustment for non-identifiable", () => {
      it("acknowledges causal limitation in evidence", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.evidence).toBeDefined();
        expect(result.evidence!.some(e => e.includes("Causal effects could not be confirmed"))).toBe(true);
      });

      it("includes custom explanation in evidence", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
            explanation: "Missing data on confounders.",
          },
        });

        expect(result.evidence).toBeDefined();
        expect(result.evidence!.some(e => e.includes("Missing data on confounders"))).toBe(true);
      });

      it("suggests remediation in evidence", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.evidence).toBeDefined();
        expect(result.evidence!.some(e => e.includes("gathering additional data"))).toBe(true);
      });

      it("uses scenario language for utility in non-identifiable evidence", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.85, outcome_quality: "positive" },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.evidence).toBeDefined();
        expect(result.evidence!.some(e => e.includes("Scenario analysis shows"))).toBe(true);
      });

      it("uses correlation language for drivers in non-identifiable evidence", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];
        const drivers: Driver[] = [
          { node_id: "d1", label: "Market size", impact_pct: 45 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          top_drivers: drivers,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.evidence).toBeDefined();
        expect(result.evidence!.some(e => e.includes("correlation, not confirmed causation"))).toBe(true);
      });
    });

    describe("next steps adjustment for non-identifiable", () => {
      it("prioritizes data gathering for non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.next_steps).toBeDefined();
        expect(result.next_steps!.some(s => s.includes("Gather additional data"))).toBe(true);
      });

      it("suggests pilot/experiment for non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.next_steps).toBeDefined();
        expect(result.next_steps!.some(s => s.toLowerCase().includes("pilot") || s.toLowerCase().includes("experiment"))).toBe(true);
      });

      it("suggests model review for non-identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.next_steps).toBeDefined();
        expect(result.next_steps!.some(s => s.includes("model structure") || s.includes("confounders"))).toBe(true);
      });

      it("allows up to 4 next steps for non-identifiable cases", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.52 },
          { node_id: "o2", label: "Option B", expected_utility: 0.50 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "revenue",
          goal_type: "continuous",
          identifiability: {
            identifiable: false,
          },
        });

        expect(result.next_steps).toBeDefined();
        expect(result.next_steps!.length).toBeLessThanOrEqual(4);
      });
    });

    describe("identifiable cases with method", () => {
      it("uses confident causal language when identifiable", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.80 },
          { node_id: "o2", label: "Option B", expected_utility: 0.55 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          goal_text: "growth",
          goal_type: "continuous",
          identifiability: {
            identifiable: true,
            method: "backdoor",
            adjustment_set: ["age", "income"],
          },
        });

        // Should use standard confident language (not exploratory)
        expect(result.headline).not.toContain("appears most promising");
        expect(result.headline).not.toContain("cannot be confirmed");
        expect(result.headline).toContain("best path to");
      });

      it("notes method used in identifiability_note", () => {
        const rankedActions: RankedAction[] = [
          { node_id: "o1", label: "Option A", expected_utility: 0.75 },
        ];

        const result = generateKeyInsight({
          graph: minimalGraph as any,
          ranked_actions: rankedActions,
          identifiability: {
            identifiable: true,
            method: "frontdoor",
          },
        });

        expect(result.identifiability_note).toContain("frontdoor criterion");
      });
    });
  });
});
