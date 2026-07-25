/**
 * ANTHROPIC_DRAFT_GRAPH_SCHEMA — grammar-size budget tripwire (Lane 3, 2026-07-07).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every staging draft_graph was failing structured outputs with Anthropic
 * 400 "The compiled grammar is too large... Simplify your tool schemas or
 * reduce the number of strict tools" (model claude-sonnet-4-6), silently
 * falling back to prompt-only JSON at ~48s per draft. This is a REGRESSION
 * of a previously-fixed failure:
 *   - commit 7eaee1131 (2026-04-02): an 11KB serialized schema exceeded the
 *     grammar compiler limit; slimming to nodes+edges+goal_constraints
 *     (3.2KB) fixed it (structured outputs compiled and ran).
 *   - commit 7f7fdb7c3 (v0.11.0 amendment): re-added coaching +
 *     causal_claims + topology_plan, re-inflating the schema to ~5.5KB —
 *     the compile failure returned on staging.
 * The v7 reduction (see the GRAMMAR BUDGET (v7) note in
 * src/cee/draft/anthropic-graph-schema.ts) pruned non-load-bearing enums
 * and collapsed the causal_claims 4-branch object anyOf, taking the
 * serialized schema to ~4.6KB, 9/16 unions, 7 enums / 25 enum values —
 * STILL over the compiler limit (verified live 2026-07-07: 400 on every
 * current model at 4,578B).
 *
 * v8 (2026-07-07, Lane 26) is the empirically-verified fix: coaching,
 * causal_claims, and topology_plan are declared `{ type: "string" }`
 * JSON-string fields (the encoding_map pattern), keeping full grammar
 * enforcement on nodes/edges/goal_constraints. A 15-probe live bisect
 * located the compile PASS/FAIL boundary for this schema family between
 * 3,194B / 7 object schemas (PASS — the v8 shape) and 3,539B / 9 object
 * schemas (FAIL — v7 minus the entire coaching subtree). Total structural
 * surface (objects × properties) is the dominant cost driver; killing all
 * unions, all enums, or all optionality individually did NOT rescue the
 * v7 schema. See scripts/probe-grammar-compile.mjs for the live tripwire.
 *
 * WHAT THE BUDGETS MEAN
 * ---------------------
 * Anthropic does not publish the grammar-compiler limit; serialized bytes,
 * enum values, union branches, and object/property counts are PROXIES that
 * correlate with compiled-grammar size. The budgets below pin the current
 * (post-v8) complexity with small headroom so future amendments cannot
 * silently re-inflate the schema the way v0.11.0 did. A budget pass does
 * NOT guarantee compilation — verify live (below) after any schema change.
 *
 * HOW TO VERIFY LIVE
 * ------------------
 * 1. On staging (or locally with CEE_ANTHROPIC_STRUCTURED_OUTPUTS=true and
 *    a real ANTHROPIC_API_KEY), trigger one draft_graph request.
 * 2. PASS: no `cee.draft_graph.structured_outputs_fell_back` telemetry
 *    event and no "[Anthropic] Structured Outputs rejected by API" WARN
 *    log; draft latency drops well below the ~48s prompt-only baseline.
 * 3. FAIL: the event/log fires with error_snippet "compiled grammar is too
 *    large" — the schema is still over the compiler limit; reduce further.
 * Minimal standalone probe (no CEE needed): send the schema as
 * `output_config.format = { type: "json_schema", schema }` on a 1-token
 * messages.create against the same model and check for a 400.
 */
import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_DRAFT_GRAPH_SCHEMA,
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  DRAFT_SOFT_EDGE_CAP,
  DRAFT_SOFT_NODE_CAP,
  RUNAWAY_PRONE_NODE_DATA_KEYS,
  buildDraftGraphSchema,
  countOptionalParams,
  countUnionParams,
} from "../../src/cee/draft/anthropic-graph-schema.js";

