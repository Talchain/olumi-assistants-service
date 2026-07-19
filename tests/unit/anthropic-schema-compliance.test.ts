/**
 * Unit tests for Anthropic structured outputs schema compliance normaliser.
 *
 * Covers:
 * 1. additionalProperties enforcement on all objects
 * 2. required array expansion to list all properties
 * 3. oneOf → anyOf conversion
 * 4. Unsupported keyword stripping
 * 5. $ref inlining from $defs/definitions
 * 6. Idempotency
 * 7. Input immutability
 * 8. Logging
 * 9. Real schema compliance (draft_graph, edit_graph)
 */

import { describe, it, expect } from "vitest";
import { enforceAnthropicSchemaCompliance } from "../../src/adapters/llm/anthropic-schema-compliance.js";
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../src/cee/draft/anthropic-graph-schema.js";
import { ANTHROPIC_EDIT_GRAPH_SCHEMA } from "../../src/orchestrator/tools/anthropic-edit-graph-schema.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively assert that every object node WITH defined properties in a JSON
 * schema has additionalProperties: false.
 * Bare { type: "object" } (no properties) are intentionally left unlocked.
 */
function assertAllObjectsCompliant(
  node: Record<string, unknown>,
  path: string = "root",
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  if (node.type === "object") {
    const props = node.properties as Record<string, unknown> | undefined;
    const hasDefinedProperties = props && typeof props === "object" && Object.keys(props).length > 0;

    // Only objects with defined properties should be locked
    if (hasDefinedProperties) {
      expect(node.additionalProperties, `${path}: additionalProperties must be false`).toBe(false);
    }
  }

  // Recurse into properties
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        assertAllObjectsCompliant(val as Record<string, unknown>, `${path}.properties.${key}`);
      }
    }
  }

  // Recurse into items
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    assertAllObjectsCompliant(node.items as Record<string, unknown>, `${path}.items`);
  }
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      assertAllObjectsCompliant(node.items[i] as Record<string, unknown>, `${path}.items[${i}]`);
    }
  }

  // Recurse into anyOf/allOf
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        assertAllObjectsCompliant(
          (node[combiner] as Record<string, unknown>[])[i],
          `${path}.${combiner}[${i}]`,
        );
      }
    }
  }
}

/**
 * Recursively assert that no unsupported keywords exist in the schema.
 */
function assertNoUnsupportedKeywords(
  node: Record<string, unknown>,
  path: string = "root",
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  // `minItems` is NOT in this list — it is PARTIALLY supported (0 or 1 only).
  // Live-probed against claude-sonnet-4-6, 2026-07-19: minItems 4 -> HTTP 400
  // "values other than 0 or 1 are not supported"; minItems 1 -> accepted and
  // genuinely ENFORCED (a model that should have returned `[]` returned `[""]`).
  // See MIN_ITEMS_ALLOWED_VALUES in src/adapters/llm/anthropic-schema-compliance.ts.
  // The old blanket ban is what left the draft grammar unable to require a
  // non-empty interventions array — the 2026-07-19 OPTIONS_IDENTICAL outage.
  const unsupported = [
    "minLength", "maxLength", "minimum", "maximum", "maxItems",
    "pattern", "format", "minProperties", "maxProperties", "uniqueItems",
    "exclusiveMinimum", "exclusiveMaximum", "default",
  ];

  for (const keyword of unsupported) {
    expect(node, `${path}: must not contain "${keyword}"`).not.toHaveProperty(keyword);
  }

  // minItems is allowed through, but only with an API-accepted value.
  if ("minItems" in node) {
    expect([0, 1], `${path}.minItems = ${String(node.minItems)} — API accepts only 0 or 1`)
      .toContain(node.minItems);
  }

  // Recurse
  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        assertNoUnsupportedKeywords(val as Record<string, unknown>, `${path}.${key}`);
      }
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    assertNoUnsupportedKeywords(node.items as Record<string, unknown>, `${path}.items`);
  }
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      assertNoUnsupportedKeywords(node.items[i] as Record<string, unknown>, `${path}.items[${i}]`);
    }
  }
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      for (let i = 0; i < (node[combiner] as unknown[]).length; i++) {
        assertNoUnsupportedKeywords(
          (node[combiner] as Record<string, unknown>[])[i],
          `${path}.${combiner}[${i}]`,
        );
      }
    }
  }
}

