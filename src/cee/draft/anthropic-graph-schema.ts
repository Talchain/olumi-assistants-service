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

import { FactorType, ExtractionType, PriorDistribution } from "../../schemas/graph.js";

// ── DRAFT CARDINALITY SOFT CAPS (v12 — 2026-07-23, lean-draft contract) ──
// Derived from the measured converged-draft distribution (n=17 success corpus:
// 10–17 nodes / 13–38 edges across every brief class), set ABOVE the observed
// maxima so no observed credible draft is flagged. These are a POST-PARSE
// DRIFT ALARM, not an enforcer: Anthropic structured outputs rejects `maxItems`
// (HTTP 400 "property 'maxItems' is not supported" — see
// adapters/llm/anthropic-schema-compliance.ts), so the grammar CANNOT cap array
// length during generation. The pipeline therefore cannot prevent a cardinality
// runaway structurally; it can only FLAG one loudly for diagnosis (a completed
// graph far above these caps signals a count-runaway or a structured-outputs
// prompt-only fallback). Trimming post-parse is deliberately NOT done — dropping
// nodes would orphan edges and risk shipping an invalid graph (never ship a
// corrupt draft). Single source of truth for the caps; the guard derives from
// these, and the grammar-budget test pins them so they cannot silently drift.
export const DRAFT_SOFT_NODE_CAP = 18;
export const DRAFT_SOFT_EDGE_CAP = 40;

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
              // ── v14 (2026-07-25): ENUMS RESTORED, DERIVED FROM THE ZOD ──
              // v7 pruned these to plain strings for the grammar-size budget
              // (the comment said so), NOT because a hard limit forbade them.
              // An `enum` costs NEITHER a union slot (9/16) NOR an optional
              // slot (22/24) — ONLY serialized bytes. Restoring them closes
              // free-text fields the model can loop inside, for bytes alone.
              // The byte and enum-value costs are MEASURED AND PINNED in
              // tests/unit/anthropic-graph-schema-grammar-budget.test.ts rather
              // than restated here: a hand-typed numeral in a comment is exactly
              // the drift this file's other pins exist to prevent.
              //
              // DERIVED from the SAME Zod objects the downstream validator uses
              // (`schemas/graph.ts`), never re-typed here: the grammar and the
              // validator cannot disagree about the value set, because there is
              // only one value set.
              //
              // ⚠ SCOPE OF THAT CLAIM, CORRECTED 2026-07-25 (F4). It is TRUE for
              // `extractionType` and `factor_type` — the draft LLM boundary
              // validates through `shared-schemas.ts` → `NodeData` →
              // `graph.ts`, so these two really are one value set. It is FALSE
              // for `prior.distribution` below: no validator reads
              // `PriorDistribution`, the wire schema types that field as
              // `z.string()`, and the enum mirrors a PMS-SERVED PROMPT that can
              // be re-pinned without a deploy. Do not read this paragraph as
              // covering that one — see the runtime drift alarm in
              // `transforms/schema-v3.ts`, which exists because nothing here can
              // cover it.
              extractionType: { type: "string", enum: [...ExtractionType.options] },
              factor_type: { type: "string", enum: [...FactorType.options] },
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
              // ⚠ `unit` STAYS FREE TEXT — v14 deliberately did NOT enumerate it,
              // against the initial plan, on measured evidence.
              // The proposal was to derive an enum from the set `display-value.ts`
              // hand-lists (CURRENCY_SYMBOLS + time units + "%"). Across a 20-draft
              // live corpus (2026-07-25) the model emitted `"£"` x7 and **`"scale"`
              // x4** — and `"scale"` is not in that set, so the enum would have made
              // 4 of 11 observed unit emissions UNGRAMMATICAL. The model would then
              // omit the unit or mislabel it, and `synthesiseDisplayValue` would
              // render a bare number instead of a captioned one.
              // The codebase already documents this: display-value.ts's priority-5
              // branch exists FOR arbitrary units and names "6 developers" /
              // "18 months" as the case it serves.
              // The per-string-value ceiling covers this field instead — which is
              // the whole point of having a mechanism rather than a field list.
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
              // v14 (2026-07-25): one-member enum, DERIVED. The served prompt
              // already states "distribution is always \"uniform\" in current
              // version" and 35/35 live emissions agree — this makes the
              // grammar enforce the promise the prompt already makes.
              distribution: { type: "string", enum: [...PriorDistribution.options] },
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
          // v12 (2026-07-23, lean-draft contract): `provenance_source` free text
          // dropped from the draft surface. It is per-edge natural-language
          // justification — exactly the DRAFT_LEAN_RETRY_DIRECTIVE filler — and
          // was already emitted on 0 edges across the success corpus, so its
          // removal is token-neutral on the happy path and forecloses a
          // per-edge-prose runaway. No compute consumer reads it (ISL GraphV2
          // edges never carry it).
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
    // budget). This keeps the wire schema byte-identical to the live-verified
    // compiling probe shape (3,194B, HTTP 200 on claude-sonnet-4-6).
    //
    // ⚠ CORRECTED 2026-07-25 (F7). This used to say the JSON-string instruction
    // "rides on the user message instead — STRUCTURED_OUTPUTS_AUX_STRING_REMINDER
    // in adapters/llm/anthropic.ts". THERE IS NO SUCH IDENTIFIER, and there is no
    // such instruction: the v12 lean-draft contract dropped coaching /
    // causal_claims / topology_plan from the SENT grammar, which made the old v8
    // reminder an empty-string no-op, and it was deleted on 2026-07-24
    // (simplification F2 — see the note beside DRAFT_COMPLIANCE_REMINDER in
    // adapters/llm/anthropic.ts, which is the surviving record). So the three
    // string-typed keys below are simply NOT SENT today. If one is ever restored
    // to the grammar, the instruction has to be restored with it.
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

