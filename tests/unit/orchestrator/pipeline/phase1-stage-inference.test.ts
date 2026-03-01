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

  it("returns 'ideate' when graph exists but no analysis", () => {
    const result = inferStage(
      makeContext({ graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"] }),
    );
    expect(result.stage).toBe("ideate");
    expect(result.confidence).toBe("high");
  });

  it("returns 'evaluate' with substate 'has_run' when analysis complete", () => {
    const result = inferStage(
      makeContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"],
        analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: "abc" }, results: [] } as unknown as ConversationContext["analysis_response"],
      }),
    );
    expect(result.stage).toBe("evaluate");
    expect(result.substate).toBe("has_run");
    expect(result.confidence).toBe("high");
  });

  it("returns 'decide' when brief has been generated", () => {
    const result = inferStage(
      makeContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"],
        analysis_response: {
          meta: { seed_used: 1, n_samples: 100, response_hash: "abc" },
          results: [],
          decision_brief: { title: "test brief" },
        } as unknown as ConversationContext["analysis_response"],
      }),
    );
    expect(result.stage).toBe("decide");
    expect(result.confidence).toBe("high");
  });

  it("uses explicit system event when present (direct_analysis_run)", () => {
    const event: SystemEvent = { type: "direct_analysis_run", payload: {} };
    const result = inferStage(makeContext(), event);
    expect(result.stage).toBe("evaluate");
    expect(result.substate).toBe("needs_run");
    expect(result.source).toBe("explicit_event");
    expect(result.confidence).toBe("high");
  });

  it("uses explicit system event (patch_accepted) with analysis → evaluate", () => {
    const event: SystemEvent = { type: "patch_accepted", payload: {} };
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
    const event: SystemEvent = { type: "patch_accepted", payload: {} };
    const result = inferStage(
      makeContext({ graph: { nodes: [], edges: [], options: [] } as unknown as ConversationContext["graph"] }),
      event,
    );
    expect(result.stage).toBe("ideate");
    expect(result.source).toBe("explicit_event");
  });

  it("falls through on patch_dismissed (not a stage event)", () => {
    const event: SystemEvent = { type: "patch_dismissed", payload: {} };
    const result = inferStage(makeContext(), event);
    // Falls through to data-driven → no graph → frame
    expect(result.stage).toBe("frame");
    expect(result.source).toBe("inferred");
  });
});
