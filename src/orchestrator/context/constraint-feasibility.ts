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

/**
 * The constraint verdict for one analysis turn. ONE meaning, five answers.
 *
 * WHY AN ENUM AND NOT A BOOLEAN. #703 modelled "was the user's hard constraint
 * honoured?" as a single `unevaluated` boolean. Both of its branches turned out
 * to be wrong for a real producer state:
 *
 *   - `true` on a constraint-IDENTITY failure tells the user their condition
 *     was never checked, on a run where the engine plainly DID check
 *     something. False statement, and it costs a valid recommendation.
 *   - `false` on that same failure (the first attempt at fixing it) reads as
 *     "no gap" and restores a confident leading-option claim, which asserts
 *     the user's condition holds on evidence CEE has just admitted it cannot
 *     read. Also a false statement, and the more dangerous of the two.
 *
 * There is no correct boolean, because "we could not tell" is a third answer.
 * Every state below therefore declares its own leading-option answer in
 * {@link MAY_NAME_LEADING_OPTION} rather than leaving callers to infer it.
 */
export type ConstraintVerdictState =
  /**
   * Nothing to withhold for: the user ratified no hard constraints AND the
   * producer's own constraint scoring gives no reason to hold the leader back.
   * Byte-identical to the pre-T1 product on this path.
   */
  | 'not_applicable'
  /**
   * Every ratified constraint was scored under an id we recognise, and the
   * leading option clears the violation floor. THE RECOMMENDATION SURVIVES.
   * (With no leading option id the leader half is vacuous — see
   * {@link deriveConstraintVerdict}.)
   */
  | 'evaluated_feasible'
  /**
   * The producer scored constraints and the leading option breaks one. "The
   * leader does not satisfy a limit we checked" is assertable; naming it as the
   * answer is not.
   */
  | 'evaluated_infeasible'
  /**
   * At least one ratified constraint was NOT evaluated to decision grade, on
   * evidence that cannot be confused with a keying failure: either the producer
   * said so explicitly (a not-decision-grade code, or
   * `constraints_status: 'unavailable'`), or the id spaces demonstrably line up
   * elsewhere and this constraint still has no score. "Your condition was not
   * checked" is assertable HERE AND NOWHERE ELSE.
   */
  | 'unevaluated'
  /**
   * The producer plainly evaluated constraints, but NOT ONE of the ids it
   * returned reconciles with anything we ratified.
   *
   * The seam is unenforced: CEE's persisted `constraint_id` meets PLoT's map
   * keys across an untyped `z.record` enrichment boundary that nothing
   * validates, and PLoT does not promise that key is CEE's id — it resolves
   * positionally, then by `node_id`+`operator`, then falls back to a
   * `` `${node_id}_${operator}` `` composite. So the only observable is "these
   * two id spaces do not intersect", and from that observable "the engine
   * checked YOUR condition" and "the engine checked a different condition" are
   * indistinguishable.
   *
   * Consequently this state asserts NEITHER claim. It does not say the
   * condition went unchecked, and it does not certify constraint-safety — so
   * the leading option is withheld. The user-facing disclosure says the system
   * could not reconcile which condition was evaluated, and nothing more.
   */
  | 'identity_unresolved';

/**
 * May a leading option be NAMED as the answer, per state? Exhaustive by
 * construction — `Record<ConstraintVerdictState, boolean>` makes a new state
 * without a declared answer a compile error rather than a silent `undefined`.
 *
 * Exactly two states permit it, and both mean "verified": either there was
 * nothing to verify, or everything the user ratified was verified and holds.
 * Every other state is some flavour of "we cannot stand behind that claim".
 */
export const MAY_NAME_LEADING_OPTION: Readonly<
  Record<ConstraintVerdictState, boolean>
> = Object.freeze({
  not_applicable: true,
  evaluated_feasible: true,
  evaluated_infeasible: false,
  unevaluated: false,
  identity_unresolved: false,
});

