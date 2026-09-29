/**
 * orchestrator-eval — decision_review PRODUCTION assembly.
 *
 * This file is deliberately thin. Its entire job is to call the runtime's own
 * exported user-message builder, `buildDecisionReviewUserMessage`
 * (`src/cee/decision-review/invoke.ts:315`), so a candidate prompt is evaluated
 * against the EXACT `<BRIEF>` / `<GRAPH>` / `<ISL_RESULTS>` /
 * `<DETERMINISTIC_COACHING>` / `<DECISION_CONTEXT>` / `<SCAFFOLDED_OPTIONS>` /
 * `<FLIP_THRESHOLD_DATA>` section assembly staging serves — including its
 * array caps, its relevance-ranked truncation, and its `[TRUNCATED: …]`
 * disclosure markers.
 *
 * ── Why this matters more than it looks ─────────────────────────────────────
 *
 * The pre-existing decision_review evaluator (`tools/graph-evaluator/src/
 * adapters/decision-review.ts`) builds its request as
 * `JSON.stringify(fixture.input)` plus a hardcoded five-claim
 * `<SCIENCE_CLAIMS>` block. That is a TWIN of production assembly, and it has
 * been drifting since 2026-03-06: it has no section tags at all, so it cannot
 * measure a prompt that reads them, and it cannot see truncation disclosure,
 * scaffold disclosure, or the flip-threshold block — three input surfaces the
 * runtime added afterwards. A score from a twin is a score of the twin.
 *
 * The rule for this file matches `guards.ts`: import, never copy.
 */

import { buildDecisionReviewUserMessage } from '../../../../src/cee/decision-review/invoke.js';
import type { DecisionReviewEvalInput } from './types.js';

/**
 * The margin the runtime passes to the assembler.
 *
 * `invokeDecisionReview` computes exactly this immediately before calling the
 * builder (`invoke.ts:478-481`), and the exported `DecisionReviewMeta.margin`
 * doc states the identity verbatim: "winner.win_probability minus
 * runner_up.win_probability. Null when no runner-up exists."
 *
 * It is not exported as a function, so this is the one arithmetic identity the
 * eval restates rather than imports. It is restated HERE, once, rather than
 * being baked into fixture data — a fixture-carried margin would be a second
 * copy that could disagree with the winner/runner_up it sits beside, and
 * nothing would notice.
 */
export function computeMargin(input: DecisionReviewEvalInput): number | null {
  return input.runner_up !== null
    ? input.winner.win_probability - input.runner_up.win_probability
    : null;
}

/**
 * Assemble the user message for one fixture through the PRODUCTION builder.
 * Returns the message plus the margin used, so a report can show both.
 */
export function assembleDecisionReviewUserMessage(input: DecisionReviewEvalInput): {
  userMessage: string;
  margin: number | null;
} {
  const margin = computeMargin(input);
  return { userMessage: buildDecisionReviewUserMessage(input, margin), margin };
}

/**
 * The section tags the production builder emits. Used by the assembly-fidelity
 * report (and its test) to show WHICH sections a fixture actually exercises —
 * a fixture that reaches none of the post-v11 sections is measuring the v11
 * surface no matter what its description claims.
 */
export const PRODUCTION_SECTION_TAGS = [
  'BRIEF',
  'GRAPH',
  'ISL_RESULTS',
  'DETERMINISTIC_COACHING',
  'DECISION_CONTEXT',
  'SCAFFOLDED_OPTIONS',
  'FLIP_THRESHOLD_DATA',
] as const;

export type ProductionSectionTag = (typeof PRODUCTION_SECTION_TAGS)[number];

/** Which production sections a given assembled message actually contains. */
export function sectionsPresent(userMessage: string): ProductionSectionTag[] {
  return PRODUCTION_SECTION_TAGS.filter((tag) => userMessage.includes(`<${tag}>`));
}