// ── Budgets (post-v8 measured values) ───────────────────────────────────────
// Measured on 2026-07-07 (v8): 3,194 bytes, 9 unions, 5 enums / 17 values,
// 8 object schemas (by this file's walk, which counts the root) / 52
// properties (7 optional).
//
// SERIALIZED_BYTES_BUDGET = 3400 pins the schema under the empirically-found
// compile boundary: live probes on 2026-07-07 showed HTTP 200 at 3,194B
// (the v8 shape, byte-identical to what this repo now builds) and 400
// "compiled grammar is too large" at 3,539B (v7 minus the whole coaching
// subtree) and above, on every current model (sonnet-4-5/4-6/5,
// opus-4-6/4-8, haiku-4-5 — the limit is API-wide). Bytes are a PROXY for
// structural surface — if you raise this number, you MUST re-verify
// compilation live (scripts/probe-grammar-compile.mjs) before merging.
const SERIALIZED_BYTES_BUDGET = 3400;
const UNION_PARAMS_BUDGET = 16; // Anthropic hard limit
const UNION_PARAMS_TRIPWIRE = 10; // current 9 + 1 headroom
const OPTIONAL_PARAMS_BUDGET = 24; // Anthropic hard limit
// v9 (2026-07-18, draft-latency lane) SPENDS this budget deliberately: the
// kind-scoped node/data fields moved out of `required` so the model can omit
// them instead of emitting sentinels the ingress normaliser throws away
// (21% of a real 6,245-token draft response). Count went 7 → 23 of 24.
// There is now exactly ONE slot left, so the tripwire and the hard limit have
// converged: the next optional property added anywhere in this tree breaks
// structured outputs in production (400 → silent prompt-only fallback on
// every draft). To add one, you must take one back into a `required` list.
const OPTIONAL_PARAMS_TRIPWIRE = 23; // v9 measured 23; 1 slot of headroom left
const ENUM_VALUES_TRIPWIRE = 20; // v8 measured 17 + headroom
// Object-schema count is pinned EXACTLY: the live bisect showed structural
// surface is the dominant compile cost, and a 9-object variant of this
// family already failed. Adding any object schema must be a deliberate,
// live-verified decision (update this pin + run the probe).
const OBJECT_NODES_TRIPWIRE = 8; // v8 measured 8 (root + nodes.items + data +
// interventions.items + prior + edges.items + strength + gc.items)

interface Stats {
  objects: number;
  maxProps: number;
  totalProps: number;
  optionalProps: number;
  enums: number;
  enumValues: number;
  anyOf: number;
  anyOfBranches: number;
}

function walk(node: unknown, stats: Stats): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, stats);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "object") {
    stats.objects += 1;
    const props = rec.properties ? Object.keys(rec.properties as object).length : 0;
    stats.maxProps = Math.max(stats.maxProps, props);
    stats.totalProps += props;
    const required = Array.isArray(rec.required) ? rec.required.length : 0;
    stats.optionalProps += Math.max(0, props - required);
  }
  if (Array.isArray(rec.enum)) {
    stats.enums += 1;
    stats.enumValues += rec.enum.length;
  }
  if (Array.isArray(rec.anyOf)) {
    stats.anyOf += 1;
    stats.anyOfBranches += (rec.anyOf as unknown[]).length;
  }
  for (const v of Object.values(rec)) walk(v, stats);
}

function measure(): Stats {
  const stats: Stats = {
    objects: 0,
    maxProps: 0,
    totalProps: 0,
    optionalProps: 0,
    enums: 0,
    enumValues: 0,
    anyOf: 0,
    anyOfBranches: 0,
  };
  walk(ANTHROPIC_DRAFT_GRAPH_SCHEMA, stats);
  return stats;
}

describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA — grammar-size budget", () => {
  it(`serialized schema stays under ${SERIALIZED_BYTES_BUDGET} bytes`, () => {
    const bytes = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA).length;
    expect(bytes).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
  });

  it("union-typed params stay within the Anthropic hard limit AND the tripwire", () => {
    const unions = countUnionParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(unions).toBeLessThanOrEqual(UNION_PARAMS_BUDGET);
    expect(unions).toBeLessThanOrEqual(UNION_PARAMS_TRIPWIRE);
  });

  it("optional params stay within the Anthropic hard limit AND the tripwire", () => {
    const stats = measure();
    expect(stats.optionalProps).toBeLessThanOrEqual(OPTIONAL_PARAMS_BUDGET);
    expect(stats.optionalProps).toBeLessThanOrEqual(OPTIONAL_PARAMS_TRIPWIRE);
  });

  it("total enum values stay under the tripwire (enum explosion guard)", () => {
    const stats = measure();
    expect(stats.enumValues).toBeLessThanOrEqual(ENUM_VALUES_TRIPWIRE);
  });

  it("object-node count stays under the tripwire (key-tracking state guard)", () => {
    const stats = measure();
    expect(stats.objects).toBeLessThanOrEqual(OBJECT_NODES_TRIPWIRE);
  });

  it("aux subtrees (coaching, causal_claims, topology_plan) are JSON-string fields — v8", () => {
    // v8 (2026-07-07): the three aux subtrees MUST be `{ type: "string" }`
    // JSON-string fields (the encoding_map pattern). The live bisect proved
    // no schema keeping all six top-level keys as structured objects can
    // compile — even v7-minus-the-entire-coaching-subtree failed at 3,539B.
    // Re-objectifying ANY of these fields will silently break structured
    // outputs for every production draft (400 → prompt-only fallback).
    // Enforcement for the aux content lives downstream, exactly as on the
    // prompt-only path: normalise-legacy-coaching + canonical CoachingSchema
    // for coaching, validateCausalClaims item-wise Zod drop for
    // causal_claims, Stage 5/6 passthrough for topology_plan.
    const props = (ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    }).properties;
    for (const key of ["coaching", "causal_claims", "topology_plan"]) {
      expect(props[key], `schema lost required aux field "${key}"`).toBeDefined();
      expect(props[key].type, `aux field "${key}" must be a JSON-string field (v8)`).toBe("string");
      expect(props[key].anyOf, `aux field "${key}" must not be a union`).toBeUndefined();
      expect(props[key].properties, `aux field "${key}" must not be an object schema`).toBeUndefined();
      expect(props[key].items, `aux field "${key}" must not be an array schema`).toBeUndefined();
    }
    // All six top-level keys stay required — the LLM must always emit them.
    expect((ANTHROPIC_DRAFT_GRAPH_SCHEMA as { required: string[] }).required.slice().sort()).toEqual(
      ["causal_claims", "coaching", "edges", "goal_constraints", "nodes", "topology_plan"],
    );
  });

  it("v9: kind-scoped node + data fields are OPTIONAL, not required (output-token budget)", () => {
    // WHY THIS PIN EXISTS
    // -------------------
    // A draft turn is ~99.8% one LLM call and latency is near-linear in
    // OUTPUT tokens (~80 tok/s measured on claude-sonnet-4-6, 2026-07-18).
    // Under v8 these fields were in `required`, so the grammar forced EVERY
    // node to emit them whatever its kind — a decision node carried
    // `"category":null,"data":null,"prior":null,"is_baseline":false,
    // "intercept":null,"goal_threshold":null,...` even though PMS
    // draft_graph v195 documents that node as exactly `{id, kind, label}`.
    // The ingress normaliser coerces every one of those values straight back
    // to `undefined` (adapters/llm/normalisation.ts §SENTINEL & NULL
    // COERCION), so they are unreadable BY CONSTRUCTION — pure wall-clock.
    // Measured on a real captured draft: 1,327 of 6,245 output tokens (21%).
    //
    // Putting any of these back into `required` re-introduces that cost
    // silently — nothing else in the suite would notice, because the wire
    // shape after normalisation is identical either way. Hence this pin.
    const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as {
      properties: {
        nodes: { items: { required: string[]; properties: Record<string, { anyOf?: { required?: string[] }[] }> } };
      };
    };
    const nodeItems = schema.properties.nodes.items;

    expect(nodeItems.required.slice().sort()).toEqual(["id", "kind", "label"]);

    const KIND_SCOPED_NODE_FIELDS = [
      "category", "data", "prior", "is_baseline", "intercept",
      "goal_threshold", "goal_threshold_raw", "goal_threshold_unit", "goal_threshold_cap",
    ];
    for (const field of KIND_SCOPED_NODE_FIELDS) {
      expect(
        nodeItems.required,
        `"${field}" is kind-scoped: requiring it forces a discarded sentinel on every other node kind`,
      ).not.toContain(field);
    }

    // `data`'s inner required list: only the three fields a data block always
    // carries. The other eight were forced "" / 0 / [] / false on every node
    // that had no use for them.
    const dataObject = nodeItems.properties.data.anyOf?.[0];
    expect(dataObject?.required?.slice().sort()).toEqual(["extractionType", "factor_type", "value"]);
    for (const field of [
      "uncertainty_drivers", "interventions", "raw_value", "unit", "cap",
      "encoding_map", "is_baseline", "display_value",
    ]) {
      expect(
        dataObject?.required ?? [],
        `data.${field} is kind-scoped: requiring it forces a discarded sentinel`,
      ).not.toContain(field);
    }
  });

  it("v9: the optional-count guard is DERIVED from the schema and fails loud", () => {
    // Trap #12 (hand-maintained mirror): the optional budget is one slot from
    // the hard limit, so the number must never be a comment someone forgets
    // to update. countOptionalParams walks the live object.
    expect(countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(measure().optionalProps);
    expect(ANTHROPIC_OPTIONAL_PARAM_LIMIT).toBe(OPTIONAL_PARAMS_BUDGET);

    // Positive control: the guard must be able to SEE a violation, not just
    // pass on today's shape (trap #13 — an absence assertion with no
    // demonstrated presence is vacuous).
    const overBudget = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: [],
    };
    expect(countOptionalParams(overBudget)).toBe(2);
  });

  it("load-bearing enums are retained (kind, category, operator, effect_direction)", () => {
    const s = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    // Node kind — core discriminator for the by-kind normaliser.
    expect(s).toContain('"goal"');
    expect(s).toContain('"factor"');
    // Factor category — required-nullable classification.
    expect(s).toContain('"controllable"');
    // Constraint operator.
    expect(s).toContain('">="');
    // Edge direction.
    expect(s).toContain('"positive"');
  });
});

