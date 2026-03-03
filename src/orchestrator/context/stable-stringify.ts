/**
 * Stable (deterministic) JSON serialisation.
 *
 * Recursively sorts object keys alphabetically at every nesting level,
 * preserving array element order.
 *
 * Use this wherever JSON output must be identical regardless of key insertion
 * order — e.g. context hashing, block-ID generation.
 */

/**
 * Recursively sort all object keys, preserving array order.
 * Returns a new value — does not mutate the input.
 */
function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

/**
 * Serialise `value` to JSON with all object keys sorted recursively.
 * Same logical value → byte-identical string regardless of key insertion order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
