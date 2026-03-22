/**
 * Dispatch Gap Coaching Integration Tests
 *
 * Tests for:
 * - run_analysis returns gap coaching when value-missing factors detected
 * - _skip_gap_check bypasses gap detection
 * - conversational_state.last_gap_coaching bypasses gap detection
 * - Analysis proceeds normally when no gaps detected
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

const { mockRunAnalysis } = vi.hoisted(() => ({
  mockRunAnalysis: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/run-analysis.js", () => ({
  handleRunAnalysis: mockRunAnalysis,
}));

vi.mock("../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: () => ({
    run: vi.fn(),
    validatePatch: vi.fn(),
  }),
}));

vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({ model: "test", name: "test" }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../../../src/orchestrator/tools/explain-results.js", () => ({
  handleExplainResults: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/draft-graph.js", () => ({
  handleDraftGraph: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/generate-brief.js", () => ({
  handleGenerateBrief: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/edit-graph.js", () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/undo-patch.js", () => ({
  handleUndoPatch: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/run-exercise.js", () => ({
  handleRunExercise: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/research-topic.js", () => ({
  handleResearchTopic: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/guidance/post-draft.js", () => ({
  generatePostDraftGuidance: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/orchestrator/analysis-state.js", () => ({
  isAnalysisExplainable: vi.fn().mockReturnValue(false),
}));

import { dispatchToolHandler, _resetDispatchPlotClient } from "../../../../src/orchestrator/tools/dispatch.js";
import type { ConversationContext, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";
import { GAP_COACHING_FINGERPRINT } from "../../../../src/orchestrator/tools/gap-detection.js";
import { SIGNAL_CODES } from "../../../../src/orchestrator/types/guidance-item.js";

// ============================================================================
// Helpers
// ============================================================================

function makeGraphWithGap(): GraphV3T {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "opt_a", kind: "option", label: "Option A" },
      { id: "fac_ext", kind: "factor", label: "Market Growth", category: "external" },
      { id: "goal_1", kind: "goal", label: "Revenue" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "fac_ext", to: "goal_1", strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: "positive" },
    ],
  } as unknown as GraphV3T;
}

function makeGraphWithoutGap(): GraphV3T {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Decision" },
      { id: "fac_obs", kind: "factor", label: "Revenue", observed_state: { value: 0.7 } },
      { id: "goal_1", kind: "goal", label: "Goal" },
    ],
    edges: [
      { from: "fac_obs", to: "goal_1", strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9, effect_direction: "positive" },
    ],
  } as unknown as GraphV3T;
}

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: makeGraphWithGap(),
    analysis_response: null,
    framing: { stage: "evaluate" },
    messages: [],
    scenario_id: "test-scenario",
    analysis_inputs: {
      options: [{ option_id: "opt_a", label: "Option A", interventions: { fac_ext: { value: 0.5 } } }],
    },
    ...overrides,
  };
}

function makeAnalysisResult(): { blocks: []; analysisResponse: V2RunResponseEnvelope; responseHash: string; seedUsed: number; nSamples: number; latencyMs: number } {
  return {
    blocks: [],
    analysisResponse: {
      meta: { seed_used: "42", n_samples: 1000, response_hash: "hash" },
      results: [],
    } as unknown as V2RunResponseEnvelope,
    responseHash: "hash",
    seedUsed: 42,
    nSamples: 1000,
    latencyMs: 100,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("dispatch gap coaching integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetDispatchPlotClient();
    mockRunAnalysis.mockResolvedValue(makeAnalysisResult());
  });

  it("returns gap coaching when value-missing factors detected", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
    );

    // Should return coaching text, not analysis
    expect(result.assistantText).toContain("Market Growth");
    expect(result.assistantText).toContain(GAP_COACHING_FINGERPRINT);
    expect(result.guidanceItems.length).toBeGreaterThan(0);
    expect(result.guidanceItems[0].signal_code).toBe(SIGNAL_CODES.MISSING_OBSERVED_VALUE);
    expect(result.routeMetadata?.outcome).toBe("gap_coaching");

    // handleRunAnalysis should NOT have been called
    expect(mockRunAnalysis).not.toHaveBeenCalled();
  });

  it("bypasses gap check with _skip_gap_check flag", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      { _skip_gap_check: true },
      makeContext(),
      "turn-1",
      "req-1",
    );

    // handleRunAnalysis SHOULD have been called
    expect(mockRunAnalysis).toHaveBeenCalled();
    expect(result.analysisResponse).toBeDefined();
  });

  it("bypasses gap check when conversational_state.last_gap_coaching is true", async () => {
    const ctx = makeContext({
      conversational_state: {
        active_entities: [],
        stated_constraints: [],
        current_topic: "analysis",
        last_failed_action: null,
        last_gap_coaching: true,
      },
    });

    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      ctx,
      "turn-1",
      "req-1",
    );

    // handleRunAnalysis SHOULD have been called
    expect(mockRunAnalysis).toHaveBeenCalled();
    expect(result.analysisResponse).toBeDefined();
  });

  it("proceeds normally when no gaps detected", async () => {
    const ctx = makeContext({ graph: makeGraphWithoutGap() });

    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      ctx,
      "turn-1",
      "req-1",
    );

    // handleRunAnalysis SHOULD have been called
    expect(mockRunAnalysis).toHaveBeenCalled();
    expect(result.analysisResponse).toBeDefined();
  });

  it("proceeds normally when graph is null", async () => {
    const ctx = makeContext({ graph: null });

    // This will throw because graph is null (prerequisite check in handleRunAnalysis)
    // but the gap detection should NOT fire
    await dispatchToolHandler(
      "run_analysis",
      {},
      ctx,
      "turn-1",
      "req-1",
    );

    expect(mockRunAnalysis).toHaveBeenCalled();
  });

  it("includes brief anchor in coaching text when brief_text available", async () => {
    const ctx = makeContext({
      framing: { stage: "evaluate", brief_text: "Market growth is expected at 5% per year" } as ConversationContext["framing"],
    });

    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      ctx,
      "turn-1",
      "req-1",
    );

    expect(result.assistantText).toContain("Market Growth");
    expect(result.assistantText).toContain("5%");
    expect(result.assistantText).toContain("brief");
  });

  it("gap coaching includes run-anyway guidance item", async () => {
    const result = await dispatchToolHandler(
      "run_analysis",
      {},
      makeContext(),
      "turn-1",
      "req-1",
    );

    const runAnywayItem = result.guidanceItems.find(
      g => g.title === "Run analysis with defaults",
    );
    expect(runAnywayItem).toBeDefined();
    expect(runAnywayItem!.category).toBe("could_fix");
    expect(runAnywayItem!.primary_action.type).toBe("navigate");
  });
});
