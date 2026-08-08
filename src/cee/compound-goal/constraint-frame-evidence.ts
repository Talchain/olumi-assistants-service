/**
 * ROADMAP 2.877 (link 1) — DETERMINISTIC FRAME EVIDENCE FOR A NUMBER SOMEONE
 * ELSE COMPUTED.
 *
 * THE PROBLEM THIS SOLVES. `goal_constraints[].value_frame` is an ATTESTATION:
 * `@talchain/schemas` 0.38.0 says absence means UNATTESTED and forbids
 * defaulting it, because a defaulted frame is a manufactured attestation and
 * ISL will convert a change-from-origin number against a baseline and return a
 * confident WRONG probability. #862 therefore stamped the frame only where CEE
 * owns the minting arithmetic — the regex extractor's own branches — and left
 * every other producer failing closed.
 *
 * The `add_constraint` handler is one of those. Its number came from the
 * ROUTING MODEL, and `routing/tool-schema.ts` instructs a NEGATIVE `at_most`
 * encoding for reduction framing, so BOTH frames are reachable through one
 * parameter. Inferring from `(operator, sign)` is not sound — `<=` with a
 * positive value is a level, and a negative LEVEL is perfectly sayable ("keep
 * net margin above -2%"). The handler genuinely cannot tell from the parameter.
 *
 * WHAT IT *CAN* DO. CEE holds a second, independent source of truth about that
 * turn: THE USER'S OWN MESSAGE, and a deterministic parser for it whose every
 * branch already states its own frame. This module asks that parser what frame
 * the user's words carry, and answers only when the parsed number IS the number
 * about to be persisted.
 *
 * ⚠ THE VALUE GATE IS THE WHOLE GUARANTEE, NOT A DETAIL. The extractor
 * guarantees a branch's frame describes THAT branch's number; it says nothing
 * about whether that number is the one being persisted. Requiring them to be
 * equal is what carries the guarantee across — the identical carrier the
 * sibling goal-baseline gate in `add-constraint.ts` already uses, and for the
 * identical reason. Drop it and this becomes exactly the guess the row exists
 * to refuse.
 *
 * ⚠ THIS MODULE MINTS NOTHING. It returns a frame some registered stamper
 * already attested (`compound-goal/extractor.ts`), or `undefined`. There is
 * deliberately no frame LITERAL anywhere in this file: it is a relay, and the
 * derived completeness guard over stamp sites
 * (`__tests__/constraint-value-frame-unattested.test.ts`) is right not to count
 * it as an attestation site.
 *
 * FAIL-CLOSED IN EVERY AMBIGUOUS DIRECTION: no message, no parse, a parse about
 * a different number, a parse with a different comparator, a temporal
 * pseudo-constraint, or two surviving candidates that DISAGREE ⇒ `undefined`,
 * and ISL keeps refusing. The cost of `undefined` is one unframed constraint.
 * The cost of a wrong frame is a confident wrong probability.
 */

import type { GoalThresholdFrameType } from "@talchain/schemas";

import { valuesMatch } from "../../utils/reduction-framing.js";

import {
  extractCompoundGoals,
  normaliseConstraintUnits,
  type ExtractedGoalConstraint,
} from "./extractor.js";

/**
 * Units under which the extractor's `value` is a FRACTION of the user's stated
 * percentage — `parseValue` divides by 100 for any `%`-suffixed or `percent`
 * amount, and `normaliseConstraintUnits` then relabels sub-unit values
 * `"fraction"`. `add_constraint` stores `value` in USER UNITS with no
 * normalisation, so a comparison across the two conventions has to allow the
 * ×100 reading — the same conversion the goal-baseline gate performs.
 *
 * Derived by prefix rather than by an exact set because `parseValue` appends a
 * period suffix to the percent unit (`"%/month"`).
 */
function isPercentScaled(unit: string | undefined): boolean {
  return unit === "fraction" || (unit !== undefined && unit.startsWith("%"));
}

