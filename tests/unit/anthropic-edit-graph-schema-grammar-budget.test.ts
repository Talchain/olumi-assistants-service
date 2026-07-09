/**
 * ANTHROPIC_EDIT_GRAPH_SCHEMA — grammar-size budget tripwire
 * (Tier A #1 edit-reliability, 2026-07-09).
 *
 * WHY THIS EXISTS
 * ---------------
 * Lane 26 (PR #367, draft_graph) proved live that Anthropic's structured-
 * outputs grammar compiler has an UNPUBLISHED size limit correlated with
 * total structural surface (object schemas × properties), not just raw
 * bytes — a schema that passes a naive byte check can still draw 400 "The
 * compiled grammar is too large" at runtime, silently falling back to
 * prompt-only JSON on every call. This edit_graph schema is FAR smaller
 * than the draft_graph schema family Lane 26 bisected (which found the
 * compile boundary between 3,194B/8 objects PASS and 3,539B/9 objects
 * FAIL) — see tests/unit/anthropic-graph-schema-grammar-budget.test.ts for
 * that history. This test pins the edit_graph schema's own budget with
 * generous headroom so a future amendment cannot silently re-inflate it
 * into that territory without a deliberate, reviewed change.
 *
 * v1 → v2 (2026-07-09): `value`/`old_value` were added to operations.items
 * as `{ type: "string" }` (the v8 stringified-payload trick) to re-enable
 * structured outputs for edit_graph at all (see GRAMMAR BUDGET (v2) in
 * anthropic-edit-graph-schema.ts) — two string properties, ZERO new object
 * schemas, zero new unions/enums. The budgets below are pinned to the
 * measured v2 shape.
 *
 * HOW TO VERIFY LIVE
 * -------------------
 * Run `ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/probe-grammar-compile-edit-graph.mjs`
 * before merging any further amendment to this schema.
 */
import { describe, expect, it } from "vitest";

import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../src/orchestrator/tools/anthropic-edit-graph-schema.js";

// ── Budgets (v2 measured values) ────────────────────────────────────────────
// Measured 2026-07-09: 918 bytes serialized, 4 object schemas (root,
// operations.items, removed_edges.items, coaching), 1 enum / 6 values,
// 0 unions. Far under Lane 26's empirically-found ~3,400B / 8-9-object
// compile boundary for the (much larger) draft_graph schema family — this
// budget is a generous-headroom tripwire, not a boundary probe.
const SERIALIZED_BYTES_BUDGET = 1600;
const OBJECT_NODES_BUDGET = 6;
const ENUM_VALUES_BUDGET = 12;

interface Stats {
  objects: number;
  enumValues: number;
}

function walk(node: unknown, stats: Stats): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, stats);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "object") stats.objects += 1;
  if (Array.isArray(rec.enum)) stats.enumValues += rec.enum.length;
  for (const value of Object.values(rec)) walk(value, stats);
}

describe("ANTHROPIC_EDIT_GRAPH_SCHEMA grammar-size budget", () => {
  it("stays under the serialized-bytes budget", () => {
    const bytes = JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA).length;
    expect(bytes).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
  });

  it("stays under the object-schema-count budget", () => {
    const stats: Stats = { objects: 0, enumValues: 0 };
    walk(ANTHROPIC_EDIT_GRAPH_SCHEMA, stats);
    expect(stats.objects).toBeLessThanOrEqual(OBJECT_NODES_BUDGET);
  });

  it("stays under the enum-values budget", () => {
    const stats: Stats = { objects: 0, enumValues: 0 };
    walk(ANTHROPIC_EDIT_GRAPH_SCHEMA, stats);
    expect(stats.enumValues).toBeLessThanOrEqual(ENUM_VALUES_BUDGET);
  });

  it("declares value/old_value as stringified-payload string fields, not objects", () => {
    const opsItemProps = (ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.operations.items as {
      properties: Record<string, { type: string }>;
    }).properties;
    expect(opsItemProps.value?.type).toBe("string");
    expect(opsItemProps.old_value?.type).toBe("string");
  });

  it("keeps every object schema compliant by construction (additionalProperties:false)", () => {
    const objectsMissingClosure: string[] = [];
    function check(node: unknown, path: string): void {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((v, i) => check(v, `${path}[${i}]`));
        return;
      }
      const rec = node as Record<string, unknown>;
      if (rec.type === "object" && rec.additionalProperties !== false) {
        objectsMissingClosure.push(path);
      }
      for (const [key, value] of Object.entries(rec)) check(value, `${path}.${key}`);
    }
    check(ANTHROPIC_EDIT_GRAPH_SCHEMA, "root");
    expect(objectsMissingClosure).toEqual([]);
  });
});