// ── DEFERRED AUX KEYS (v12 — 2026-07-23, lean-draft contract, ROADMAP 1.197) ──
// The draft call now emits STRUCTURE ONLY. `coaching` and `causal_claims` are
// ~30% of draft output tokens (coaching ~21% + causal ~8%, b2b anatomy), the two
// most prose-heavy / most-runaway-prone surfaces, and NO compute consumer reads
// them (ISL/PLoT read GraphV2 structure only; GraphV3Schema is nodes+edges;
// coaching/causal ride as UI envelope siblings — reader-manifest re-verified
// at the deployed tips 2026-07-23). They are re-produced from the drafted
// structure by a bounded post-draft pass (unified-pipeline/stages/coaching-pass)
// and attached to the same response envelope, so the UI (their only consumer)
// sees no change. Removing them from the grammar (top-level
// additionalProperties:false makes the keys UNEMITTABLE, not merely unrequired)
// is the demand cut made structural, not a soft prompt instruction (1.197).
// `topology_plan` stays deferred as before (v11, zero-reader).
//
// Anchor assertion (trap-15: a tool that cannot fail is theatre). The builder
// below removes keys BY NAME. If any is ever renamed or dropped from the base
// object, a silent no-op would leak it back into the grammar — so fail loud at
// module load instead.
const TOPOLOGY_PLAN_KEY = 'topology_plan';
const DEFERRED_AUX_KEYS = [TOPOLOGY_PLAN_KEY, 'coaching', 'causal_claims'] as const;
// ⚠ THESE ANCHORS NOW THROW (2026-07-25). They were `console.error`, which in a
// Fastify process at import time is a line nobody reads — an anchor that cannot
// stop anything is the guarantee-theatre class this estate keeps hunting, and
// the thing it guards is the SILENT return of a runaway-prone field into the
// sent grammar. The unit suite asserts every anchor holds, so a genuine
// violation is caught in CI long before it could fail a boot.
// The UNION / OPTIONAL guardrails further below deliberately stay
// `console.error`: they warn about Anthropic's limits, which may not even apply
// (structured outputs can be off), and crashing on them was never intended.
for (const key of DEFERRED_AUX_KEYS) {
  if (!(key in ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties)) {
    throw new Error(
      `[anthropic-graph-schema] ANCHOR MISSING: '${key}' is not a property of ` +
      `ANTHROPIC_DRAFT_GRAPH_SCHEMA. buildDraftGraphSchema() would silently return an ` +
      `unchanged schema (${key} would leak back into the grammar). Update the v12 builder.`
    );
  }
}

