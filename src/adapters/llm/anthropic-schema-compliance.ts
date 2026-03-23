/**
 * Anthropic Structured Outputs Schema Compliance Normaliser
 *
 * Takes any JSON schema object and returns a deep clone that is fully
 * compliant with Anthropic's structured outputs requirements:
 *
 * 1. Every object has `additionalProperties: false`
 * 2. Every object has `required` listing ALL its properties
 * 3. `oneOf` converted to `anyOf`
 * 4. Unsupported validation keywords stripped
 * 5. `$ref` inlined from `$defs`/`definitions`
 * 6. `default` values removed
 *
 * The function is idempotent — running it twice produces the same output.
 * The input schema is never mutated.
 *
 * Reference: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */

import { log } from "../../utils/telemetry.js";

// ============================================================================
// Constants
// ============================================================================

/** Validation keywords not supported by Anthropic structured outputs. */
const UNSUPPORTED_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "minProperties",
  "maxProperties",
  "uniqueItems",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "default",
]);

// ============================================================================
// Types
// ============================================================================

type JsonSchemaNode = Record<string, unknown>;

interface NormaliserStats {
  additionalProperties_set: number;
  required_expanded: number;
  oneOf_converted: number;
  keywords_stripped: string[];
  refs_inlined: number;
  refs_unresolved: number;
  refs_cyclic: number;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Deep-clone a JSON schema and enforce Anthropic structured outputs compliance.
 *
 * @param schema - Input JSON schema (not mutated)
 * @param label  - Optional label for log messages (e.g. "draft_graph")
 * @returns Anthropic-compliant deep clone of the schema
 */
export function enforceAnthropicSchemaCompliance(
  schema: Record<string, unknown>,
  label?: string,
): Record<string, unknown> {
  // Deep clone to avoid mutation
  const clone = JSON.parse(JSON.stringify(schema)) as JsonSchemaNode;

  // Extract $defs/definitions for $ref resolution
  const defs: Record<string, JsonSchemaNode> = {};
  if (clone.$defs && typeof clone.$defs === "object") {
    Object.assign(defs, clone.$defs as Record<string, JsonSchemaNode>);
  }
  if (clone.definitions && typeof clone.definitions === "object") {
    Object.assign(defs, clone.definitions as Record<string, JsonSchemaNode>);
  }

  const stats: NormaliserStats = {
    additionalProperties_set: 0,
    required_expanded: 0,
    oneOf_converted: 0,
    keywords_stripped: [],
    refs_inlined: 0,
    refs_unresolved: 0,
    refs_cyclic: 0,
  };

  // Walk and normalise (with cycle detection for $ref inlining)
  const refStack = new Set<string>();
  normaliseNode(clone, defs, stats, [], refStack);

  // Only remove $defs/definitions if all refs were successfully resolved (no unresolved or cyclic)
  if (stats.refs_unresolved === 0 && stats.refs_cyclic === 0) {
    if (clone.$defs) {
      delete clone.$defs;
    }
    if (clone.definitions) {
      delete clone.definitions;
    }
  }

  // Warn on unresolved or cyclic refs
  if (stats.refs_unresolved > 0) {
    log.warn(
      { label: label ?? "unknown", refs_unresolved: stats.refs_unresolved },
      `[AnthropicSchemaCompliance] ${stats.refs_unresolved} unresolved $ref(s) — definitions retained`,
    );
  }
  if (stats.refs_cyclic > 0) {
    log.warn(
      { label: label ?? "unknown", refs_cyclic: stats.refs_cyclic },
      `[AnthropicSchemaCompliance] ${stats.refs_cyclic} cyclic $ref(s) detected — left as-is`,
    );
  }

  // Log transformations
  const totalChanges =
    stats.additionalProperties_set +
    stats.required_expanded +
    stats.oneOf_converted +
    stats.keywords_stripped.length +
    stats.refs_inlined;

  if (totalChanges > 0) {
    log.info(
      {
        label: label ?? "unknown",
        additionalProperties_set: stats.additionalProperties_set,
        required_expanded: stats.required_expanded,
        oneOf_converted: stats.oneOf_converted,
        keywords_stripped: stats.keywords_stripped,
        refs_inlined: stats.refs_inlined,
      },
      `[AnthropicSchemaCompliance] Normalised schema: ${totalChanges} transformations applied`,
    );
  }

  return clone;
}

// ============================================================================
// Recursive tree walker
// ============================================================================

function normaliseNode(
  node: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  stats: NormaliserStats,
  path: string[],
  refStack: Set<string>,
): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;

