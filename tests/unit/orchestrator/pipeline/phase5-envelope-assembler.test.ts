import { describe, it, expect, vi } from "vitest";
import {
  computeContextHash,
  assembleV2Envelope,
  buildErrorEnvelope,
} from "../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js";
import type {
  EnrichedContext,
  SpecialistResult,
  LLMResult,
  ToolResult,
  ScienceLedger,
} from "../../../../src/orchestrator/pipeline/types.js";

// Stub isProduction to return false for debug field tests
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false } },
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
    assistant_text: "Hello",
    tool_invocations: [],
    science_annotations: [],
    raw_response: "Hello",
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

function makeScienceLedger(): ScienceLedger {
  return {
    claims_used: [],
    techniques_used: [],
    scope_violations: [],
    phrasing_violations: [],
    rewrite_applied: false,
  };
}

describe("computeContextHash", () => {
  it("returns a hex string", () => {
    const hash = computeContextHash(makeEnrichedContext());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const ctx = makeEnrichedContext();
    expect(computeContextHash(ctx)).toBe(computeContextHash(ctx));
  });

  it("excludes conversation_history from hash", () => {
    const a = makeEnrichedContext({ conversation_history: [] });
    const b = makeEnrichedContext({
      conversation_history: [{ role: "user", content: "hello" }],
    });
    expect(computeContextHash(a)).toBe(computeContextHash(b));
  });

  it("excludes turn_id from hash", () => {
    const a = makeEnrichedContext({ turn_id: "aaa" });
    const b = makeEnrichedContext({ turn_id: "bbb" });
    expect(computeContextHash(a)).toBe(computeContextHash(b));
  });

  it("excludes system_event from hash", () => {
    const a = makeEnrichedContext();
    const b = makeEnrichedContext({ system_event: { type: "direct_analysis_run", payload: {} } });
    expect(computeContextHash(a)).toBe(computeContextHash(b));
  });

  it("produces different hashes for different scenario_ids", () => {
    const a = makeEnrichedContext({ scenario_id: "s1" });
    const b = makeEnrichedContext({ scenario_id: "s2" });
    expect(computeContextHash(a)).not.toBe(computeContextHash(b));
  });
});

describe("assembleV2Envelope", () => {
  it("returns envelope with all required fields", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.turn_id).toBe("test-turn-id");
    expect(envelope.assistant_text).toBe("Hello");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.suggested_actions).toEqual([]);
    expect(envelope.lineage).toBeDefined();
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.lineage.dsk_version_hash).toBeNull();
    expect(envelope.stage_indicator).toBeDefined();
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.observability).toBeDefined();
    expect(envelope.turn_plan).toBeDefined();
  });

  it("applies stage transition", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext({ stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" } }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult({ side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false } }),
      progressKind: "ran_analysis",
      stageTransition: { from: "ideate", to: "evaluate", trigger: "analysis_completed" },
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.stage_indicator.stage).toBe("evaluate");
    expect(envelope.stage_indicator.transition).toEqual({
      from: "ideate",
      to: "evaluate",
      trigger: "analysis_completed",
    });
  });

  it("merges rescue routes when stuck", () => {
    const rescueRoutes = [
      { label: "Test", prompt: "Test prompt", role: "facilitator" as const },
    ];
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext({
        stuck: { detected: true, rescue_routes: rescueRoutes },
      }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ suggested_actions: [{ label: "Existing", prompt: "...", role: "challenger" }] }),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.suggested_actions).toHaveLength(2);
    expect(envelope.suggested_actions[0].label).toBe("Existing");
    expect(envelope.suggested_actions[1].label).toBe("Test");
  });

  it("uses tool result assistant_text over LLM text", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ assistant_text: "LLM text" }),
      toolResult: makeToolResult({ assistant_text: "Tool text" }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_text).toBe("Tool text");
  });

  it("falls back to LLM text when tool result has no text", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ assistant_text: "LLM text" }),
      toolResult: makeToolResult({ assistant_text: null }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_text).toBe("LLM text");
  });

  it("sets routing to 'deterministic' when tool has deterministic id", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{ name: "run_analysis", input: {}, id: "deterministic" }],
      }),
      toolResult: makeToolResult({ side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false } }),
      progressKind: "ran_analysis",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.turn_plan.routing).toBe("deterministic");
    expect(envelope.turn_plan.selected_tool).toBe("run_analysis");
  });

  it("includes diagnostics in non-production mode", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ diagnostics: "Debug info" }),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.diagnostics).toBe("Debug info");
  });
});

describe("buildErrorEnvelope", () => {
  it("returns envelope with error field and safe defaults", () => {
    const envelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "Something broke");

    expect(envelope.turn_id).toBe("err-turn");
    expect(envelope.error).toEqual({ code: "PIPELINE_ERROR", message: "Something broke" });
    expect(envelope.assistant_text).toBe("I ran into a problem processing that. Could you try again?");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.suggested_actions).toEqual([]);
    expect(envelope.lineage.context_hash).toBe("");
    expect(envelope.lineage.dsk_version_hash).toBeNull();
    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.observability.triggers_fired).toEqual([]);
    expect(envelope.turn_plan.selected_tool).toBeNull();
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.stage_indicator.confidence).toBe("low");
  });

  it("uses enriched context for hash and stage when available", () => {
    const ctx = makeEnrichedContext({
      stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
    });
    const envelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "fail", ctx);

    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.stage_indicator.stage).toBe("evaluate");
    expect(envelope.observability.intent_classification).toBe("conversational");
  });
});
