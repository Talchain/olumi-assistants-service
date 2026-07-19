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

/**
 * Validation keywords not supported by Anthropic structured outputs.
 *
 * EXPORTED as the single source of truth. Three test suites previously carried
 * their own divergent copies of this policy (6, 13 and 14 keywords), and the
 * stalest of them lived under `src/`, not `tests/`, so a sweep of the test tree
 * missed it. That copy still banned `minItems` outright and failed with the
 * message "API rejects minItems" — a claim DISPROVED by live probe (see
 * MIN_ITEMS_ALLOWED_VALUES). A false red is worse than a silent green here: it
 * tells the next engineer to REMOVE a working fix.
 */
export const UNSUPPORTED_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  // NOTE: "minItems" is deliberately NOT here — see MIN_ITEMS_ALLOWED_VALUES.
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

/**
 * `minItems` is PARTIALLY supported: the grammar compiler accepts 0 and 1 and
 * rejects everything else. Live-probed against claude-sonnet-4-6, 2026-07-19:
 *
 *   minItems: 4  -> HTTP 400 invalid_request_error
 *                   "For 'array' type, 'minItems' values other than 0 or 1 are
 *                    not supported"
 *   minItems: 0  -> accepted; a no-op (an empty array still validates)
 *   minItems: 1  -> accepted AND genuinely ENFORCED at generation time. Asked a
 *                   question whose only correct answer is an empty list, the
 *                   model could not emit `[]` and returned `[""]`; the same
 *                   request with no minItems, and with minItems: 0, both
 *                   returned `[]`.
 *
 * This distinction is load-bearing. `minItems: 1` is the only grammar-level
 * lever that can stop the model satisfying a `required` array with `[]`, and a
 * blanket ban on the keyword is what left the draft grammar unable to guarantee
 * an option carries any interventions — the 2026-07-19 OPTIONS_IDENTICAL
 * outage, where every draft turn 500'd with `intervention_signature: ""`.
 *
 * Values outside this set are still stripped: sending them would 400 the whole
 * request, which is strictly worse than dropping the constraint.
 */
export const MIN_ITEMS_ALLOWED_VALUES = new Set([0, 1]);

/**
 * Validation keywords the GA `output_config` structured-outputs endpoint
 * ACCEPTS. Live-probed 2026-07-14 against BOTH `claude-sonnet-5` and
 * `claude-sonnet-4-6` — identical results on the two models, which is why one
 * shared constant is safe here rather than a per-model table:
 *
 *   enum                                     -> accepted
 *   minLength / maxLength      (on strings)  -> accepted (SEE THE CAVEAT BELOW)
 *   additionalProperties / required
 *                              (on objects)  -> accepted
 *
 * The SAME probe established the rejected half, which is the reason both halves
 * are exported side by side. Previously only this accepted half was undiscoverable
 * — it lived in a test-file docstring while the rejected half was already a
 * constant here. That asymmetry cost two lanes: one flagged `minLength`/`maxLength`
 * as "unprobed, possibly a live defect" while pointing at the very file whose
 * docstring answered it, and a second spent a full investigation re-deriving that
 * it was already answered.
 *
 *   maxItems                   (on arrays)   -> HTTP 400
 *                                               "property 'maxItems' is not supported"
 *   minimum / maximum / exclusiveMinimum
 *                              (on numbers)  -> HTTP 400
 *
 * ⚠ ACCEPTED IS NOT ENFORCED — AND IS NOT THE SAME AS "KEPT".
 *
 * `minLength`/`maxLength` are accepted by the compiler but are almost certainly
 * NOT ENFORCED at generation time: Anthropic's structured-outputs reference lists
 * them under "Not supported" string constraints. NO live enforcement probe has
 * been run for either — unlike `minItems: 1`, which WAS proven enforced (see
 * MIN_ITEMS_ALLOWED_VALUES). Do not read this set as a guarantee that a value
 * satisfying the constraint will come back. Note the docs' "Not supported" label
 * does not by itself discriminate 400-on-send from silently-ignored: the numeric
 * bounds sit under the same heading and DO 400. Only the live probe separates them.
 *
 * That is why `minLength`/`maxLength` also remain in UNSUPPORTED_KEYWORDS above
 * and are still stripped by the normaliser — a constraint the compiler accepts
 * but ignores buys nothing on the wire. They are the ONLY overlap between the two
 * sets: accepted, yet deliberately dropped.
 *
 * Nothing is lost by dropping them, because both are deterministically backstopped
 * downstream, which is where enforcement actually lives:
 *   - maxLength     -> `findOversizedProposalField` (cee/dual-draft/guards.ts),
 *                      with the deterministic merge rejecting the proposal as
 *                      `proposal_field_too_large` (cee/dual-draft/merge.ts)
 *   - minLength: 1  -> `evidence_pointer`'s `z.string().min(1, …)` on
 *                      ProposalEnvelope (cee/dual-draft/proposals.ts)
 *
 * As PROPOSALS_JSON_SCHEMA's own header puts it, the model-facing schema is
 * "a first fence, not the enforcement point".
 */
export const ACCEPTED_KEYWORDS = new Set([
  "enum",
  "minLength",
  "maxLength",
  "additionalProperties",
  "required",
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

  // --- minItems: keep 0 and 1, strip anything else (see MIN_ITEMS_ALLOWED_VALUES) ---
  if ("minItems" in node && !MIN_ITEMS_ALLOWED_VALUES.has(node.minItems as number)) {
    stats.keywords_stripped.push(`${path.join(".")}.minItems`);
    delete node.minItems;
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
