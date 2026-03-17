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

    it("rejects missing meta.response_hash", () => {
      expect(validate({ meta: {} })).toBe(false);
    });
  });
});