export interface ConstraintVerdict {
  /** Which of the five answers this turn's producer evidence selects. */
  readonly state: ConstraintVerdictState;
  /**
   * The state's declared leading-option answer, copied onto every verdict so
   * callers read it instead of re-deriving it from `state` (and disagreeing).
   * Always `MAY_NAME_LEADING_OPTION[state]`.
   */
  readonly mayNameLeadingOption: boolean;
  /** Producer-shipped not-decision-grade codes (deduped, sorted); else `[]`. */
  readonly codes: readonly string[];
  /**
   * The ratified constraints this verdict is ABOUT, in graph order:
   *   - `unevaluated` — the ones with no usable evaluation (all of them when a
   *     code or an 'unavailable' status condemns the whole block);
   *   - `identity_unresolved` — the full ratified set, i.e. the ids we could
   *     not reconcile. NOTE: these are NOT "unchecked" constraints, and copy
   *     built from them must not say so;
   *   - every other state — empty.
   */
  readonly constraints: readonly RatifiedConstraint[];
  /**
   * The leading option's DETECTED infeasibility — carried on every state, not
   * just `evaluated_infeasible`, so a run that is both `unevaluated` and led by
   * an option breaking a scored constraint loses nothing to the precedence
   * order below. `null` when the leader is feasible, or when feasibility could
   * not be computed at all (no leading option id, no matching option entry, or
   * no constraint probabilities — {@link deriveWinnerConstraintInfeasibility}
   * fails open in all three).
   */
  readonly leaderInfeasibility: WinnerConstraintFeasibility | null;
}

function verdict(
  state: ConstraintVerdictState,
  parts: {
    codes?: readonly string[];
    constraints?: readonly RatifiedConstraint[];
    leaderInfeasibility?: WinnerConstraintFeasibility | null;
  } = {},
): ConstraintVerdict {
  return {
    state,
    mayNameLeadingOption: MAY_NAME_LEADING_OPTION[state],
    codes: parts.codes ?? [],
    constraints: parts.constraints ?? [],
    leaderInfeasibility: parts.leaderInfeasibility ?? null,
  };
}

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

