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
 *
 * The accumulator is a null-prototype object (`Object.create(null)`), NOT a
 * plain `{}`. `JSON.parse` of wire JSON yields an OWN enumerable `__proto__`
 * key when the payload contains one, and `Object.keys` enumerates it; on a
 * plain object `sorted['__proto__'] = …` hits the inherited accessor's setter
 * and the key silently vanishes, so two payloads differing only in `__proto__`
 * would serialise identically (a hash collision). A null-prototype accumulator
 * has no such setter, so `__proto__` round-trips as a normal own property.
 * Output is byte-identical to the previous behaviour for every payload without
 * an own `__proto__` key.
 */
function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = Object.create(null);
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
