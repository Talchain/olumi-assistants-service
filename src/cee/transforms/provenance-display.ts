/**
 * Provenance display mappers.
 *
 * Project the internal `extractionType` (nodes) and structured
 * `provenance.source` (edges) into the UI's display vocabulary
 * (`from_brief` / `ai_inferred` / `user_set`).
 *
 * UI-only. The structural `extractionType` and `provenance.source` fields stay
 * untouched on the V3 response — these mappers add a sibling display string
 * so existing consumers of the structured fields are unaffected (F.6: UI
 * displays, never computes).
 */

export type ProvenanceDisplay = "from_brief" | "ai_inferred" | "user_set";

/**
 * Map a node's `extractionType` to UI display vocabulary.
 *
 * - `explicit` / `observed` → `from_brief` (extracted directly from the brief)
 * - `inferred` / `range`    → `ai_inferred` (model-inferred)
 * - any other / absent      → `ai_inferred` (safe default — anything we did
 *   not directly take from the brief is, by elimination, an AI estimate)
 */
export function nodeProvenanceDisplay(extractionType: unknown): ProvenanceDisplay {
  if (typeof extractionType !== "string") return "ai_inferred";
  if (extractionType === "explicit" || extractionType === "observed") return "from_brief";
  if (extractionType === "inferred" || extractionType === "range") return "ai_inferred";
  return "ai_inferred";
}

/**
 * Map an edge's structured `provenance.source` enum to UI display vocabulary.
 *
 * - `brief_extraction` → `from_brief`
 * - `user_specified`   → `user_set`
 * - `cee_hypothesis` / `domain_knowledge` / absent / unknown → `ai_inferred`
 */
export function edgeProvenanceDisplay(source: unknown): ProvenanceDisplay {
  if (source === "brief_extraction") return "from_brief";
  if (source === "user_specified") return "user_set";
  return "ai_inferred";
}