// ── RUNAWAY-PRONE NODE-DATA KEYS (v13 — 2026-07-25) ──────────────────────
// `data.display_value` is the field the draft runaway actually lives in.
//
// Re-probed at the wire against api.anthropic.com with the SERVED prompt
// (draft_graph v195, 59,293 chars), THIS builder's output, claude-sonnet-4-6,
// temperature 0, thinking disabled, max_tokens 8550 — the live request minus
// CEE. The control arm reproduced the live failure (5/16 usable) and every
// characterised failure had the same anatomy:
//
//   …"factor_type":"cost","display_value":"No additional headcount hired yet
//   (baseline)  ␣␣␣… (8,113 more U+200B ZERO WIDTH SPACE) …
//
// A character-repetition loop INSIDE the string value of `display_value`.
// 10 of 10 characterised failures ended in this field (the repeated payload
// varies — U+200B runs, "← display only.  ", "No additional headcount hired in
// place currently." — the field never does), always in the SIXTH node, the
// first `factor`. The entire token budget is spent inside one string of one
// field. That is why time_to_edges was NULL 17/17, why the schema error was
// always `edges: Required`, why completion_tokens == cap EXACTLY at 8,550 /
// 12,000 / 16,000, and why raising the ceiling rescued nothing: an
// unterminated string has no length it is trying to reach.
//
// Measured effect of removing it (four arms, same brief/prompt/model, run
// concurrently so provider drift hits all arms equally):
//   control (today's live request)                       5/16 = 31%
//   temperature 0 -> 0.5                                  3/8  = 38%
//   two-call nodes-then-edges decomposition               5/8  = 63%
//   THIS CHANGE                                         16/16 = 100%   p ~ 1.4e-5
//   CONTROL: drop a DIFFERENT unconstrained free-text
//            string (data.encoding_map)                   2/8  = 25%
// The encoding_map arm is the load-bearing control: if the benefit were "a
// smaller grammar" or "one less optional param" it would have moved too. It did
// not. The effect is specific to the field the loop happens in.
//
// SAFE because the field is display-only and already has a DETERMINISTIC
// replacement. The served prompt says so itself (v195 line 392: "display_value
// is display-only; never affects inference or intervention logic"), and
// `formatGraphForContext` (orchestrator-v5/format/format-graph-for-context.ts)
// already prefers an existing `display_value` and SYNTHESISES one via
// `synthesiseDisplayValue` (cee/factor-extraction/display-value.ts, capped at
// 50 chars) when absent. This routes the field from "free prose the model
// writes, bounded by nothing" to "a deterministic formatter, bounded at 50
// characters" — the better answer independent of the runaway.
//
// The grammar CANNOT bound the string instead: `maxLength` is accepted by the
// structured-outputs compiler but not enforced at generation time, and is
// stripped by enforceAnthropicSchemaCompliance; `maxItems` 400s outright
// (re-probed at the wire 2026-07-25, still rejected). Removal is the only
// grammar-level lever that exists.
//
// SCOPE — do not over-read this. `label`, `uncertainty_drivers[]`, `unit` and
// `encoding_map` remain unconstrained strings by construction. 16/16 at the
// wire is evidence the loop did not migrate; it is not proof that it cannot.
//
// Anchor assertion (trap-15: a tool that cannot fail is theatre). The builder
// removes keys BY NAME from a NESTED object; a rename would make it a silent
// no-op that leaks the field straight back into the grammar.
export const RUNAWAY_PRONE_NODE_DATA_KEYS = ['display_value'] as const;

/** The node-`data` object schema (the non-null branch of its anyOf). */
function nodeDataObjectOf(schema: {
  properties: Record<string, unknown>;
}): { properties: Record<string, unknown>; required?: string[] } | undefined {
  const nodes = schema.properties.nodes as { items?: { properties?: Record<string, unknown> } } | undefined;
  const data = nodes?.items?.properties?.data as { anyOf?: unknown[] } | undefined;
  return data?.anyOf?.[0] as { properties: Record<string, unknown>; required?: string[] } | undefined;
}

for (const key of RUNAWAY_PRONE_NODE_DATA_KEYS) {
  if (!(key in (nodeDataObjectOf(ANTHROPIC_DRAFT_GRAPH_SCHEMA)?.properties ?? {}))) {
    throw new Error(
      `[anthropic-graph-schema] ANCHOR MISSING: '${key}' is not a property of ` +
      `ANTHROPIC_DRAFT_GRAPH_SCHEMA's node.data object. buildDraftGraphSchema() would ` +
      `silently return an unchanged grammar (${key} would leak back in). Update the v13 builder.`
    );
  }
}

