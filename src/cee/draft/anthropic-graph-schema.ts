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
 *
 * GRAMMAR BUDGET (v8 — 2026-07-07 stringified aux fields, Lane 26):
 * v7 was NOT enough: the post-v7 schema (4,578B) still drew 400 "compiled
 * grammar is too large" on EVERY current model (verified live 2026-07-07,
 * 15-probe bisect), so every production draft silently fell back to
 * prompt-only JSON. The bisect showed total structural surface
 * (object schemas × properties) is the dominant compile cost: v7 carried
 * 13 object schemas / 72 properties, and even deleting the entire
 * coaching subtree (3,539B, 9 objects) still failed. The PASS/FAIL
 * boundary for this schema family sits between ~3.2KB / 7 objects (PASS)
 * and ~3.5KB / 9 objects (FAIL). No prune keeping all six top-level keys
 * as structured objects can fit — the aux content must leave the grammar.
 * v8 therefore declares the three aux subtrees — coaching, causal_claims,
 * topology_plan — as `{ type: "string" }` fields carrying JSON-encoded
 * payloads (the same pattern data.encoding_map already uses), keeping
 * full grammar enforcement on nodes/edges/goal_constraints. Verified
 * compiling live: HTTP 200 at 3,194B on claude-sonnet-4-6 (probe 14).
 *  - Ingress: parseStringifiedAuxFields() in adapters/llm/normalisation.ts
 *    JSON.parses the three strings before Zod/downstream consumers; on
 *    parse failure the field is dropped, which degrades to exactly the
 *    canonical-empty defaults Stage 5 already emits (identical to the
 *    prompt-only fallback path — enforcement never worse than status quo).
 *  - Aux value-set enforcement stays downstream, as v7 already had it:
 *    normalise-legacy-coaching + canonical CoachingSchema, item-wise
 *    validateCausalClaims Zod drop, Stage 5/6 topology_plan passthrough.
 *  - Re-verify ANY schema amendment live with
 *    scripts/probe-grammar-compile.mjs before merging.
 * Serialized size is pinned by tests/unit/anthropic-graph-schema-grammar-budget.test.ts;
 * see that file for how to verify grammar compilation against the live API.
 *
 * OUTPUT-TOKEN BUDGET (v9 — 2026-07-18, draft-latency lane):
 * A draft turn is ~99.8% one LLM call and latency is near-linear in OUTPUT
 * tokens, so every forced token is wall-clock. v8's `required` lists made the
 * grammar demand eight kind-scoped node fields and eight `data` sub-fields on
 * EVERY node, whatever its kind — a decision node was forced to emit
 * `"category":null,"data":null,"prior":null,"is_baseline":false,
 * "intercept":null,"goal_threshold":null,...` even though PMS draft_graph
 * v195 documents that node as exactly `{id, kind, label}`. Every one of those
 * values is coerced straight back to `undefined` by the ingress normaliser
 * (adapters/llm/normalisation.ts §SENTINEL & NULL COERCION), so they are
 * unreadable by construction: pure latency and cost.
 * Measured on a real captured draft (claude-sonnet-4-6, v195, structured
 * outputs on, 2026-07-18): 1,327 of 6,245 output tokens — 21% — were these
 * sentinels. v9 demotes them to optional. It does NOT remove any property or
 * narrow any type, so the accepted surface is a strict SUPERSET of v8 and a
 * model that still emits explicit nulls remains valid. Downstream sees an
 * identical post-normalisation object; no consumer changes.
 * Cost: optional-parameter count rises 7 → 23 of Anthropic's 24 limit, so the
 * budget is now TIGHT — countOptionalParams() below fails loud on the next
 * addition rather than letting structured outputs 400 in production.
 * Serialized size FALLS 3,194B → 2,974B (grammar budget improves).
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
                // P0 GUARD (2026-07-19) — `minItems: 1` makes the EMPTY array
                // ungrammatical. Without it every draft turn 500s.
                //
                // The served prompt (draft_graph v195) teaches interventions
                // as an OBJECT — every example reads
                // `"data": { "interventions": { "fac_id": 0.6 } }` — while
                // this grammar demands an ARRAY of {factor_id, value}. Under
                // structured outputs the GRAMMAR wins, so the model has to
                // translate shape on the fly; under v195's heavier
                // OPTION_RULES it stops translating and satisfies the grammar
                // with `[]` instead. That is legal and content-free, and it
                // is fatal: normalisation converts array->object so `[]`
                // becomes `{}`, buildInterventionSignature({}) returns "",
                // every option collides on the empty signature, and the
                // validator raises OPTIONS_IDENTICAL with
                // `intervention_signature: ""` — unrepairable by the LLM
                // repair stage, so the turn 500s.
                //
                // `required` DOES NOT FIX THIS: it forces the KEY, never the
                // CONTENT, and `[]` satisfies it. Measured against the served
                // v195 prompt (claude-sonnet-4-6, temp 0, n=3/arm):
                //   optional (the shape that shipped) -> OPTIONS_IDENTICAL 3/3
                //   required (the naive fix)          -> OPTIONS_IDENTICAL 3/3
                //   optional + minItems: 1 (this)     -> OPTIONS_IDENTICAL 0/3
                //   no grammar at all                 -> OPTIONS_IDENTICAL 0/3
                //
                // The field must stay OPTIONAL for this to be safe: a factor
                // node has no interventions and omits the key entirely
                // (measured: 0 non-option nodes emit it). Requiring it AND
                // bounding it would make every factor node ungrammatical.
                // Costs no optional-parameter slot and 13 bytes.
                // Guard: tests/unit/draft-grammar-option-interventions.test.ts
                minItems: 1,
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
            // v9 (2026-07-18, latency lane): only the three fields a `data`
            // block always carries stay required. The other eight were
            // forced sentinels ("" / 0 / [] / false) on every node that had
            // no use for them; normalisation.ts strips each one to
            // `undefined` at ingress, so demoting them is downstream-neutral
            // and removes ~0.3k output tokens per draft.
            ["value", "extractionType", "factor_type"],
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
        // OUTPUT-TOKEN BUDGET (v9 — 2026-07-18, latency lane):
        // Only the three fields every node genuinely carries stay required.
        // The kind-scoped fields below are OPTIONAL so the model can omit
        // them on nodes where they are inapplicable, instead of being forced
        // by the grammar to emit `null` / `0` / `""` sentinels the ingress
        // normaliser immediately coerces back to `undefined`
        // (normalisation.ts §SENTINEL & NULL COERCION, lines ~258-312).
        // Downstream sees an IDENTICAL object either way — the only
        // difference is ~1.3k wasted output tokens per draft (measured:
        // 21% of a real 6,245-token draft response, 2026-07-18).
        // The nullable anyOf wrappers are retained: a model that still emits
        // an explicit null stays valid, so this is a strict superset of the
        // v8 accepted surface.
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
    // v8 stringified aux fields (see GRAMMAR BUDGET (v8) above): the three
    // v0.11.0 aux subtrees are JSON-STRING fields — the grammar guarantees
    // a string, the prompt instructs JSON-encoded content, and
    // parseStringifiedAuxFields() (adapters/llm/normalisation.ts) parses
    // them back to objects/arrays at ingress before Zod/downstream
    // consumers. Do NOT re-objectify these without a live compile check
    // (scripts/probe-grammar-compile.mjs): the 2026-07-07 bisect proved no
    // schema keeping all six top-level keys as structured objects compiles.
    // Expected content, enforced downstream exactly as at v7:
    //  - causal_claims: JSON-encoded array of claim objects; canonical
    //    discriminated union enforced by validateCausalClaims (item-wise
    //    Zod drop with CAUSAL_CLAIM_DROPPED warning).
    //  - topology_plan: JSON-encoded string[] (≤15 structural lines).
    //  - coaching: JSON-encoded object {summary, strengthen_items,
    //    widening_log?, bias_signals?}; legacy shapes converted by
    //    normalise-legacy-coaching.ts, canonical CoachingSchema downstream.
    // No `description` keywords (by-construction invariant + grammar-size
    // budget): the JSON-string instruction to the model rides on the user
    // message instead — STRUCTURED_OUTPUTS_AUX_STRING_REMINDER in
    // adapters/llm/anthropic.ts, appended only when structured outputs is
    // active. This keeps the wire schema byte-identical to the live-verified
    // compiling probe shape (3,194B, HTTP 200 on claude-sonnet-4-6).
    causal_claims: { type: "string" },
    topology_plan: { type: "string" },
    coaching: { type: "string" },
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

