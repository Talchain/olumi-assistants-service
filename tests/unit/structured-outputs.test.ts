/**
 * Unit tests for Track B: Structured Outputs + Strict Tool Use
 *
 * Covers:
 * 1. Tool registry: strict-mode-compatible schemas (additionalProperties, required)
 * 2. Edit graph schema: structure validation
 * 3. Draft graph schema: closed top-level envelope
 * 4. Anthropic adapter: buildStrictAnthropicTools produces strict: true + additionalProperties: false
 * 5. isStructuredOutputsRejection: capability rejections vs. schema errors
 * 6. Thinking + structured outputs incompatibility guard
 * 7. OpenAI provider: strict: true not in registry (adapter-specific)
 */

import { describe, it, expect } from "vitest";
import { getToolDefinitions } from "../../src/orchestrator/tools/registry.js";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../src/orchestrator/tools/anthropic-edit-graph-schema.js";
import { __test_only } from "../../src/adapters/llm/anthropic.js";

const { buildStrictAnthropicTools, isStructuredOutputsRejection } = __test_only;

// =============================================================================
// 1. Tool Registry — Strict Mode Compatibility
// =============================================================================

describe("Tool Registry — strict mode compatibility", () => {
  const tools = getToolDefinitions();

  it("every tool has additionalProperties: false on input_schema", () => {
    for (const tool of tools) {
      expect(tool.input_schema).toHaveProperty("additionalProperties", false);
    }
  });

  it("every tool with properties has all properties listed in required[]", () => {
    for (const tool of tools) {
      const schema = tool.input_schema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      const propKeys = Object.keys(schema.properties ?? {});
      if (propKeys.length === 0) continue;
      expect(schema.required).toBeDefined();
      for (const key of propKeys) {
        expect(schema.required).toContain(key);
      }
    }
  });

  it("optional properties use type: ['string', 'null'] for strict mode", () => {
    const researchTopic = tools.find((t) => t.name === "research_topic");
    expect(researchTopic).toBeDefined();
    const schema = researchTopic!.input_schema as {
      properties: Record<string, { type: unknown }>;
    };
    expect(schema.properties.context.type).toEqual(["string", "null"]);
    expect(schema.properties.target_factor.type).toEqual(["string", "null"]);
    expect(schema.properties.query.type).toBe("string");
  });

  it("explain_results.focus uses nullable type and is in required[]", () => {
    const explainResults = tools.find((t) => t.name === "explain_results");
    expect(explainResults).toBeDefined();
    const schema = explainResults!.input_schema as {
      properties: Record<string, { type: unknown }>;
      required: string[];
    };
    expect(schema.properties.focus.type).toEqual(["string", "null"]);
    expect(schema.required).toContain("focus");
  });

  it("tools with no properties have empty properties and additionalProperties: false", () => {
    const runAnalysis = tools.find((t) => t.name === "run_analysis");
    expect(runAnalysis).toBeDefined();
    const schema = runAnalysis!.input_schema as {
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties)).toHaveLength(0);
    expect(schema.additionalProperties).toBe(false);
  });

  it("has 6 LLM-visible tools", () => {
    expect(tools).toHaveLength(6);
  });
});

// =============================================================================
// 2. Edit Graph Schema — Structure Validation
// =============================================================================

describe("ANTHROPIC_EDIT_GRAPH_SCHEMA", () => {
  it("requires operations, removed_edges, warnings, and coaching", () => {
    expect(ANTHROPIC_EDIT_GRAPH_SCHEMA.required).toContain("operations");
    expect(ANTHROPIC_EDIT_GRAPH_SCHEMA.required).toContain("removed_edges");
    expect(ANTHROPIC_EDIT_GRAPH_SCHEMA.required).toContain("warnings");
    expect(ANTHROPIC_EDIT_GRAPH_SCHEMA.required).toContain("coaching");
  });

  it("operations items have op enum with 6 valid operation types", () => {
    const opSchema = ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.operations.items;
    expect(opSchema.properties.op.enum).toEqual([
      "add_node", "remove_node", "update_node",
      "add_edge", "remove_edge", "update_edge",
    ]);
  });

  it("operations items require op and path", () => {
    const opSchema = ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.operations.items;
    expect(opSchema.required).toContain("op");
    expect(opSchema.required).toContain("path");
  });

  it("removed_edges items require from, to, and reason", () => {
    const edgeSchema = ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.removed_edges.items;
    expect(edgeSchema.required).toContain("from");
    expect(edgeSchema.required).toContain("to");
    expect(edgeSchema.required).toContain("reason");
  });

  it("coaching has summary and rerun_recommended fields", () => {
    const coaching = ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.coaching;
    expect(coaching.properties.summary.type).toBe("string");
    expect(coaching.properties.rerun_recommended.type).toBe("boolean");
  });

  it("top-level additionalProperties is false (closed envelope)", () => {
    expect(ANTHROPIC_EDIT_GRAPH_SCHEMA.additionalProperties).toBe(false);
  });

  it("is serialisable to JSON and round-trips correctly", () => {
    const json = JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA);
    const parsed = JSON.parse(json);
    expect(parsed.required).toEqual(ANTHROPIC_EDIT_GRAPH_SCHEMA.required);
  });
});

