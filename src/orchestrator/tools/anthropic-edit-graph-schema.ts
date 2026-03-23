/**
 * JSON Schema for Anthropic Structured Outputs — edit_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` has
 * `additionalProperties: false`. No exceptions. No runtime normalisation.
 *
 * Matches the EditGraphLLMResult top-level shape. The `value` and `old_value`
 * fields are intentionally omitted — they carry arbitrary patch payloads that
 * cannot be represented as a closed schema. The LLM still produces them via
 * prompt instructions; they are parsed downstream by patch-validation.ts.
 * With additionalProperties:false on operations.items, the LLM cannot include
 * unlisted fields — this means value/old_value are NOT schema-constrained.
 * The structured output guarantees the envelope shape (operations array with
 * op/path, removed_edges, warnings, coaching); patch content relies on prompt.
 */

export const ANTHROPIC_EDIT_GRAPH_SCHEMA = {
  type: "object" as const,
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: {
            type: "string",
            enum: ["add_node", "remove_node", "update_node", "add_edge", "remove_edge", "update_edge"],
          },
          path: { type: "string" },
          impact: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["op", "path"],
        additionalProperties: false,
      },
    },
    removed_edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["from", "to", "reason"],
        additionalProperties: false,
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    coaching: {
      type: "object",
      properties: {
        summary: { type: "string" },
        rerun_recommended: { type: "boolean" },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  required: ["operations", "removed_edges", "warnings", "coaching"],
  additionalProperties: false,
};

export type AnthropicEditGraphSchema = typeof ANTHROPIC_EDIT_GRAPH_SCHEMA;
