/**
 * Exhaustive build-time compliance assertions for Anthropic structured output schemas.
 *
 * These tests prove the schemas are Anthropic-compliant BY CONSTRUCTION.
 * If any test fails, the schema source file must be fixed before deploy.
 * No allowlists. No exceptions. No dynamic-map carve-outs.
 *
 * Validates:
 * 1. String-level: serialised JSON contains no additionalProperties:true
 * 2. Structural: every type:"object" has additionalProperties:false (with or without properties)
 * 3. No $ref nodes
 * 4. No unsupported keywords (min/max/pattern/format/default/oneOf)
 * 5. No description fields (adds grammar compilation overhead)
 * 6. Top-level required matches prompt contract
 * 7. Idempotency: normaliser is a no-op
 * 8. Emitted payload: exact output_config.format object passes all checks
 * 9. Enum cross-reference: Anthropic enums match Zod enums
 */

import { describe, it, expect } from "vitest";
import { enforceAnthropicSchemaCompliance } from "../../src/adapters/llm/anthropic-schema-compliance.js";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA, countUnionParams } from "../../src/cee/draft/anthropic-graph-schema.js";
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../src/orchestrator/tools/anthropic-edit-graph-schema.js";
import { NodeKind, FactorCategory } from "../../src/schemas/graph.js";

// ============================================================================
// Helpers
// ============================================================================

type SchemaNode = Record<string, unknown>;

/** Collect every type:"object" node — with or without properties. */
function collectObjectNodes(
  node: SchemaNode,
  path: string = "root",
  results: { path: string; additionalProperties: unknown }[] = [],
): typeof results {
  if (!node || typeof node !== "object" || Array.isArray(node)) return results;

  if (node.type === "object") {
    results.push({ path, additionalProperties: node.additionalProperties });
  }

  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        collectObjectNodes(val as SchemaNode, `${path}.${key}`, results);
      }
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    collectObjectNodes(node.items as SchemaNode, `${path}.items`, results);
  }
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      collectObjectNodes(node.items[i] as SchemaNode, `${path}.items[${i}]`, results);
    }
  }
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        collectObjectNodes(
          (node[combiner] as SchemaNode[])[i],
          `${path}.${combiner}[${i}]`,
          results,
        );
      }
    }
  }
  return results;
}

/** Recursively check for $ref nodes. */
function findRefs(node: SchemaNode, path: string = "root", results: string[] = []): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return results;
  if ("$ref" in node) results.push(path);
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") findRefs(val as SchemaNode, `${path}.${key}`, results);
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    findRefs(node.items as SchemaNode, `${path}.items`, results);
  }
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        findRefs((node[combiner] as SchemaNode[])[i], `${path}.${combiner}[${i}]`, results);
      }
    }
  }
  return results;
}

// `minItems` was in this list until 2026-07-19 and the blanket ban was WRONG —
// a hand-maintained mirror that had drifted from what the API actually accepts.
// Live-probed against claude-sonnet-4-6 on 2026-07-19:
//   minItems: 4  -> HTTP 400 "For 'array' type, 'minItems' values other than
//                   0 or 1 are not supported"
//   minItems: 0  -> accepted (and a no-op)
//   minItems: 1  -> accepted AND ENFORCED. Asked a question whose only correct
//                   answer is an empty list, the model could not emit `[]` and
//                   returned `[""]`; the same request without minItems, and with
//                   minItems: 0, both returned `[]`.
// So the real constraint is not "minItems is unsupported" but "minItems must be
// 0 or 1". Banning it outright cost us the only grammar-level lever that can
// stop an empty array — the exact defect behind the 2026-07-19 OPTIONS_IDENTICAL
// outage (see tests/unit/draft-grammar-option-interventions.test.ts).
// `maxItems` stays banned: not probed, no use case.
const UNSUPPORTED_KEYWORDS = [
  "minLength", "maxLength", "minimum", "maximum", "maxItems",
  "pattern", "format", "minProperties", "maxProperties", "uniqueItems",
  "exclusiveMinimum", "exclusiveMaximum", "default", "oneOf",
];

/** Collect every `minItems` value in the tree with its path. */
function findMinItems(
  node: SchemaNode,
  path: string = "root",
  results: { path: string; value: unknown }[] = [],
): { path: string; value: unknown }[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return results;
  if ("minItems" in node) results.push({ path, value: node.minItems });
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") findMinItems(val as SchemaNode, `${path}.${key}`, results);
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    findMinItems(node.items as SchemaNode, `${path}.items`, results);
  }
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        findMinItems((node[combiner] as SchemaNode[])[i], `${path}.${combiner}[${i}]`, results);
      }
    }
  }
  return results;
}