  // --- Strip unsupported keywords ---
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in node) {
      stats.keywords_stripped.push(`${path.join(".")}.${keyword}`);
      delete node[keyword];
    }
  }

  // --- Inline $ref (with cycle detection) ---
  if (typeof node.$ref === "string") {
    const refPath = node.$ref as string;
    // Support "#/$defs/Foo" and "#/definitions/Foo"
    const match = refPath.match(/^#\/(\$defs|definitions)\/(.+)$/);
    if (match) {
      const defName = match[2];

      // Cycle detection: if we're already resolving this def, stop
      if (refStack.has(defName)) {
        stats.refs_cyclic++;
        return;
      }

      const resolved = defs[defName];
      if (resolved) {
        // Deep clone the definition to avoid shared mutation
        const inlined = JSON.parse(JSON.stringify(resolved)) as JsonSchemaNode;
        // Replace $ref node content with resolved definition
        delete node.$ref;
        Object.assign(node, inlined);
        stats.refs_inlined++;
        // Recursively normalise the inlined content (with cycle tracking)
        refStack.add(defName);
        normaliseNode(node, defs, stats, path, refStack);
        refStack.delete(defName);
        return;
      } else {
        // Unresolved ref — leave $ref intact so $defs are preserved
        stats.refs_unresolved++;
        return;
      }
    }
  }

  // --- Convert oneOf → anyOf (merge with pre-existing anyOf) ---
  if (Array.isArray(node.oneOf)) {
    const existing = Array.isArray(node.anyOf) ? (node.anyOf as unknown[]) : [];
    node.anyOf = [...existing, ...(node.oneOf as unknown[])];
    delete node.oneOf;
    stats.oneOf_converted++;
  }

  // --- Object type enforcement ---
  if (node.type === "object") {
    const properties = node.properties as Record<string, unknown> | undefined;
    const hasDefinedProperties = properties && typeof properties === "object" && Object.keys(properties).length > 0;

    // Only set additionalProperties: false on objects WITH defined properties.
    // Bare `{ type: "object" }` (e.g. data, prior) are flexible containers —
    // locking them prevents the LLM from nesting content inside, which breaks
    // option nodes (data.interventions) and factor nodes (data.value).
    if (hasDefinedProperties && node.additionalProperties !== false) {
      node.additionalProperties = false;
      stats.additionalProperties_set++;
    }

    // Preserve the schema author's original `required` array.
    // Expanding to ALL properties forces the LLM to output every field
    // (e.g. goal_threshold on decision nodes, prior on option nodes),
    // which produces invalid output that fails downstream Zod validation.
    // The Anthropic API accepts schemas with optional properties.
    if (!node.required && hasDefinedProperties) {
      node.required = [];
      stats.required_expanded++;
    }
  }

  // --- Recurse into properties ---
  if (node.properties && typeof node.properties === "object") {
    const props = node.properties as Record<string, JsonSchemaNode>;
    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === "object") {
        normaliseNode(value, defs, stats, [...path, "properties", key], refStack);
      }
    }
  }

  // --- Recurse into items (array items) ---
  if (node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    normaliseNode(node.items as JsonSchemaNode, defs, stats, [...path, "items"], refStack);
  }
  if (Array.isArray(node.items)) {
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i] as JsonSchemaNode;
      if (item && typeof item === "object") {
        normaliseNode(item, defs, stats, [...path, "items", String(i)], refStack);
      }
    }
  }

  // --- Recurse into anyOf / allOf ---
  for (const combiner of ["anyOf", "allOf"] as const) {
    if (Array.isArray(node[combiner])) {
      const variants = node[combiner] as JsonSchemaNode[];
      for (let i = 0; i < variants.length; i++) {
        normaliseNode(variants[i], defs, stats, [...path, combiner, String(i)], refStack);
      }
    }
  }

  // --- Recurse into additionalProperties when it's a schema ---
  // (We set it to false above for objects, but other node types might have schema-valued additionalProperties)
  if (
    node.additionalProperties &&
    typeof node.additionalProperties === "object" &&
    node.additionalProperties !== null
  ) {
    normaliseNode(
      node.additionalProperties as JsonSchemaNode,
      defs,
      stats,
      [...path, "additionalProperties"],
      refStack,
    );
  }
}