// ── ENRICHER-OWNED GOAL-THRESHOLD KEYS (v15 — 2026-08-01, ROADMAP 2.281) ──
// The goal-threshold quad is MINTED BY CEE, never by the model.
//
// WHY THIS EXISTS. The whole goal-frame train (schemas 0.31.0, ISL's level→delta
// converter, PLoT frame forwarding, CEE's frame stamp #786 and baseline
// extraction #787) shipped and STILL produced no goal probability on staging,
// because on the live draft path THE MODEL minted `goal_threshold` itself. The
// enricher's redirect — the only code that stamps the threshold FRAME (see
// `CEE_GOAL_THRESHOLD_FRAME`, utils/goal-threshold-cap.ts) and that
// extracts the goal node's `observed_state` baseline — is gated on
// `goal_threshold === undefined` (factor-extraction/enricher.ts:652). A
// model-authored value closes that gate, so the frame was never stamped, ISL
// refused with GOAL_THRESHOLD_FRAME_UNSPECIFIED on every run, and the stated
// current level was filed as a separate factor node (`fac_current_revenue`).
// Measured live 2026-08-01 across three briefs, all three runs:
// PHASE0-EVIDENCE-2026-07-28/witness-2258-goal-probability-live.md §5.1, §7.1.
// The machinery was correct and UNREACHED — so the fix is not more machinery,
// it is removing the model's ability to reach past it.
//
// ATTESTATION BY CONSTRUCTION. The frame (`CEE_GOAL_THRESHOLD_FRAME`) is a
// CODE CONSTANT set on
// the same branch that computes `raw / cap` (enricher.ts:733) — it is true by
// construction there and is never derived from a model. A threshold the model
// wrote carries no such attestation and cannot be given one after the fact,
// because nothing downstream knows what frame the model meant. So the model
// must be unable to write one.
//
// WHY ALL FOUR KEYS, not just `goal_threshold`. The enricher writes the quad as
// a unit (enricher.ts:724-727) AND READS two of them as inputs to the cap
// resolver (`goal_threshold_cap`, `goal_threshold_unit` at :680-685). Excising
// only the gate field would leave the mint reachable but its DENOMINATOR
// model-authored — a half-attested contract, which is worse than either
// extreme because it reads as attested. The quad is one contract; it is minted
// as one or not at all.
//
// MECHANISM — REMOVAL IS "CANNOT EMIT", NOT "DISCOURAGED", *WHEN THE GRAMMAR IS
// SENT*. `nodes.items` carries `additionalProperties: false` (:315), so a key
// absent from `properties` is ungrammatical rather than merely not-required —
// the same lever v11/v12 used for the aux keys and v13 used for
// `data.display_value`. Under Anthropic structured outputs the grammar is
// compiled into constrained decoding, so the token sequence for the key cannot
// be produced.
//
// ⚠ THE SCOPE LIMIT OF THAT CLAIM, STATED BECAUSE IT IS LOAD-BEARING. The
// grammar is only sent when `structuredOutputsEnabled` (adapters/llm/
// anthropic.ts:795): the flag `CEE_ANTHROPIC_STRUCTURED_OUTPUTS` (config
// default FALSE), a model-allowlist hit, and thinking disabled — plus a
// documented `so_reject` rebuild that RETRIES prompt-only after a 400. On the
// prompt-only path THERE IS NO GRAMMAR AT ALL, so this excision alone would be
// inert exactly where the witness measured the defect. That is why it is paired
// with an ingress strip at the draft seam (`stripModelAuthoredGoalThreshold`,
// adapters/llm/normalisation.ts), which holds on every real-provider draft path
// regardless of structured-outputs posture. NEITHER layer is redundant: the
// grammar makes it unemittable when sent, the strip makes it unpersistable
// always. Do not remove one on the grounds that the other covers it.
//
// ⚠ NOTE FOR A FUTURE EDITOR: the frame field's literal identifier is
// deliberately NOT spelled out anywhere in this file, only its constant name.
// `goal-threshold-frame-stamp.test.ts` scans this file's WHOLE TEXT for that
// identifier and REDs on any occurrence — a coarse guard on purpose, because
// "the token must not appear in an LLM output surface at all" is stronger than
// any comment-aware variant, and the field it protects is the one the model
// must never be able to guess at. Spelling it out here, even in prose, breaks
// that gate. Do not "helpfully" restore it.
//
// The base object KEEPS the quad — it is what CEE TOLERATES at ingress (a
// stored graph, a repair response, or a prompt-only draft may legitimately
// carry the fields), exactly as v12/v13 keep their removed keys on the base.
//
// Anchor assertion (trap-15: a tool that cannot fail is theatre). The builder
// removes keys BY NAME from a NESTED object; a rename would make it a silent
// no-op that leaks the field straight back into the grammar.
export const ENRICHER_OWNED_GOAL_KEYS = [
  'goal_threshold',
  'goal_threshold_raw',
  'goal_threshold_unit',
  'goal_threshold_cap',
] as const;

