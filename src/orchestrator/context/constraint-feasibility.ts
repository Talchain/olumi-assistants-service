/**
 * Winner constraint-feasibility detection (trust-spine board item #1, CEE half).
 *
 * DEFECT (plan agile-finding-harp.md §1 CONFIRMED DEFECT #1): the CEE
 * winner-surfacing code selects the leading option purely by `win_probability`
 * and NEVER consults constraint feasibility, so a hard-constraint-violating
 * option is surfaced as the recommended leader with no flag. Live-proven on
 * staging (build 139150c, 2026-07-17): a £80k option violating a £65k budget
 * constraint (`constraint_probabilities.c_budget === 0`, joint 0) still leads
 * "by 100 percentage points" and PLoT even sets `robustness.recommended_option_id`
 * to it.
 *
 * This module is the SINGLE SOURCE of the "does the WINNING option violate a
 * hard constraint" predicate (CLAUDE.md trap #12 — derive, don't mirror). Every
 * winner surface (analysis-compact, decision-review-enricher, the run_analysis
 * headline) calls THIS one function so they can never disagree on infeasibility.
 * It is PURE — the feature flag (`CEE_CONSTRAINT_INFEASIBLE_GATE`) is enforced
 * by the callers, so this function stays trivially testable on both wire shapes.
 *
 * WIRE SHAPE (verified at the bytes — see the live capture cited above and
 * tests/fixtures/cross-service/plot-to-cee.doctrine-b.code-derived.json):
 * the per-option constraint satisfaction data arrives in TWO shapes that both
 * flow through here:
 *   - LIVE doctrine-B wire: `constraint_probabilities` is an OBJECT keyed by
 *     constraint_id → P(satisfied), e.g. `{ c_budget: 0 }`, alongside
 *     `probability_of_joint_goal`.
 *   - Legacy / test shape: `constraint_probabilities` is an ARRAY of
 *     `{ constraint_id, probability }`.
 * Both are read here; the pre-existing `deriveConstraintTensions`
 * (analysis-compact.ts) reads ONLY the array shape and is therefore silently
 * dead on the live object wire — this module does not share that limitation.
 */

import { readOptionResultSources } from "./option-result-source.js";

export interface WinnerConstraintFeasibility {
  /** True when the WINNING option violates a hard constraint. */
  infeasible: boolean;
  /** The violated constraint id (for honest copy / telemetry), or null. */
  constraintId: string | null;
  /**
   * WHICH criterion fired (adversarial-review P2 — the two are different
   * claims and must carry different copy):
   *   'hard_violation' — C1: the winner's constraint satisfaction probability
   *     is at/below the hard floor. "Does not satisfy the constraint" is
   *     definitionally supported.
   *   'joint_tension' — C2: the winner's joint-goal probability is well below
   *     its constraint satisfaction. A TENSION, not a proven violation —
   *     copy must say "in tension with", never "does not satisfy".
   * Null when `infeasible` is false.
   */
  kind: 'hard_violation' | 'joint_tension' | null;
}

/**
 * P(constraint satisfied) at or below this floor is treated as a HARD
 * violation of the winning option — the leader cannot satisfy the constraint.
 * The live-proven defect emits exactly 0 (constraint node pinned at std≈0.001,
 * a clear £80k-vs-£65k violation); a small non-zero floor keeps effectively-
 * impossible constraints (<5% satisfaction) inside the net without flagging a
 * merely-risky-but-feasible leader. Provisional, mirroring TENSION_THRESHOLD.
 */
const HARD_VIOLATION_FLOOR = 0.05;

/**
 * Joint-goal tension threshold: when the winner's `probability_of_joint_goal`
 * is below `min(individual constraint satisfaction) × this`, the outcome lead
 * is not backed by feasibility. Mirrors `deriveConstraintTensions`'
 * TENSION_THRESHOLD so the two derivations agree on the array shape.
 */
