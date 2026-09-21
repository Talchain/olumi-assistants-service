/**
 * ⭐⭐ THE OPTION-LABEL CLARIFY — the ask that was detected and discarded.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES. `labelIsTheDecisionItself`
 * (`tools/propose-add-option.ts:489`) detects an option proposed under its own
 * decision's name — "Geographic expansion" under "Geographic expansion
 * strategy". It returned `LABEL_IS_THE_PARENT_DECISION`, and the route branched
 * ONLY on `composed.status === 'composed'`, so every other status fell through
 * to the generic edit lane carrying telemetry and nothing else
 * (`fell_through:text_clarify`). The product knew precisely what was wrong with
 * the name and answered "tell me the specific factor, edge, option, or value to
 * change" — a sentence about a different question entirely.
 *
 * This is the exit the detector's own header nominates as its successor work:
 * where the name may be the decision rather than an option, the honest answer
 * is neither accept nor refuse but ASK. Make the ambiguity the product
 * (CLAUDE.md trap 22f).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ SCOPE, STATED SO IT IS NOT OVER-READ. This closes the case that is already
 * decided DETERMINISTICALLY. It does NOT close the general compelled-invention
 * defect — the tool schema sets `required: ['label']` (`:334`), so a model must
 * emit a name and has no legal way to decline, and `clarification` is scoped to
 * "which decision owns this option" (`:319`) with `candidate_decision_ids` the
 * only channel on the wire (`:355`). A model at temperature 0 must still invent
 * a name when it has none. That needs a SCHEMA change and is separate work.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ IT SHIPS NO CHIP, AND THAT IS THE LOAD-BEARING DECISION HERE.
 *
 * A chip is a REPLAY MESSAGE. This seam holds exactly two names — the label
 * that was refused, and the decision's own name — and a chip spelling EITHER
 * re-enters the very rejection it was minted to end. That is the closed loop
 * `duplicate-option-label-response.ts:133-137` documents for its own seam:
 * "every escape route the product offered was spelled in the vocabulary that
 * had collided". Inventing a THIRD name to put on a chip is the compelled-
 * invention defect one level up, committed by us rather than by the model.
 *
 * So the ask is free text, and the absence of chips is asserted by the
 * companion spec so a later tidy-up cannot quietly add one back.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COPY CONTRACT. "I have not changed the model." is taken VERBATIM from
 * `duplicate-option-label-response.ts`, which took it from
 * `option-effect-ask-response.ts` — both ship it today, so it is already proven
 * against `FORBIDDEN_USER_FACING_PHRASES`. Do NOT reach for the natural
 * phrasings: "no changes were made", "nothing changed" and "no change was made"
 * are BANNED at runtime as state-mutation denials, and a hit replaces the
 * ENTIRE response with the neutral fallback. The composed bytes are checked
 * against `findForbiddenPhraseHit` and `findSuccessClaimHit` BY EXECUTION in
 * `__tests__/option-label-clarify-response.test.ts` — not by inspection.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';

/**
 * Exported so the spec pins the exact bytes rather than a paraphrase: this
 * sentence is proven-safe by PRECEDENT, and a reworded copy would lose that
 * provenance silently.
 */
export const OPTION_LABEL_CLARIFY_UNCHANGED_SENTENCE = 'I have not changed the model.';

export interface ComposeOptionLabelClarifyInput {
  /** The refused name, in the spelling the user saw. Quoted back verbatim. */
  readonly proposedLabel: string;
  /** The decision it collided with, in the model's own spelling. */
  readonly decisionLabel: string;
  readonly stage: StageType;
}

/**
 * Build the deterministic label-clarification reply. Pure — no I/O, no LLM, no
 * invention: both strings are facts the caller already holds (one from the
 * user's turn, one from the model's own nodes).
 */
export function composeOptionLabelClarifyResponse(
  input: ComposeOptionLabelClarifyInput,
): OlumiResponse {
  const assistant_text =
    `"${input.proposedLabel}" is the name of the decision itself, not an option ` +
    `for it. ${OPTION_LABEL_CLARIFY_UNCHANGED_SENTENCE} What should I call the ` +
    `option — one of the alternatives you are weighing up under ` +
    `"${input.decisionLabel}"?`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    // ⚠ EMPTY BY DESIGN — see the header. Every name this seam can spell
    // re-enters the rejection, and a third name would be invented.
    suggested_actions: [],
  });
}
