/**
 * Option Status Computation Utility
 *
 * SINGLE SOURCE OF TRUTH for option readiness status.
 *
 * Used by:
 * - draft-graph endpoint (via intervention-extractor.ts)
 * - graph-readiness endpoint (via analysis-ready.ts)
 *
 * Status values:
 * - "ready": Has resolved interventions (exact_id OR exact_label matches)
 * - "needs_encoding": Has categorical/boolean values awaiting numeric encoding
 * - "needs_user_mapping": No interventions, or only semantic/unresolved matches
 *
 * KEY RULE: Both exact_id AND exact_label matches count as "resolved".
 * Only semantic matches or unmatched targets are considered "unresolved".
 *
 * @see CEE Brief: Fix Option Status Computation Discrepancy
 */

import type { InterventionV3T } from "../../schemas/cee-v3.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Match types that count as "resolved" for status computation.
 * Both exact_id and exact_label are high-confidence matches.
 */
export const RESOLVED_MATCH_TYPES = new Set(["exact_id", "exact_label"]);

/**
 * Input for status computation.
 */
export interface StatusComputationInput {
  /** Matched interventions keyed by factor ID */
  interventions: Record<string, InterventionV3T>;
  /** Targets that couldn't be matched to any node */
  unresolvedTargets?: string[];
  /** Whether any non-numeric raw values exist (categorical/boolean) */
  hasNonNumericRaw?: boolean;
  /** User questions that require blocking resolution (not just informational) */
  blockingQuestions?: string[];
}

/**
 * Result of status computation.
 */
export interface StatusComputationResult {
  /** Computed status */
  status: "ready" | "needs_user_mapping" | "needs_encoding";
  /** Number of resolved interventions (exact_id or exact_label) */
  resolvedCount: number;
  /** Number of unresolved interventions (semantic only) */
  unresolvedCount: number;
  /** Reason for status determination */
  reason: string;
}

// ============================================================================
// Core Status Computation
// ============================================================================

/**
 * Determine if an intervention is "resolved" based on its match type.
 *
 * RESOLVED: exact_id, exact_label (high confidence, factor clearly identified)
 * UNRESOLVED: semantic (low confidence, may need user confirmation)
 *
 * @param intervention - The intervention to check
 * @returns true if the intervention is resolved
 */
export function isInterventionResolved(intervention: InterventionV3T): boolean {
  const matchType = intervention.target_match?.match_type;
  return RESOLVED_MATCH_TYPES.has(matchType ?? "");
}

/**
 * Count resolved vs unresolved interventions.
 *
 * @param interventions - Map of factor ID to intervention
 * @returns Counts of resolved and unresolved interventions
 */
export function countInterventionsByResolution(
  interventions: Record<string, InterventionV3T>
): { resolved: number; unresolved: number } {
  let resolved = 0;
  let unresolved = 0;

  for (const intervention of Object.values(interventions ?? {})) {
    if (isInterventionResolved(intervention)) {
      resolved++;
    } else {
      unresolved++;
    }
  }

  return { resolved, unresolved };
}

/**
 * Compute option status from interventions and context.
 *
 * STATUS PRIORITY (highest to lowest):
 * 1. needs_user_mapping: No interventions, unresolved targets, or blocking questions
 * 2. needs_encoding: Has non-numeric raw values (categorical/boolean)
 * 3. needs_user_mapping: Only semantic matches (no exact_id or exact_label)
 * 4. ready: Has at least one resolved intervention (exact_id or exact_label)
 *
 * KEY RULE: exact_label matches ARE resolved - they should not block "ready" status.
 * KEY RULE: Categorical/boolean values get "needs_encoding" even with semantic matches.
 *
 * @param input - Status computation input
 * @returns Status computation result
 */
export function computeOptionStatus(input: StatusComputationInput): StatusComputationResult {
  const {
    interventions,
    unresolvedTargets = [],
    hasNonNumericRaw = false,
    blockingQuestions = [],
  } = input;

  const interventionCount = Object.keys(interventions).length;
  const { resolved, unresolved } = countInterventionsByResolution(interventions);

  // Priority 1: No interventions at all
  if (interventionCount === 0) {
    return {
      status: "needs_user_mapping",
      resolvedCount: 0,
      unresolvedCount: 0,
      reason: "No interventions extracted",
    };
  }

  // Priority 2: Has unresolved targets that couldn't be matched to any node
  if (unresolvedTargets.length > 0) {
    return {
      status: "needs_user_mapping",
      resolvedCount: resolved,
      unresolvedCount: unresolved,
      reason: `Unresolved targets: ${unresolvedTargets.join(", ")}`,
    };
  }

  // Priority 3: Has blocking questions that require user input
  // Note: Informational questions (low confidence, no path) do NOT block ready status
  if (blockingQuestions.length > 0) {
    return {
      status: "needs_user_mapping",
      resolvedCount: resolved,
      unresolvedCount: unresolved,
      reason: `Blocking questions: ${blockingQuestions.length}`,
    };
  }

  // Priority 4: Has non-numeric raw values needing encoding
  // This takes precedence over "only semantic matches" - categorical/boolean
  // values should be marked as needs_encoding, not needs_user_mapping
  if (hasNonNumericRaw) {
    return {
      status: "needs_encoding",
      resolvedCount: resolved,
      unresolvedCount: unresolved,
      reason: "Has categorical/boolean values awaiting numeric encoding",
    };
  }

  // Priority 5: All interventions are semantic (unresolved) - no exact matches
  // Only applies to numeric interventions (categorical already handled above)
  if (resolved === 0 && unresolved > 0) {
    return {
      status: "needs_user_mapping",
      resolvedCount: 0,
      unresolvedCount: unresolved,
      reason: "All interventions are semantic matches (low confidence)",
    };
  }

  // Priority 6: Has at least one resolved intervention - READY!
  // Note: Having some semantic matches alongside resolved ones is OK
  return {
    status: "ready",
    resolvedCount: resolved,
    unresolvedCount: unresolved,
    reason: `${resolved} resolved intervention(s) via exact match`,
  };
}

