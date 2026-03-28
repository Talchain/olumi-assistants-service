/**
 * Entity Resolution — Confidence-Gated
 *
 * Resolves user-referenced elements to graph entity IDs using a cascade:
 * 1. Exact ID match → confidence 1.0
 * 2. Exact label match (case-insensitive) → confidence 1.0
 * 3. Alias match → confidence 0.9
 * 4. Fuzzy label match (Levenshtein < 3) → confidence 0.7
 * 5. Ambiguous → clarification with 2-3 closest matches
 *
 * Confidence thresholds by execution risk:
 * - none (read-only): 0.7
 * - low (set_factor_value, adjust_edge): 0.9
 * - moderate (add_factor): 1.0
 * - high (add_option, remove_factor): 1.0
 */

import type { EntityRegistry, EntityEntry } from "./types.js";
import type { ExecutionRisk } from "./actions/types.js";

// ============================================================================
// Types
// ============================================================================

export interface ResolvedEntity {
  id: string;
  label: string;
  kind: string;
  confidence: number;
}

export type EntityResolutionStatus = 'resolved' | 'ambiguous' | 'not_found';

export interface EntityResolution {
  status: EntityResolutionStatus;
  entity?: ResolvedEntity;
  candidates?: ResolvedEntity[];
  confidence: number;
}

// ============================================================================
// Confidence Thresholds
// ============================================================================

const RISK_THRESHOLDS: Record<ExecutionRisk, number> = {
  none: 0.7,
  low: 0.9,
  moderate: 1.0,
  high: 1.0,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve a user reference to a graph entity.
 *
 * @param reference - The user's text reference (e.g., "revenue", "cust acq cost")
 * @param registry - Entity registry from TurnContext
 * @param risk - Execution risk of the action requesting resolution
 * @returns EntityResolution with status, entity, and confidence
 */
export function resolveEntity(
  reference: string,
  registry: EntityRegistry,
  risk: ExecutionRisk,
): EntityResolution {
  const threshold = RISK_THRESHOLDS[risk];
  const normalised = reference.toLowerCase().trim();

  if (!normalised) {
    return { status: 'not_found', confidence: 0 };
  }

  // Collect all candidates with confidence scores
  const candidates: ResolvedEntity[] = [];

  for (const [, entry] of registry.nodes) {
    const score = scoreMatch(normalised, entry);
    if (score > 0) {
      candidates.push({
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        confidence: score,
      });
    }
  }

  if (candidates.length === 0) {
    return { status: 'not_found', confidence: 0 };
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  const best = candidates[0];

  // If best confidence meets threshold, resolve
  if (best.confidence >= threshold) {
    // Check for ambiguity: two candidates with identical confidence
    if (candidates.length >= 2 && candidates[1].confidence === best.confidence) {
      return {
        status: 'ambiguous',
        candidates: candidates.slice(0, 3),
        confidence: best.confidence,
      };
    }
    return {
      status: 'resolved',
      entity: best,
      confidence: best.confidence,
    };
  }

  // Below threshold — return ambiguous with top candidates
  if (candidates.length > 0) {
    return {
      status: 'ambiguous',
      candidates: candidates.slice(0, 3),
      confidence: best.confidence,
    };
  }

  return { status: 'not_found', confidence: 0 };
}

// ============================================================================
// Scoring
// ============================================================================

function scoreMatch(normalised: string, entry: EntityEntry): number {
  const entryLabel = entry.label.toLowerCase().trim();
  const entryId = entry.id.toLowerCase();

  // 1. Exact ID match
  if (normalised === entryId) return 1.0;

  // 2. Exact label match (case-insensitive)
  if (normalised === entryLabel) return 1.0;

  // 3. Alias match
  for (const alias of entry.aliases) {
    if (normalised === alias.toLowerCase()) return 0.9;
  }

  // 4. Fuzzy label match (Levenshtein distance)
  const distance = levenshteinDistance(normalised, entryLabel);
  if (distance <= 2 && entryLabel.length >= 4) {
    // Scale confidence: distance 1 → 0.8, distance 2 → 0.7
    return distance === 1 ? 0.8 : 0.7;
  }

  // 5. Substring match (entry label contains reference or vice versa)
  if (entryLabel.includes(normalised) && normalised.length >= 4) {
    return 0.75;
  }
  if (normalised.includes(entryLabel) && entryLabel.length >= 4) {
    return 0.7;
  }

  return 0;
}

// ============================================================================
// Levenshtein Distance
// ============================================================================

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses dynamic programming with O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space efficiency
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(m + 1);
  let curr = new Array<number>(m + 1);

  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,      // deletion
        curr[i - 1] + 1,  // insertion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m];
}