/** Recursively find unsupported keywords. */
function findUnsupportedKeywords(
  node: SchemaNode,
  path: string = "root",
  results: string[] = [],
): string[] {
  if (!node || typeof node !== "object" || Array.isArray(node)) return results;
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in node) results.push(`${path}.${keyword}`);
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        findUnsupportedKeywords(val as SchemaNode, `${path}.${key}`, results);
      }
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    findUnsupportedKeywords(node.items as SchemaNode, `${path}.items`, results);
  }
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        findUnsupportedKeywords(
          (node[combiner] as SchemaNode[])[i],
          `${path}.${combiner}[${i}]`,
          results,
        );
      }
    }
  }
  return results;
}

/** Count optional parameters across the full schema tree.
 *  A field is optional if it's in `properties` but NOT in `required`. */
function countOptionalParams(node: SchemaNode, path = "root"): number {
  if (!node || typeof node !== "object" || Array.isArray(node)) return 0;
  let count = 0;

  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const props = Object.keys(node.properties as object);
    count += props.filter((p) => !required.has(p)).length;
  }

  // Recurse into properties
  if (node.properties && typeof node.properties === "object") {
    for (const val of Object.values(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        count += countOptionalParams(val as SchemaNode, path);
      }
    }
  }
  // Recurse into items
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    count += countOptionalParams(node.items as SchemaNode, path);
  }
  // Recurse into anyOf/allOf
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (const variant of node[combiner] as SchemaNode[]) {
        count += countOptionalParams(variant, path);
      }
    }
  }
  return count;
}

