import { describe, it, expect } from "vitest";
import { assembleEnvelope, buildTurnPlan } from "../../../src/orchestrator/envelope.js";
import { getHttpStatusForError } from "../../../src/orchestrator/types.js";
import type { ConversationContext, V2RunResponseEnvelope, OrchestratorError } from "../../../src/orchestrator/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: { stage: "frame" },
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

describe("Envelope Assembly", () => {
  it("assembles minimal envelope", () => {
    const envelope = assembleEnvelope({
      assistantText: "Hello",
      blocks: [],
      context: makeContext(),
    });

    expect(envelope.turn_id).toBeDefined();
    expect(envelope.assistant_text).toBe("Hello");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.lineage.context_hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses provided turnId", () => {
    const envelope = assembleEnvelope({
      turnId: "my-turn-id",
      assistantText: null,
      blocks: [],
      context: makeContext(),
    });

    expect(envelope.turn_id).toBe("my-turn-id");
  });

  it("includes analysis response when provided", () => {
    const analysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "meta-hash" },
      results: [],
      response_hash: "top-level-hash",
    } as unknown as V2RunResponseEnvelope;

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      analysisResponse,
    });

    expect(envelope.analysis_response).toBeDefined();
    expect(envelope.lineage.response_hash).toBe("top-level-hash");
    expect(envelope.lineage.seed_used).toBe(42);
    expect(envelope.lineage.n_samples).toBe(1000);
  });

  it("falls back to meta.response_hash if top-level absent", () => {
    const analysisResponse = {
      meta: { seed_used: "42", n_samples: 1000, response_hash: "meta-hash" },
      results: [],
    } as unknown as V2RunResponseEnvelope;

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      analysisResponse,
    });

    expect(envelope.lineage.response_hash).toBe("meta-hash");
    // seed_used arrives as string — should be parsed as Number
    expect(envelope.lineage.seed_used).toBe(42);
  });

  it("includes stage indicator from framing", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext({ framing: { stage: "evaluate" } }),
    });

    expect(envelope.stage_indicator).toBe("evaluate");
    expect(envelope.stage_label).toBe("Evaluating options");
  });

  it("omits stage indicator when framing absent", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext({ framing: null }),
    });

    expect(envelope.stage_indicator).toBeUndefined();
  });

  it("includes turn plan when provided", () => {
    const plan = buildTurnPlan("run_analysis", "deterministic", true, 1500);

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      turnPlan: plan,
    });

    expect(envelope.turn_plan).toEqual({
      selected_tool: "run_analysis",
      routing: "deterministic",
      long_running: true,
      tool_latency_ms: 1500,
    });
  });

  it("includes error when provided", () => {
    const error: OrchestratorError = {
      code: "TOOL_EXECUTION_FAILED",
      message: "PLoT failed",
      tool: "run_analysis",
      recoverable: true,
    };

    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: makeContext(),
      error,
    });

    expect(envelope.error).toEqual(error);
  });
});

describe("Turn Plan Builder", () => {
  it("builds plan without latency", () => {
    const plan = buildTurnPlan("draft_graph", "llm", true);
    expect(plan).toEqual({
      selected_tool: "draft_graph",
      routing: "llm",
      long_running: true,
    });
    expect(plan.tool_latency_ms).toBeUndefined();
  });

  it("builds plan with latency", () => {
    const plan = buildTurnPlan("run_analysis", "deterministic", true, 2500);
    expect(plan.tool_latency_ms).toBe(2500);
  });

  it("builds plan for pure conversation", () => {
    const plan = buildTurnPlan(null, "llm", false);
    expect(plan.selected_tool).toBeNull();
    expect(plan.long_running).toBe(false);
  });
});

describe("HTTP Status Mapping", () => {
  it.each([
    ["LLM_TIMEOUT" as const, 504],
    ["TOOL_EXECUTION_FAILED" as const, 502],
    ["VALIDATION_REJECTED" as const, 422],
    ["CONTEXT_TOO_LARGE" as const, 413],
    ["INVALID_REQUEST" as const, 400],
    ["UNKNOWN" as const, 500],
  ])("maps %s to %d", (code, expectedStatus) => {
    const error: OrchestratorError = {
      code,
      message: "test",
      recoverable: false,
    };
    expect(getHttpStatusForError(error)).toBe(expectedStatus);
  });
});
