/**
 * Token Overlap Matching — Shared Utility
 *
 * Used by edit-graph.ts (resolveTokenOverlapMatches) and intent-gate.ts
 * (parameter assignment routing) to share the same stopword set and
 * substring-containment logic without duplicating either.
 *
 * Pure functions — no side effects, no async, no external dependencies.
 */

// ============================================================================
// Stopwords
// ============================================================================

/**
 * Words excluded from token overlap scoring — common edit verbs, prepositions,
 * and value words that would inflate match scores against unrelated node labels.
 */
export const TOKEN_OVERLAP_STOPWORDS: ReadonlySet<string> = new Set([
  'set', 'the', 'to', 'a', 'an', 'of', 'for', 'and', 'in', 'on', 'is', 'it',
  'high', 'low', 'higher', 'lower', 'more', 'less', 'very', 'much',
  'make', 'change', 'update', 'adjust', 'increase', 'decrease', 'raise', 'reduce',
  'please', 'add', 'remove', 'delete', 'new', 'from', 'with', 'by', 'its', 'this',
  'that', 'value', 'level', 'factor', 'node', 'edge', 'option', 'model',
]);

// ============================================================================
// Core overlap check
// ============================================================================

/**
 * Check whether two token lists have sufficient overlap to consider them a match.
 *
 * Rules:
 * - Exact token equality, OR
 * - Substring containment when the shorter token is ≥60% of the longer
 *   (allows "competi" ↔ "competitive"; prevents "rate" ↔ "corporate").
 * - Match requires ≥1 overlapping token AND overlap/labelTokens ≥ 0.5.
 */
export function hasTokenOverlap(messageTokens: string[], labelTokens: string[]): boolean {
  if (messageTokens.length === 0 || labelTokens.length === 0) return false;

  const overlapCount = labelTokens.filter((lt) =>
    messageTokens.some((mt) => {
      if (lt === mt) return true;
      const shorter = lt.length <= mt.length ? lt : mt;
      const longer  = lt.length <= mt.length ? mt : lt;
      return longer.includes(shorter) && shorter.length / longer.length >= 0.6;
    }),
  ).length;

  return overlapCount >= 1 && overlapCount / labelTokens.length >= 0.5;
}

// ============================================================================
// Tokenisation helper
// ============================================================================

/**
 * Tokenise a normalised string: split on whitespace, filter short tokens and
 * stopwords. Returns the significant content words.
 */
export function tokenise(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((t) => t.length > 2 && !TOKEN_OVERLAP_STOPWORDS.has(t));
}

// ============================================================================
// Intent-gate helper — exact single-node overlap check
// ============================================================================

/**
 * Check whether the normalised message has significant token overlap with
 * exactly one label from the provided list.
 *
 * Returns true only when exactly one label matches — ambiguous multi-node
 * matches return false to prevent incorrect deterministic routing.
 *
 * @param normalisedMessage - Lowercased, trimmed, whitespace-collapsed message
 * @param nodeLabels        - Labels of all nodes in the current graph
 */
export function hasExactlyOneNodeOverlap(normalisedMessage: string, nodeLabels: string[]): boolean {
  const messageTokens = tokenise(normalisedMessage);
  if (messageTokens.length === 0) return false;

  let matchCount = 0;
  for (const label of nodeLabels) {
    const labelTokens = tokenise(label.toLowerCase());
    if (labelTokens.length === 0) continue;

    if (hasTokenOverlap(messageTokens, labelTokens)) {
      matchCount++;
      if (matchCount > 1) return false; // ambiguous
    }
  }

  return matchCount === 1;
}
