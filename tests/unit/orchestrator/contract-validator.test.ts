/**
 * Unit tests for src/orchestrator/validation/response-contract.ts
 *
 * Covers:
 * - Per-violation telemetry payload fields (request_id, turn_id, violation_type, field_path)
 * - stage_indicator validation and repair (V2 only)
 * - Whitespace-only chip rejection (trim-based validation)
 * - V1 equivalent paths
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  validateV2EnvelopeContract,
  validateV1EnvelopeContract,
  VALID_BLOCK_TYPES,
} from "../../../src/orchestrator/validation/response-contract.js";
import { setTestSink, TelemetryEvents } from "../../../src/utils/telemetry.js";
import type { OrchestratorResponseEnvelopeV2 } from "../../../src/orchestrator/pipeline/types.js";
import type { OrchestratorResponseEnvelope, ConversationBlock } from "../../../src/orchestrator/types.js";

// ============================================================================
// Helpers
// ============================================================================

type CapturedEvent = { name: string; data: Record<string, unknown> };

function captureEvents(): { events: CapturedEvent[]; stop: () => void } {
  const events: CapturedEvent[] = [];
  setTestSink((name, data) => events.push({ name, data }));
  return {
    events,
    stop: () => setTestSink(null),
  };
}

function makeV2Envelope(
  overrides?: Partial<OrchestratorResponseEnvelopeV2>,
): OrchestratorResponseEnvelopeV2 {
  return {
    turn_id: "turn-001",
    client_turn_id: "client-001",
    assistant_text: "Hello",
    blocks: [],
    suggested_actions: [],
    guidance_items: [],
    stage_indicator: {
      stage: "frame",
      confidence: "high",
      source: "inferred",
    },
    science_ledger: { citations: [], confidence_score: null },
    progress_marker: { kind: "conversational" },
    observability: {
      triggers_fired: [],
      triggers_suppressed: [],
      intent_classification: "llm",
      specialist_contributions: [],
      specialist_disagreement: null,
    },
    lineage: {
      model: "claude-sonnet-4-6",
      latency_ms: 100,
      input_tokens: 10,
      output_tokens: 10,
      plan_hash: undefined,
      response_hash: undefined,
      dsk_version_hash: null,
    },
    ...overrides,
  } as OrchestratorResponseEnvelopeV2;
}

function makeValidBlock(block_type: string): ConversationBlock {
  return {
    block_id: "b1",
    block_type: block_type as ConversationBlock["block_type"],
    data: {} as ConversationBlock["data"],
    provenance: { trigger: "test", turn_id: "turn-001", timestamp: new Date().toISOString() },
  };
}

function makeV1Envelope(
  overrides?: Partial<OrchestratorResponseEnvelope>,
): OrchestratorResponseEnvelope {
  return {
    turn_id: "turn-v1",
    assistant_text: "Hello",
    blocks: [],
    lineage: {
      mode: "INTERPRET",
      parse_path: "llm_xml",
      tool_invoked: null,
      tool_result_source: null,
      context_hash: null,
      prompt_version: null,
    },
    ...overrides,
  } as OrchestratorResponseEnvelope;
}

// ============================================================================
// VALID_BLOCK_TYPES contract
// ============================================================================

describe("VALID_BLOCK_TYPES", () => {
  it("contains exactly the 7 canonical block types", () => {
    expect([...VALID_BLOCK_TYPES].sort()).toEqual([
      "brief",
      "commentary",
      "evidence",
      "fact",
      "framing",
      "graph_patch",
      "review_card",
    ]);
  });

  it("does not include model_receipt (it is a top-level envelope field, not a block_type)", () => {
    expect(VALID_BLOCK_TYPES.has("model_receipt")).toBe(false);
  });
});

// ============================================================================
// V2: Per-violation telemetry payload
// ============================================================================

describe("validateV2EnvelopeContract — telemetry per-violation shape", () => {
  afterEach(() => setTestSink(null));

  it("emits one event per violation with required correlation fields", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV2Envelope({
      assistant_text: null,
      suggested_actions: [{ label: "", prompt: "p", role: "facilitator" }],
    });
    validateV2EnvelopeContract(envelope, "frame", "req-abc");

    stop();

    const contractEvents = events.filter(
      (e) => e.name === TelemetryEvents.OrchestratorContractViolation,
    );

    // At minimum: one for the bad action + one for empty_response_fallback
    expect(contractEvents.length).toBeGreaterThanOrEqual(2);

    for (const ev of contractEvents) {
      expect(typeof ev.data.request_id).toBe("string");
      expect(ev.data.turn_id).toBe("turn-001");
      expect(typeof ev.data.violation_type).toBe("string");
      expect(typeof ev.data.field_path).toBe("string");
      expect(typeof ev.data.detail).toBe("string");
    }
  });

  it("emits exactly one event for invalid_block_type with correct field_path", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV2Envelope({
      blocks: [makeValidBlock("unknown_widget")],
    });
    validateV2EnvelopeContract(envelope, "frame", "req-xyz");
    stop();

    const blockViolation = events.find(
      (e) =>
        e.name === TelemetryEvents.OrchestratorContractViolation &&
        e.data.violation_type === "invalid_block_type",
    );

    expect(blockViolation).toBeDefined();
    expect(blockViolation!.data.field_path).toBe("blocks[0].block_type");
    expect(blockViolation!.data.request_id).toBe("req-xyz");
    expect(blockViolation!.data.turn_id).toBe("turn-001");
  });

  it("uses null for request_id when not supplied", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV2Envelope({
      blocks: [makeValidBlock("bad_type")],
    });
    validateV2EnvelopeContract(envelope, "frame");
    stop();

    const ev = events.find(
      (e) => e.name === TelemetryEvents.OrchestratorContractViolation,
    );
    expect(ev).toBeDefined();
    expect(ev!.data.request_id).toBeNull();
  });

  it("emits empty_response_fallback violation with field_path='assistant_text'", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV2Envelope({ assistant_text: null });
    validateV2EnvelopeContract(envelope, "frame", "req-fallback");
    stop();

    const fallbackEv = events.find(
      (e) =>
        e.name === TelemetryEvents.OrchestratorContractViolation &&
        e.data.violation_type === "empty_response_fallback",
    );
    expect(fallbackEv).toBeDefined();
    expect(fallbackEv!.data.field_path).toBe("assistant_text");
  });
});

// ============================================================================
// V2: stage_indicator validation
// ============================================================================

describe("validateV2EnvelopeContract — stage_indicator validation", () => {
  afterEach(() => setTestSink(null));

  it("passes cleanly when stage_indicator.stage is present and valid", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV2Envelope();
    const result = validateV2EnvelopeContract(envelope, "frame");
    stop();

    const stageViolation = events.find(
      (e) =>
        e.name === TelemetryEvents.OrchestratorContractViolation &&
        e.data.violation_type === "missing_stage_indicator",
    );
    expect(stageViolation).toBeUndefined();
    expect(result.violations.some((v) => v.code === "missing_stage_indicator")).toBe(false);
  });

  it("emits missing_stage_indicator violation when stage_indicator.stage is absent", () => {
    const { events, stop } = captureEvents();

    // Simulate runtime missing stage by casting
    const envelope = makeV2Envelope({
      stage_indicator: { stage: undefined as unknown as "frame", confidence: "high", source: "inferred" },
    });
    const result = validateV2EnvelopeContract(envelope, "evaluate", "req-stage");
    stop();

    const stageEv = events.find(
      (e) =>
        e.name === TelemetryEvents.OrchestratorContractViolation &&
        e.data.violation_type === "missing_stage_indicator",
    );
    expect(stageEv).toBeDefined();
    expect(stageEv!.data.field_path).toBe("stage_indicator.stage");
    expect(stageEv!.data.request_id).toBe("req-stage");

    const stageViolation = result.violations.find((v) => v.code === "missing_stage_indicator");
    expect(stageViolation).toBeDefined();
    // stage is repaired to the caller-supplied stage
    expect(stageViolation!.detail).toContain("evaluate");
  });

  it("repairs stage_indicator.stage to caller-supplied stage when missing", () => {
    const envelope = makeV2Envelope({
      stage_indicator: { stage: undefined as unknown as "frame", confidence: "high", source: "inferred" },
    });
    validateV2EnvelopeContract(envelope, "decide");
    // After repair, stage_indicator.stage should be the supplied fallback
    expect((envelope.stage_indicator as { stage: string }).stage).toBe("decide");
  });

  it("falls back to 'frame' when stage_indicator.stage is missing and no stage arg provided", () => {
    const envelope = makeV2Envelope({
      stage_indicator: { stage: undefined as unknown as "frame", confidence: "high", source: "inferred" },
    });
    validateV2EnvelopeContract(envelope);
    expect((envelope.stage_indicator as { stage: string }).stage).toBe("frame");
  });
});

// ============================================================================
// V2: whitespace-only chip validation
// ============================================================================

describe("validateV2EnvelopeContract — whitespace-only chip rejection", () => {
  it("drops a chip whose label is all whitespace", () => {
    const envelope = makeV2Envelope({
      suggested_actions: [{ label: "   ", prompt: "What?", role: "facilitator" }],
    });
    const result = validateV2EnvelopeContract(envelope, "frame");

    expect(envelope.suggested_actions).toHaveLength(0);
    expect(result.violations.some((v) => v.code === "invalid_action_missing_message")).toBe(true);
  });

  it("drops a chip whose prompt is all whitespace", () => {
    const envelope = makeV2Envelope({
      suggested_actions: [{ label: "Set goal", prompt: "\t\n  ", role: "facilitator" }],
    });
    validateV2EnvelopeContract(envelope, "frame");

    expect(envelope.suggested_actions).toHaveLength(0);
  });

  it("includes field_path pointing to the failing field", () => {
    const { events, stop } = captureEvents();
    const envelope = makeV2Envelope({
      suggested_actions: [{ label: "  ", prompt: "ok", role: "facilitator" }],
    });
    validateV2EnvelopeContract(envelope, "frame", "req-ws");
    stop();

    const ev = events.find(
      (e) =>
        e.name === TelemetryEvents.OrchestratorContractViolation &&
        e.data.violation_type === "invalid_action_missing_message",
    );
    expect(ev!.data.field_path).toBe("suggested_actions[0].label");
  });

  it("preserves chips with valid non-whitespace label and prompt", () => {
    const envelope = makeV2Envelope({
      suggested_actions: [{ label: "Set goal", prompt: "What outcome?", role: "facilitator" }],
    });
    validateV2EnvelopeContract(envelope, "frame");
    expect(envelope.suggested_actions).toHaveLength(1);
  });
});

// ============================================================================
// V1: Per-violation telemetry
// ============================================================================

describe("validateV1EnvelopeContract — telemetry per-violation shape", () => {
  afterEach(() => setTestSink(null));

  it("emits one event per violation with required correlation fields", () => {
    const { events, stop } = captureEvents();

    const envelope = makeV1Envelope({
      assistant_text: null,
      blocks: [makeValidBlock("bad_v1_type")],
    });
    validateV1EnvelopeContract(envelope, "frame", "req-v1-abc");
    stop();

    const contractEvents = events.filter(
      (e) => e.name === TelemetryEvents.OrchestratorContractViolation,
    );

    expect(contractEvents.length).toBeGreaterThanOrEqual(1);
    for (const ev of contractEvents) {
      expect(ev.data.request_id).toBe("req-v1-abc");
      expect(ev.data.turn_id).toBe("turn-v1");
      expect(typeof ev.data.violation_type).toBe("string");
      expect(typeof ev.data.field_path).toBe("string");
    }
  });

  it("V1 whitespace-only label is dropped", () => {
    const envelope = makeV1Envelope({
      suggested_actions: [{ label: "   ", prompt: "p", role: "facilitator" }],
    });
    validateV1EnvelopeContract(envelope, "frame");
    expect(envelope.suggested_actions).toHaveLength(0);
  });
});

// ============================================================================
// System event ack guard (regression — must not get fallback)
// ============================================================================

describe("system event ack envelopes — no fallback injection", () => {
  it("V2 system_event ack: null assistant_text + no blocks → no fallback injected", () => {
    const envelope = makeV2Envelope({
      assistant_text: null,
      turn_plan: {
        selected_tool: null,
        routing: "deterministic",
        long_running: false,
        system_event: { type: "direct_graph_edit", event_id: "evt-1" },
      },
    });
    validateV2EnvelopeContract(envelope, "ideate");
    expect(envelope.assistant_text).toBeNull();
  });

  it("V1 system_event ack: null assistant_text + no blocks → no fallback injected", () => {
    const envelope = makeV1Envelope({
      assistant_text: null,
      turn_plan: {
        selected_tool: null,
        routing: "deterministic",
        long_running: false,
        system_event: { type: "direct_graph_edit", event_id: "evt-1" },
      },
    });
    validateV1EnvelopeContract(envelope, "ideate");
    expect(envelope.assistant_text).toBeNull();
  });
});