/** The node-item object schema (`nodes.items`) — where the goal quad is declared. */
function nodeItemsObjectOf(schema: {
  properties: Record<string, unknown>;
}): { properties: Record<string, unknown>; required?: string[] } | undefined {
  const nodes = schema.properties.nodes as { items?: Record<string, unknown> } | undefined;
  return nodes?.items as { properties: Record<string, unknown>; required?: string[] } | undefined;
}

for (const key of ENRICHER_OWNED_GOAL_KEYS) {
  if (!(key in (nodeItemsObjectOf(ANTHROPIC_DRAFT_GRAPH_SCHEMA)?.properties ?? {}))) {
    throw new Error(
      `[anthropic-graph-schema] ANCHOR MISSING: '${key}' is not a property of ` +
      `ANTHROPIC_DRAFT_GRAPH_SCHEMA's nodes.items object. buildDraftGraphSchema() would ` +
      `silently return an unchanged grammar (${key} would leak back in). Update the v15 builder.`
    );
  }
}

/**
 * The draft-graph JSON schema actually sent to Anthropic.
 *
 * DERIVED from `ANTHROPIC_DRAFT_GRAPH_SCHEMA` rather than mirrored, so there is
 * exactly one source of truth for every field it shares with the base object.
 *
 * v11 (2026-07-21): topology_plan omission is UNCONDITIONAL (zero-reader).
 * v12 (2026-07-23, lean-draft contract): ALSO drops `coaching` and
 * `causal_claims` — the draft call is structure-only; both are re-produced by
 * the bounded post-draft coaching pass. All three deferred keys are dropped
 * from the sent grammar's `properties` and `required` here; the base object is
 * never mutated (so the guard counts + anchors keep their single source).
 * v13 (2026-07-25): ALSO drops the runaway-prone node-`data` free-text keys —
 * see RUNAWAY_PRONE_NODE_DATA_KEYS above. Because the node-`data` object
 * carries `additionalProperties: false`, removing the key makes it
 * UNEMITTABLE, not merely unrequired — which is the whole point: an optional
 * field the model still chooses to write can still loop inside it.
 * v15 (2026-08-01, ROADMAP 2.281): ALSO drops the enricher-owned goal-threshold
 * quad from `nodes.items` — see ENRICHER_OWNED_GOAL_KEYS above. Same lever, same
 * reason: `additionalProperties: false` turns removal into cannot-emit, so the
 * enricher's `goal_threshold === undefined` redirect always runs on a
 * goal-bearing brief and the frame is stamped by the code that earns it.
 */
