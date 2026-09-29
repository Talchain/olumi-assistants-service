/**
 * ROADMAP 1.46 residual (task_97fbcb00) — the edit LLM occasionally
 * synthesises a node `category` value (e.g. "strategic") outside
 * GraphV3's enum (`controllable | observable | external`). Because the v2
 * structured-output schema encodes the node payload as an opaque
 * JSON-stringified `value` field (the GRAMMAR BUDGET v2 pattern in
 * anthropic-edit-graph-schema.ts), the grammar cannot constrain a field
 * INSIDE that string — so an otherwise well-formed op with a bad
 * `category` previously reached `GraphV3.safeParse` unchanged and failed
 * the WHOLE edit with SYNTHESIZED_GRAPH_INVALID.
 *
 * Structural fix (mirrors the draft schema's load-bearing-enum doctrine —
 * kind/category/edge-type stay structurally typed even where other
 * subtrees are stringified): a small `category` field is declared
 * directly on the operation item, grammar-enforced to the closed enum —
 * the model CANNOT emit an invalid value through this channel. As a
 * second line of defence for the residual case where the model still
 * writes an out-of-enum category INSIDE the stringified `value` blob
 * (un-grammar-checked string content), that value is coerced away
 * (dropped, disclosed via a WARN log) rather than failing the entire edit.
 */
import { describe, it, expect } from "vitest";

import { parseEditGraphResponse } from "../../../../src/orchestrator/tools/edit-graph.js";
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../../../src/orchestrator/tools/anthropic-edit-graph-schema.js";
import { GraphV3 } from "../../../../src/schemas/cee-v3.js";
import { FactorCategoryV3 } from "../../../../src/schemas/cee-v3.js";

function v2Response(operations: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    operations,
    removed_edges: [],
    warnings: [],
    coaching: { summary: "", rerun_recommended: false },
  });
}

describe("edit_graph category enum constraint (1.46 residual, task_97fbcb00)", () => {
  it("coerced-with-disclosure: an out-of-enum category embedded in the stringified value blob is dropped, not left to fail GraphV3", () => {
    const text = v2Response([
      {
        op: "update_node",
        path: "fac_pricing",
        value: JSON.stringify({ category: "strategic", label: "Pricing strategy" }),
      },
    ]);

    const result = parseEditGraphResponse(text);
    const value = result.operations[0]!.value as Record<string, unknown>;

    // The live defect: "strategic" survived normalisation unchanged and
    // was later rejected wholesale by GraphV3.safeParse (SYNTHESIZED_GRAPH_INVALID).
    expect(value.category).not.toBe("strategic");
    // A factor node without `category` (the field is optional) is valid
    // GraphV3 — prove the class of failure is actually closed, not just
    // that the literal string changed.
    const candidateNode = {
      id: "fac_pricing",
      kind: "factor",
      label: "Pricing strategy",
      ...value,
    };
    expect(
      GraphV3.safeParse({ nodes: [candidateNode], edges: [] }).success,
    ).toBe(true);
  });

  it("constrained-at-source: a valid structured `category` field on the op wins over the stringified blob", () => {
    const text = v2Response([
      {
        op: "update_node",
        path: "fac_pricing",
        category: "controllable",
        value: JSON.stringify({ label: "Pricing strategy" }),
      },
    ]);

    const result = parseEditGraphResponse(text);
    const value = result.operations[0]!.value as Record<string, unknown>;
    expect(value.category).toBe("controllable");
  });

  it("a valid category (either channel) is never coerced away", () => {
    for (const cat of FactorCategoryV3.options) {
      const text = v2Response([
        {
          op: "update_node",
          path: "fac_pricing",
          value: JSON.stringify({ category: cat, label: "Pricing strategy" }),
        },
      ]);
      const result = parseEditGraphResponse(text);
      const value = result.operations[0]!.value as Record<string, unknown>;
      expect(value.category).toBe(cat);
    }
  });

  it("the operations item schema declares category as a closed, grammar-enforced enum (structural constraint, not just runtime coercion)", () => {
    const opsSchema = ANTHROPIC_EDIT_GRAPH_SCHEMA.properties.operations.items as {
      properties: Record<string, unknown>;
    };
    const categoryField = opsSchema.properties.category as
      | { type: string; enum?: readonly string[] }
      | undefined;
    expect(categoryField).toBeDefined();
    expect(categoryField?.enum).toEqual([...FactorCategoryV3.options]);
  });
});
