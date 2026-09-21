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
 * - "needs_user_mapping": No interventions AND no connected factor, or only
 *   semantic/unresolved matches
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

  // Priority 1: Nothing extracted at all.
  //
  // ⚠ `interventionCount === 0` IS NOT THE SAME QUESTION AS "we learned
  // nothing". Since the categorical limb stopped writing a `value: 0`
  // placeholder for an un-encodable value, an option can reach here having
  // matched its factor EXACTLY and captured the raw value ("Adopt Vue"), with
  // no numeric intervention only because no encoding exists yet. That is
  // `needs_encoding` — we know the factor, we lack the number — and reporting
  // it as `needs_user_mapping` tells the user we could not work out which
  // factor they meant, which is false and sends them to re-do work we already
  // did. `hasNonNumericRaw` is the evidence that we DID identify something, so
  // it defers to Priority 4 rather than being pre-empted here.
  if (interventionCount === 0 && !hasNonNumericRaw) {
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
 * @param connectedFactorCount - Non-repair-authored option→factor edge count
 * @param isBaseline - Whether this option is the status-quo baseline
 * @returns Computed status
 */
export function computeAnalysisReadyStatus(
  interventionCount: number,
  originalStatus: "ready" | "needs_user_mapping" | "needs_encoding" | undefined,
  hasNonNumericRaw: boolean,
  connectedFactorCount: number,
  isBaseline = false
): "ready" | "needs_user_mapping" | "needs_encoding" {
  return computeAnalysisReadyStatusWithReason(
    interventionCount,
    originalStatus,
    hasNonNumericRaw,
    connectedFactorCount,
    isBaseline
  ).status;
}

/**
 * Simplified status computation for analysis-ready transform with reason.
 * Returns both the status and a human-readable reason.
 *
 * @param interventionCount - Number of interventions
 * @param originalStatus - Status from V3 option
 * @param hasNonNumericRaw - Whether any raw values are non-numeric
 * @param connectedFactorCount - Non-repair-authored option→factor edge count
 * @param isBaseline - Whether this option is the status-quo baseline, as
 *   decided by `detectBaselineOptionIndex` in `analysis-ready.ts` (the same
 *   decision `analysable-option-gate.ts` later reads off the wire). Defaults
 *   to `false` for the standalone callers that hold no payload-wide view.
 * @returns Computed status and reason
 */
export function computeAnalysisReadyStatusWithReason(
  interventionCount: number,
  originalStatus: "ready" | "needs_user_mapping" | "needs_encoding" | undefined,
  hasNonNumericRaw: boolean,
  connectedFactorCount: number,
  isBaseline = false,
  unresolvedTargetCount = 0
): AnalysisReadyStatusResult {
  if (unresolvedTargetCount > 0) {
    return { status: "needs_user_mapping", reason: "A proposed effect still needs a supported mapping" };
  }
  // ⭐ THE SINGLE ADJUDICATION OF "this option has no effect value yet".
  //
  // It decides WHICH QUESTION the repair flow puts to the user, and the two
  // questions are not interchangeable:
  //   · needs_user_mapping → "Choose which factor X changes and by how much."
  //   · needs_encoding     → "Choose how X should be represented on the effect
  //                           scale."
  // (both spellings: `orchestrator/tools/analysis-ready-helper.ts`.)
  //
  // The connected-factor limb below SUPERSEDES the duplicate rule that used to
  // live in `projectOptionForCanonicalBuilder`'s status fallback. That rule was
  // reachable only from the PERSISTED-graph readiness path, so the draft path —
  // which is what a fresh user's first turn takes — had no connectivity input at
  // all and fell through to `needs_user_mapping` every time. Two producers, one
  // field, and they disagreed on identical graph shapes. One owner now.
  if (interventionCount === 0) {
    if (originalStatus === "needs_encoding") {
      return {
        status: "needs_encoding",
        reason: "No interventions extracted; original status preserved",
      };
    }
    // ⭐ THE HELD BASELINE. `interventions: {}` ENCODES TWO DIFFERENT FACTS and
    // this function used to read only one of them (trap 21 at field grain):
    //   · "nobody has said what this option does"        → a real question;
    //   · "it has been stated that this does nothing"    → a complete answer.
    //
    // RUN ADMISSION ALREADY NAMES THEM APART, strictly on the same flag:
    // `orchestrator-v5/tools/handlers/analysable-option-gate.ts::isBaselineOption`
    // HOLDS a baseline with no interventions and SUBMITS it, because "holding
    // every factor at its own observed value *is* the complete and correct
    // specification of 'no change'" (that file's docblock, Paul's 2026-08-14
    // ruling). Readiness never got that ruling, so the same option was
    // analysable and un-ready in the same turn — measured on the wire at
    // staging build `0168483`, 18 Sep 2026, option `bad0f75e`
    // "Status Quo (Hold Current Plan)", `is_baseline: true`, `interventions: {}`,
    // `status: "needs_user_mapping"`.
    //
    // ⚠ THE ASK IT WAS PRODUCING HAS NO ANSWERABLE FORM. "Choose which factor
    // X changes and by how much" cannot be answered for a status quo: supplying
    // the mapping stops it being the status quo. The user could not exit,
    // because the exit destroys the thing being configured — which is why the
    // conversational layer, correctly, told them there was nothing to configure
    // while this authority kept the blocker on screen.
    //
    // This is NOT a loosening of the run gate toward readiness; it is readiness
    // learning the distinction the run gate already makes, from the same flag,
    // with the same strict predicate. It is placed AFTER the `needs_encoding`
    // limb above on purpose: an explicit upstream `needs_encoding` claims a
    // stated effect could not be represented, which is a different fact from
    // "nothing was stated" and is not this rule's to overturn.
    if (isBaseline === true) {
      return {
        status: "ready",
        reason: "Baseline: every factor holds at its observed value, so no effect values are needed",
      };
    }

    // CONNECTED BUT NUMBERLESS. A surviving option→factor edge IS the mapping:
    // the product has already established which factor this option moves.
    // Repair-authored edges are excluded upstream by the caller, so the product
    // can never count its own wiring as the user's mapping — without that
    // exclusion this limb would swap the question for one nobody can answer
    // (there is no representation to choose for a lever nobody stated).
    if (connectedFactorCount > 0) {
      return {
        status: "needs_encoding",
        reason: `Connected to ${connectedFactorCount} factor(s); awaiting effect value(s)`,
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

// ============================================================================
// The obligation that comes with `needs_user_mapping`
// ============================================================================

/**
 * ⭐⭐ THE ONE SENTENCE THE PRODUCT USES TO SAY "WE DO NOT KNOW WHAT THIS
 * OPTION DOES", and the only place it is spelled.
 *
 * It NAMES THE OPTION on purpose. Two real user debug bundles
 * (2026-09-21T11:47Z, scenarios `48a1ce84` and `376707e6`) each carried FOUR
 * options at `needs_user_mapping` simultaneously; a question that does not name
 * its option cannot tell the user which of the four it is about, which is the
 * difference between an answerable ask and a restatement of the blocker.
 */
export function mappingNeedQuestion(optionLabel: string): string {
  return `Which factor(s) does "${optionLabel}" change, and what value should each be set to?`;
}

/** Input to {@link nameMappingNeed}. */
export interface MappingNeedInput {
  /** The status this option is being published with. */
  status: "ready" | "needs_user_mapping" | "needs_encoding";
  /** The option's own label — the question names it. */
  label: string;
  /** Concepts mentioned but not matched to a factor. */
  unresolvedTargets?: readonly string[];
  /** Questions the producer has already written. */
  userQuestions?: readonly string[];
  /**
   * Whether this option is the status-quo baseline, as decided by the same flag
   * `analysable-option-gate.ts::isBaselineOption` and
   * `computeAnalysisReadyStatusWithReason` read.
   */
  isBaseline?: boolean;
}

/**
 * ⭐⭐ `needs_user_mapping` IS A CLAIM THAT SOMETHING IS MISSING, SO IT CARRIES
 * AN OBLIGATION TO SAY WHAT. This function discharges it.
 *
 * `v3-validator.ts` has declared the pair invalid since it was written
 * (`MISSING_USER_QUESTIONS`: "Option X needs user mapping but has no
 * user_questions or unresolved_targets") — but only as a post-hoc warning on a
 * response already built, so nothing held the PRODUCERS to it. Measured on two
 * real user bundles, every option in both violated it: the user asked what was
 * missing and the product had nothing to say.
 *
 * ── WHY THE PRODUCER SUPPLIES CONTENT RATHER THAN THE STATUS DEGRADING ──────
 * The invariant can be met from either end. It must be met from this one:
 *
 *   · `ready` would be a LIE IN THE DANGEROUS DIRECTION — it asserts the option
 *     is analysable when nothing is known about what it changes. An unhelpful
 *     status is bad; an option silently admitted to a run on no mapping is
 *     worse, and it is the exact harm the NO-SILENT-INVENTION rules exist for.
 *   · `needs_encoding` would be a DIFFERENT lie. It means "we know WHICH factor
 *     and lack only the number" (see `computeOptionStatus` Priority 1 and
 *     `computeAnalysisReadyStatusWithReason`'s connected-factor limb). With no
 *     interventions and no connectivity the factor is precisely what is NOT
 *     known, so it would put a question to the user about a mapping that does
 *     not exist.
 *
 * So `needs_user_mapping` is the TRUE status and the producer owes the content.
 * That is also the direction the repo already took at
 * `intervention-extractor.ts` — which now calls this function instead of
 * carrying its own copy of the sentence (CLAUDE.md trap 12: the second copy is
 * the one that drifts).
 *
 * ── THE HELD BASELINE IS EXCLUDED, AND THAT IS NOT A LOOPHOLE ───────────────
 * For a status quo the question HAS NO ANSWERABLE FORM: supplying the mapping
 * stops it being the status quo. Asking it is the closed defect recorded in
 * `computeAnalysisReadyStatusWithReason` (the 2026-09-18 held-baseline ruling,
 * option `bad0f75e`), where the user was told there was nothing to configure
 * while the blocker stayed on screen. A blanket backfill would re-open it
 * (CLAUDE.md trap 21). The baseline's own obligation is discharged by that same
 * authority returning `ready` for it — this function must not pre-empt that
 * decision here, because a second producer of the status is what the divergence
 * note in `analysis-ready-helper.ts` was written to prevent.
 *
 * ⚠ SCOPE, STATED PRECISELY: the guarantee is
 * `status === 'needs_user_mapping' && !isBaseline ⟹ questions ∪ targets ≠ ∅`.
 * A held baseline may still carry the bare status out of this function.
 *
 * @returns The `user_questions` the option should publish — the producer's own
 *   list untouched whenever it already discharges the obligation.
 */
export function nameMappingNeed(input: MappingNeedInput): string[] {
  const existing = [...(input.userQuestions ?? [])];
  if (input.status !== "needs_user_mapping") return existing;
  // The status quo: the ask has no answerable form. See above.
  if (input.isBaseline === true) return existing;
  // Already explained, by either carrier the validator accepts.
  if (existing.length > 0) return existing;
  if ((input.unresolvedTargets?.length ?? 0) > 0) return existing;
  return [mappingNeedQuestion(input.label)];
}