/**
 * Collect every constraint id PLoT returned a satisfaction probability for.
 *
 * TWO sources, deliberately — reading only the per-option map threw away the
 * producer's own canonical answer:
 *   1. per-option `constraint_probabilities` keys (both wire shapes);
 *   2. top-level `constraint_results[].constraint_id`, which is an EXPLICIT
 *      `constraint_id` field rather than a map key, and is therefore the
 *      keying-independent statement of "which constraints did the engine
 *      score" (present on the live doctrine-B wire — see
 *      tests/fixtures/cross-service/plot-to-cee.doctrine-b.code-derived.json).
 * Taking both means a per-option keying quirk alone cannot make a scored
 * constraint look unscored.
 */
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
  const results = envelope.constraint_results;
  if (Array.isArray(results)) {
    for (const entry of results) {
      if (entry === null || typeof entry !== 'object') continue;
      const id = readString((entry as Record<string, unknown>).constraint_id);
      if (id !== null) seen.add(id);
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
 * THE constraint verdict for one analysis turn — the single owner of the
 * meaning "was the user's hard constraint honoured?".
 *
 * DEFECT THIS EXISTS TO CLOSE (reported 1/1 on live staging): a user asks for
 * "total three-year cost below £2,500"; CEE replies "Added constraint: …";
 * PLoT returns `CONSTRAINT_OUT_OF_DOMAIN` and withholds goal-fit under
 * `CONSTRAINT_TARGET_UNRELIABLE`; and CEE nevertheless leads with "MacBook Pro
 * currently leads by 18 percentage points", disclosing nothing. The user's
 * stated condition was accepted, silently discarded by the engine, and the
 * product asserted a recommendation anyway.
 *
 * Every signal is READ FROM THE PRODUCER — the codes, the status field, the
 * per-option probabilities and the top-level `constraint_results` are all
 * PLoT's own output. Nothing here re-derives a verdict PLoT already computed,
 * and nothing here mirrors PLoT's key-resolution rule (CLAUDE.md trap #12):
 * where that rule produces ids CEE cannot reconcile, the verdict SAYS SO
 * ({@link ConstraintVerdictState} `identity_unresolved`) instead of guessing.
 *
 * PRECEDENCE, most-certain evidence first. Exactly one state is returned:
 *
 *   1. (S1/S2) An explicit producer verdict — a not-decision-grade CODE, or
 *      `constraints_status: 'unavailable'` — condemns the whole constraint
 *      block, so every ratified constraint is `unevaluated`. This outranks the
 *      identity question because the producer has told us in words that it did
 *      not reach decision grade; no id reconciliation is needed to believe it.
 *   2. Evaluations present but ZERO reconcile ⇒ `identity_unresolved`. Zero
 *      overlap is required: a single match proves the id spaces DO line up, so
 *      any remaining unscored constraint is genuinely unscored.
 *   3. (S3) A ratified constraint with no score, where step 2 did not fire ⇒
 *      `unevaluated` for exactly those constraints. This is the honest "applied,
 *      then silently unscored" case, and it covers "nothing was scored at all"
 *      (no evaluations ⇒ no id space to reconcile ⇒ no ambiguity).
 *   4. Otherwise every ratified constraint was scored, and the LEADER decides:
 *      `evaluated_infeasible` if it breaks one, else `evaluated_feasible`.
 *
 * `unevaluated` outranks `evaluated_infeasible` when both are true (constraint
 * A scored and violated, constraint B never scored): the unevaluated disclosure
 * is the one that names a condition and offers a repair step, and the
 * infeasibility is not lost — it is carried on
 * {@link ConstraintVerdict.leaderInfeasibility} in every state.
 *
 * Why {@link deriveWinnerConstraintInfeasibility} cannot cover the gap on its
 * own: it FAILS OPEN when no constraint probabilities are present
 * (`probs.length === 0 → infeasible: false`). PLoT's suppressed-unreliable
 * variant withholds exactly those probabilities, so the suppressed case is
 * indistinguishable from the no-constraints case at that predicate. This
 * function distinguishes them by consulting what the user ratified.
 *
 * With no ratified constraints the only question left is the pre-T1 one — does
 * the producer's own scoring show the leader breaking a constraint? — so the
 * result is `evaluated_infeasible` or `not_applicable`, and every caller stays
 * byte-identical to its pre-T1 behaviour. `not_applicable` therefore means
 * "nothing to withhold for", NOT merely "no ratified constraints"; collapsing
 * it to the latter would silently un-fix trust-spine board #1.
 *
 * PURE. The `CEE_CONSTRAINT_INFEASIBLE_GATE` feature flag is enforced by the
 * callers, exactly as it is for {@link deriveWinnerConstraintInfeasibility}, so
 * this function stays trivially testable and the gate keeps one owner.
 */
export function deriveConstraintVerdict(
  envelope: Record<string, unknown>,
  ratified: readonly RatifiedConstraint[],
  leadingOptionId: string | null | undefined,
): ConstraintVerdict {
  // Computed unconditionally so it can be carried on every state (see
  // `leaderInfeasibility`). Fails open to `{ infeasible: false }`.
  const leaderRaw = deriveWinnerConstraintInfeasibility(envelope, leadingOptionId);
  const leader = leaderRaw.infeasible ? leaderRaw : null;

  if (ratified.length === 0) {
    return leaderRaw.infeasible
      ? verdict('evaluated_infeasible', { leaderInfeasibility: leaderRaw })
      : verdict('not_applicable');
  }

  const codes = collectNotDecisionGradeCodes(envelope);
  const statusUnavailable =
    readString(envelope.constraints_status) === "unavailable";

  // 1. The producer's own explicit verdict on the whole block.
  if (codes.length > 0 || statusUnavailable) {
    return verdict('unevaluated', {
      codes,
      constraints: [...ratified],
      leaderInfeasibility: leader,
    });
  }

  const evaluated = collectEvaluatedConstraintIds(envelope);
  const unscored = ratified.filter((c) => !evaluated.has(c.constraint_id));

  // 2. Evaluations exist; not one of them is an id we ratified.
  if (evaluated.size > 0 && unscored.length === ratified.length) {
    return verdict('identity_unresolved', {
      constraints: [...ratified],
      leaderInfeasibility: leader,
    });
  }

  // 3. Genuinely unscored — either nothing was evaluated at all, or the
  //    overlap above proves the id spaces line up and these still have no score.
  if (unscored.length > 0) {
    return verdict('unevaluated', {
      constraints: unscored,
      leaderInfeasibility: leader,
    });
  }

  // 4. Everything the user ratified was scored. The leader decides.
  return leaderRaw.infeasible
    ? verdict('evaluated_infeasible', { leaderInfeasibility: leaderRaw })
    : verdict('evaluated_feasible');
}
