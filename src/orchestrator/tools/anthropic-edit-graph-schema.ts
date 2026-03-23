/**
 * JSON Schema for Anthropic Structured Outputs — edit_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` with defined properties
 * has `additionalProperties: false`. Dynamic maps use `additionalProperties: true`.
 * No runtime normalisation needed.
 *
 * Used with Anthropic's GA structured outputs parameter:
 *   output_config: { format: { type: "json_schema", schema: <this schema> } }
 * when CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true.
 *
 * Matches the EditGraphLLMResult shape:
 *   { operations: PatchOperation[], removed_edges: RemovedEdgeInfo[], warnings: string[], coaching: object | null }
 *
 * Field-level validation of PatchOperation discriminants and referential integrity
 * is handled downstream by patch-validation.ts and the PLoT validate-patch endpoint.
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
          // Dynamic patch payloads — keys vary by op type (node fields, edge fields, etc.)
          value: { type: "object", additionalProperties: true },
          old_value: { type: "object", additionalProperties: true },
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