// ── v12 (2026-07-23, lean-draft contract, ROADMAP 1.197): STRUCTURE-ONLY ──
// The draft call now emits STRUCTURE ONLY. buildDraftGraphSchema() drops all
// THREE deferred aux keys — topology_plan (v11, zero-reader) PLUS coaching and
// causal_claims (v12) — from the SENT grammar. coaching/causal are ~30% of
// draft output tokens, the two most prose-heavy / most-runaway-prone surfaces,
// and no compute consumer reads them (ISL/PLoT read GraphV2 structure only;
// GraphV3Schema is nodes+edges; validateGraph's coaching/causal checks are
// warning-only and guard-skip when absent). They are re-produced by the bounded
// post-draft coaching pass and attached to the same response envelope, so the
// UI (their only consumer) sees no change. The base object keeps all three (so
// the grammar-budget pins + guard counts have their single source); the builder
// is what drops them from the wire.
//
// NOTE on grammar cardinality: Anthropic structured outputs REJECTS `maxItems`
// (HTTP 400 "property 'maxItems' is not supported" — anthropic-schema-compliance
// .ts) and only accepts minItems 0/1, so array LENGTH cannot be capped in the
// grammar. Cardinality is a POST-PARSE drift alarm only (DRAFT_SOFT_*_CAP,
// parse.ts) — never a grammar enforcer. Do not add maxItems here.
describe("v12 — buildDraftGraphSchema() (structure-only: topology_plan + coaching + causal_claims omitted)", () => {
  const DEFERRED = ["topology_plan", "coaching", "causal_claims"];

  it("ANCHOR: all three deferred keys are properties of the base schema (so the builder actually removes them, not a silent no-op)", () => {
    for (const key of DEFERRED) {
      expect(Object.keys(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties)).toContain(key);
      expect((ANTHROPIC_DRAFT_GRAPH_SCHEMA as { required: string[] }).required).toContain(key);
    }
  });

  it("ALWAYS removes topology_plan, coaching AND causal_claims from properties AND required", () => {
    const v12 = buildDraftGraphSchema();
    for (const key of DEFERRED) {
      expect(Object.keys(v12.properties), `built grammar must not emit "${key}"`).not.toContain(key);
      expect(v12.required, `built grammar must not require "${key}"`).not.toContain(key);
    }
    // additionalProperties:false is what makes the keys UNEMITTABLE rather
    // than merely not-required — the whole point of removing over demoting.
    expect(v12.additionalProperties).toBe(false);
  });

  it("keeps EXACTLY the structural keys the draft still emits (nodes, edges, goal_constraints)", () => {
    const v12 = buildDraftGraphSchema();
    expect(Object.keys(v12.properties).sort()).toEqual(["edges", "goal_constraints", "nodes"]);
    expect(v12.required.slice().sort()).toEqual(["edges", "goal_constraints", "nodes"]);
  });

  it("does NOT return the base object by identity", () => {
    expect(buildDraftGraphSchema()).not.toBe(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
  });

  it("spends NO optional-parameter slot and shrinks the grammar", () => {
    const v12 = buildDraftGraphSchema();
    // ⚠ FLIP, DISCLOSED (v13, 2026-07-25). This assertion used to read
    // `toBe(countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA))` — the v12 cut
    // removed only REQUIRED top-level keys, so the optional count was unchanged.
    // v13 additionally removes `data.display_value`, which IS optional (it is
    // not in node.data's `required` list), so the sent grammar now spends
    // strictly FEWER optional slots than the base. Re-aimed rather than
    // deleted: the property the test exists to protect is "the sent grammar
    // never spends MORE of the 24-slot budget than the base", and that is now
    // asserted directly and derived, not mirrored against a literal.
    const baseOptional = countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(countOptionalParams(v12)).toBe(baseOptional - RUNAWAY_PRONE_NODE_DATA_KEYS.length);
    expect(countOptionalParams(v12)).toBeLessThanOrEqual(baseOptional);
    expect(countOptionalParams(v12)).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    // Union budget untouched (all three were plain strings, not unions).
    expect(countUnionParams(v12)).toBe(countUnionParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA));
    // Grammar-size budget strictly improves vs the base (3 fewer string props).
    expect(JSON.stringify(v12).length).toBeLessThan(
      JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA).length,
    );
  });

  it("does not mutate the shared base schema", () => {
    const before = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    buildDraftGraphSchema();
    expect(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(before);
  });

  it("edges no longer carry the provenance_source prose field", () => {
    const v12 = buildDraftGraphSchema() as unknown as {
      properties: { edges: { items: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(v12.properties.edges.items.properties)).not.toContain("provenance_source");
  });

  it("cardinality soft caps are pinned (post-parse drift alarm, NOT a grammar enforcer)", () => {
    // Single source of truth; the parse-stage guard derives from these. Pinned
    // so they cannot silently drift below the observed converged maxima (17
    // nodes / 38 edges) and start flagging credible drafts.
    expect(DRAFT_SOFT_NODE_CAP).toBe(18);
    expect(DRAFT_SOFT_EDGE_CAP).toBe(40);
    expect(DRAFT_SOFT_NODE_CAP).toBeGreaterThanOrEqual(17);
    expect(DRAFT_SOFT_EDGE_CAP).toBeGreaterThanOrEqual(38);
  });
});
