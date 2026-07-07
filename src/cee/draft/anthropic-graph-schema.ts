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
 * - Max 16 parameters with union types (anyOf / type arrays)
 *
 * UNION BUDGET (v4 — 2026-04-02):
 * Anthropic counts every field using `anyOf` or `type: [...]` as a
 * "union-typed parameter", hard limit 16. To stay well under the limit,
 * only outer wrappers (data, prior, category) and edge nullable fields
 * use anyOf. All inner fields use plain types; the normaliser coerces
 * sentinels (0, "", [], false) → undefined by node kind post-parse.
 *
 * GRAMMAR BUDGET (v6 — 2026-05-02 schema amendment):
 * v0.11.0 lifts coaching, causal_claims, and topology_plan into the
 * strict schema as required top-level fields. Within `coaching`,
 * `widening_log` and `bias_signals` are optional during the v192b →
 * v194 transition; CEE's ingress normaliser at anthropic.ts:884 fills
 * empty defaults so the canonical Zod parse passes downstream. `rationales`
 * remains omitted (legacy carry, no consumer enforcement).
 *
 * GRAMMAR BUDGET (v7 — 2026-07-07 grammar-size reduction, Lane 3):
 * The v6 amendment reintroduced the "compiled grammar is too large" 400
 * previously fixed on 2026-04-02 (commit 7eaee1131 slimmed an 11KB schema
 * to 3.2KB after the same error; v6 re-inflated it to ~5.5KB and every
 * staging draft_graph fell back to prompt-only JSON at ~48s). v7 prunes
 * non-load-bearing constraints WITHOUT changing the accepted output
 * surface — the grammar becomes a strict superset and downstream Zod /
 * ingress normalisers remain the enforcement (identical to what already
 * happens on the prompt-only fallback path, which has no grammar at all):
 *  - causal_claims: 4-branch object anyOf collapsed to ONE flat object
 *    (type enum kept; per-variant fields optional). Malformed claims are
 *    dropped item-wise by validateCausalClaims (CAUSAL_CLAIM_DROPPED).
 *  - Enums replaced by plain strings where a downstream normaliser/Zod
 *    owns the value set: data.extractionType, data.factor_type,
 *    strengthen_items[*].bias_category (the enum actively FOUGHT the
 *    documented legacy-value transition), widening_log.brief_completeness,
 *    bias_signals[*].type, causal stated_strength.
 * Load-bearing enums kept: node kind, factor category, edge
 * effect_direction / edge_type, goal_constraints operator,
 * strengthen_items action_type (UI chip dispatch), causal type.
 *
 * Post-v7 union count: 9 / 16. Post-v7 optional count: 15 / 24
 * (causal_claims per-variant fields are optional in the grammar).
 * Serialized size is pinned by tests/unit/anthropic-graph-schema-grammar-budget.test.ts;
 * see that file for how to verify grammar compilation against the live API.
 */

