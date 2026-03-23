/**
 * JSON Schema for Anthropic Structured Outputs — draft_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` with defined properties
 * has `additionalProperties: false`. Dynamic maps use `additionalProperties: true`.
 * No runtime normalisation needed.
 *
 * Used with Anthropic's GA structured outputs parameter:
 *   output_config: { format: { type: "json_schema", schema: <this schema> } }
 * when CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true.
 *
 * Anthropic Structured Outputs requirements (GA since Jan 2026):
 * - Every object with properties MUST have `additionalProperties: false`
 * - Dynamic maps (Record<string, T>) use `additionalProperties: true`
 * - No `$ref`, no `oneOf`, no validation keywords (min/max/pattern/format)
 * - `required` lists only fields the LLM must always produce
 *
 * The prompt contract (draft_graph_v187.txt OUTPUT_SCHEMA) is the authority
 * for what fields exist and which are required.
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
          data: {
            type: "object",
            properties: {
              // Factor data fields
              value: { type: "number" },
              raw_value: { type: "number" },
              unit: { type: "string" },
              cap: { type: "number" },
              baseline: { type: "number" },
              extractionType: {
                type: "string",
                enum: ["explicit", "inferred", "range", "observed"],
              },
              factor_type: {
                type: "string",
                enum: ["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"],
              },
              uncertainty_drivers: {
                type: "array",
                items: { type: "string" },
              },
              range: {
                type: "object",
                properties: {
                  min: { type: "number" },
                  max: { type: "number" },
                },
                required: [] as string[],
                additionalProperties: false,
              },
              confidence: { type: "number" },
              rangeMin: { type: "number" },
              rangeMax: { type: "number" },
              // Option data fields — dynamic map: factor_id → number
              interventions: {
                type: "object",
                additionalProperties: true,
              },
              // Constraint data fields
              operator: {
                type: "string",
                enum: [">=", "<="],
              },
            },
            required: [] as string[],
            additionalProperties: false,
          },
          prior: {
            type: "object",
            properties: {
              distribution: { type: "string" },
              range_min: { type: "number" },
              range_max: { type: "number" },
            },
            required: [] as string[],
            additionalProperties: false,
          },
          goal_threshold: { type: "number" },
          goal_threshold_raw: { type: "number" },
          goal_threshold_unit: { type: "string" },
          goal_threshold_cap: { type: "number" },
          baseline: { type: "number" },
          body: { type: "string" },
        },
        required: ["id", "kind"],
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
          // Legacy fields — accepted for backward compatibility
          belief: { type: "number" },
          weight: { type: "number" },
          strength_mean: { type: "number" },
          strength_std: { type: "number" },
        },
        required: ["from", "to"],
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
          provenance_source: { type: "string" },
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
              action_type: { type: "string" },
              bias_category: { type: "string" },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
      required: [] as string[],
      additionalProperties: false,
    },
  },
  required: ["nodes", "edges", "causal_claims", "topology_plan", "coaching"],
  additionalProperties: false,
};

export type AnthropicDraftGraphSchema = typeof ANTHROPIC_DRAFT_GRAPH_SCHEMA;
