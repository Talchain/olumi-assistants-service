/**
 * JSON Schema for Anthropic Structured Outputs — edit_graph
 *
 * Used with Anthropic's `output_format: { type: "json_schema" }` parameter when
 * CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true. Guarantees parseable JSON and correct
 * top-level structure at the token generation level.
 *
 * Matches the EditGraphLLMResult shape:
 *   { operations: PatchOperation[], removed_edges: RemovedEdgeInfo[], warnings: string[], coaching: object | null }
 *
 * Deliberately not maximally strict — field-level validation of PatchOperation
 * discriminants and referential integrity is handled downstream by
 * patch-validation.ts and the PLoT validate-patch endpoint.
 *
 * The schema goal is: eliminate JSON parse failures and ensure the four
 * top-level arrays/objects are always present.
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
          value: { type: "object" },
          old_value: { type: "object" },
          impact: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["op", "path"],
        additionalProperties: true,
      },
      description: "Patch operations to apply to the graph",
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
        additionalProperties: true,
      },
      description: "Edges removed as a consequence of node removal",
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Advisory warnings about the edit",
    },
    coaching: {
      type: "object",
      properties: {
        summary: { type: "string" },
        rerun_recommended: { type: "boolean" },
      },
      additionalProperties: true,
      description: "Coaching output for the user",
    },
  },
  required: ["operations", "removed_edges", "warnings", "coaching"],
  additionalProperties: false,
} as const;

export type AnthropicEditGraphSchema = typeof ANTHROPIC_EDIT_GRAPH_SCHEMA;
