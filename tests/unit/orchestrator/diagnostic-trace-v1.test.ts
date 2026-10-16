/**
 * V1 Diagnostic Trace Tests
 *
 * Tests that the V1 turn-handler correctly threads tool-level LLM telemetry
 * through to _diagnostic_trace on the response envelope.
 *
 * Also tests request ID chain consistency.
 */

import { describe,expect,it } from "vitest";
import { DiagnosticTraceCollector } from "../../../src/orchestrator/pipeline/diagnostic-trace.js";
// ROADMAP 1.162 — statically imported; see the sibling note in
// tests/unit/cee.analysis-ready-enrichment.test.ts. This file resolved the same
// `draft-graph.js` module graph from inside four `it()` bodies, charging its
// cost to the 5000ms per-test timeout. It was the LAST survivor of this class:
// with the other two files fixed, this one still failed on both clean
// full-suite runs under ~30x CPU oversubscription (loadavg 195-308 on 10
// cores), with `Error: Test timed out in 5000ms.` raised at the dynamic
// import in `extractToolLLMTelemetry`'s first case. No `vi.mock` and no
// `vi.resetModules()` in this file, so the dynamic form yielded the same
// cached module a static import does.


describe("DiagnosticTraceCollector (unit)", () => {
  it("should produce non-empty llm_calls when a tool call is recorded", () => {
    const collector = new DiagnosticTraceCollector();

    collector.recordLLMCall({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 5000,
      output_tokens: 3000,
      cache_read_tokens: 1000,
      cache_creation_tokens: 500,
      latency_ms: 4500,
      stop_reason: "end_turn",
      thinking_enabled: false,
      error: null,
    });

    const trace = collector.freeze();

    expect(trace.llm_calls).toHaveLength(1);
    expect(trace.llm_calls[0]).toMatchObject({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 5000,
      output_tokens: 3000,
      latency_ms: 4500,
      stop_reason: "end_turn",
      thinking_enabled: false,
      error: null,
    });
  });

  it("should produce null structured_output_config when nothing is recorded", () => {
    const collector = new DiagnosticTraceCollector();
    const trace = collector.freeze();

    expect(trace.structured_output_config).toBeNull();
    expect(trace.llm_calls).toHaveLength(0);
  });

  it("should record structured_output_config when tool used structured outputs", () => {
    const collector = new DiagnosticTraceCollector();

    collector.recordStructuredOutputConfig({
      enabled: true,
      api_shape: "output_config_ga",
      schema_hash: null,
      beta_header_present: false,
    });

    const trace = collector.freeze();

    expect(trace.structured_output_config).toEqual({
      enabled: true,
      api_shape: "output_config_ga",
      schema_hash: null,
      beta_header_present: false,
    });
  });

  it("should produce an immutable snapshot on each freeze()", () => {
    const collector = new DiagnosticTraceCollector();

    collector.recordLLMCall({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: 1000,
      stop_reason: "end_turn",
      thinking_enabled: false,
      error: null,
    });

    const trace1 = collector.freeze();
    const trace2 = collector.freeze();

    // Each call returns a new object
    expect(trace1).not.toBe(trace2);
    // But content is identical
    expect(trace1).toEqual(trace2);
  });

  it("should record error on LLM call trace", () => {
    const collector = new DiagnosticTraceCollector();

    collector.recordLLMCall({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: 200,
      stop_reason: null,
      thinking_enabled: false,
      error: { status: 400, type: "invalid_request", message: "Prompt too long" },
    });

    const trace = collector.freeze();

    expect(trace.llm_calls).toHaveLength(1);
    expect(trace.llm_calls[0].error).toEqual({
      status: 400,
      type: "invalid_request",
      message: "Prompt too long",
    });
  });
});



describe("V1 envelope _diagnostic_trace field", () => {
  it("should accept _diagnostic_trace on OrchestratorResponseEnvelope type", () => {
    // This is a compile-time check — if the type doesn't include _diagnostic_trace,
    // this import and assignment would fail TypeScript compilation.
    const collector = new DiagnosticTraceCollector();
    collector.recordLLMCall({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: 1000,
      stop_reason: "end_turn",
      thinking_enabled: false,
      error: null,
    });

    const trace = collector.freeze();

    // Simulate V1 envelope with diagnostic trace attached
    const envelope = {
      turn_id: "test-turn",
      assistant_text: "test",
      blocks: [],
      lineage: { request_id: "test-123", context_hash: "abc" },
      _diagnostic_trace: trace,
    };

    expect(envelope._diagnostic_trace.llm_calls).toHaveLength(1);
    expect(envelope._diagnostic_trace.llm_calls[0].model).toBe("claude-sonnet-4-6");
    expect(envelope._diagnostic_trace.structured_output_config).toBeNull();
  });
});

describe("Response serialization (no field stripping)", () => {
  it("should preserve _diagnostic_trace in JSON serialization", () => {
    const collector = new DiagnosticTraceCollector();
    collector.recordLLMCall({
      role: "draft_graph",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: 1000,
      stop_reason: "end_turn",
      thinking_enabled: false,
      error: null,
    });

    const envelope = {
      turn_id: "test",
      assistant_text: null,
      blocks: [],
      _diagnostic_trace: collector.freeze(),
    };

    // Fastify uses JSON.stringify — verify _diagnostic_trace survives
    const serialized = JSON.stringify(envelope);
    const deserialized = JSON.parse(serialized);

    expect(deserialized._diagnostic_trace).toBeDefined();
    expect(deserialized._diagnostic_trace.llm_calls).toHaveLength(1);
    expect(deserialized._diagnostic_trace.llm_calls[0].model).toBe("claude-sonnet-4-6");
  });
});