const JOINT_TENSION_THRESHOLD = 0.7;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Extract per-constraint satisfaction probabilities from ONE option-result
 * entry, tolerating BOTH the live object shape and the legacy array shape.
 * Returns `[]` when no constraint probabilities are present.
 */
function readConstraintSatisfactionProbs(
  entry: Record<string, unknown>,
): Array<{ id: string; probability: number }> {
  const raw = entry.constraint_probabilities;
  const out: Array<{ id: string; probability: number }> = [];

  // Live doctrine-B wire: OBJECT { <constraint_id>: P(satisfied) }.
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out.push({ id, probability: value });
      }
    }
    return out;
  }

  // Legacy / test shape: ARRAY of { constraint_id, probability }.
  if (Array.isArray(raw)) {
    for (const cp of raw) {
      const cpObj = cp as Record<string, unknown>;
      const id = readString(cpObj.constraint_id);
      if (id !== null && typeof cpObj.probability === "number" && Number.isFinite(cpObj.probability)) {
        out.push({ id, probability: cpObj.probability });
      }
    }
  }

  return out;
}

/**
 * Find the option-result entry for `winnerOptionId` across every option-result
 * source (current-first precedence — the same reader every winner surface
 * uses). Matches on `option_id` OR `id` (the live `option_comparison` shape
 * populates both; the `decision_brief.options` shape only `option_id`).
 */
function findWinnerEntry(
  envelope: Record<string, unknown>,
  winnerOptionId: string,
): Record<string, unknown> | null {
  for (const source of readOptionResultSources(envelope)) {
    for (const entry of source) {
      if (entry.option_id === winnerOptionId || entry.id === winnerOptionId) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Does the WINNING option violate a hard constraint? PURE detection — the
 * caller decides (behind CEE_CONSTRAINT_INFEASIBLE_GATE) whether to act on it.
 *
 * Only the winner is evaluated, so a feasible leader is never flagged because a
 * DIFFERENT option is infeasible (no false positives on non-winners).
 *
 * Infeasible iff EITHER:
 *   (C1) HARD violation — the winner's minimum constraint satisfaction
 *        probability ≤ {@link HARD_VIOLATION_FLOOR}. This is the live-proven
 *        case (`constraint_probabilities.c_budget === 0`).
 *   (C2) JOINT-GOAL tension — the winner's `probability_of_joint_goal` <
 *        `min(individual) × {@link JOINT_TENSION_THRESHOLD}`. The lead's
 *        outcome is not backed by feasibility.
 * Returns `{ infeasible: false }` when no winner id, no matching entry, or no
 * constraint probabilities are present (fail-open to the pre-flag behaviour).
 */
export function deriveWinnerConstraintInfeasibility(
  envelope: Record<string, unknown>,
  winnerOptionId: string | null | undefined,
): WinnerConstraintFeasibility {
  if (typeof winnerOptionId !== "string" || winnerOptionId.length === 0) {
    return { infeasible: false, constraintId: null, kind: null };
  }

  const entry = findWinnerEntry(envelope, winnerOptionId);
  if (entry === null) return { infeasible: false, constraintId: null, kind: null };

  const probs = readConstraintSatisfactionProbs(entry);
  if (probs.length === 0) return { infeasible: false, constraintId: null, kind: null };

  const min = probs.reduce((lowest, cur) => (cur.probability < lowest.probability ? cur : lowest));

  // C1 — hard violation (live-proven).
  if (min.probability <= HARD_VIOLATION_FLOOR) {
    return { infeasible: true, constraintId: min.id, kind: 'hard_violation' };
  }

  // C2 — joint-goal tension (the array-shape / red-test discriminator).
  const joint = typeof entry.probability_of_joint_goal === "number" && Number.isFinite(entry.probability_of_joint_goal)
    ? entry.probability_of_joint_goal
    : null;
  if (joint !== null && joint < min.probability * JOINT_TENSION_THRESHOLD) {
    return { infeasible: true, constraintId: min.id, kind: 'joint_tension' };
  }

  return { infeasible: false, constraintId: null, kind: null };
}