/**
 * Does this parsed candidate state THE SAME NUMBER as the value being
 * persisted? Accepts either representation of a percentage, because the two
 * producers legitimately disagree about whether "5%" is `5` or `0.05` — and
 * neither reading changes the FRAME, which is the only thing being carried.
 */
function statesSameNumber(candidate: ExtractedGoalConstraint, value: number): boolean {
  if (valuesMatch(candidate.value, value)) return true;
  return isPercentScaled(candidate.unit) && valuesMatch(candidate.value * 100, value);
}

/**
 * The frame the USER'S OWN WORDS attest for `value` under `operator`, or
 * `undefined` when CEE holds no unambiguous deterministic evidence.
 *
 * EXTRACTION ONLY — never infers, defaults, or rounds.
 */
export function deriveStatedConstraintFrame(
  message: string | null | undefined,
  operator: ">=" | "<=",
  value: number,
): GoalThresholdFrameType | undefined {
  if (typeof message !== "string" || message.trim() === "") return undefined;
  if (!Number.isFinite(value)) return undefined;

  // `includeProxies: false` matches the draft stage's own call. A qualitative
  // proxy substitutes a DIFFERENT metric for the user's words ("improve morale"
  // -> a proxy scale), so its number is not this turn's number and its frame
  // must not be borrowed on a value coincidence.
  const parsed = normaliseConstraintUnits(
    extractCompoundGoals(message, { includeProxies: false }).constraints,
  );

  const matching = parsed.filter(
    (c) =>
      c.operator === operator &&
      // ROADMAP 2.349 — a deadline is not a hard constraint, and the merge
      // stage drops these source-agnostically. Excluded here for the same
      // reason: a months-unit pseudo-constraint must not become the frame
      // evidence for a £- or %-measured one on a bare numeric coincidence.
      c.deadlineMetadata === undefined &&
      statesSameNumber(c, value),
  );

  // One phrase routinely yields SEVERAL candidates (the extractor guesses more
  // than one target name for the same words), so uniqueness of the CANDIDATE is
  // the wrong test — unanimity of the FRAME is the right one. Zero candidates
  // and two disagreeing candidates both mean "CEE cannot say", and both must
  // return undefined rather than pick.
  //
  // ⚠ THIS DISAGREEMENT BRANCH IS LIVE DEFENCE, REACHABLE FROM A REAL BRIEF —
  // AND AN EARLIER REVISION OF THIS COMMENT CLAIMED THE OPPOSITE. It said the
  // two frames sit on DISJOINT SIGN RANGES (reduction always negative, every
  // level non-negative) so no single number could carry both, and that mutant
  // A-M5 (relax `!== 1` to "take the first") therefore had no killing fixture.
  // That was ASSERTED, not demonstrated, and it is FALSE — refuted by execution
  // in review (trap 13c: never assert an equivalence you have not measured).
  //
  // The collision lives at the ZERO BOUNDARY. On
  //   "Reduce marketing cost by 0% and keep churn under 0%."
  // the real extractor mints three LEVEL candidates (value 0, from the upper
  // bounds) and one DELTA candidate (the reduction flips +0 to -0), all `<=`,
  // none temporal — and `valuesMatch(-0, 0)` is true, so all four reach this
  // Set for a persisted value of 0. Intact, `frames.size === 2` and this
  // returns undefined (fail closed, correct). Under A-M5 it would return the
  // FIRST candidate's frame — a silently picked attestation ISL then trusts.
  // So the branch is not defence against a hypothetical future producer; it is
  // defence against a brief a user can type today. Pinned by
  // "AMBIGUOUS ZERO BOUNDARY" in add-constraint-value-frame-carry.test.ts.
  const frames = new Set<GoalThresholdFrameType>(matching.map((c) => c.valueFrame));
  if (frames.size !== 1) return undefined;

  return [...frames][0];
}
