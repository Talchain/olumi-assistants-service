import { describe, it, expect } from "vitest";
import { classifyProgress } from "../../../../src/orchestrator/pipeline/phase5-validation/progress-classifier.js";
import type { ToolResult } from "../../../../src/orchestrator/pipeline/types.js";

function makeToolResult(overrides?: Partial<ToolResult["side_effects"]>): ToolResult {
  return {
    blocks: [],
    side_effects: {
      graph_updated: false,
      analysis_ran: false,
      brief_generated: false,
      ...overrides,
    },
    assistant_text: null,
  };
}

describe("progress-classifier", () => {
  it("returns 'changed_model' when graph_updated is true", () => {
    expect(classifyProgress(makeToolResult({ graph_updated: true }))).toBe("changed_model");
  });

  it("returns 'ran_analysis' when analysis_ran is true", () => {
    expect(classifyProgress(makeToolResult({ analysis_ran: true }))).toBe("ran_analysis");
  });

  it("returns 'committed' when brief_generated is true", () => {
    expect(classifyProgress(makeToolResult({ brief_generated: true }))).toBe("committed");
  });

  it("returns 'none' when no side effects are true", () => {
    expect(classifyProgress(makeToolResult())).toBe("none");
  });

  it("prioritises graph_updated over analysis_ran", () => {
    expect(classifyProgress(makeToolResult({ graph_updated: true, analysis_ran: true }))).toBe("changed_model");
  });

  it("prioritises analysis_ran over brief_generated", () => {
    expect(classifyProgress(makeToolResult({ analysis_ran: true, brief_generated: true }))).toBe("ran_analysis");
  });
});
