import { describe, it, expect } from "vitest";
import { phase1Enrich } from "../../../../src/orchestrator/pipeline/phase1-enrichment/index.js";
import type { ConversationContext } from "../../../../src/orchestrator/pipeline/types.js";

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

describe("phase1-enrichment (index)", () => {
  it("returns EnrichedContext with all required fields", () => {
    const result = phase1Enrich("Hello", makeContext(), "scenario-1");

    expect(result.graph).toBeNull();
    expect(result.analysis).toBeNull();
    expect(result.framing).toBeNull();
    expect(result.conversation_history).toEqual([]);
    expect(result.selected_elements).toEqual([]);
    expect(result.stage_indicator).toBeDefined();
    expect(result.intent_classification).toBeDefined();
    expect(result.decision_archetype).toBeDefined();
    expect(result.progress_markers).toBeDefined();
    expect(result.stuck).toBeDefined();
    expect(result.dsk).toBeDefined();
    expect(result.user_profile).toBeDefined();
    expect(result.scenario_id).toBe("scenario-1");
    expect(result.turn_id).toBeDefined();
    expect(result.turn_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique turn_id each call", () => {
    const a = phase1Enrich("Hi", makeContext(), "s1");
    const b = phase1Enrich("Hi", makeContext(), "s1");
    expect(a.turn_id).not.toBe(b.turn_id);
  });

  it("infers frame stage when no graph exists", () => {
    const result = phase1Enrich("Help me decide", makeContext(), "s1");
    expect(result.stage_indicator.stage).toBe("frame");
    expect(result.stage_indicator.confidence).toBe("high");
  });

  it("classifies intent from user message", () => {
    const result = phase1Enrich("Why did this happen?", makeContext(), "s1");
    expect(result.intent_classification).toBe("explain");
  });

  it("detects decision archetype from message", () => {
    const result = phase1Enrich("Should I increase the price?", makeContext(), "s1");
    expect(result.decision_archetype.type).toBe("pricing");
  });

  it("passes framing from context", () => {
    const framing = { stage: "frame" as const, goal: "Test goal" };
    const result = phase1Enrich("Hello", makeContext({ framing }), "s1");
    expect(result.framing).toEqual(framing);
  });

  it("passes system_event through when provided", () => {
    const event = { type: "direct_analysis_run" as const, payload: {} };
    const result = phase1Enrich("Hello", makeContext(), "s1", event);
    expect(result.system_event).toBe(event);
    expect(result.stage_indicator.source).toBe("explicit_event");
  });

  it("DSK is stubbed with empty values", () => {
    const result = phase1Enrich("Hello", makeContext(), "s1");
    expect(result.dsk.claims).toEqual([]);
    expect(result.dsk.triggers).toEqual([]);
    expect(result.dsk.techniques).toEqual([]);
    expect(result.dsk.version_hash).toBeNull();
  });

  it("user_profile has stub defaults", () => {
    const result = phase1Enrich("Hello", makeContext(), "s1");
    expect(result.user_profile.coaching_style).toBe("socratic");
    expect(result.user_profile.calibration_tendency).toBe("unknown");
    expect(result.user_profile.challenge_tolerance).toBe("medium");
  });
});