/**
 * Recursively assert no $ref nodes survive.
 */
function assertNoRefs(node: Record<string, unknown>, path: string = "root"): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  expect(node, `${path}: must not contain $ref`).not.toHaveProperty("$ref");

  if (node.properties && typeof node.properties === "object") {
    for (const [key, val] of Object.entries(node.properties as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        assertNoRefs(val as Record<string, unknown>, `${path}.${key}`);
      }
    }
  }
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    assertNoRefs(node.items as Record<string, unknown>, `${path}.items`);
  }
  if (Array.isArray(node.anyOf)) {
    for (let i = 0; i < node.anyOf.length; i++) {
      assertNoRefs(node.anyOf[i] as Record<string, unknown>, `${path}.anyOf[${i}]`);
    }
  }
}

// ============================================================================
// 1. Core normalisation rules
// ============================================================================

describe("enforceAnthropicSchemaCompliance", () => {
  it("sets additionalProperties: false on objects where it was true", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: true,
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    expect(result.additionalProperties).toBe(false);
  });

  it("sets additionalProperties: false on objects where it was absent", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    expect(result.additionalProperties).toBe(false);
  });

  it("preserves original required array (does not expand to all properties)", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        optional_field: { type: "number" },
      },
      required: ["id"],
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const required = result.required as string[];
    // Original required preserved — not expanded
    expect(required).toContain("id");
    expect(required).toHaveLength(1);
  });

  it("converts oneOf to anyOf", () => {
    const schema = {
      type: "object",
      properties: {
        value: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const valueProp = (result.properties as Record<string, unknown>).value as Record<string, unknown>;
    expect(valueProp.anyOf).toBeDefined();
    expect(valueProp.oneOf).toBeUndefined();
    expect((valueProp.anyOf as unknown[]).length).toBe(2);
  });

  it("strips unsupported validation keywords", () => {
    const schema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          pattern: "^[a-z]+$",
          format: "email",
          default: "test",
        },
        count: {
          type: "number",
          minimum: 0,
          maximum: 100,
          exclusiveMinimum: 0,
          exclusiveMaximum: 100,
        },
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    // String keywords
    expect(props.name.minLength).toBeUndefined();
    expect(props.name.maxLength).toBeUndefined();
    expect(props.name.pattern).toBeUndefined();
    expect(props.name.format).toBeUndefined();
    expect(props.name.default).toBeUndefined();
    expect(props.name.type).toBe("string");

    // Number keywords
    expect(props.count.minimum).toBeUndefined();
    expect(props.count.maximum).toBeUndefined();
    expect(props.count.exclusiveMinimum).toBeUndefined();
    expect(props.count.exclusiveMaximum).toBeUndefined();

    // Array keywords. `minItems: 1` is KEPT — it is API-accepted and enforced,
    // and it is the only lever that stops the model satisfying a required array
    // with `[]` (the 2026-07-19 OPTIONS_IDENTICAL outage). Values >= 2 are still
    // stripped because the API 400s the whole request on those — asserted below.
    expect(props.items.minItems).toBe(1);
    expect(props.items.maxItems).toBeUndefined();
    expect(props.items.uniqueItems).toBeUndefined();
  });

  it("strips minItems >= 2 but keeps 0 and 1 (API accepts only those)", () => {
    // Positive control for the strip path: the keep-assertion above would pass
    // just as happily against a normaliser that had stopped touching minItems
    // entirely, so prove the discriminator actually fires on a bad value.
    const build = (minItems: number) => ({
      type: "object",
      properties: { xs: { type: "array", items: { type: "string" }, minItems } },
    });
    for (const good of [0, 1]) {
      const r = enforceAnthropicSchemaCompliance(build(good));
      const p = r.properties as Record<string, Record<string, unknown>>;
      expect(p.xs.minItems, `minItems: ${good} must survive`).toBe(good);
    }
    for (const bad of [2, 10]) {
      const r = enforceAnthropicSchemaCompliance(build(bad));
      const p = r.properties as Record<string, Record<string, unknown>>;
      expect(p.xs, `minItems: ${bad} must be stripped`).not.toHaveProperty("minItems");
    }
  });

  it("inlines $ref from $defs", () => {
    const schema = {
      type: "object",
      properties: {
        address: { $ref: "#/$defs/Address" },
      },
      $defs: {
        Address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const address = (result.properties as Record<string, Record<string, unknown>>).address;

    // $ref should be gone
    expect(address.$ref).toBeUndefined();
    // Inlined content should be present
    expect(address.type).toBe("object");
    expect(address.properties).toBeDefined();
    // $defs should be removed from top level
    expect(result.$defs).toBeUndefined();
    // Inlined object should be compliant
    expect(address.additionalProperties).toBe(false);
  });

  it("inlines $ref from definitions", () => {
    const schema = {
      type: "object",
      properties: {
        item: { $ref: "#/definitions/Item" },
      },
      definitions: {
        Item: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const item = (result.properties as Record<string, Record<string, unknown>>).item;
    expect(item.$ref).toBeUndefined();
    expect(item.type).toBe("object");
    expect(result.definitions).toBeUndefined();
  });

  it("handles nested objects recursively", () => {
    const schema = {
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: {
            deep: {
              type: "object",
              properties: { value: { type: "string" } },
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    assertAllObjectsCompliant(result);
  });

  it("handles array items that are objects", () => {
    const schema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
            },
            required: ["id"],
            additionalProperties: true,
          },
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const items = (result.properties as Record<string, Record<string, unknown>>).items;
    const itemSchema = items.items as Record<string, unknown>;
    expect(itemSchema.additionalProperties).toBe(false);
    // Original required preserved — not expanded to include "name"
    expect(itemSchema.required).toContain("id");
    expect(itemSchema.required).toHaveLength(1);
  });

  // ============================================================================
  // 2. Idempotency
  // ============================================================================

  it("is idempotent — enforce(enforce(schema)) equals enforce(schema)", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        nested: {
          type: "object",
          properties: { value: { type: "number", minimum: 0 } },
          additionalProperties: true,
        },
      },
      required: ["name"],
      additionalProperties: true,
    };
    const first = enforceAnthropicSchemaCompliance(schema);
    const second = enforceAnthropicSchemaCompliance(first);
    expect(second).toEqual(first);
  });

  // ============================================================================
  // 3. Input immutability
  // ============================================================================

  it("does not mutate the input schema", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
      },
      required: [] as string[],
      additionalProperties: true,
    };
    const snapshot = JSON.parse(JSON.stringify(schema));
    enforceAnthropicSchemaCompliance(schema);
    expect(schema).toEqual(snapshot);
  });

  // ============================================================================
  // 4. Real schema compliance
  // ============================================================================

  describe("ANTHROPIC_DRAFT_GRAPH_SCHEMA compliance", () => {
    it("normalised schema has additionalProperties: false on ALL objects", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "draft_graph",
      );
      assertAllObjectsCompliant(normalised);
    });

    it("normalised schema has no unsupported keywords", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "draft_graph",
      );
      assertNoUnsupportedKeywords(normalised);
    });

    it("normalised schema has no $ref nodes", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "draft_graph",
      );
      assertNoRefs(normalised);
    });

    it("preserves the schema structure (nodes/edges still present)", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_DRAFT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "draft_graph",
      );
      const props = normalised.properties as Record<string, unknown>;
      expect(props.nodes).toBeDefined();
      expect(props.edges).toBeDefined();
    });
  });

  describe("ANTHROPIC_EDIT_GRAPH_SCHEMA compliance", () => {
    it("normalised schema has additionalProperties: false on ALL objects", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "edit_graph",
      );
      assertAllObjectsCompliant(normalised);
    });

    it("normalised schema has no unsupported keywords", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "edit_graph",
      );
      assertNoUnsupportedKeywords(normalised);
    });

    it("normalised schema has no $ref nodes", () => {
      const normalised = enforceAnthropicSchemaCompliance(
        ANTHROPIC_EDIT_GRAPH_SCHEMA as unknown as Record<string, unknown>,
        "edit_graph",
      );
      assertNoRefs(normalised);
    });
  });

  // ============================================================================
  // 5. Edge cases
  // ============================================================================

  it("handles empty schema", () => {
    const result = enforceAnthropicSchemaCompliance({});
    expect(result).toEqual({});
  });

  it("does not lock bare { type: 'object' } with no defined properties", () => {
    const schema = { type: "object" };
    const result = enforceAnthropicSchemaCompliance(schema);
    // Bare objects (like data, prior) should NOT get additionalProperties: false
    // because they are flexible containers the LLM fills with nested content
    expect(result.additionalProperties).toBeUndefined();
    expect(result.required).toBeUndefined();
  });

  it("handles anyOf with object variants", () => {
    const schema = {
      anyOf: [
        { type: "object", properties: { a: { type: "string" } }, additionalProperties: true },
        { type: "string" },
      ],
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const variants = result.anyOf as Record<string, unknown>[];
    expect(variants[0].additionalProperties).toBe(false);
    // required is not expanded — original schema had no required array, so it stays absent or empty
  });

  // ============================================================================
  // 6. $ref edge cases
  // ============================================================================

  it("handles cyclic $ref without infinite recursion", () => {
    const schema = {
      type: "object",
      properties: {
        self: { $ref: "#/$defs/Node" },
      },
      $defs: {
        Node: {
          type: "object",
          properties: {
            child: { $ref: "#/$defs/Node" },
            label: { type: "string" },
          },
        },
      },
    };
    // Should not throw or hang
    const result = enforceAnthropicSchemaCompliance(schema);
    // The first level should be inlined, cyclic ref should be left as-is
    const selfProp = (result.properties as Record<string, Record<string, unknown>>).self;
    expect(selfProp.type).toBe("object");
    // $defs should be preserved because of the cyclic ref
    expect(result.$defs).toBeDefined();
  });

  it("handles unresolved $ref (def does not exist)", () => {
    const schema = {
      type: "object",
      properties: {
        broken: { $ref: "#/$defs/DoesNotExist" },
      },
      $defs: {},
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    // $ref should survive (unresolved)
    const broken = (result.properties as Record<string, Record<string, unknown>>).broken;
    expect(broken.$ref).toBe("#/$defs/DoesNotExist");
    // $defs should be preserved since there are unresolved refs
    expect(result.$defs).toBeDefined();
  });

  it("successfully inlines non-cyclic $ref and removes $defs", () => {
    const schema = {
      type: "object",
      properties: {
        item: { $ref: "#/$defs/Simple" },
      },
      $defs: {
        Simple: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    const item = (result.properties as Record<string, Record<string, unknown>>).item;
    expect(item.$ref).toBeUndefined();
    expect(item.type).toBe("object");
    // $defs should be removed after successful inlining
    expect(result.$defs).toBeUndefined();
  });

  // ============================================================================
  // 7. oneOf merge with pre-existing anyOf
  // ============================================================================

  it("merges oneOf into pre-existing anyOf instead of overwriting", () => {
    const schema = {
      anyOf: [{ type: "string" }],
      oneOf: [{ type: "number" }],
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    expect(result.oneOf).toBeUndefined();
    const anyOf = result.anyOf as unknown[];
    // Should have both the pre-existing anyOf variant and the converted oneOf variant
    expect(anyOf).toHaveLength(2);
    expect(anyOf[0]).toEqual({ type: "string" });
    expect(anyOf[1]).toEqual({ type: "number" });
  });

  it("converts oneOf to anyOf when no pre-existing anyOf", () => {
    const schema = {
      oneOf: [{ type: "string" }, { type: "number" }],
    };
    const result = enforceAnthropicSchemaCompliance(schema);
    expect(result.oneOf).toBeUndefined();
    expect(result.anyOf).toHaveLength(2);
  });
});
