/**
 * orchestrator-eval — goal-fit / win-probability conflation detector.
 *
 * THE WORKED DEFECT (staging scenario 90385279, fixed twice): an 89% WIN
 * probability narrated as target attainment when the scored target-fit was
 * 29.3%. House doctrine: `win_probability` ("wins most often — beats the
 * alternatives") is NOT `target_fit` ("meets your target — the modelled
 * probability of goal attainment"). The producer keeps them apart
 * (`format-analysis-for-context.ts`: TARGET_FIT_DEFINITION); the UI/LLM must
 * not re-fuse them in prose.
 *
 * This detector is NOT a re-specified copy of a runtime banned-term list — the
 * runtime guards (forbidden phrases, mutation language) are imported wholesale
 * in `guards.ts`. This is the fixture's own scenario-specific assertion: it is
 * grounded in the ACTUAL numbers the production assembly produced for this
 * fixture (the leading option's win% and target-fit%), so it catches the exact
 * conflation the fix prevents, not a keyword.
 *
 * Method (deterministic, clause-scoped):
 *   1. From the raw analysis, compute the leading option's win-percent and,
 *      when scored, its target-fit percent.
 *   2. Split the response into clauses (sentence terminators + contrastive
 *      connectives + commas).
 *   3. Flag a clause when it (a) frames GOAL/TARGET ATTAINMENT, (b) is
 *      quantified by the WIN percent, and (c) is NOT quantified by the
 *      target-fit percent. That is exactly "the win number narrated as the
 *      chance of meeting the goal".
 *
 * Known limitation (disclosed, deferred): attainment vocabulary is bounded to
 * meet/hit/reach/achieve/attain/clear + target/goal/threshold/objective, and
 * clause-splitting is heuristic. A conflation phrased entirely outside that
 * vocabulary is not caught. The follow-up widens the corpus.
 */

import type { ContextPackAnalysis } from '../../../src/orchestrator-v5/context/context-pack-assembler.js';

/** Verbs that express reaching/meeting a target. */
const ATTAINMENT_VERB =
  /\b(?:meet|meets|meeting|met|hit|hits|hitting|reach|reaches|reaching|reached|achiev\w+|attain\w+|clear|clears|clearing)\b/i;

/** Nouns that name the target being attained. */
const TARGET_NOUN = /\b(?:target|goal|threshold|objective)\b/i;

export interface GoalFitConflationResult {
  readonly conflated: boolean;
  /** The offending clause(s), verbatim, for honest reporting. */
  readonly evidence: readonly string[];
  /** The win / target-fit percents this run was grounded on (for the report). */
  readonly grounding: {
    readonly winPercent: number | null;
    readonly targetFitPercent: number | null;
  };
}

/** Round a raw model number to a percent-int on the [0,1]→% or already-% convention. */
function toPercentInt(value: number): number {
  if (value > 0 && value <= 1) return Math.round(value * 100);
  return Math.round(value);
}

/** Extract every numeric token from a clause, normalised to percent-ints. */
function clausePercents(clause: string): number[] {
  const tokens = clause.match(/\d+(?:\.\d+)?/g) ?? [];
  return tokens.map((t) => toPercentInt(parseFloat(t))).filter((n) => Number.isFinite(n));
}

/** A clause frames goal/target attainment when an attainment verb meets a target noun. */
function framesAttainment(clause: string): boolean {
  return ATTAINMENT_VERB.test(clause) && TARGET_NOUN.test(clause);
}

/** Split prose into clauses: sentence terminators, contrastive connectives, commas, semicolons. */
function splitClauses(text: string): string[] {
  return text
    .split(/[.?!;]+|\bbut\b|\byet\b|\bhowever\b|\bwhereas\b|\bwhile\b|\balthough\b|\bthough\b|,/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Detect win%/target-fit conflation in a candidate response, grounded in the
 * fixture's assembled numbers.
 */
export function detectGoalFitConflation(
  raw: ContextPackAnalysis,
  text: string,
): GoalFitConflationResult {
  const leading = raw.leading_option;
  const winPercent =
    leading && Number.isFinite(leading.probability) ? toPercentInt(leading.probability) : null;
  const targetFitPercent =
    leading && typeof leading.goal_fit_probability === 'number' && Number.isFinite(leading.goal_fit_probability)
      ? toPercentInt(leading.goal_fit_probability)
      : null;

  const grounding = { winPercent, targetFitPercent };

  // Nothing to key on: no win percent means no conflation claim to make.
  if (winPercent === null) {
    return { conflated: false, evidence: [], grounding };
  }

  const evidence: string[] = [];
  for (const clause of splitClauses(text)) {
    if (!framesAttainment(clause)) continue;
    const pcts = clausePercents(clause);
    const quantifiedByWin = pcts.includes(winPercent);
    const quantifiedByTargetFit = targetFitPercent !== null && pcts.includes(targetFitPercent);
    // The win number narrated as the chance of meeting the goal — and NOT the
    // (distinct) target-fit number. That is the conflation.
    if (quantifiedByWin && !quantifiedByTargetFit) {
      evidence.push(clause);
    }
  }

  return { conflated: evidence.length > 0, evidence, grounding };
}
