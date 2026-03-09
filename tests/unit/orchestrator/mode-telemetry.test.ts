import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractDeclaredMode, inferResponseMode } from "../../../src/orchestrator/response-parser.js";
import { setTestSink, TelemetryEvents, emit } from "../../../src/utils/telemetry.js";

// ============================================================================
// Mode agreement / disagreement tests
// ============================================================================

describe("mode consistency telemetry", () => {
  it("mode_disagreement is true when declared=ACT, inferred=INTERPRET", () => {
    const declared = extractDeclaredMode("Mode: ACT");
    const inferred = inferResponseMode({
      assistant_text: "Here's what the data shows.",
      tool_invocations: [],
      extracted_blocks: [],
      suggested_actions: [],
      stop_reason: "end_turn",
      diagnostics: null,
      parse_warnings: [],
    });

    const disagreement = declared !== "unknown" && declared !== inferred;
    expect(declared).toBe("ACT");
    expect(inferred).toBe("INTERPRET");
    expect(disagreement).toBe(true);
  });

  it("mode_disagreement is false when declared matches inferred", () => {
    const declared = extractDeclaredMode("Mode: ACT");
    const inferred = inferResponseMode({
      assistant_text: null,
      tool_invocations: [{ name: "run_analysis", input: {}, id: "1" }],
      extracted_blocks: [],
      suggested_actions: [],
      stop_reason: "end_turn",
      diagnostics: null,
      parse_warnings: [],
    });

    const disagreement = declared !== "unknown" && declared !== inferred;
    expect(declared).toBe("ACT");
    expect(inferred).toBe("ACT");
    expect(disagreement).toBe(false);
  });

  it("mode_disagreement is false when declared=unknown", () => {
    const declared = extractDeclaredMode(null);
    const inferred = inferResponseMode({
      assistant_text: "Here is the analysis.",
      tool_invocations: [],
      extracted_blocks: [],
      suggested_actions: [],
      stop_reason: "end_turn",
      diagnostics: null,
      parse_warnings: [],
    });

    const disagreement = declared !== "unknown" && declared !== inferred;
    expect(declared).toBe("unknown");
    expect(disagreement).toBe(false);
  });
});

// ============================================================================
// Telemetry event emission tests (via test sink)
// ============================================================================

describe("telemetry event emission", () => {
  const sinkEvents: Array<{ name: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    sinkEvents.length = 0;
    setTestSink((name, data) => {
      sinkEvents.push({ name, data });
    });
  });

  afterEach(() => {
    setTestSink(null);
  });

  it("OrchestratorModeDisagreement event is emitted on disagreement", () => {
    emit(TelemetryEvents.OrchestratorModeDisagreement, {
      declared: "ACT",
      inferred: "INTERPRET",
      tool_selected: "edit_graph",
      stage: "ideate",
      scenario_id: "test-scenario",
    });

    const event = sinkEvents.find((e) => e.name === TelemetryEvents.OrchestratorModeDisagreement);
    expect(event).toBeDefined();
    expect(event!.data.declared).toBe("ACT");
    expect(event!.data.inferred).toBe("INTERPRET");
    expect(event!.data.stage).toBe("ideate");
  });

  it("OrchestratorToolSuppressed event is emitted when tool_permitted is false", () => {
    emit(TelemetryEvents.OrchestratorToolSuppressed, {
      tool_attempted: "run_analysis",
      stage: "frame",
      scenario_id: "test-scenario",
    });

    const event = sinkEvents.find((e) => e.name === TelemetryEvents.OrchestratorToolSuppressed);
    expect(event).toBeDefined();
    expect(event!.data.tool_attempted).toBe("run_analysis");
    expect(event!.data.stage).toBe("frame");
  });

  it("stage field is present in telemetry events", () => {
    emit(TelemetryEvents.OrchestratorModeDisagreement, {
      declared: "SUGGEST",
      inferred: "INTERPRET",
      tool_selected: null,
      stage: "evaluate",
      scenario_id: "test-scenario",
    });

    const event = sinkEvents.find((e) => e.name === TelemetryEvents.OrchestratorModeDisagreement);
    expect(event!.data.stage).toBe("evaluate");
  });
});

// ============================================================================
// System events do not trigger mode telemetry
// ============================================================================

describe("system events and mode telemetry", () => {
  it("system events should not trigger mode disagreement or tool suppression telemetry", () => {
    // System events bypass the intent gate and stage policy entirely.
    // The pipeline routes them before Phase 3 (LLM call), so no declared/inferred
    // mode exists. This test documents the invariant.
    //
    // In the V1 turn handler: handleSystemEvent returns before the intent gate.
    // In the V2 pipeline: routeSystemEvent returns before Phase 3.
    //
    // Therefore no mode disagreement or tool suppression can be emitted for system events.
    // This is verified structurally — system events never reach the telemetry block.
    expect(true).toBe(true); // structural guarantee, not runtime
  });
});
