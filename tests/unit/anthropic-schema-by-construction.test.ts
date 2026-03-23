/**
 * Build-time compliance assertions for Anthropic structured output schemas.
 *
 * These tests prove the schemas are Anthropic-compliant BY CONSTRUCTION —
 * no runtime normalisation needed. If any test fails, the schema source
 * file must be fixed before deploy.
 *
 * Validates:
 * 1. Every type:"object" with properties has additionalProperties:false
 * 2. No $ref nodes (all inlined)
 * 3. No unsupported keywords (min/max/pattern/format/default/oneOf)
 * 4. Top-level required matches prompt contract
 * 5. No field in both required and nullable anyOf
 * 6. Idempotency: normaliser is a no-op on compliant schemas
 * 7. Emitted payload test: the exact output_config.format object is compliant
 * 8. Enum cross-reference: Anthropic schema enums match Zod enums
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

/** Collect every type:"object" node's JSON path and additionalProperties value. */
function collectObjectNodes(
  node: SchemaNode,
  path: string = "root",
  results: { path: string; hasProperties: boolean; additionalProperties: unknown }[] = [],
): typeof results {
  if (!node || typeof node !== "object" || Array.isArray(node)) return results;

  if (node.type === "object") {
    const props = node.properties as SchemaNode | undefined;
    const hasProperties = !!props && typeof props === "object" && Object.keys(props).length > 0;
    results.push({ path, hasProperties, additionalProperties: node.additionalProperties });
  }

  // Recurse into properties
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        collectObjectNodes(val as SchemaNode, `${path}.properties.${key}`, results);
      }
    }
  }

  // Recurse into items
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    collectObjectNodes(node.items as SchemaNode, `${path}.items`, results);
  }
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      collectObjectNodes(node.items[i] as SchemaNode, `${path}.items[${i}]`, results);
    }
  }

  // Recurse into anyOf/allOf
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

/** Recursively check for any $ref nodes. */
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
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      findRefs(node.items[i] as SchemaNode, `${path}.items[${i}]`, results);
    }
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
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      findUnsupportedKeywords(node.items[i] as SchemaNode, `${path}.items[${i}]`, results);
    }
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

// ============================================================================
// ANTHROPIC_DRAFT_GRAPH_SCHEMA — compliant by construction
// ============================================================================

describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA — compliant by construction", () => {
  const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as SchemaNode;

  it("every type:object node has additionalProperties:false — no exceptions", () => {
    const objects = collectObjectNodes(schema);

    // Print full inventory for reviewers
    console.log("\n=== Draft Graph Schema: Object Node Inventory ===");
    for (const obj of objects) {
      const status = obj.additionalProperties === false ? "LOCKED" : "VIOLATION";
      console.log(`  ${status} ${obj.path} (additionalProperties: ${JSON.stringify(obj.additionalProperties)})`);
    }
    console.log(`  Total: ${objects.length} object nodes\n`);

    // STRICT: every type:"object" must have additionalProperties: false. No allowlist.
    for (const obj of objects) {
      expect(
        obj.additionalProperties,
        `${obj.path}: additionalProperties must be false, got ${JSON.stringify(obj.additionalProperties)}`,
      ).toBe(false);
    }
  });

  it("serialised payload contains no additionalProperties:true (string-level check)", () => {
    const payload = JSON.stringify(ANTHROPIC_DRAFT_GRAPH_SCHEMA);
    expect(payload).not.toContain('"additionalProperties":true');
    expect(payload).not.toContain('"additionalProperties": true');
  });

  it("has no $ref nodes", () => {
    const refs = findRefs(schema);
    expect(refs, `Found $ref nodes: ${refs.join(", ")}`).toHaveLength(0);
  });

  it("has no unsupported keywords", () => {
    const found = findUnsupportedKeywords(schema);
    expect(found, `Found unsupported keywords: ${found.join(", ")}`).toHaveLength(0);
  });

  it("top-level required matches prompt contract", () => {
    const required = schema.required as string[];
    expect(required).toContain("nodes");
    expect(required).toContain("edges");
    expect(required).toContain("causal_claims");
    expect(required).toContain("topology_plan");
    expect(required).toContain("coaching");
    // goal_constraints is optional
    expect(required).not.toContain("goal_constraints");
    // rationales is optional
    expect(required).not.toContain("rationales");
  });

  it("no field appears in both required and nullable anyOf", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const required = new Set(schema.required as string[]);

    for (const [key, propSchema] of Object.entries(props)) {
      if (required.has(key) && Array.isArray(propSchema.anyOf)) {
        const hasNull = (propSchema.anyOf as SchemaNode[]).some(
          v => v.type === "null",
        );
        expect(
          hasNull,
          `${key} is in required AND has nullable anyOf — pick one`,
        ).toBe(false);
      }
    }
  });

  it("normaliser is a no-op (idempotency proves compliance)", () => {
    const cloned = JSON.parse(JSON.stringify(schema));
    const normalised = enforceAnthropicSchemaCompliance(cloned, "draft_graph_test");

    // Compare the normalised output with the original.
    // The normaliser may add empty required:[] arrays to objects that had none,
    // so we compare structure-aware.
    const originalStr = JSON.stringify(schema, null, 2);
    const normalisedStr = JSON.stringify(normalised, null, 2);
    expect(normalisedStr).toEqual(originalStr);
  });

  it("emitted payload test: output_config.format object is compliant", () => {
    // Build the exact payload shape that draftGraphWithAnthropic sends
    const payload = {
      type: "json_schema" as const,
      schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA as Record<string, unknown>,
    };

    console.log("\n=== Emitted output_config.format payload ===");
    console.log(JSON.stringify(payload, null, 2).slice(0, 500) + "...\n");

    // STRICT string-level check on the serialised payload — cannot be fooled by allowlists
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('"additionalProperties":true');
    expect(serialised).not.toContain('"additionalProperties": true');

    // Structural checks
    const payloadSchema = payload.schema as SchemaNode;
    const objects = collectObjectNodes(payloadSchema);
    for (const obj of objects) {
      expect(
        obj.additionalProperties,
        `PAYLOAD ${obj.path}: additionalProperties must be false`,
      ).toBe(false);
    }
    expect(findRefs(payloadSchema)).toHaveLength(0);
    expect(findUnsupportedKeywords(payloadSchema)).toHaveLength(0);
  });

  it("node kind enum matches Zod NodeKind", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const nodesItems = (props.nodes as SchemaNode).items as SchemaNode;
    const nodeProps = nodesItems.properties as Record<string, SchemaNode>;
    const schemaKinds = (nodeProps.kind as SchemaNode).enum as string[];
    const zodKinds = NodeKind.options;

    for (const zodKind of zodKinds) {
      expect(schemaKinds, `Zod NodeKind "${zodKind}" missing from Anthropic schema`).toContain(zodKind);
    }
  });

  it("factor category enum matches Zod FactorCategory", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const nodesItems = (props.nodes as SchemaNode).items as SchemaNode;
    const nodeProps = nodesItems.properties as Record<string, SchemaNode>;
    const schemaCategories = (nodeProps.category as SchemaNode).enum as string[];
    const zodCategories = FactorCategory.options;

    for (const zodCat of zodCategories) {
      expect(schemaCategories, `Zod FactorCategory "${zodCat}" missing from Anthropic schema`).toContain(zodCat);
    }
  });

  it("edge effect_direction enum covers positive and negative", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const edgesItems = (props.edges as SchemaNode).items as SchemaNode;
    const edgeProps = edgesItems.properties as Record<string, SchemaNode>;
    const dirs = (edgeProps.effect_direction as SchemaNode).enum as string[];
    expect(dirs).toContain("positive");
    expect(dirs).toContain("negative");
  });

  it("edge edge_type enum covers directed and bidirected", () => {
    const props = schema.properties as Record<string, SchemaNode>;
    const edgesItems = (props.edges as SchemaNode).items as SchemaNode;
    const edgeProps = edgesItems.properties as Record<string, SchemaNode>;
    const types = (edgeProps.edge_type as SchemaNode).enum as string[];
    expect(types).toContain("directed");
    expect(types).toContain("bidirected");
  });
});

