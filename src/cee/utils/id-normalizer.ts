import { log } from "../../utils/telemetry.js";

/**
 * ID Normalizer Utility
 *
 * Converts human-readable labels into valid node IDs following the pattern:
 * ^[A-Za-z][A-Za-z0-9_-]*$
 *
 * Used by V3 schema to generate consistent IDs for option nodes and
 * intervention targets.
 */

const PRESERVED_ID_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Normalize a label into a valid node ID.
 *
 * Rules:
 * 1. Convert to lowercase
 * 2. Replace spaces and hyphens with underscores
 * 3. Remove characters not matching [a-z0-9_:-]
 * 4. Collapse multiple underscores
 * 5. Trim leading/trailing underscores
 * 6. Handle duplicates by appending __2, __3, etc. (P1-CEE-4: double underscore)
 *
 * @param label - Human-readable label to normalize
 * @param existingIds - Set of IDs already in use (for deduplication)
 * @returns Valid node ID
 *
 * @example
 * normalizeToId("Marketing Spend", new Set()) // "marketing_spend"
 * normalizeToId("Price (GBP)", new Set()) // "price_gbp"
 * normalizeToId("Option A", new Set(["option_a"])) // "option_a__2"
 */
export function normalizeToId(
  label: string,
  existingIds: Set<string> = new Set()
): string {
  if (label === null || label === undefined || typeof label !== "string") {
    return generateUniqueId("unknown", existingIds);
  }

  if (PRESERVED_ID_REGEX.test(label)) {
    const uniqueId = generateUniqueId(label, existingIds);
    if (uniqueId !== label) {
      log.warn(
        { original_id: label, normalized_id: uniqueId, reason: "collision" },
        "Normalized ID to resolve collision"
      );
    }
    return uniqueId;
  }

  // Step 1: Lowercase
  let id = label.toLowerCase();

  // Step 2: Replace common separators with underscores
  id = id.replace(/[\s\-–—:]/g, "_");

  // Step 3: Remove parentheses but keep content
  id = id.replace(/[()[\]{}]/g, "_");

  // Step 4: Remove characters not in allowed set
  id = id.replace(/[^a-z0-9_-]/g, "");

  // Step 5: Collapse multiple underscores/colons/hyphens
  id = id.replace(/_{2,}/g, "_");
  id = id.replace(/-{2,}/g, "-");
  id = id.replace(/:{2,}/g, ":");

  // Step 6: Trim leading/trailing underscores and hyphens
  id = id.replace(/^[_-]+|[_-]+$/g, "");

  // Step 7: Ensure non-empty
  if (!id) {
    id = "node";
  }

  // Step 8: Handle duplicates
  const uniqueId = generateUniqueId(id, existingIds);
  if (uniqueId !== label) {
    log.warn(
      { original_id: label, normalized_id: uniqueId, reason: "normalized" },
      "Normalized ID to match policy"
    );
  }
  return uniqueId;
}

/**
 * Generate a unique ID by appending a suffix if needed.
 *
 * P1-CEE-4: Uses double underscore (__) for collision suffix to distinguish
 * from natural underscores in IDs.
 *
 * @param baseId - Base ID to make unique
 * @param existingIds - Set of IDs already in use
 * @returns Unique ID (original or with __N suffix)
 */
function generateUniqueId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let counter = 2;
  let candidateId = `${baseId}__${counter}`;

  while (existingIds.has(candidateId)) {
    counter++;
    candidateId = `${baseId}__${counter}`;
  }

  return candidateId;
}

/**
 * Batch normalize labels to IDs, ensuring uniqueness across the batch.
 *
 * @param labels - Array of labels to normalize
 * @param existingIds - Set of IDs already in use (optional)
 * @returns Array of unique normalized IDs (same order as input)
 *
 * @example
 * normalizeLabelsToIds(["Option A", "Option B", "Option A"])
 * // ["option_a", "option_b", "option_a__2"]
 */
export function normalizeLabelsToIds(
  labels: string[],
  existingIds: Set<string> = new Set()
): string[] {
  const usedIds = new Set(existingIds);
  const results: string[] = [];

  for (const label of labels) {
    const id = normalizeToId(label, usedIds);
    usedIds.add(id);
    results.push(id);
  }

  return results;
}

/**
 * Core ID normalisation (steps 1-7) without dedup suffix.
 *
 * Exported for use by the integrity sentinel so that raw↔V3 ID matching
 * uses the exact same algorithm as the production normalizer.
 *
 * If the input already matches the valid ID pattern, it is returned as-is.
 */
export function normaliseIdBase(label: string): string {
  if (label === null || label === undefined || typeof label !== "string") {
    return "unknown";
  }
  if (PRESERVED_ID_REGEX.test(label)) {
    return label;
  }
  let id = label.toLowerCase();
  id = id.replace(/[\s\-–—:]/g, "_");
  id = id.replace(/[()[\]{}]/g, "_");
  id = id.replace(/[^a-z0-9_-]/g, "");
  id = id.replace(/_{2,}/g, "_");
  id = id.replace(/-{2,}/g, "-");
  id = id.replace(/:{2,}/g, ":");
  id = id.replace(/^[_-]+|[_-]+$/g, "");
  if (!id) {
    id = "node";
  }
  return id;
}

/**
 * Validate that an ID matches the required pattern.
 *
 * @param id - ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidId(id: string): boolean {
  return PRESERVED_ID_REGEX.test(id);
}

/**
 * Extract a prefix from an ID for grouping purposes.
 *
 * @param id - ID to extract prefix from
 * @returns Prefix (part before first underscore or colon)
 *
 * @example
 * extractIdPrefix("option_price_low") // "option"
 * extractIdPrefix("factor:marketing") // "factor"
 */
export function extractIdPrefix(id: string): string {
  const match = id.match(/^([A-Za-z]+)[_:/]/);
  return match ? match[1] : id;
}