// ── OUTPUT-TOKEN BUDGET (v11 — 2026-07-21, runaway-draft lane fix b) ──
// `topology_plan` is a zero-reader field that the grammar FORCES the model to
// emit, in direct contradiction of the served prompt.
//
//  - PMS draft_graph v195 line 159: "Do this planning silently in your
//    reasoning; the output JSON must NOT contain a topology_plan key."
//  - The v8/v9 grammar lists it in `required` above. The grammar wins, so it
//    is emitted anyway: measured 508 output tokens, 8.1% of a real draft.
//
// Nothing reads its CONTENT anywhere in the platform. In this repo the live
// V5 path is pure passthrough — parse.ts:422 stashes it on ctx, package.ts:452
// spreads it back, schema-v3.ts:1040 carries V1 → V3 — and no branch, render,
// validation or aggregation inspects an element. Cross-repo it is ABSENT from
// DecisionGuideAI and plot-lite-service (not even type-declared).
//
// It also cannot be chain-of-thought scaffolding for the graph: in a captured
// response it is emitted at char 15,490, AFTER nodes (char 1) and edges
// (char 8,920). A field emitted after the content it would scaffold cannot
// have scaffolded it — it is post-hoc narration of an already-written graph.
//
// WHY REMOVE THE PROPERTY RATHER THAN DEMOTE IT (the v9 pattern):
// v9 spent the optional-parameter budget down to 23 of Anthropic's hard 24.
// Demoting `topology_plan` to optional would spend the LAST slot on a field we
// want gone rather than permitted, leaving zero headroom. Deleting the property
// costs NO optional slot and is deterministic: the top-level object is
// `additionalProperties: false`, so the key becomes unemittable rather than
// merely unrequired. Union count and every `required` list elsewhere are
// untouched; serialized size falls further.
//
// v10 shipped this FLAG-DARK (`CEE_DRAFT_OMIT_TOPOLOGY_PLAN`, default false).
// v11 DELETES that flag and makes omission UNCONDITIONAL (no-dark-launches:
// ship the capability ON, roll back by code revert). The zero-reader premise
// was re-verified at HEAD before this change — a complete manifest of every
// `topology_plan` / `topologyPlan` occurrence in src/ plus a value-access
// sweep found NO consumer that inspects the field's CONTENT (schema defs are
// `.optional()`; every runtime touch is a conditional passthrough that no-ops
// when the field is absent), with a `coaching` positive control proving the
// sweep can see a real reader. Cross-repo it is absent from DecisionGuideAI
// and plot-lite-service.
//
// PERSISTENCE (`scenarios.graph`) — verified safe in both directions:
//  - Both Zod declarations are `.optional()` (schemas/cee-v3.ts:521,
//    schemas/assist.ts:266), so a response WITHOUT the key parses.
//  - transforms/schema-v3.ts:1041 defaults a missing value to `[]`, so the V3
//    boundary still always CARRIES the key. No consumer ever sees it missing;
//    new graphs simply persist an empty array.
//  - Stored graphs that already hold a populated array are untouched: the D1
//    mutation merge (apply-graph-mutation.ts:127) is a key-agnostic spread of
//    the full ingress shape, not a hand-listed allowlist, so re-load and
//    re-parse of an existing `scenarios.graph` is unaffected.
// The change is therefore forward-only and shape-preserving.

