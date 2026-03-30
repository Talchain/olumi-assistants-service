import { describe, it, expect } from "vitest";
import { evaluateStageTransition } from "../../../../src/orchestrator/pipeline/phase5-validation/stage-transition.js";
import type { StageIndicator, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";

function makeStageIndicator(stage: string): StageIndicator {
  return {
    stage: stage as StageIndicator["stage"],
    confidence: "high",
    source: "inferred",
  };
}

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
    guidance_items: [],
  };
}

describe("stage-transition", () => {
  it("transitions frame → evaluate when analysis ran", () => {
    const result = evaluateStageTransition(
      makeStageIndicator("frame"),
      makeToolResult({ analysis_ran: true }),
    );
    expect(result).toEqual({
      from: "frame",
      to: "evaluate",
      trigger: "analysis_completed",
    });
  });

  it("transitions ideate → evaluate when analysis ran", () => {
    const result = evaluateStageTransition(
      makeStageIndicator("ideate"),
      makeToolResult({ analysis_ran: true }),
    );
    expect(result).toEqual({
      from: "ideate",
      to: "evaluate",
      trigger: "analysis_completed",
    });
  });

  it("does NOT transition evaluate → decide on brief_generated (requires explicit user commitment)", () => {
    const result = evaluateStageTransition(
      makeStageIndicator("evaluate"),
      makeToolResult({ brief_generated: true }),
    );
    expect(result).toBeNull();
  });

  it("returns null when no transition is appropriate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("frame"),
      makeToolResult({ graph_updated: true }),
    )).toBeNull();
  });

  it("returns null when analysis runs but already in evaluate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("evaluate"),
      makeToolResult({ analysis_ran: true }),
    )).toBeNull();
  });

  it("returns null when brief generated but not in evaluate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("frame"),
      makeToolResult({ brief_generated: true }),
    )).toBeNull();
  });

  it("returns null when no side effects", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("ideate"),
      makeToolResult(),
    )).toBeNull();
  });

  // ── Stage transition stability tests ──────────────────────────────────────

  it("generate_brief in ideate → stage stays ideate (no transition)", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("ideate"),
      makeToolResult({ brief_generated: true }),
    )).toBeNull();
  });

  it("explain_result in evaluate → stage stays evaluate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("evaluate"),
      makeToolResult(), // explain_result has no side_effects flags
    )).toBeNull();
  });

  it("compare_options in evaluate → stage stays evaluate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("evaluate"),
      makeToolResult(), // compare_options has no side_effects flags
    )).toBeNull();
  });

  it("graph_updated in evaluate → stage stays evaluate", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("evaluate"),
      makeToolResult({ graph_updated: true }),
    )).toBeNull();
  });

  it("brief_generated in decide → stage stays decide (no further promotion)", () => {
    expect(evaluateStageTransition(
      makeStageIndicator("decide"),
      makeToolResult({ brief_generated: true }),
    )).toBeNull();
  });
});