// Helpers for nullable types (required field that can be null)
const nullable = (typeName: string) => ({
  anyOf: [{ type: typeName }, { type: "null" }],
});
const nullableEnum = (values: string[]) => ({
  anyOf: [{ type: "string", enum: values }, { type: "null" }],
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
    // v0.11.0 schema amendment: topology_plan, coaching, causal_claims are
    // declared further below as required top-level fields.
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
          // Inner fields are plain (non-nullable) types to stay under the 16
          // union-param limit. LLM emits sentinels (0, "", [], false) for
          // inapplicable fields; normaliser strips them post-parse.
          data: nullableObject(
            {
              value: { type: "number" },
              // v7: enums pruned to plain strings (grammar-size budget).
              // Downstream Zod/normalisers own the value sets; the prompt
              // still instructs the canonical values.
              extractionType: { type: "string" },
              factor_type: { type: "string" },
              uncertainty_drivers: { type: "array", items: { type: "string" } },
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
              raw_value: { type: "number" },
              unit: { type: "string" },
              cap: { type: "number" },
              // Encoding map for categorical factor labels (v191+).
              // JSON-stringified Record<string, string> — e.g. '{"0":"Developers","1":"Tech Lead"}'.
              // Anthropic structured outputs requires additionalProperties:false on all objects,
              // which is incompatible with dynamic keys, so we use a JSON string here.
              encoding_map: { type: "string" },
              // Marks the status-quo / baseline option (v191+). false for non-option nodes.
              is_baseline: { type: "boolean" },
              // Human-readable factor value for UI rendering (v191+).
              // Empty string for non-applicable nodes; normaliser strips.
              display_value: { type: "string" },
            },
            ["value", "extractionType", "factor_type", "uncertainty_drivers", "interventions", "raw_value", "unit", "cap", "encoding_map", "is_baseline", "display_value"],
          ),
          // ── Prior (external factors) ───────────────────────────────────
          prior: nullableObject(
            {
              distribution: { type: "string" },
              range_min: { type: "number" },
              range_max: { type: "number" },
            },
            ["distribution", "range_min", "range_max"],
          ),
          // ── Baseline flag (option nodes) ──────────────────────────────
          // Plain boolean; false for non-option nodes. Normaliser strips by kind.
          is_baseline: { type: "boolean" },
          // ── Intercept (root factor nodes) ─────────────────────────────
          // Nullable: LLM emits null when not applicable or unspecified.
          intercept: nullable("number"),
          // ── Goal threshold fields ──────────────────────────────────────
          // Nullable: 0 is a valid threshold so sentinels would be ambiguous.
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
    // rationales omitted — legacy carry, no consumer enforcement.
    // causal_claims, coaching, topology_plan: declared below per v0.11.0.
    // v7 grammar-size reduction: the 4-branch discriminated-union anyOf was
    // the largest union in the tree and a dominant grammar-compilation cost.
    // Collapsed to ONE flat object: `type` keeps its enum (structure-
    // defining); the per-variant fields (from/to/via/between/
    // stated_strength) are grammar-optional. The canonical discriminated
    // union stays enforced downstream — validateCausalClaims Zod-parses each
    // claim (CausalClaimSchema) and DROPS malformed ones item-wise with a
    // CAUSAL_CLAIM_DROPPED warning, exactly as on the prompt-only path.
    causal_claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["direct_effect", "mediation_only", "no_direct_effect", "unmeasured_confounder"],
          },
          from: { type: "string" },
          to: { type: "string" },
          via: { type: "string" },
          between: {
            type: "array",
            items: { type: "string" },
          },
          // 4-band contract (very_strong|strong|moderate|slight) enforced by
          // the shared CausalClaimSchema downstream; plain string here (v7).
          stated_strength: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    topology_plan: {
      type: "array",
      items: { type: "string" },
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
              // Optional during transition — LLM may emit legacy values
              // (framing|confidence|blindspots) which the ingress normaliser
              // at anthropic.ts:884 maps to canonical BiasType before any
              // downstream parse. v7: plain string — the previous canonical
              // enum actively FORBADE the legacy values the normaliser is
              // documented to handle, forcing the model to guess a canonical
              // value under structured outputs.
              bias_category: { type: "string" },
            },
            required: ["id", "label", "detail", "action_type"],
            additionalProperties: false,
          },
        },
        // Optional during v192b → v194 transition. The legacy normaliser at
        // `src/adapters/llm/normalise-legacy-coaching.ts` converts the
        // legacy widening_log array shape to canonical object; Stage 5
        // emits a canonical-empty coaching block (incl. empty widening_log
        // + bias_signals) when the LLM produces no meaningful coaching,
        // and Stage 6 V3 transform mirrors that default for legacy paths.
        widening_log: {
          type: "object",
          properties: {
            elements_added: {
              type: "array",
              items: { type: "string" },
            },
            elements_considered_but_excluded: {
              type: "array",
              items: { type: "string" },
            },
            // v7: plain string (grammar budget); canonical Zod owns
            // complete|partial|thin downstream.
            brief_completeness: { type: "string" },
          },
          required: [
            "elements_added",
            "elements_considered_but_excluded",
            "brief_completeness",
          ],
          additionalProperties: false,
        },
        bias_signals: {
          type: "array",
          items: {
            type: "object",
            properties: {
              // v7: plain string (grammar budget); same BiasType domain as
              // bias_category — legacy values normalised at ingress,
              // canonical Zod enforces downstream.
              type: { type: "string" },
              detail: { type: "string" },
            },
            required: ["type", "detail"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "strengthen_items"],
      additionalProperties: false,
    },
    goal_constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          // Plain types; normaliser coerces "" → undefined for strings
          constraint_id: { type: "string" },
          node_id: { type: "string" },
          operator: { type: "string", enum: [">=", "<="] },
          value: { type: "number" },
          label: { type: "string" },
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
  },
  required: [
    "nodes",
    "edges",
    "goal_constraints",
    // v0.11.0 schema amendment: required at the LLM boundary.
    "coaching",
    "causal_claims",
    "topology_plan",
  ],
  additionalProperties: false,
};

export type AnthropicDraftGraphSchema = typeof ANTHROPIC_DRAFT_GRAPH_SCHEMA;

// ── Union-count guardrail ──────────────────────────────────────────────
// Anthropic limits schemas to 16 parameters with union types (anyOf / type arrays).
// Exported for test assertions; logged at module load to catch regressions
// without crashing the service when structured outputs may not even be in use.
export function countUnionParams(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  if (Array.isArray(obj)) return obj.reduce((n, v) => n + countUnionParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = ('anyOf' in rec || (Array.isArray(rec.type) && rec.type.length > 1)) ? 1 : 0;
  for (const v of Object.values(rec)) count += countUnionParams(v);
  return count;
}

const UNION_PARAM_COUNT = countUnionParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
if (UNION_PARAM_COUNT > 16) {
   
  console.error(
    `[anthropic-graph-schema] UNION BUDGET EXCEEDED: ${UNION_PARAM_COUNT}/16 union-typed params. ` +
    `Anthropic structured outputs will fail. Reduce anyOf/nullable usage.`
  );
}
