/**
 * JSON Schema for Anthropic Structured Outputs — draft_graph
 *
 * Used with Anthropic's GA structured outputs parameter:
 *   output_config: { format: { type: "json_schema", schema: <this schema> } }
 * when CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true. Guarantees parseable JSON and
 * correct top-level structure at the token generation level.
 *
 * Deliberately not maximally strict — field-level validation (node kinds, edge
 * patterns, belief distributions) is handled downstream by Stage 4 (Repair).
 * The schema goal is: eliminate JSON parse failures and ensure `nodes` + `edges`
 * arrays are always present.
 *
 * IMPORTANT: The nested key is "schema", NOT "json_schema" — the API returns
 * 400 "Unexpected key" if the wrong key is used.
 *
 * Anthropic Structured Outputs (GA since Jan 2026):
 * - GA parameter: output_config.format (no beta header required)
 * - Deprecated parameter: output_format (still works during transition)
 * - Supported models: Claude Sonnet 4.5+, Opus 4+, Haiku 4.5+
 * - Schema must use JSON Schema draft-07 subset (no $ref, $defs, allOf, anyOf
 *   at the top level of required properties)
 *
 * Reference: https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/increase-consistency
 */

/**
 * Minimal JSON schema that guarantees parseable JSON with correct top-level
 * structure for a draft_graph response.
 *
 * All fields except `nodes` and `edges` are optional — the pipeline's repair
 * stage (Stage 4) fills missing fields.
 */
export const ANTHROPIC_DRAFT_GRAPH_SCHEMA = {
  type: "object" as const,
  properties: {
    topology_plan: {
      type: "array",
      items: { type: "string" },
      description: "Pre-generation topology plan — list of node IDs in draft order",
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
          data: { type: "object" },
          prior: { type: "object" },
          goal_threshold: { type: "number" },
          goal_threshold_raw: { type: "number" },
          goal_threshold_unit: { type: "string" },
          goal_threshold_cap: { type: "number" },
          baseline: { type: "number" },
          interventions: { type: "object" },
        },
        required: ["id", "kind"],
        additionalProperties: true,
      },
      description: "Graph nodes — minimum required for a valid graph response",
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
          },
          belief: { type: "number" },
          weight: { type: "number" },
          strength_mean: { type: "number" },
          strength_std: { type: "number" },
          exists_probability: { type: "number" },
          effect_direction: {
            type: "string",
            enum: ["positive", "negative"],
          },
          edge_type: {
            type: "string",
            enum: ["directed", "bidirected"],
          },
          provenance: { type: "object" },
          provenance_source: { type: "string" },
        },
        required: ["from", "to"],
        additionalProperties: true,
      },
      description: "Graph edges connecting nodes",
    },
    rationales: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: "string" },
          why: { type: "string" },
          provenance_source: { type: "string" },
        },
        required: ["target", "why"],
        additionalProperties: true,
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
        additionalProperties: true,
      },
    },
    goal_constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          constraint_id: { type: "string" },
          node_id: { type: "string" },
          operator: { type: "string" },
          value: { type: "number" },
          label: { type: "string" },
          unit: { type: "string" },
          source_quote: { type: "string" },
          confidence: { type: "number" },
          provenance: { type: "string" },
        },
        required: ["node_id"],
        additionalProperties: true,
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
              action_type: { type: "string" },
              bias_category: { type: "string" },
            },
            required: ["id"],
            additionalProperties: true,
          },
        },
      },
      additionalProperties: true,
    },
  },
  required: ["nodes", "edges"],
  additionalProperties: false,
} as const;

export type AnthropicDraftGraphSchema = typeof ANTHROPIC_DRAFT_GRAPH_SCHEMA;
