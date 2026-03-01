import { describe, it, expect, vi } from "vitest";
import { executePipeline } from "../../../../src/orchestrator/pipeline/pipeline.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { PipelineDeps, LLMClient, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";

// Mock config for isProduction check
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false } },
}));

// Mock intent gate
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

// Mock prompt assembly
vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
}));

vi.mock("../../../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "test" }]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Hello",
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: "test-scenario",
    },
    ...overrides,
  } as OrchestratorTurnRequest;
}

function makeMockDeps(): PipelineDeps {
  const llmClient: LLMClient = {
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "<assistant_reply>Hello from LLM</assistant_reply>" }],
      stop_reason: "end_turn",
    }),
    chat: vi.fn().mockResolvedValue({ content: "Hello" }),
  };

  const toolDispatcher: ToolDispatcher = {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
    } as ToolResult),
  };

  return { llmClient, toolDispatcher };
}

describe("pipeline", () => {
  it("returns a valid V2 envelope from full pipeline", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.turn_id).toBeDefined();
    expect(envelope.lineage).toBeDefined();
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.stage_indicator).toBeDefined();
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker).toBeDefined();
    expect(envelope.observability).toBeDefined();
    expect(envelope.turn_plan).toBeDefined();
    expect(envelope.error).toBeUndefined();
  });

  it("returns error envelope when a phase throws", async () => {
    const deps = makeMockDeps();
    // Make LLM client throw
    (deps.llmClient.chatWithTools as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM timeout"),
    );

    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.error).toBeDefined();
    expect(envelope.error!.code).toBe("PIPELINE_ERROR");
    expect(envelope.assistant_text).toBe(
      "I ran into a problem processing that. Could you try again?",
    );
    // All fields must still be present with defaults
    expect(envelope.lineage).toBeDefined();
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.turn_plan.selected_tool).toBeNull();
  });

  it("Phase 2 stub returns empty specialist result", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.observability.triggers_fired).toEqual([]);
    expect(envelope.observability.triggers_suppressed).toEqual([]);
    expect(envelope.observability.specialist_contributions).toEqual([]);
  });

  it("science_ledger fields are empty (stubs)", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.science_ledger.techniques_used).toEqual([]);
    expect(envelope.science_ledger.scope_violations).toEqual([]);
    expect(envelope.science_ledger.rewrite_applied).toBe(false);
  });

  it("dsk_version_hash is null (stub)", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);
    expect(envelope.lineage.dsk_version_hash).toBeNull();
  });

  it("propagates stage_indicator from Phase 1", async () => {
    const deps = makeMockDeps();
    // No graph → should infer frame
    const envelope = await executePipeline(makeRequest(), "req-1", deps);
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.stage_indicator.confidence).toBe("high");
  });
});