/** Count object nodes, total properties, and max nesting depth. */
function schemaComplexity(node: SchemaNode, depth = 0): { objects: number; properties: number; maxDepth: number } {
  if (!node || typeof node !== "object" || Array.isArray(node)) return { objects: 0, properties: 0, maxDepth: depth };
  let objects = 0;
  let properties = 0;
  let maxDepth = depth;

  if (node.type === "object") {
    objects++;
    if (node.properties && typeof node.properties === "object") {
      properties += Object.keys(node.properties as object).length;
    }
  }

  if (node.properties && typeof node.properties === "object") {
    for (const val of Object.values(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const sub = schemaComplexity(val as SchemaNode, depth + 1);
        objects += sub.objects;
        properties += sub.properties;
        maxDepth = Math.max(maxDepth, sub.maxDepth);
      }
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    const sub = schemaComplexity(node.items as SchemaNode, depth + 1);
    objects += sub.objects;
    properties += sub.properties;
    maxDepth = Math.max(maxDepth, sub.maxDepth);
  }
  return { objects, properties, maxDepth };
}

// ============================================================================
// Shared assertions — run on both schemas
// ============================================================================

function assertFullCompliance(schema: SchemaNode, label: string) {
  const serialised = JSON.stringify(schema);

  describe(`${label} — exhaustive compliance`, () => {
    // 1. STRING-LEVEL CHECK — first assertion, cannot be fooled
    it("serialised JSON contains no additionalProperties:true", () => {
      expect(serialised).not.toContain('"additionalProperties":true');
      expect(serialised).not.toContain('"additionalProperties": true');
    });

    // 2. STRUCTURAL — every type:"object" has additionalProperties:false
    it("every type:object node has additionalProperties:false — no exceptions", () => {
      const objects = collectObjectNodes(schema);
      console.log(`\n=== ${label}: Object Node Inventory ===`);
      for (const obj of objects) {
        const status = obj.additionalProperties === false ? "LOCKED" : "VIOLATION";
        console.log(`  ${status} ${obj.path} (additionalProperties: ${JSON.stringify(obj.additionalProperties)})`);
      }
      console.log(`  Total: ${objects.length} object nodes\n`);

      for (const obj of objects) {
        expect(
          obj.additionalProperties,
          `${obj.path}: additionalProperties must be false, got ${JSON.stringify(obj.additionalProperties)}`,
        ).toBe(false);
      }
    });

    // 3. No $ref
    it("has no $ref nodes", () => {
      const refs = findRefs(schema);
      expect(refs, `Found $ref nodes: ${refs.join(", ")}`).toHaveLength(0);
    });

    // 4. No unsupported keywords
    it("has no unsupported keywords", () => {
      const found = findUnsupportedKeywords(schema);
      expect(found, `Found unsupported keywords: ${found.join(", ")}`).toHaveLength(0);
    });

    // 5. No description fields
    it("has no description fields", () => {
      expect(serialised).not.toContain('"description"');
    });

    // 6. Normaliser is a no-op (idempotency)
    it("normaliser is a no-op (idempotency proves compliance)", () => {
      const cloned = JSON.parse(serialised);
      const normalised = enforceAnthropicSchemaCompliance(cloned, `${label}_test`);
      expect(JSON.stringify(normalised, null, 2)).toEqual(JSON.stringify(schema, null, 2));
    });

    // 7. Complexity check
    // Depth 6 is reached by nodes.items.data.interventions.items (option node
    // intervention pairs). Anthropic does not enforce a strict depth limit.
    it("schema complexity within Anthropic limits (< 100 objects, ≤ 6 depth)", () => {
      const { objects, properties, maxDepth } = schemaComplexity(schema);
      console.log(`  ${label} complexity: ${objects} objects, ${properties} properties, depth ${maxDepth}`);
      expect(objects).toBeLessThan(100);
      expect(maxDepth).toBeLessThanOrEqual(6);
    });

    // 8. Optional parameter count (hard Anthropic limit: 24)
    it("optional parameter count ≤ 24 (Anthropic hard limit)", () => {
      const optionals = countOptionalParams(schema);
      console.log(`  ${label} optional params: ${optionals}/24`);
      expect(optionals).toBeLessThanOrEqual(24);
    });

    // 9. Union parameter count (hard Anthropic limit: 16)
    it("union parameter count ≤ 16 (Anthropic hard limit)", () => {
      const unions = countUnionParams(schema);
      console.log(`  ${label} union params: ${unions}/16`);
      expect(unions).toBeLessThanOrEqual(16);
    });
  });
}

// ============================================================================
// ANTHROPIC_DRAFT_GRAPH_SCHEMA
// ============================================================================

assertFullCompliance(
  ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as SchemaNode,
  "ANTHROPIC_DRAFT_GRAPH_SCHEMA",
);

describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA — prompt contract", () => {
  const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as SchemaNode;

  it("top-level required matches prompt contract (v0.11.0 schema amendment)", () => {
    const required = schema.required as string[];
    expect(required).toContain("nodes");
    expect(required).toContain("edges");
    expect(required).toContain("goal_constraints");
    // v0.11.0 schema amendment: coaching, causal_claims, topology_plan
    // were lifted into the strict schema as required top-level fields.
    expect(required).toContain("coaching");
    expect(required).toContain("causal_claims");
    expect(required).toContain("topology_plan");
    // `rationales` remains omitted (legacy carry, no consumer enforcement).
    expect(required).not.toContain("rationales");
  });

  it("emitted payload (output_config.format) passes all checks", () => {
    const payload = {
      type: "json_schema" as const,
      schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA as Record<string, unknown>,
    };
    const serialised = JSON.stringify(payload);

    // String-level
    expect(serialised).not.toContain('"additionalProperties":true');
    expect(serialised).not.toContain('"additionalProperties": true');
    expect(serialised).not.toContain('"description"');

    // Structural
    const payloadSchema = payload.schema as SchemaNode;
    const objects = collectObjectNodes(payloadSchema);
    for (const obj of objects) {
      expect(obj.additionalProperties, `PAYLOAD ${obj.path}`).toBe(false);
    }
    expect(findRefs(payloadSchema)).toHaveLength(0);
    expect(findUnsupportedKeywords(payloadSchema)).toHaveLength(0);

    // `minItems` is permitted but ONLY with value 0 or 1 — anything else is a
    // hard 400 from the grammar compiler (live-probed 2026-07-19; see the note
    // on UNSUPPORTED_KEYWORDS). This check replaces the old blanket ban.
    for (const { path, value } of findMinItems(payloadSchema)) {
      expect(
        [0, 1],
        `${path}.minItems = ${String(value)} — the API rejects any minItems other than 0 or 1`,
      ).toContain(value);
    }
    // POSITIVE CONTROL (trap #13): the walker must be able to SEE a minItems,
    // or the loop above is vacuous — it would pass on a schema that has none,
    // and it would have passed just as happily before the P0 fix added one.
    expect(
      findMinItems(payloadSchema).map((m) => m.path),
      "findMinItems found nothing — the draft grammar's option-interventions guard is gone",
    ).toContain("root.nodes.items.data.anyOf[0].interventions");
    expect(
      findMinItems({ type: "array", minItems: 7 } as unknown as SchemaNode),
    ).toEqual([{ path: "root", value: 7 }]);

    // Print for visual verification
    console.log("\n=== Full serialised draft_graph schema ===");
    console.log(JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA, null, 2));
    console.log("=== END ===\n");
  });

  it("node kind enum matches Zod NodeKind", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const nodeProps = ((props.nodes as SchemaNode).items as SchemaNode).properties as Record<string, SchemaNode>;
    const schemaKinds = (nodeProps.kind as SchemaNode).enum as string[];
    for (const zodKind of NodeKind.options) {
      expect(schemaKinds, `Zod NodeKind "${zodKind}" missing`).toContain(zodKind);
    }
  });

  it("factor category enum matches Zod FactorCategory", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const nodeProps = ((props.nodes as SchemaNode).items as SchemaNode).properties as Record<string, SchemaNode>;
    // category is now nullable: { anyOf: [{ type: "string", enum: [...] }, { type: "null" }] }
    const categoryNode = nodeProps.category as SchemaNode;
    const schemaCats = categoryNode.enum as string[]
      ?? ((categoryNode.anyOf as SchemaNode[])?.[0]?.enum as string[]);
    for (const zodCat of FactorCategory.options) {
      expect(schemaCats, `Zod FactorCategory "${zodCat}" missing`).toContain(zodCat);
    }
  });

  it("edge enums cover required values", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const edgeProps = ((props.edges as SchemaNode).items as SchemaNode).properties as Record<string, SchemaNode>;
    // effect_direction is now nullable: { anyOf: [{ type: "string", enum: [...] }, { type: "null" }] }
    const directionNode = edgeProps.effect_direction as SchemaNode;
    const directionEnum = directionNode.enum as string[]
      ?? ((directionNode.anyOf as SchemaNode[])?.[0]?.enum as string[]);
    expect(directionEnum).toContain("positive");
    expect(directionEnum).toContain("negative");
    expect((edgeProps.edge_type as SchemaNode).enum).toContain("directed");
    expect((edgeProps.edge_type as SchemaNode).enum).toContain("bidirected");
  });
});