// ============================================================================
// Simplified Status Computation (for analysis-ready transform)
// ============================================================================

/**
 * Status computation result with reason.
 */
export interface AnalysisReadyStatusResult {
  status: "ready" | "needs_user_mapping" | "needs_encoding";
  reason: string;
}

/**
 * Simplified status computation for analysis-ready transform.
 * Used when we only have the flattened interventions (Record<string, number>)
 * and the original option status.
 *
 * @param interventionCount - Number of interventions
 * @param originalStatus - Status from V3 option
 * @param hasNonNumericRaw - Whether any raw values are non-numeric
 * @returns Computed status
 */
export function computeAnalysisReadyStatus(
  interventionCount: number,
  originalStatus: "ready" | "needs_user_mapping" | "needs_encoding" | undefined,
  hasNonNumericRaw: boolean
): "ready" | "needs_user_mapping" | "needs_encoding" {
  return computeAnalysisReadyStatusWithReason(interventionCount, originalStatus, hasNonNumericRaw).status;
}

/**
 * Simplified status computation for analysis-ready transform with reason.
 * Returns both the status and a human-readable reason.
 *
 * @param interventionCount - Number of interventions
 * @param originalStatus - Status from V3 option
 * @param hasNonNumericRaw - Whether any raw values are non-numeric
 * @returns Computed status and reason
 */
export function computeAnalysisReadyStatusWithReason(
  interventionCount: number,
  originalStatus: "ready" | "needs_user_mapping" | "needs_encoding" | undefined,
  hasNonNumericRaw: boolean
): AnalysisReadyStatusResult {
  // No interventions - needs mapping
  if (interventionCount === 0) {
    if (originalStatus === "needs_encoding") {
      return {
        status: "needs_encoding",
        reason: "No interventions extracted; original status preserved",
      };
    }
    return {
      status: "needs_user_mapping",
      reason: "No interventions extracted",
    };
  }

  // Has non-numeric raw values - needs encoding
  if (hasNonNumericRaw) {
    return {
      status: "needs_encoding",
      reason: "Has categorical/boolean values awaiting numeric encoding",
    };
  }

  // Original status was needs_encoding - preserve it
  if (originalStatus === "needs_encoding") {
    return {
      status: "needs_encoding",
      reason: "Original extraction identified encoding requirement",
    };
  }

  // Has interventions, all numeric - ready!
  // Note: We trust the original status determination if it was "ready"
  // or if it was "needs_user_mapping" but now has interventions
  return {
    status: "ready",
    reason: `${interventionCount} intervention(s) ready for analysis`,
  };
}

// ============================================================================
// User Question Classification
// ============================================================================

/**
 * Classify a user question as blocking or informational.
 *
 * BLOCKING questions require user input before analysis can proceed:
 * - "What value should X be set to?" (missing value)
 * - "Which factor does X correspond to?" (unmatched target)
 *
 * INFORMATIONAL questions are nice-to-have confirmations:
 * - "Is X correctly mapped to Y?" (low confidence confirmation)
 * - "Factor X doesn't have a path to goal. Is this correct?" (path warning)
 *
 * @param question - The user question text
 * @returns true if the question is blocking
 */
export function isBlockingQuestion(question: string): boolean {
  // Encoding questions are NOT blocking - they result in needs_encoding status
  // which is separate from needs_user_mapping
  const encodingPatterns = [
    /how should.*be encoded/i,
    /encoded numerically/i,
  ];
  if (encodingPatterns.some((pattern) => pattern.test(question))) {
    return false;
  }

  const blockingPatterns = [
    /what value should/i,
    /which factor does/i,
    /what.*should be set to/i,
    /what.*factors.*and values/i,
    /which factors.*and values/i,
  ];

  return blockingPatterns.some((pattern) => pattern.test(question));
}

/**
 * Filter user questions into blocking vs informational categories.
 *
 * @param questions - All user questions
 * @returns Categorized questions
 */
export function categorizeUserQuestions(questions: string[]): {
  blocking: string[];
  informational: string[];
} {
  const blocking: string[] = [];
  const informational: string[] = [];

  for (const question of questions) {
    if (isBlockingQuestion(question)) {
      blocking.push(question);
    } else {
      informational.push(question);
    }
  }

  return { blocking, informational };
}
