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

// ── v10 (2026-07-18): flag-dark topology_plan omission ──────────────────
// The candidate is a zero-reader field the grammar was forcing the model to
// emit against the served prompt's explicit instruction. These tests pin BOTH
// arms: flag-off must be provably unchanged, flag-on must actually remove the
// key AND must not spend an optional-parameter slot (v9 left only one).
describe("v10 — buildDraftGraphSchema({ omitTopologyPlan })", () => {
  it("ANCHOR: topology_plan is a property of the base schema", () => {
    // Guards the builder against becoming a silent no-op if the field is
    // ever renamed — without this, flag-on would look enabled and do nothing.
    expect(
      Object.keys(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties),
    ).toContain("topology_plan");
    expect(
      (ANTHROPIC_DRAFT_GRAPH_SCHEMA as { required: string[] }).required,
    ).toContain("topology_plan");
  });

  it("flag OFF returns the v9 object BY IDENTITY (wire schema byte-identical)", () => {
    expect(buildDraftGraphSchema()).toBe(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(buildDraftGraphSchema({})).toBe(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(buildDraftGraphSchema({ omitTopologyPlan: false })).toBe(
      ANTHROPIC_DRAFT_GRAPH_SCHEMA,
    );
  });

  it("flag ON removes topology_plan from properties AND required", () => {
    const v10 = buildDraftGraphSchema({ omitTopologyPlan: true });
    expect(Object.keys(v10.properties)).not.toContain("topology_plan");
    expect(v10.required).not.toContain("topology_plan");
    // additionalProperties:false is what makes the key UNEMITTABLE rather
    // than merely not-required — the whole point of removing over demoting.
    expect(v10.additionalProperties).toBe(false);
  });

  it("flag ON changes NOTHING else — every other key and required entry survives", () => {
    const v10 = buildDraftGraphSchema({ omitTopologyPlan: true });
    const baseProps = Object.keys(ANTHROPIC_DRAFT_GRAPH_SCHEMA.properties)
      .filter((k) => k !== "topology_plan")
      .sort();
    expect(Object.keys(v10.properties).sort()).toEqual(baseProps);

    const baseReq = (ANTHROPIC_DRAFT_GRAPH_SCHEMA as { required: string[] }).required
      .filter((k) => k !== "topology_plan")
      .sort();
    expect(v10.required.slice().sort()).toEqual(baseReq);

    // The other two stringified aux fields must be untouched: they DO have
    // real CEE readers (coaching.bias_signals[*].detail reaches user-visible
    // assistant_text; causal_claims feeds graph-validator).
    expect(Object.keys(v10.properties)).toContain("coaching");
    expect(Object.keys(v10.properties)).toContain("causal_claims");
    expect(v10.required).toContain("coaching");
    expect(v10.required).toContain("causal_claims");
  });

  it("flag ON spends NO optional-parameter slot and shrinks the grammar", () => {
    const v10 = buildDraftGraphSchema({ omitTopologyPlan: true });
    // Removing a REQUIRED property cannot add optional params. Demoting it to
    // optional would have — v9 left exactly one slot (23 of 24).
    expect(countOptionalParams(v10)).toBe(
      countOptionalParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA),
    );
    expect(countOptionalParams(v10)).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    // Union budget untouched (topology_plan was a plain string, not a union).
    expect(countUnionParams(v10)).toBe(countUnionParams(ANTHROPIC_DRAFT_GRAPH_SCHEMA));
    // Grammar-size budget strictly improves.
    expect(JSON.stringify(v10).length).toBeLessThan(
      JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA).length,
    );
  });

  it("flag ON does not mutate the shared base schema", () => {
    const before = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    buildDraftGraphSchema({ omitTopologyPlan: true });
    expect(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA)).toBe(before);
  });
});