export function buildDraftGraphSchema(): DraftGraphSchemaObject {
  const deferred = new Set<string>(DEFERRED_AUX_KEYS);
  const properties = Object.fromEntries(
    Object.entries(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties).filter(
      ([k]) => !deferred.has(k),
    ),
  );

  const built: DraftGraphSchemaObject = {
    ...ANTHROPIC_DRAFT_GRAPH_SCHEMA,
    properties,
    required: ANTHROPIC_DRAFT_GRAPH_SCHEMA.required.filter((k) => !deferred.has(k)),
  };

  // v13 — the node-data cut. Deep-clone ONLY the path being edited, so the base
  // object is never mutated (it stays the single source for the guard counts,
  // the anchors, and what CEE tolerates at ingress).
  const dropped = new Set<string>(RUNAWAY_PRONE_NODE_DATA_KEYS);
  const nodes = built.properties.nodes as Record<string, unknown>;
  const nodeItems = (nodes as { items: Record<string, unknown> }).items;
  const itemProps = nodeItems.properties as Record<string, unknown>;
  const dataProp = itemProps.data as { anyOf: unknown[] };
  // Read the node-`data` object through the SAME accessor the anchors and the
  // post-condition use, so a future change to that path lands in one place
  // instead of three. (The enclosing `built` spread shares structure with the
  // base object here — `clonedDataObject` below is what makes the edit
  // copy-on-write, so reading via the helper is equivalent and not aliased.)
  const dataObject = nodeDataObjectOf(built);
  if (!dataObject) {
    throw new Error(
      `[anthropic-graph-schema] STRUCTURE MISSING: nodes.items.properties.data.anyOf[0] is not ` +
      `reachable on the built schema, so the runaway-prone node-data cut cannot be applied.`
    );
  }

  const clonedDataObject = {
    ...dataObject,
    properties: Object.fromEntries(
      Object.entries(dataObject.properties).filter(([k]) => !dropped.has(k)),
    ),
    ...(dataObject.required
      ? { required: dataObject.required.filter((k) => !dropped.has(k)) }
      : {}),
  };
  // v15 — the goal-quad cut. Applied to the SAME cloned node-item properties as
  // the v13 data cut, so the two edits compose in one copy-on-write rather than
  // one silently rebuilding over the other.
  const goalOwned = new Set<string>(ENRICHER_OWNED_GOAL_KEYS);
  const nodeItemProps = Object.fromEntries(
    Object.entries({
      ...itemProps,
      data: { ...dataProp, anyOf: [clonedDataObject, ...dataProp.anyOf.slice(1)] },
    }).filter(([k]) => !goalOwned.has(k)),
  );

  built.properties = {
    ...built.properties,
    nodes: {
      ...nodes,
      items: {
        ...nodeItems,
        properties: nodeItemProps,
        // The quad is optional on the base object, so `required` cannot contain
        // it today — filtered anyway so a future promotion to required cannot
        // leave a dangling name that makes the sent grammar unsatisfiable.
        ...(Array.isArray((nodeItems as { required?: string[] }).required)
          ? {
            required: (nodeItems as { required: string[] }).required.filter(
              (k) => !goalOwned.has(k),
            ),
          }
          : {}),
      },
    },
  };

  return built;
}

// POST-CONDITION (trap-15: verify the write LANDED, never assume the edit ran).
// Asserted against the BUILT object, not the intent.
//
// ⚠ MOVED OUT OF THE BUILDER (2026-07-25). It ran on EVERY call — i.e. on every
// draft — to catch a defect that only an edit to `buildDraftGraphSchema()` can
// introduce. That is per-request cost for a compile-time property. Running it
// ONCE at module load makes it strictly stronger (it now fails the process
// rather than logging into a stream nobody reads) and free on the hot path.
// F6 (2026-07-25): ONE rebuild, hoisted out of the loop. It used to sit inside
// the `for`, so the whole grammar was rebuilt once PER KEY — harmless at
// length 1, pointless work the moment the list grows.
{
  const builtSchema = buildDraftGraphSchema();
  const builtData = nodeDataObjectOf(builtSchema);
  for (const key of RUNAWAY_PRONE_NODE_DATA_KEYS) {
    if (builtData && key in builtData.properties) {
      throw new Error(
        `[anthropic-graph-schema] REMOVAL NO-OP: '${key}' is still present in the SENT ` +
        `draft grammar after buildDraftGraphSchema(). The runaway-prone field cut did not land.`
      );
    }
  }
  // v15 (2.281) — the same post-condition for the goal quad. A silent no-op here
  // would hand the model back its ability to mint an unattested threshold, which
  // is the entire defect this cut exists to close.
  const builtItems = nodeItemsObjectOf(builtSchema);
  for (const key of ENRICHER_OWNED_GOAL_KEYS) {
    if (builtItems && key in builtItems.properties) {
      throw new Error(
        `[anthropic-graph-schema] REMOVAL NO-OP: '${key}' is still present in the SENT ` +
        `draft grammar after buildDraftGraphSchema(). The enricher-owned goal-threshold cut ` +
        `did not land, so the model can still mint an unattested threshold.`
      );
    }
  }
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
