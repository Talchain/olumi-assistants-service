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
 * - Max 24 optional parameters across the full schema tree
 *
 * OPTIONAL BUDGET (v3 — 2026-03-24):
 * Anthropic counts fields in `properties` that are NOT in `required` as
 * "optional parameters", with a hard limit of 24. To stay under the limit
 * while keeping all fields, we make most fields required-but-nullable:
 * the LLM always emits them (or emits null), so they don't count as
 * optional. The normaliser coerces null → undefined post-parse.
 *
 * Current optional count: 16 / 24. (is_baseline, intercept, display_value are required-nullable — no slots used)
 */

// Helpers for nullable types (required field that can be null)
const nullable = (typeName: string) => ({
  anyOf: [{ type: typeName }, { type: "null" }],
});
const nullableEnum = (values: string[]) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
});
const nullableArray = (items: Record<string, unknown>) => ({
  anyOf: [{ type: "array", items }, { type: "null" }],
});
const nullableObject = (props: Record<string, unknown>, req: string[]) => ({
  anyOf: [
    { type: "object", properties: props, required: req, additionalProperties: false },
    { type: "null" },
  ],
});

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
          // ── Required-nullable: LLM always classifies (or null for non-factors) ──
          category: nullableEnum(["controllable", "observable", "external"]),
          // ── Factor data (controllable/observable) or option interventions ──
          data: nullableObject(
            {
              // Required-nullable within data (LLM always decides)
              value: nullable("number"),
              extractionType: nullableEnum(["explicit", "inferred"]),
              factor_type: nullableEnum(["cost", "price", "time", "probability", "revenue", "demand", "quality", "other"]),
              uncertainty_drivers: nullableArray({ type: "string" }),
              interventions: nullableArray({
                type: "object",
                properties: {
                  factor_id: { type: "string" },
                  value: { type: "number" },
                },
                required: ["factor_id", "value"],
                additionalProperties: false,
              }),
              // Required-nullable within data (high value for scale consistency checks)
              raw_value: nullable("number"),
              unit: nullable("string"),
              cap: nullable("number"),
              // Encoding map for categorical factor labels (v191+).
              // JSON-stringified Record<string, string> — e.g. '{"0":"Developers","1":"Tech Lead"}'.
              // Anthropic structured outputs requires additionalProperties:false on all objects,
              // which is incompatible with dynamic keys, so we use a JSON string here.
              // The normalisation layer parses this back to Record<string,string>.
              encoding_map: nullable("string"),
              // Marks the status-quo / baseline option (v191+). Exactly one option should be true.
              // Set on option nodes only; null for all other node kinds.
              is_baseline: nullable("boolean"),
              // Human-readable factor value for UI rendering (v191+).
              // e.g. "£40,000", "No tech lead in place", "18 months".
              // Eliminates UI heuristics in formatFactorDisplayValue.ts.
              display_value: nullable("string"),
            },
            ["value", "extractionType", "factor_type", "uncertainty_drivers", "interventions", "raw_value", "unit", "cap", "encoding_map", "is_baseline", "display_value"],
          ),
          // ── Prior (external factors) ───────────────────────────────────
          prior: nullableObject(
            {
              distribution: nullable("string"),
              range_min: nullable("number"),
              range_max: nullable("number"),
            },
            ["distribution", "range_min", "range_max"],
          ),
          // ── Baseline flag (option nodes) ──────────────────────────────
          is_baseline: nullable("boolean"),
          // ── Intercept (root factor nodes) ─────────────────────────────
          intercept: nullable("number"),
          // ── Goal threshold fields ──────────────────────────────────────
          goal_threshold: nullable("number"),
          goal_threshold_raw: nullable("number"),
          goal_threshold_unit: nullable("string"),
          // (goal_threshold_cap stays optional — 1 optional slot)
          goal_threshold_cap: { type: "number" },
        },
        required: [
          "id", "kind", "label",
          // Required-nullable fields (don't count against optional limit)
          "category", "data", "prior",
          "is_baseline", "intercept",
          "goal_threshold", "goal_threshold_raw", "goal_threshold_unit",
        ],
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
          // Required-nullable: LLM always emits these for edges
          exists_probability: nullable("number"),
          effect_direction: nullableEnum(["positive", "negative"]),
          // Optional: sometimes produced
          edge_type: {
            type: "string",
            enum: ["directed", "bidirected"],
          },
          provenance_source: { type: "string" },
        },
        required: ["from", "to", "strength", "exists_probability", "effect_direction"],
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
          // Required-nullable: LLM always produces these for constraints
          constraint_id: nullable("string"),
          node_id: { type: "string" },
          operator: nullable("string"),
          value: nullable("number"),
          label: nullable("string"),
          // Optional: lower-value metadata
          unit: { type: "string" },
          source_quote: { type: "string" },
          confidence: { type: "number" },
          provenance: { type: "string" },
        },
        required: ["node_id", "constraint_id", "operator", "value", "label"],
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
              // Required-nullable: LLM always produces label/detail
              label: nullable("string"),
              detail: nullable("string"),
              // Optional: sometimes produced
              action_type: {
                type: "string",
                enum: ["add_option", "add_constraint", "add_risk", "reframe_goal"],
              },
              bias_category: {
                type: "string",
                enum: ["anchoring", "framing", "confidence", "blindspots"],
              },
            },
            required: ["id", "label", "detail"],
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