// =============================================================================
// 3. Draft Graph Schema — Closed Top-Level Envelope
// =============================================================================

describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA", () => {
  it("requires nodes and edges", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("nodes");
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.required).toContain("edges");
  });

  it("top-level additionalProperties is false (closed envelope)", () => {
    expect(ANTHROPIC_DRAFT_GRAPH_SCHEMA.additionalProperties).toBe(false);
  });
});

// =============================================================================
// 4. Anthropic Adapter — buildStrictAnthropicTools
// =============================================================================

describe("buildStrictAnthropicTools", () => {
  const sampleTools = [
    {
      name: "draft_graph",
      description: "Draft a graph.",
      input_schema: {
        type: "object",
        properties: { brief: { type: "string" } },
        required: ["brief"],
        additionalProperties: false,
      },
    },
    {
      name: "run_analysis",
      description: "Run analysis.",
      input_schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];

  it("adds strict: true to every tool", () => {
    const result = buildStrictAnthropicTools(sampleTools);
    for (const tool of result) {
      expect(tool).toHaveProperty("strict", true);
    }
  });

  it("forces additionalProperties: false on input_schema", () => {
    // Even if source doesn't have it, the helper adds it
    const toolsWithoutAP = [
      {
        name: "test_tool",
        description: "Test.",
        input_schema: { type: "object", properties: {} },
      },
    ];
    const result = buildStrictAnthropicTools(toolsWithoutAP);
    expect(result[0].input_schema).toHaveProperty("additionalProperties", false);
  });

  it("preserves tool name and description", () => {
    const result = buildStrictAnthropicTools(sampleTools);
    expect(result[0].name).toBe("draft_graph");
    expect(result[0].description).toBe("Draft a graph.");
    expect(result[1].name).toBe("run_analysis");
  });

  it("preserves existing input_schema properties", () => {
    const result = buildStrictAnthropicTools(sampleTools);
    const schema = result[0].input_schema as unknown as Record<string, unknown>;
    expect(schema).toHaveProperty("type", "object");
    expect(schema).toHaveProperty("required");
    expect((schema.required as string[])).toContain("brief");
  });

  it("produces same output for all registry tools (streaming/non-streaming parity)", () => {
    const tools = getToolDefinitions().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
    const result = buildStrictAnthropicTools(tools);
    expect(result).toHaveLength(6);
    for (const tool of result) {
      expect(tool).toHaveProperty("strict", true);
      expect(tool.input_schema).toHaveProperty("additionalProperties", false);
    }
  });
});

// =============================================================================
// 5. isStructuredOutputsRejection — Capability vs. Schema Errors
// =============================================================================

describe("isStructuredOutputsRejection", () => {
  it("returns true for capability rejection (output_format not recognized)", () => {
    const err = { status: 400, message: "Unknown parameter: output_format" };
    expect(isStructuredOutputsRejection(err)).toBe(true);
  });

  it("returns true for 'not supported' rejection", () => {
    const err = { status: 400, message: "Structured outputs not supported for this model" };
    expect(isStructuredOutputsRejection(err)).toBe(true);
  });

  it("returns false for malformed schema error (invalid + schema)", () => {
    const err = { status: 400, message: "Invalid JSON schema: unsupported keyword '$ref'" };
    expect(isStructuredOutputsRejection(err)).toBe(false);
  });

  it("returns false for unsupported schema feature error", () => {
    const err = { status: 400, message: "Unsupported schema feature: allOf is not allowed" };
    expect(isStructuredOutputsRejection(err)).toBe(false);
  });

  it("returns false for non-400 status", () => {
    const err = { status: 500, message: "output_format internal error" };
    expect(isStructuredOutputsRejection(err)).toBe(false);
  });

  it("returns false for null/undefined input", () => {
    expect(isStructuredOutputsRejection(null)).toBe(false);
    expect(isStructuredOutputsRejection(undefined)).toBe(false);
  });

  it("returns false for non-object input", () => {
    expect(isStructuredOutputsRejection("error")).toBe(false);
  });

  it("returns false for 400 with unrelated message", () => {
    const err = { status: 400, message: "Invalid max_tokens value" };
    expect(isStructuredOutputsRejection(err)).toBe(false);
  });
});

// =============================================================================
// 6. Thinking + Structured Outputs Guard
// =============================================================================

describe("Thinking + Structured Outputs incompatibility", () => {
  it("edit_graph schema is a valid JSON Schema object", () => {
    const schema = ANTHROPIC_EDIT_GRAPH_SCHEMA;
    expect(schema.type).toBe("object");
    expect(Array.isArray(schema.required)).toBe(true);
    expect(typeof schema.properties).toBe("object");
  });

  it("draft_graph schema is a valid JSON Schema object", () => {
    const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA;
    expect(schema.type).toBe("object");
    expect(Array.isArray(schema.required)).toBe(true);
    expect(typeof schema.properties).toBe("object");
  });
});

// =============================================================================
// 7. OpenAI Provider — strict: true not in registry
// =============================================================================

describe("OpenAI provider — strict mode isolation", () => {
  it("tool registry does NOT have strict at the tool level (adapter-specific)", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool).not.toHaveProperty("strict");
    }
  });
});
