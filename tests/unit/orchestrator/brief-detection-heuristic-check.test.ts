/**
 * Task 6: Brief Detection Heuristic Investigation
 *
 * Run 10 messages through classifyIntentWithContext with CEE_BRIEF_DETECTION_ENABLED=true
 * and report whether the heuristic agrees with the expected classification.
 *
 * This is an investigation test — it documents findings, not hard pass/fail.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIntentWithContext,
  looksLikeDecisionBrief,
  classifyIntent,
} from "../../../src/orchestrator/intent-gate.js";

const NODE_LABELS = ['Budget', 'Revenue', 'Pricing', 'Team Size', 'Market Share'];

interface TestCase {
  message: string;
  expected: string;
  expectedTool: string | null;
}

const CASES: TestCase[] = [
  {
    message: "Should we raise prices on our SaaS product?",
    expected: "draft_graph",
    expectedTool: "draft_graph",
  },
  {
    message: "We need to decide between hiring and outsourcing. Budget 200k, 6 months.",
    expected: "draft_graph",
    expectedTool: "draft_graph",
  },
  {
    message: "What do you think about our pricing strategy?",
    expected: "NOT draft_graph",
    expectedTool: null,
  },
  {
    message: "Help me think through this acquisition",
    expected: "draft_graph (borderline)",
    expectedTool: null, // borderline — heuristic may or may not fire
  },
  {
    message: "Our revenue dropped 20% last quarter",
    expected: "NOT draft_graph",
    expectedTool: null,
  },
  {
    message: "Budget is 150k",
    expected: "edit_graph (parameter assignment)",
    expectedTool: "edit_graph",
  },
  {
    message: "Run the analysis",
    expected: "run_analysis",
    expectedTool: "run_analysis",
  },
  {
    message: "Walk me through the results",
    expected: "NOT a tool (INTERPRET)",
    expectedTool: null,
  },
  {
    message: "I have a decision to make",
    expected: "NOT draft_graph (too vague)",
    expectedTool: null,
  },
  {
    message: "Should we expand into the US market or stay focused on Europe?",
    expected: "draft_graph (borderline)",
    expectedTool: "draft_graph",
  },
];

describe("Task 6: Brief detection heuristic investigation", () => {
  it("reports findings for all 10 messages", () => {
    const findings: string[] = [];

    for (const c of CASES) {
      const exact = classifyIntent(c.message);
      const noGraph = classifyIntentWithContext(c.message, { hasGraph: false, graphNodeLabels: [] });
      const withGraph = classifyIntentWithContext(c.message, { hasGraph: true, graphNodeLabels: NODE_LABELS });
      const brief = looksLikeDecisionBrief(c.message);

      let heuristicResult: string;
      if (exact.tool) {
        heuristicResult = exact.tool;
      } else if (noGraph.tool) {
        heuristicResult = `${noGraph.tool} (brief_detection)`;
      } else if (withGraph.tool) {
        heuristicResult = `${withGraph.tool} (parameter_assignment)`;
      } else {
        heuristicResult = 'null (LLM)';
      }

      const agrees = (c.expectedTool === null && !exact.tool && !noGraph.tool && (c.expected.includes('edit_graph') ? withGraph.tool === 'edit_graph' : !withGraph.tool)) ||
                      (c.expectedTool === exact.tool) ||
                      (c.expectedTool === noGraph.tool) ||
                      (c.expectedTool === withGraph.tool && c.expected.includes('edit_graph'));

      findings.push(`${c.message} | Expected: ${c.expected} | Heuristic: ${heuristicResult} | Brief?: ${brief} | ${agrees ? 'AGREE' : 'DISAGREE'}`);
    }

    // Print findings for investigation
    console.log('\n=== Brief Detection Heuristic Findings ===\n');
    for (const f of findings) {
      console.log(f);
    }
    console.log('');

    // Assertions: must not crash, must return results for all 10
    expect(findings).toHaveLength(10);
  });

  // Individual assertions for clear expected outcomes
  it("'Should we raise prices on our SaaS product?' triggers brief detection", () => {
    const result = classifyIntentWithContext("Should we raise prices on our SaaS product?", { hasGraph: false });
    // "should we" matches DECISION_BRIEF_PATTERN, length > 30
    expect(result.tool).toBe("draft_graph");
    expect(result.matched_pattern).toBe("brief_detection");
  });

  it("'We need to decide between hiring and outsourcing. Budget 200k, 6 months.' — heuristic MISSES (finding)", () => {
    // FINDING: The heuristic pattern uses "deciding between" but the message says "decide between".
    // The DECISION_BRIEF_PATTERN should include "decide" alongside "deciding" — this is a known gap.
    // Sonnet 4.6 would correctly route this to draft_graph; the heuristic falls short here.
    // Recommendation: Add "decide (between|whether|on|if)" to DECISION_BRIEF_PATTERN.
    const result = classifyIntentWithContext(
      "We need to decide between hiring and outsourcing. Budget 200k, 6 months.",
      { hasGraph: false },
    );
    expect(result.tool).toBeNull(); // documents current behaviour — heuristic misses this
    expect(looksLikeDecisionBrief("We need to decide between hiring and outsourcing. Budget 200k, 6 months.")).toBe(false);
  });

  it("'What do you think about our pricing strategy?' does NOT trigger (question pattern)", () => {
    const result = classifyIntentWithContext("What do you think about our pricing strategy?", { hasGraph: false });
    expect(result.tool).toBeNull();
  });

  it("'Help me think through this acquisition' does NOT trigger (no decision signal)", () => {
    const result = classifyIntentWithContext("Help me think through this acquisition", { hasGraph: false });
    // No decision signal: "think through" doesn't match choosing/deciding/options/should we
    expect(result.tool).toBeNull();
  });

  it("'Our revenue dropped 20% last quarter' does NOT trigger (informational)", () => {
    const result = classifyIntentWithContext("Our revenue dropped 20% last quarter", { hasGraph: false });
    expect(result.tool).toBeNull();
  });

  it("'Budget is 150k' routes to edit_graph with graph context", () => {
    const result = classifyIntentWithContext("Budget is 150k", {
      hasGraph: true,
      graphNodeLabels: NODE_LABELS,
    });
    expect(result.tool).toBe("edit_graph");
    expect(result.matched_pattern).toBe("parameter_assignment");
  });

  it("'Run the analysis' routes to run_analysis (exact match)", () => {
    expect(classifyIntent("Run the analysis").tool).toBe("run_analysis");
  });

  it("'Walk me through the results' does NOT match any tool", () => {
    const result = classifyIntentWithContext("Walk me through the results", { hasGraph: false });
    expect(result.tool).toBeNull();
  });

  it("'I have a decision to make' does NOT trigger (too short/vague)", () => {
    const result = classifyIntentWithContext("I have a decision to make", { hasGraph: false });
    expect(result.tool).toBeNull();
  });

  it("'Should we expand into the US market or stay focused on Europe?' triggers brief detection", () => {
    const result = classifyIntentWithContext(
      "Should we expand into the US market or stay focused on Europe?",
      { hasGraph: false },
    );
    // "should we" matches, length > 30
    expect(result.tool).toBe("draft_graph");
    expect(result.matched_pattern).toBe("brief_detection");
  });
});
