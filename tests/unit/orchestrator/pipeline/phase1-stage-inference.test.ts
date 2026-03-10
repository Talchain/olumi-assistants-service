import { describe, it, expect } from "vitest";
import { inferStage } from "../../../../src/orchestrator/pipeline/phase1-enrichment/stage-inference.js";
import type { ConversationContext, SystemEvent } from "../../../../src/orchestrator/pipeline/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

describe("stage-inference", () => {
  it("returns 'frame' when no graph exists", () => {
    const result = inferStage(makeContext());
    expect(result.stage).toBe("frame");
    expect(result.confidence).toBe("high");
    expect(result.source).toBe("inferred");
  });

  it("returns 'ideate' when graph with nodes exists but no analysis", () => {
    const result = inferStage(
      makeContext({
        graph: {
          nodes: [{ id: "n1", kind: "decision", label: "Decision" }],
          edges: [],
        } as unknown as ConversationContext["graph"],
      }),
    );
    expect(result.stage).toBe("ideate");
    expect(result.confidence).toBe("high");
  });

  it("returns 'frame' when graph is structurally empty (no nodes) and no analysis", () => {
    const result = inferStage(
      makeContext({ graph: { nodes: [], edges: [] } as unknown as ConversationContext["graph"] }),
    );
    expect(result.stage).toBe("frame");
    expect(result.confidence).toBe("high");
    expect(result.source).toBe("inferred");
  });

  it("returns 'evaluate' with substate 'has_run' when analysis complete", () => {
    const result = inferStage(
      makeContext({
        graph: { nodes: [{ id: "n1", kind: "decision", label: "D" }], edges: [] } as unknown as ConversationContext["graph"],
        analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: "abc" }, results: [] } as unknown as ConversationContext["analysis_response"],
      }),
    );
    expect(result.stage).toBe("evaluate");
    expect(result.substate).toBe("has_run");
    expect(result.confidence).toBe("high");
  });

  it("returns 'evaluate' even when brief has been generated (decide is user-intent-led, never auto-derived)", () => {
    // Task 2: 'decide' must NOT be auto-derived from data. The user must explicitly
    // signal intent to decide. A generated brief keeps us in evaluate.
    const result = inferStage(
      makeContext({
        graph: { nodes: [{ id: "n1", kind: "decision", label: "D" }], edges: [] } as unknown as ConversationContext["graph"],
        analysis_response: {
          meta: { seed_used: 1, n_samples: 100, response_hash: "abc" },
          results: [],
          decision_brief: { title: "test brief" },
        } as unknown as ConversationContext["analysis_response"],
      }),
    );
    expect(result.stage).toBe("evaluate");
    expect(result.confidence).toBe("high");
  });

  it("returns 'frame' when graph has empty nodes even with analysis present", () => {
    // Task 2: empty-nodes graph is treated as no graph regardless of analysis
    const result = inferStage(
      makeContext({
        graph: { nodes: [], edges: [] } as unknown as ConversationContext["graph"],
        analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: "abc" }, results: [] } as unknown as ConversationContext["analysis_response"],
      }),
    );
    expect(result.stage).toBe("frame");
    expect(result.confidence).toBe("high");
  });

  it("uses explicit system event when present (direct_analysis_run)", () => {
    const event: SystemEvent = { event_type: "direct_analysis_run", timestamp: "2026-03-03T00:00:00Z", event_id: "e1", details: {} };
    const result = inferStage(makeContext(), event);
    expect(result.stage).toBe("evaluate");
    expect(result.substate).toBe("needs_run");
    expect(result.source).toBe("explicit_event");
    expect(result.confidence).toBe("high");
  });

  it("uses explicit system event (patch_accepted) with analysis → evaluate", () => {
    const event: SystemEvent = { event_type: "patch_accepted", timestamp: "2026-03-03T00:00:00Z", event_id: "e2", details: { patch_id: "p1", operations: [] } };
    const result = inferStage(
      makeContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"],
        analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: "abc" }, results: [] } as unknown as ConversationContext["analysis_response"],
      }),
      event,
    );
    expect(result.stage).toBe("evaluate");
    expect(result.source).toBe("explicit_event");
  });

  it("uses explicit system event (patch_accepted) without analysis → ideate", () => {
    const event: SystemEvent = { event_type: "patch_accepted", timestamp: "2026-03-03T00:00:00Z", event_id: "e3", details: { patch_id: "p1", operations: [] } };
    const result = inferStage(
      makeContext({ graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"] }),
      event,
    );
    expect(result.stage).toBe("ideate");
    expect(result.source).toBe("explicit_event");
  });

  it("falls through on patch_dismissed (not a stage event)", () => {
    const event: SystemEvent = { event_type: "patch_dismissed", timestamp: "2026-03-03T00:00:00Z", event_id: "e4", details: { patch_id: "p1" } };
    const result = inferStage(makeContext(), event);
    // Falls through to data-driven → no graph → frame
    expect(result.stage).toBe("frame");
    expect(result.source).toBe("inferred");
  });
});
