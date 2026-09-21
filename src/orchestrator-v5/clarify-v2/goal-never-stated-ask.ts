/**
 * ⭐⭐ THE PRODUCT ALREADY OWNS THIS SENTENCE. IT JUST ASKED IT TOO LATE.
 *
 * Every SUCCESSFUL short-brief draft closes by asking *"What outcome would make
 * this decision a success?"* — the goal question, `questions.ts:120`. It is the
 * precise information whose absence makes the OTHER 73% of those drafts fail.
 * So the product asks for the missing fact only when it did not need it, and
 * returns a dead 500 when it did.
 *
 * This module composes the turn that asks it when it is needed.
 *
 * ── WHY IT IS NOT `composeClarifyV2Response` ───────────────────────────────
 * That composer was reused first and it produced a FALSE SENTENCE. Its lead is
 * *"Before I draft the model, one quick question will make it sharper"*
 * (`preflight.ts:1071`) — true on the pre-draft path it was written for, and a
 * misstatement here, where the draft has already been attempted and has failed.
 * Its escape-hatch chip is worse: `assertClarifyChipContract`
 * (`preflight.ts:1173`) REQUIRES a *"Draft it anyway"* chip on every clarify
 * response, and offering that here offers the user the one action just measured
 * to fail 11 times out of 15 on this input. A contract that is right for
 * pre-draft clarification is wrong for post-draft recovery — two questions
 * under one composer (trap 21), so they are named apart.
 *
 * What IS reused, by import rather than by copy: the question text, its impact
 * clause and its candidate answers, all from `QUESTION_TEMPLATES` via
 * `composeClarifyQuestions` — so the product asks this in ONE voice and a
 * reword at the template moves both paths together. And `CLARIFY_V2_MAX_CHIPS`,
 * because the UI silently drops chips past the cap and that fact is not this
 * module's to re-decide.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It ships NO graph and NO partial model. That is the whole safety argument and
 * it holds by construction rather than by care: nothing can silently vanish
 * from a comparison that was never presented, no missing constraint can read as
 * "no constraints", and there is no gutted model to mistake for a whole one.
 * The drafted graph is discarded here exactly as it is discarded today — the
 * difference is that the user is told what to do instead of seeing nothing.
 */

import type { OlumiResponse } from "@talchain/schemas/boundary";
// The same chip type `composeClarifyV2Response` uses, from the same module —
// a second spelling of one shape is how two producers drift apart.
import type { SuggestedAction } from "../compose/types.js";
import { composeClarifyQuestions } from "./questions.js";
import { CLARIFY_V2_MAX_CHIPS } from "./preflight.js";

/**
 * The lead sentence.
 *
 * ⚠ IT NAMES OUR OWN GAP, NOT THE USER'S. The brief was not deficient: the
 * pipeline minted a contentless goal, could not connect the alternatives to it,
 * and failed. Copy that says "your brief was too vague" would be both false and
 * unactionable — the rich-brief arm differs from this one by a single sentence
 * naming the outcome, not by quality. Measured: same graph-size band, 0/10
 * failures once the outcome is named.
 *
 * It also does not apologise at length or describe internal machinery. What the
 * user needs is the question.
 */
export const GOAL_NEVER_STATED_LEAD =
  "I got as far as the alternatives, but I could not tell what they should be judged against, "
  + "so the model would not hold together.";

/** The closing line — how to answer, and that the brief itself is safe. */
export const GOAL_NEVER_STATED_TAIL =
  "Tap one below or type your own, and I'll draft the model around it. "
  + "You don't need to rewrite anything else.";

/**
 * Compose the post-draft-failure goal ask.
 *
 * Shape matches the two graphless turns already shipped on this route
 * (`composeClarifyV2Response`, and the frame-no-brief guard at
 * `route-v2.ts:7128`): `response_version: 2`, no `draft_graph` key, empty
 * `blocks`, `stage_indicator: 'frame'` so the UI stays on the graph-creation
 * path.
 *
 * ⚠ `stage_indicator` is 'frame', NOT 'analyse'. The draft did not land, so
 * there is nothing to analyse; telling the UI otherwise would advance a stage
 * the model never reached.
 */
export function composeGoalNeverStatedAsk(): OlumiResponse {
  // ONE dimension, deliberately. The measurement isolated the goal — the
  // outcome sentence alone flipped 11/15 failures to 0/10 — so asking about
  // options or horizon here would dilute the one question that is known to
  // work and spend chip slots on questions nothing measured.
  const [question] = composeClarifyQuestions(["goal"], 1);
  if (question === undefined) {
    // `composeClarifyQuestions` throws on a malformed template and returns a
    // question for every requested dimension otherwise, so this is
    // unreachable — but returning a chipless prose ask is the fail-safe
    // direction: the user still gets the question, just without taps.
    return {
      response_version: 2,
      assistant_text: `${GOAL_NEVER_STATED_LEAD} What outcome would make this decision a success?`,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: "frame",
    } as OlumiResponse;
  }

  const assistantText =
    `${GOAL_NEVER_STATED_LEAD}\n\n`
    + `${question.text} (${question.impact})\n\n`
    + GOAL_NEVER_STATED_TAIL;

  // Every chip slot goes to a candidate answer. There is no escape-hatch chip
  // here BY DESIGN — see the module header: "draft it anyway" is the action
  // that just failed, and a chip that reproduces the failure is a dead end
  // wearing a button. The user can still type anything, including a retry.
  const chips: SuggestedAction[] = question.candidates
    .slice(0, CLARIFY_V2_MAX_CHIPS)
    .map((c) => ({ id: c.id, label: c.label, message: c.message }));

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: chips,
    insights: [],
    stage_indicator: "frame",
  } as OlumiResponse;
}
