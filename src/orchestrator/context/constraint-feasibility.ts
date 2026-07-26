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

// ===========================================================================
// T1 — the constraint that was APPLIED, then never evaluated
// ===========================================================================

/**
 * PLoT-originated codes whose meaning is "this hard constraint is NOT
 * decision-grade" — the engine accepted the constraint, then refused to score
 * it. Read off the wire; nothing here re-derives the verdict.
 *
 * `CONSTRAINT_OUT_OF_DOMAIN`  — the threshold cannot be expressed in the
 *   target's domain (live: a £2,500 monetary cap attached to a normalised
 *   [0,1] "Cost Efficiency" outcome).
 * `CONSTRAINT_TARGET_UNRELIABLE` — the target is not decision-grade, so
 *   goal-fit probabilities are suppressed (PLoT PR #205 withholds the whole
 *   top-level constraint block and sets `constraints_status: 'unavailable'`).
 */
const CONSTRAINT_NOT_DECISION_GRADE_CODES: ReadonlySet<string> = new Set([
  "CONSTRAINT_OUT_OF_DOMAIN",
  "CONSTRAINT_TARGET_UNRELIABLE",
]);

/** A hard constraint the user ratified and CEE persisted on the graph. */
export interface RatifiedConstraint {
  readonly constraint_id: string;
  /** User-facing label, when the persisted constraint carries one. */
  readonly label: string | null;
}

export interface ConstraintEvaluationGap {
  /**
   * True when at least one user-ratified hard constraint was NOT evaluated to
   * decision grade. While true, no recommendation may be asserted.
   */
  readonly unevaluated: boolean;
  /** Producer-shipped codes that evidenced the gap (deduped, sorted). */
  readonly codes: readonly string[];
  /** The ratified constraints with no usable evaluation, in graph order. */
  readonly constraints: readonly RatifiedConstraint[];
}

const NO_GAP: ConstraintEvaluationGap = Object.freeze({
  unevaluated: false,
  codes: Object.freeze([]) as readonly string[],
  constraints: Object.freeze([]) as readonly RatifiedConstraint[],
});

/**
 * Read the user-ratified hard constraints.
 *
 * Accepts EITHER the `goal_constraints` array itself — the snapshot field the
 * run_analysis handler forwards verbatim to PLoT, which is the tightest
 * possible statement of "what we asked the engine to enforce" — OR any object
 * carrying a root-level `goal_constraints` (the persisted graph, where D1's
 * `add_constraint` writes them). Taking both means this never depends on which
 * mirror a given call site happens to hold (CLAUDE.md trap #12).
 *
 * Constraints are metadata, never nodes or edges, so this array is the ONLY
 * record of what the user ratified.
 */
export function readRatifiedConstraints(source: unknown): RatifiedConstraint[] {
  const raw = Array.isArray(source)
    ? source
    : source !== null && typeof source === "object"
      ? (source as Record<string, unknown>).goal_constraints
      : undefined;
  if (!Array.isArray(raw)) return [];

  const out: RatifiedConstraint[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const id = readString(obj.constraint_id);
    if (id === null) continue;
    out.push({ constraint_id: id, label: readString(obj.label) });
  }
  return out;
}

/** Collect every constraint id PLoT returned a satisfaction probability for. */
function collectEvaluatedConstraintIds(
  envelope: Record<string, unknown>,
): Set<string> {
  const seen = new Set<string>();
  for (const source of readOptionResultSources(envelope)) {
    for (const entry of source) {
      for (const { id } of readConstraintSatisfactionProbs(entry as Record<string, unknown>)) {
        seen.add(id);
      }
    }
  }
  return seen;
}

/** Codes on the producer's warning channels that mean "not decision-grade". */
function collectNotDecisionGradeCodes(
  envelope: Record<string, unknown>,
): string[] {
  const found = new Set<string>();
  for (const key of ["inference_warnings", "critiques"] as const) {
    const arr = envelope[key];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (entry === null || typeof entry !== "object") continue;
      const code = readString((entry as Record<string, unknown>).code);
      if (code !== null && CONSTRAINT_NOT_DECISION_GRADE_CODES.has(code)) {
        found.add(code);
      }
    }
  }
  return [...found].sort();
}

/**
 * Did any user-ratified hard constraint fail to reach decision grade?
 *
 * DEFECT THIS EXISTS TO CLOSE (reported 1/1 on live staging): a user asks for
 * "total three-year cost below £2,500"; CEE replies "Added constraint: …";
 * PLoT returns `CONSTRAINT_OUT_OF_DOMAIN` and withholds goal-fit under
 * `CONSTRAINT_TARGET_UNRELIABLE`; and CEE nevertheless leads with "MacBook Pro
 * currently leads by 18 percentage points", disclosing nothing. The user's
 * stated condition was accepted, silently discarded by the engine, and the
 * product asserted a recommendation anyway.
 *
 * Why {@link deriveWinnerConstraintInfeasibility} cannot catch this: it
 * FAILS OPEN when no constraint probabilities are present (`probs.length === 0
 * → infeasible: false`). PLoT's suppressed-unreliable variant withholds
 * exactly those probabilities, so the suppressed case is indistinguishable
 * from the no-constraints case at that predicate. This one distinguishes them
 * by consulting what the user ratified.
 *
 * Every signal is READ FROM THE PRODUCER — the codes, the status field and the
 * per-option probabilities are all PLoT's own output. Nothing here re-derives
 * a verdict PLoT already computed.
 *
 * Fires iff at least one constraint was ratified AND any of:
 *   (S1) a not-decision-grade CODE is on the wire;
 *   (S2) `constraints_status` is explicitly `'unavailable'`;
 *   (S3) a ratified constraint id has NO satisfaction probability anywhere in
 *        the option results — applied, then silently unscored.
 *
 * With no ratified constraints this returns {@link NO_GAP} and every caller is
 * byte-identical to its pre-T1 behaviour.
 */
export function deriveConstraintEvaluationGap(
  envelope: Record<string, unknown>,
  ratified: readonly RatifiedConstraint[],
): ConstraintEvaluationGap {
  if (ratified.length === 0) return NO_GAP;

  const codes = collectNotDecisionGradeCodes(envelope);
  const statusUnavailable =
    readString(envelope.constraints_status) === "unavailable";
  const evaluated = collectEvaluatedConstraintIds(envelope);
  const unscored = ratified.filter((c) => !evaluated.has(c.constraint_id));

  if (codes.length === 0 && !statusUnavailable && unscored.length === 0) {
    return NO_GAP;
  }

  // A code or an 'unavailable' status condemns the whole constraint block —
  // PLoT withholds it wholesale — so every ratified constraint is unevaluated.
  // Otherwise only the specifically-unscored ones are.
  const affected =
    codes.length > 0 || statusUnavailable ? [...ratified] : unscored;

  return { unevaluated: true, codes, constraints: affected };
}
