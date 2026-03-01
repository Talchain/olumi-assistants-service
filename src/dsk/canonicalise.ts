/**
 * DSK canonical JSON serialisation.
 *
 * Shared by the linter (ordering checks) and hasher (SHA-256 input).
 * Both MUST use identical canonicalisation rules.
 *
 * Rules:
 *  - Hash input: { version, objects } only (exclude generated_at, dsk_version_hash)
 *  - Keys sorted alphabetically at every nesting level
 *  - No whitespace
 *  - Unordered set arrays: sorted bytewise (context_tags, contraindications,
 *    stage_applicability, scope.*, linked_claim_ids, linked_protocol_ids,
 *    negative_conditions)
 *  - Ordered sequence arrays: preserved (steps, source_citations,
 *    required_inputs, expected_outputs)
 *  - objects array: sorted by `id` bytewise
 */

import type { DSKBundle } from "./types.js";

/**
 * Fields whose arrays are unordered sets and should be sorted for
 * canonical output. Key = JSON path segment (leaf field name).
 */
const UNORDERED_SET_FIELDS = new Set([
  "context_tags",
  "contraindications",
  "stage_applicability",
  // scope sub-fields
  "decision_contexts",
  "stages",
  "populations",
  "exclusions",
  // trigger arrays
  "linked_claim_ids",
  "linked_protocol_ids",
  "negative_conditions",
]);

/**
 * Recursively produce a canonical value:
 *  - Objects: keys sorted, values recursively canonicalised
 *  - Arrays: if the field is an unordered set, sort elements bytewise;
 *    otherwise preserve order. Elements recursively canonicalised.
 *  - Primitives: returned as-is
 */
function canonicalValue(value: unknown, fieldName?: string): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    const mapped = value.map((el) => canonicalValue(el));
    if (fieldName && UNORDERED_SET_FIELDS.has(fieldName)) {
      // Sort string elements bytewise; object elements by their JSON repr
      return mapped.slice().sort((a, b) => {
        const sa = typeof a === "string" ? a : JSON.stringify(a);
        const sb = typeof b === "string" ? b : JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    }
    return mapped;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalValue(obj[key], key);
    }
    return sorted;
  }

  return value;
}

/**
 * Produce the canonical JSON string for a DSK bundle.
 * Only includes `version` and `objects` (sorted by id).
 */
export function canonicalise(bundle: DSKBundle): string {
  const objectsCopy = bundle.objects.map((o) => canonicalValue(o));

  // Sort objects by id bytewise
  const sortedObjects = (objectsCopy as Array<Record<string, unknown>>)
    .slice()
    .sort((a, b) => {
      const idA = String(a["id"] ?? "");
      const idB = String(b["id"] ?? "");
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    });

  const hashInput = canonicalValue({
    version: bundle.version,
    objects: sortedObjects,
  });

  return JSON.stringify(hashInput);
}