// ============================================================================
// ANTHROPIC_EDIT_GRAPH_SCHEMA
// ============================================================================

assertFullCompliance(
  ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as SchemaNode,
  "ANTHROPIC_EDIT_GRAPH_SCHEMA",
);

describe("ANTHROPIC_EDIT_GRAPH_SCHEMA — prompt contract", () => {
  it("emitted payload passes all checks", () => {
    const serialised = JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA);
    expect(serialised).not.toContain('"additionalProperties":true');
    expect(serialised).not.toContain('"additionalProperties": true');
    expect(serialised).not.toContain('"description"');

    console.log("\n=== Full serialised edit_graph schema ===");
    console.log(JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA, null, 2));
    console.log("=== END ===\n");
  });
});

// ============================================================================
// OpenAI regression
// ============================================================================

describe("OpenAI regression", () => {
  it("schema does not include output_config shape", () => {
    const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as SchemaNode;
    expect(schema).not.toHaveProperty("output_config");
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
  });
});

// ============================================================================
// minItems is PARTIALLY supported — the normaliser must discriminate by VALUE
// ============================================================================

describe("enforceAnthropicSchemaCompliance — minItems value handling", () => {
  // The keyword was blanket-stripped until 2026-07-19. That blanket ban is what
  // left the draft grammar unable to stop an option emitting `interventions: []`
  // — the OPTIONS_IDENTICAL outage. Live-probed limits (claude-sonnet-4-6):
  // 0 and 1 are accepted, >=2 is a hard 400. See MIN_ITEMS_ALLOWED_VALUES.
  const wrap = (minItems: number) => ({
    type: "object",
    properties: { xs: { type: "array", minItems, items: { type: "string" } } },
    required: ["xs"],
    additionalProperties: false,
  });

  it("KEEPS minItems: 1 — the only lever that makes an empty array ungrammatical", () => {
    const out = enforceAnthropicSchemaCompliance(wrap(1), "minitems_keep_test") as {
      properties: { xs: Record<string, unknown> };
    };
    expect(out.properties.xs.minItems).toBe(1);
  });

  it("KEEPS minItems: 0 (accepted by the API, though a no-op)", () => {
    const out = enforceAnthropicSchemaCompliance(wrap(0), "minitems_zero_test") as {
      properties: { xs: Record<string, unknown> };
    };
    expect(out.properties.xs.minItems).toBe(0);
  });

  it("STRIPS minItems >= 2 — the API 400s the whole request on those", () => {
    // Positive control for the strip path: without this the test above could
    // pass on a normaliser that had simply stopped touching minItems at all.
    for (const bad of [2, 5, 100]) {
      const out = enforceAnthropicSchemaCompliance(wrap(bad), "minitems_strip_test") as {
        properties: { xs: Record<string, unknown> };
      };
      expect(out.properties.xs, `minItems: ${bad} must be stripped`).not.toHaveProperty("minItems");
    }
  });
});