/**
 * Structural type both schema variants satisfy. Deliberately widened at
 * `properties` so the omit-variant (one key fewer) is assignable without a
 * double cast — the object is handed to the API as `Record<string, unknown>`
 * at the call site regardless.
 */
export type DraftGraphSchemaObject = {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
};

// Anchor assertion (trap-15: a tool that cannot fail is theatre). The builder
// below removes a key BY NAME. If `topology_plan` is ever renamed or dropped
// from the base object, a silent no-op would make the flag look enabled while
// changing nothing — so fail loud at module load instead.
const TOPOLOGY_PLAN_KEY = 'topology_plan';
if (!(TOPOLOGY_PLAN_KEY in ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties)) {

  console.error(
    `[anthropic-graph-schema] ANCHOR MISSING: '${TOPOLOGY_PLAN_KEY}' is not a property of ` +
    `ANTHROPIC_DRAFT_GRAPH_SCHEMA. buildDraftGraphSchema() would silently return an ` +
    `unchanged schema (topology_plan would leak back into the grammar). Update the v11 builder.`
  );
}

/**
 * The draft-graph JSON schema actually sent to Anthropic.
 *
 * DERIVED from `ANTHROPIC_DRAFT_GRAPH_SCHEMA` rather than mirrored, so there is
 * exactly one source of truth for every field it shares with the base object.
 *
 * v11 (2026-07-21): topology_plan omission is now UNCONDITIONAL — the
 * `CEE_DRAFT_OMIT_TOPOLOGY_PLAN` flag was deleted per no-dark-launches. The
 * builder always drops the zero-reader `topology_plan` property and its
 * `required` entry (508 output tokens saved, and the live prompt/grammar
 * contradiction — v195 says "must NOT contain a topology_plan key" while the
 * v8/v9 grammar demanded one — is resolved). The base object is never mutated.
 */
