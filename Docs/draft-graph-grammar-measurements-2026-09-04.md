# draft_graph grammar — preserved measurement record (v4 → v15)

**Status: FROZEN RECORD. Append-only. Do not edit the measurements below.**

Moved verbatim on **2026-09-04** from the file-level JSDoc of
`src/cee/draft/anthropic-graph-schema.ts` (lines 1–103 at commit
`ae6284b8da162df5d4e57c971605dc07c1ab4767`).

## Why this was moved

These are real, live-probed measurements of Anthropic structured-output
behaviour — grammar compile PASS/FAIL boundaries, serialized byte counts, a
15-probe bisect, and an output-token census — and they are worth keeping.

They were moved because of **where** they were sitting, not because of what
they say. They documented `buildDraftGraphSchema()`, which is **no longer the
grammar CEE sends**: the draft adapter sends `buildDraftRecordsSchema()` from
`src/cee/draft/records/grammar.ts` (call site
`src/adapters/llm/anthropic.ts`). Because this record is far more
measurement-dense than the live records grammar's own documentation, readers
who did not think to check who calls the builder repeatedly treated it as
authoritative about the **current** send path. It is not.

**Scope of these numbers.** Every figure below was measured against the
**graph** grammar (`buildDraftGraphSchema()` / `ANTHROPIC_DRAFT_GRAPH_SCHEMA`).
None of them was measured against the records grammar that is sent today. The
general lessons about Anthropic's compile limits are likely to carry across;
the specific byte counts, object counts and token shares are **not** claims
about the live path and must be re-measured before being used as such.

That the builder has no production call site is not asserted here on trust — it
is enforced by
`tests/unit/draft-graph-builder-unmounted.test.ts`, which derives the call
sites and fails if one ever returns.

---

## Verbatim record

The block below is reproduced exactly as it stood in the source file.

```
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
```
