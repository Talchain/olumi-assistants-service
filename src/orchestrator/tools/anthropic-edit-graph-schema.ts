/**
 * JSON Schema for Anthropic Structured Outputs — edit_graph
 *
 * COMPLIANT BY CONSTRUCTION — every `type: "object"` has
 * `additionalProperties: false`. No exceptions. No runtime normalisation.
 *
 * GRAMMAR BUDGET (v2, Tier A #1 edit-reliability, 2026-07-09)
 * -------------------------------------------------------------------------
 * v1 of this schema (Lane pre-history) omitted `value`/`old_value` from
 * operations.items entirely — with `additionalProperties: false` and no
 * declared slot for them, the LLM was STRUCTURALLY FORBIDDEN from emitting
 * either field, making add_node/update_node/add_edge/update_edge
 * non-functional under strict grammar mode. Structured outputs was
 * therefore disabled for edit_graph entirely (commit 24ddf9d8f) and
 * edit_graph fell back to prompt-only JSON — the same ~50% prose-instead-
 * of-JSON failure mode Lane 26 (PR #367) found and fixed for draft_graph.
 *
 * v2 applies the SAME fix Lane 26 verified live for draft_graph's
 * coaching/causal_claims/topology_plan subtrees: declare `value` and
 * `old_value` as `{ type: "string" }` JSON-encoded fields (the
 * `data.encoding_map` / v8-aux-field pattern) instead of omitting them.
 * The model can now emit ANY patch payload — a full node/edge object, a
 * partial update record, or a bare scalar for a path-suffixed field
 * update — inside a schema-legal string slot. `parseStringifiedOperationPayload()`
 * in edit-graph.ts unwraps it (JSON.parse) before Zod / PLoT ever see it;
 * on parse failure the field is DROPPED (never left as a garbage string),
 * which degrades to exactly today's `value — Required` Zod rejection and
 * drives the existing repair loop — enforcement is never worse than the
 * prompt-only status quo. Adding two string properties (no new object
 * schemas, no unions, no enums) keeps this schema far under the
 * empirically-found ~3,400B grammar-compiler ceiling from Lane 26 — see
 * tests/unit/anthropic-edit-graph-schema-grammar-budget.test.ts and
 * scripts/probe-grammar-compile-edit-graph.mjs for the live tripwire.
 *
 * The structured output now guarantees the FULL envelope shape (operations
 * array with op/path/value/old_value, removed_edges, warnings, coaching) —
 * this is what eliminates the prose-instead-of-JSON failure mode, since the
 * model is grammar-constrained to emit valid JSON matching this shape on
 * every attempt (first attempt and repair attempts alike).
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
          // v2 stringified payload fields — see GRAMMAR BUDGET (v2) above.
          // JSON-encoded string, e.g. "value": "{\"id\":\"fac_x\",...}" for
          // add_node, or a bare JSON scalar string e.g. "value": "0.8" for a
          // path-suffixed single-field update. Omit for remove_node/remove_edge
          // (no payload needed).
          value: { type: "string" },
          old_value: { type: "string" },
          // ROADMAP 1.46 residual (task_97fbcb00) — a small, structurally
          // typed side-channel for a factor node's `category`, mirroring
          // the draft schema's load-bearing-enum doctrine (node kind /
          // factor category / edge type stay REAL schema enums even where
          // other subtrees are stringified — see
          // src/cee/draft/anthropic-graph-schema.ts). The `value` field
          // above is an opaque JSON string the grammar cannot look inside,
          // so it cannot stop the model emitting an invalid category
          // (e.g. "strategic") INSIDE that blob — this field can: it is a
          // real enum slot the grammar enforces, closed to GraphV3's three
          // valid values. Optional — most ops never touch category.
          // edit-graph.ts's `normaliseOperation` prefers this field over
          // any `category` embedded in the stringified `value` payload.
          category: {
            type: "string",
            enum: ["controllable", "observable", "external"],
          },
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
