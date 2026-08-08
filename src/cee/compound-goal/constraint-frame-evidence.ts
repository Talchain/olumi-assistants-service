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
  // ⚠ HONEST STATUS OF THE DISAGREEMENT HALF: NO TEST KILLS IT, AND IT IS NOT
  // CLAIMED EQUIVALENT. Relaxing `!== 1` to "take the first" left the whole
  // suite green (mutant A-M5). The measured reason is that TODAY the two frames
  // are minted on DISJOINT SIGN RANGES — `extractReductionConstraints` is the
  // only 'delta' producer and always flips its value negative, while every
  // bound/temporal branch mints a non-negative level — so no input reaching
  // this filter can carry both frames on one number, and a discriminating
  // fixture would have to be invented rather than derived from the producer.
  // The branch is kept because that disjointness is a PROPERTY OF TODAY'S
  // EXTRACTOR, not of this contract: a future branch minting a negative LEVEL
  // ("keep net margin above -2%") makes the collision reachable immediately,
  // and the failure mode would be a silently picked frame. Fail closed now,
  // rather than discover it as a confident wrong probability later.
  const frames = new Set<GoalThresholdFrameType>(matching.map((c) => c.valueFrame));
  if (frames.size !== 1) return undefined;

  return [...frames][0];
}