export function buildDraftGraphSchema(): DraftGraphSchemaObject {
  const { [TOPOLOGY_PLAN_KEY]: _omitted, ...properties } =
    ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties;

  return {
    ...ANTHROPIC_DRAFT_GRAPH_SCHEMA,
    properties,
    required: ANTHROPIC_DRAFT_GRAPH_SCHEMA.required.filter((k) => k !== TOPOLOGY_PLAN_KEY),
  };
}

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

// ── Optional-count guardrail ───────────────────────────────────────────
// Anthropic limits schemas to 24 OPTIONAL parameters (properties absent from
// their object's `required` list). v9 spends 23 of 24 buying the sentinel
// token cut, so the next optional property added anywhere in this tree
// breaks structured outputs in production — the call 400s and every draft
// silently falls back to prompt-only JSON, which is exactly the failure the
// v7/v8 grammar-budget notes above were written after.
//
// This is DERIVED from the schema, not a hand-maintained number: it walks the
// live object and recomputes. Exported for test assertions; logged at module
// load so a regression is visible without crashing the service.
export function countOptionalParams(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  if (Array.isArray(obj)) return obj.reduce((n: number, v) => n + countOptionalParams(v), 0);
  const rec = obj as Record<string, unknown>;
  let count = 0;
  if (rec.type === 'object' && rec.properties && typeof rec.properties === 'object') {
    const props = Object.keys(rec.properties as Record<string, unknown>);
    const required = new Set(Array.isArray(rec.required) ? (rec.required as string[]) : []);
    count += props.filter((p) => !required.has(p)).length;
  }
  for (const v of Object.values(rec)) count += countOptionalParams(v);
  return count;
}

export const ANTHROPIC_OPTIONAL_PARAM_LIMIT = 24;

const OPTIONAL_PARAM_COUNT = countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
if (OPTIONAL_PARAM_COUNT > ANTHROPIC_OPTIONAL_PARAM_LIMIT) {

  console.error(
    `[anthropic-graph-schema] OPTIONAL BUDGET EXCEEDED: ${OPTIONAL_PARAM_COUNT}/${ANTHROPIC_OPTIONAL_PARAM_LIMIT} optional params. ` +
    `Anthropic structured outputs will 400 and every draft will fall back to prompt-only JSON. ` +
    `Move a property back into a \`required\` list, or delete it.`
  );
}
