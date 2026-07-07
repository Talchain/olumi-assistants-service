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
 * serialized schema to ~4.6KB, 9/16 unions, 7 enums / 25 enum values.
 *
 * WHAT THE BUDGETS MEAN
 * ---------------------
 * Anthropic does not publish the grammar-compiler limit; serialized bytes,
 * enum values, union branches, and object/property counts are PROXIES that
 * correlate with compiled-grammar size. The budgets below pin the current
 * (post-v7) complexity with small headroom so future amendments cannot
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

// ── Budgets (post-v7 measured values + small headroom) ─────────────────────
// Measured on 2026-07-07: 4578 bytes, 9 unions (18 branches), 7 enums with
// 25 values, 13 objects / 72 properties (15 optional), max 12 props/object.
const SERIALIZED_BYTES_BUDGET = 5000;
const UNION_PARAMS_BUDGET = 16; // Anthropic hard limit
const UNION_PARAMS_TRIPWIRE = 10; // current 9 + 1 headroom
const OPTIONAL_PARAMS_BUDGET = 24; // Anthropic hard limit
const OPTIONAL_PARAMS_TRIPWIRE = 17; // current 15 + 2 headroom
const ENUM_VALUES_TRIPWIRE = 30; // current 25 + headroom
const OBJECT_NODES_TRIPWIRE = 16; // current 13 + headroom

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

  it("causal_claims items are a SINGLE flat object (no multi-branch object anyOf)", () => {
    // The 4-branch discriminated-union anyOf was the dominant new union of
    // the v0.11.0 amendment; the discriminated union is enforced downstream
    // by CausalClaimSchema (invalid claims dropped item-wise with a
    // CAUSAL_CLAIM_DROPPED warning). A reintroduced anyOf here must be a
    // deliberate, live-verified decision.
    const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as {
      properties: { causal_claims: { items: Record<string, unknown> } };
    };
    const items = schema.properties.causal_claims.items;
    expect(items.anyOf).toBeUndefined();
    expect(items.type).toBe("object");
    // The flat shape must remain a SUPERSET of every canonical variant so
    // the grammar can never block a claim the downstream Zod would accept.
    const props = Object.keys(items.properties as object);
    for (const key of ["type", "from", "to", "via", "between", "stated_strength"]) {
      expect(props, `causal_claims grammar lost superset key "${key}"`).toContain(key);
    }
    // Only `type` may be required — requiring a per-variant field would
    // force it onto variants that don't carry it.
    expect(items.required).toEqual(["type"]);
    const typeEnum = (items.properties as Record<string, { enum?: string[] }>).type.enum;
    expect(typeEnum).toEqual([
      "direct_effect",
      "mediation_only",
      "no_direct_effect",
      "unmeasured_confounder",
    ]);
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
