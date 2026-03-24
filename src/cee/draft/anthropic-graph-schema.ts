/**
 * JSON Schema for Anthropic Structured Outputs — draft_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` has
 * `additionalProperties: false`. No exceptions. No runtime normalisation.
 *
 * Anthropic Structured Outputs requirements (GA since Jan 2026):
 * - Every `type: "object"` MUST have `additionalProperties: false`
 * - No `$ref`, no `oneOf`, no validation keywords (min/max/pattern/format)
 * - `required` lists only fields the LLM must always produce
 *
 * SCHEMA ALIGNMENT (v2 — 2026-03-24):
 * This version restores factor `data`, `prior`, option `interventions`,
 * goal threshold raw/cap, coaching `action_type`/`bias_category`, and rich
 * goal constraint fields. Without these the LLM cannot produce factor
 * values, and the entire ISL inference pipeline receives empty data.
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
          // ── Factor data (controllable/observable) ──────────────────────
          data: {
            type: "object",
            properties: {
              value: { type: "number" },
              raw_value: { type: "number" },
              unit: { type: "string" },
              cap: { type: "number" },
              extractionType: {
                type: "string",
                enum: ["explicit", "inferred"],
              },
              factor_type: {
                type: "string",
                enum: ["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"],
              },
              uncertainty_drivers: {
                type: "array",
                items: { type: "string" },
              },
              // Option node interventions: array of {factor_id, value} pairs.
              // The prompt produces object form — the normaliser converts post-parse.
              interventions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    factor_id: { type: "string" },
                    value: { type: "number" },
                  },
                  required: ["factor_id", "value"],
                  additionalProperties: false,
                },
              },
            },
            required: [],
            additionalProperties: false,
          },
          // ── Prior (external factors) ───────────────────────────────────
          prior: {
            type: "object",
            properties: {
              distribution: { type: "string" },
              range_min: { type: "number" },
              range_max: { type: "number" },
            },
            required: [],
            additionalProperties: false,
          },
          // ── Goal threshold fields ──────────────────────────────────────
          goal_threshold: { type: "number" },
          goal_threshold_raw: { type: "number" },
          goal_threshold_unit: { type: "string" },
          goal_threshold_cap: { type: "number" },
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
              action_type: {
                type: "string",
                enum: ["add_option", "add_constraint", "add_risk", "reframe_goal"],
              },
              bias_category: {
                type: "string",
                enum: ["anchoring", "framing", "confidence", "blindspots"],
              },
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