// ============================================================================
// ANTHROPIC_EDIT_GRAPH_SCHEMA — compliant by construction
// ============================================================================

describe("ANTHROPIC_EDIT_GRAPH_SCHEMA — compliant by construction", () => {
  const schema = ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as SchemaNode;

  it("every type:object node has additionalProperties:false — no exceptions", () => {
    const objects = collectObjectNodes(schema);

    console.log("\n=== Edit Graph Schema: Object Node Inventory ===");
    for (const obj of objects) {
      const status = obj.additionalProperties === false ? "LOCKED" : "VIOLATION";
      console.log(`  ${status} ${obj.path} (additionalProperties: ${JSON.stringify(obj.additionalProperties)})`);
    }
    console.log(`  Total: ${objects.length} object nodes\n`);

    for (const obj of objects) {
      expect(
        obj.additionalProperties,
        `${obj.path}: additionalProperties must be false`,
      ).toBe(false);
    }
  });

  it("serialised payload contains no additionalProperties:true (string-level check)", () => {
    const payload = JSON.stringify(ANTHROPIC_EDIT_GRAPH_SCHEMA);
    expect(payload).not.toContain('"additionalProperties":true');
    expect(payload).not.toContain('"additionalProperties": true');
  });

  it("has no $ref nodes", () => {
    expect(findRefs(schema)).toHaveLength(0);
  });

  it("has no unsupported keywords", () => {
    expect(findUnsupportedKeywords(schema)).toHaveLength(0);
  });

  it("normaliser is a no-op", () => {
    const cloned = JSON.parse(JSON.stringify(schema));
    const normalised = enforceAnthropicSchemaCompliance(cloned, "edit_graph_test");
    expect(JSON.stringify(normalised, null, 2)).toEqual(JSON.stringify(schema, null, 2));
  });
});

// ============================================================================
// OpenAI regression: ensure schemas don't break non-Anthropic paths
// ============================================================================

describe("OpenAI regression", () => {
  it("ANTHROPIC_DRAFT_GRAPH_SCHEMA does not include output_config shape", () => {
    // The schema object itself should not contain output_config — that's added by the adapter
    const schema = ANTHROPIC_DRAFT_GRAPH_SCHEMA as SchemaNode;
    expect(schema).not.toHaveProperty("output_config");
    // It should be a plain JSON schema
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
  });
});
