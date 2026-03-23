/**
 * JSON Schema for Anthropic Structured Outputs — draft_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` has
 * `additionalProperties: false`. No exceptions. No runtime normalisation.
 *
 * Anthropic limits optional parameters to 24 across the schema tree.
 * This schema has been trimmed to stay within that limit: complex
 * sub-objects (data, prior) and legacy/rarely-used fields are omitted.
 * The normalisation layer and repair stage handle those downstream.
 *
 * Anthropic Structured Outputs requirements (GA since Jan 2026):
 * - Every `type: "object"` MUST have `additionalProperties: false`
 * - No `$ref`, no `oneOf`, no validation keywords (min/max/pattern/format)
 * - `required` lists only fields the LLM must always produce
 * - Max 24 optional parameters across the full schema tree
 */

export const ANTHROPIC_DRAFT_GRAPH_SCHEMA = {
  type: "object" as const,
  properties: {
    topology_plan: {
      type: "array",
      items: { type: "string" },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: {
            type: "string",
            enum: ["goal", "decision", "option", "outcome", "risk", "factor", "action", "constraint"],
          },
          label: { type: "string" },
          category: {
            type: "string",
            enum: ["controllable", "observable", "external"],
          },
          goal_threshold: { type: "number" },
          goal_threshold_unit: { type: "string" },
        },
        required: ["id", "kind", "label"],
        additionalProperties: false,
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          strength: {
            type: "object",
            properties: {
              mean: { type: "number" },
              std: { type: "number" },
            },
            required: ["mean", "std"],
            additionalProperties: false,
          },
          exists_probability: { type: "number" },
          effect_direction: {
            type: "string",
            enum: ["positive", "negative"],
          },
          edge_type: {
            type: "string",
            enum: ["directed", "bidirected"],
          },
          provenance_source: { type: "string" },
        },
        required: ["from", "to", "strength"],
        additionalProperties: false,
      },
    },
    rationales: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: "string" },
          why: { type: "string" },
        },
        required: ["target", "why"],
        additionalProperties: false,
      },
    },
    causal_claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          via: { type: "string" },
          between: { type: "array", items: { type: "string" } },
          stated_strength: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    goal_constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          operator: { type: "string" },
          value: { type: "number" },
        },
        required: ["node_id"],
        additionalProperties: false,
      },
    },
    coaching: {
      type: "object",
      properties: {
        summary: { type: "string" },
        strengthen_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              detail: { type: "string" },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "strengthen_items"],
      additionalProperties: false,
    },
  },
  required: ["nodes", "edges", "causal_claims", "topology_plan", "coaching"],
  additionalProperties: false,
};

export type AnthropicDraftGraphSchema = typeof ANTHROPIC_DRAFT_GRAPH_SCHEMA;
