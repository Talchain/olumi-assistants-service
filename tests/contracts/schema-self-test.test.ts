/**
 * Contract self-validation tests.
 *
 * Validates known-good payloads against the exported JSON Schema files.
 * These are NOT golden fixtures — they are minimal payloads that exercise
 * required/optional field boundaries. If a schema change makes a field
 * required, the affected payload fails immediately.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv";

const CONTRACTS_DIR = resolve(import.meta.dirname!, "../../contracts");

function loadSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve(CONTRACTS_DIR, filename), "utf-8"));
}

describe("Contract self-validation", () => {
  let ajv: Ajv;

  beforeAll(() => {
    ajv = new Ajv({ allErrors: true, strict: false });
  });

  // ---------------------------------------------------------------------------
  // turn-request.schema.json
  // ---------------------------------------------------------------------------
  describe("turn-request.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    beforeAll(() => {
      validate = ajv.compile(loadSchema("turn-request.schema.json"));
    });

    it("validates a conversation turn", () => {
      const payload = {
        message: "What should I consider for pricing?",
        scenario_id: "sc-001",
        client_turn_id: "ct-001",
        context: {
          graph: { nodes: [{ id: "g1", kind: "goal" }], edges: [] },
          analysis_response: null,
          framing: { stage: "frame" },
          messages: [{ role: "user", content: "Hello" }],
          scenario_id: "sc-001",
          analysis_inputs: null,
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a generate_model turn", () => {
      const payload = {
        message: "",
        scenario_id: "sc-002",
        client_turn_id: "ct-002",
        generate_model: true,
        context: {
          graph: null,
          analysis_response: null,
          framing: null,
          messages: [],
          scenario_id: "sc-002",
          analysis_inputs: null,
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a post-analysis turn with option_comparison (no results)", () => {
      const payload = {
        message: "Explain the results",
        scenario_id: "sc-003",
        client_turn_id: "ct-003",
        analysis_state: {
          meta: { response_hash: "abc123" },
          option_comparison: {
            best_option: "Option A",
            metrics: { cost: 100 },
          },
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a system_event turn", () => {
      const payload = {
        message: "",
        scenario_id: "sc-004",
        client_turn_id: "ct-004",
        system_event: {
          event_type: "patch_accepted",
          timestamp: "2026-03-17T00:00:00Z",
          event_id: "ev-001",
          details: {
            patch_id: "p-001",
            operations: [{ op: "add_node" }],
          },
        },
        graph_state: {
          nodes: [{ id: "g1", kind: "goal" }],
          edges: [],
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects missing scenario_id", () => {
      const payload = {
        message: "Hello",
        client_turn_id: "ct-005",
      };
      expect(validate(payload)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // orchestrator-response-v2.schema.json
  // ---------------------------------------------------------------------------
  describe("orchestrator-response-v2.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    const baseEnvelope = {
      turn_id: "t-001",
      assistant_text: "Here is my response.",
      blocks: [],
      suggested_actions: [],
      lineage: {
        context_hash: "abc123",
        dsk_version_hash: null,
      },
      stage_indicator: {
        stage: "frame",
        confidence: "high",
        source: "inferred",
      },
      science_ledger: {
        claims_used: [],
        techniques_used: [],
        scope_violations: [],
        phrasing_violations: [],
        rewrite_applied: false,
      },
      progress_marker: { kind: "none" },
      observability: {
        triggers_fired: [],
        triggers_suppressed: [],
        intent_classification: "explain",
        specialist_contributions: [],
        specialist_disagreement: null,
      },
      turn_plan: {
        selected_tool: null,
        routing: "deterministic",
        long_running: false,
      },
      guidance_items: [],
    };

    beforeAll(() => {
      validate = ajv.compile(loadSchema("orchestrator-response-v2.schema.json"));
    });

    it("validates a success envelope", () => {
      const valid = validate(baseEnvelope);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates an error envelope", () => {
      const payload = {
        ...baseEnvelope,
        turn_id: "t-002",
        assistant_text: null,
        error: {
          code: "PIPELINE_ERROR",
          message: "Something went wrong",
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a system event ack envelope", () => {
      const payload = {
        ...baseEnvelope,
        turn_id: "t-003",
        assistant_text: "Patch applied.",
        turn_plan: {
          selected_tool: null,
          routing: "deterministic",
          long_running: false,
          system_event: { type: "patch_accepted", event_id: "ev-001" },
        },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects missing turn_id", () => {
      const { turn_id: _, ...noTurnId } = baseEnvelope;
      expect(validate(noTurnId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // stream-event.schema.json
  // ---------------------------------------------------------------------------
  describe("stream-event.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    beforeAll(() => {
      validate = ajv.compile(loadSchema("stream-event.schema.json"));
    });

    it("validates a turn_start event", () => {
      const valid = validate({
        type: "turn_start",
        seq: 0,
        turn_id: "t-001",
        routing: "llm",
        stage: "frame",
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates an error event", () => {
      const valid = validate({
        type: "error",
        seq: 1,
        error: { code: "LLM_TIMEOUT", message: "Timeout" },
        recoverable: false,
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // analysis-state.schema.json
  // ---------------------------------------------------------------------------
  describe("analysis-state.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    beforeAll(() => {
      validate = ajv.compile(loadSchema("analysis-state.schema.json"));
    });

    it("validates analysis_state with option_comparison (no results array)", () => {
      const payload = {
        meta: { response_hash: "hash-xyz" },
        option_comparison: { best_option: "A", summary: "A wins" },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates analysis_state with results array", () => {
      const payload = {
        meta: { response_hash: "hash-abc" },
        results: [{ option_label: "A", win_probability: 0.6 }],
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates analysis_state without meta (option_comparison only)", () => {
      const payload = {
        option_comparison: { best_option: "B", summary: "B wins" },
      };
      const valid = validate(payload);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects non-object (string)", () => {
      expect(validate("not-an-object")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // system-event.schema.json
  // ---------------------------------------------------------------------------
  describe("system-event.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    beforeAll(() => {
      validate = ajv.compile(loadSchema("system-event.schema.json"));
    });

    it("validates a patch_accepted event", () => {
      const valid = validate({
        event_type: "patch_accepted",
        timestamp: "2026-03-17T00:00:00Z",
        event_id: "ev-001",
        details: {
          patch_id: "p-001",
          operations: [{ op: "add_node" }],
        },
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a direct_graph_edit event", () => {
      const valid = validate({
        event_type: "direct_graph_edit",
        timestamp: "2026-03-17T00:00:00Z",
        event_id: "ev-002",
        details: {
          changed_node_ids: ["n1"],
          changed_edge_ids: [],
          operations: ["add"],
        },
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates a feedback_submitted event", () => {
      const valid = validate({
        event_type: "feedback_submitted",
        timestamp: "2026-03-17T00:00:00Z",
        event_id: "ev-003",
        details: {
          turn_id: "t-100",
          rating: "up",
        },
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects unknown event_type", () => {
      expect(validate({
        event_type: "unknown_event",
        timestamp: "2026-03-17T00:00:00Z",
        event_id: "ev-004",
        details: {},
      })).toBe(false);
    });

    it("rejects missing event_id", () => {
      expect(validate({
        event_type: "patch_dismissed",
        timestamp: "2026-03-17T00:00:00Z",
        details: {},
      })).toBe(false);
    });

    // Refinement gap: runtime Zod requires patch_id or block_id for
    // patch_accepted, but JSON Schema cannot express superRefine logic.
    it("(refinement gap) patch_accepted without patch_id/block_id passes JSON Schema", () => {
      const valid = validate({
        event_type: "patch_accepted",
        timestamp: "2026-03-17T00:00:00Z",
        event_id: "ev-005",
        details: { operations: [{ op: "add_node" }] },
      });
      // Passes JSON Schema but would fail Zod superRefine at runtime
      expect(valid).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // graph-state.schema.json
  // ---------------------------------------------------------------------------
  describe("graph-state.schema.json", () => {
    let validate: ReturnType<Ajv["compile"]>;

    beforeAll(() => {
      validate = ajv.compile(loadSchema("graph-state.schema.json"));
    });

    it("validates a graph with nodes and edges", () => {
      const valid = validate({
        nodes: [
          { id: "g1", kind: "goal", label: "Increase revenue" },
          { id: "o1", kind: "option", label: "Option A" },
        ],
        edges: [{ from: "g1", to: "o1", kind: "supports" }],
      });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates null graph", () => {
      const valid = validate(null);
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("validates empty graph", () => {
      const valid = validate({ nodes: [], edges: [] });
      expect(validate.errors).toBeNull();
      expect(valid).toBe(true);
    });

    it("rejects missing nodes", () => {
      expect(validate({ edges: [] })).toBe(false);
    });

    it("rejects node without id", () => {
      expect(validate({
        nodes: [{ kind: "goal" }],
        edges: [],
      })).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Response envelope parity guard
  // ---------------------------------------------------------------------------
  describe("response envelope parity", () => {
    it("OrchestratorResponseEnvelopeV2Schema covers all required runtime fields", async () => {
      // Import the Zod schema and verify it has properties matching the
      // runtime interface's required fields. This catches drift where a
      // new required field is added to the interface but not the Zod schema.
      const { OrchestratorResponseEnvelopeV2Schema } = await import(
        "../../src/orchestrator/validation/response-envelope-schema.js"
      );
      const shape = OrchestratorResponseEnvelopeV2Schema.shape;

      const requiredRuntimeFields = [
        "turn_id",
        "assistant_text",
        "blocks",
        "suggested_actions",
        "lineage",
        "stage_indicator",
        "science_ledger",
        "progress_marker",
        "observability",
        "turn_plan",
        "guidance_items",
      ];

      for (const field of requiredRuntimeFields) {
        expect(shape).toHaveProperty(
          field,
          expect.anything(),
        );
      }

      // Verify optional fields are present in schema too
      const optionalRuntimeFields = [
        "assistant_tool_calls",
        "proposed_changes",
        "analysis_response",
        "applied_changes",
        "deterministic_answer_tier",
        "analysis_ready",
        "analysis_status",
        "status_reason",
        "retryable",
        "critiques",
        "meta",
        "error",
        "model_receipt",
        "diagnostics",
        "parse_warnings",
      ];

      for (const field of optionalRuntimeFields) {
        expect(shape).toHaveProperty(
          field,
          expect.anything(),
        );
      }
    });
  });
});
