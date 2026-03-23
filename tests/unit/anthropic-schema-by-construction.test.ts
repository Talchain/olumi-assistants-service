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
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
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

const UNSUPPORTED_KEYWORDS = [
  "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems",
  "pattern", "format", "minProperties", "maxProperties", "uniqueItems",
  "exclusiveMinimum", "exclusiveMaximum", "default", "oneOf",
];

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
    it("schema complexity within Anthropic limits (< 100 objects, ≤ 5 depth)", () => {
      const { objects, properties, maxDepth } = schemaComplexity(schema);
      console.log(`  ${label} complexity: ${objects} objects, ${properties} properties, depth ${maxDepth}`);
      expect(objects).toBeLessThan(100);
      expect(maxDepth).toBeLessThanOrEqual(5);
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

  it("top-level required matches prompt contract", () => {
    const required = schema.required as string[];
    expect(required).toContain("nodes");
    expect(required).toContain("edges");
    expect(required).toContain("causal_claims");
    expect(required).toContain("topology_plan");
    expect(required).toContain("coaching");
    expect(required).not.toContain("goal_constraints");
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
    const schemaCats = (nodeProps.category as SchemaNode).enum as string[];
    for (const zodCat of FactorCategory.options) {
      expect(schemaCats, `Zod FactorCategory "${zodCat}" missing`).toContain(zodCat);
    }
  });

  it("edge enums cover required values", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const edgeProps = ((props.edges as SchemaNode).items as SchemaNode).properties as Record<string, SchemaNode>;
    expect((edgeProps.effect_direction as SchemaNode).enum).toContain("positive");
    expect((edgeProps.effect_direction as SchemaNode).enum).toContain("negative");
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
