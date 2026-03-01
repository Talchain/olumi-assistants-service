import { describe, it, expect, vi } from "vitest";
import { phase5Validate } from "../../../../src/orchestrator/pipeline/phase5-validation/index.js";
import type { EnrichedContext, SpecialistResult, LLMResult, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";

// Mock isProduction for debug fields
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false } },
}));

vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords matched" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn-id",
    ...overrides,
  };
}

function makeLLMResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    assistant_text: "Response text",
    tool_invocations: [],
    science_annotations: [],
    raw_response: "Response text",
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
    ...overrides,
  };
}

function makeToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    ...overrides,
  };
}

function makeSpecialistResult(): SpecialistResult {
  return { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] };
}

describe("phase5-validation (index)", () => {
  it("returns a complete V2 envelope", () => {
    const envelope = phase5Validate(
      makeLLMResult(),
      makeToolResult(),
      makeEnrichedContext(),
      makeSpecialistResult(),
    );

    expect(envelope.turn_id).toBe("test-turn-id");
    expect(envelope.assistant_text).toBe("Response text");
    expect(envelope.lineage).toBeDefined();
    expect(envelope.stage_indicator).toBeDefined();
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker).toBeDefined();
    expect(envelope.observability).toBeDefined();
    expect(envelope.turn_plan).toBeDefined();
  });

  it("classifies progress from tool side effects", () => {
    const envelope = phase5Validate(
      makeLLMResult(),
      makeToolResult({ side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false } }),
      makeEnrichedContext(),
      makeSpecialistResult(),
    );

    expect(envelope.progress_marker.kind).toBe("changed_model");
  });

  it("includes stage transition when analysis runs in frame", () => {
    const envelope = phase5Validate(
      makeLLMResult(),
      makeToolResult({ side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false } }),
      makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
      makeSpecialistResult(),
    );

    expect(envelope.stage_indicator.transition).toEqual({
      from: "frame",
      to: "evaluate",
      trigger: "analysis_completed",
    });
    expect(envelope.stage_indicator.stage).toBe("evaluate");
  });

  it("science_ledger has all required empty fields", () => {
    const envelope = phase5Validate(
      makeLLMResult(),
      makeToolResult(),
      makeEnrichedContext(),
      makeSpecialistResult(),
    );

    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.science_ledger.techniques_used).toEqual([]);
    expect(envelope.science_ledger.scope_violations).toEqual([]);
    expect(envelope.science_ledger.phrasing_violations).toEqual([]);
    expect(envelope.science_ledger.rewrite_applied).toBe(false);
  });

  it("observability includes intent and specialist data", () => {
    const envelope = phase5Validate(
      makeLLMResult(),
      makeToolResult(),
      makeEnrichedContext({ intent_classification: "recommend" }),
      makeSpecialistResult(),
    );

    expect(envelope.observability.intent_classification).toBe("recommend");
    expect(envelope.observability.specialist_contributions).toEqual([]);
    expect(envelope.observability.specialist_disagreement).toBeNull();
  });
});
