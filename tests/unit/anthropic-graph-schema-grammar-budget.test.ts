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
  countUnionParams,
} from "../../src/cee/draft/anthropic-graph-schema.js";

// ── Budgets (post-v8 measured values + small headroom) ─────────────────────
// Measured on 2026-07-07 (v8): ~3.2KB serialized, 9 unions, 7 objects.
//
// SERIALIZED_BYTES_BUDGET = 3400 pins the schema under the empirically-found
// compile boundary: live probes on 2026-07-07 showed HTTP 200 at 3,194B
// (7 object schemas — the v8 shape) and 400 "compiled grammar is too large"
// at 3,539B (9 object schemas) and above, on every current model
// (sonnet-4-5/4-6/5, opus-4-6/4-8, haiku-4-5 — the limit is API-wide).
// 3,400B sits inside the verified-PASS side of that 3.1–3.5KB boundary with
// ~200B headroom over the v8 measurement. Bytes are a PROXY for structural
// surface — if you raise this number, you MUST re-verify compilation live
// (scripts/probe-grammar-compile.mjs) before merging.
const SERIALIZED_BYTES_BUDGET = 3400;
const UNION_PARAMS_BUDGET = 16; // Anthropic hard limit
const UNION_PARAMS_TRIPWIRE = 10; // current 9 + 1 headroom
const OPTIONAL_PARAMS_BUDGET = 24; // Anthropic hard limit
const OPTIONAL_PARAMS_TRIPWIRE = 17; // current 15 + 2 headroom
const ENUM_VALUES_TRIPWIRE = 30; // current 25 + headroom
const OBJECT_NODES_TRIPWIRE = 8; // v8 measured 7 + 1 headroom (13 → 7 at v8;
// object count was the dominant compile-cost driver in the live bisect)

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
