/**
 * ⭐⭐ THE DUPLICATE-OPTION-LABEL EXIT — the ASK that could not be answered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS REPLACES, measured at pristine `14aefde6` on the wire-captured
 * graph with one of its own option nodes cloned under a new id:
 *
 *   "Your message names 2 options — "subcontracting inner-city deliveries to a
 *    green courier" and "subcontracting inner-city deliveries to a green
 *    courier" — so I do not know which one 0.12 belongs to. … Pick one below"
 *
 * The product quoted ONE STRING TWICE and asked the user to choose between the
 * two. Both chips carried a byte-identical `label` AND a byte-identical
 * `message`, differing only in an ordinal id, because
 * `buildConfigureOptionAdvisedFormat` composes a chip out of LABELS and never
 * ids. Clicking either replayed a message that re-entered the same ask.
 *
 * ⭐ THE LOOP WAS CLOSED BY CONSTRUCTION, NOT BY ACCIDENT: every escape route
 * the product offered was spelled in the vocabulary that had collided. The only
 * escape was to select the node and press Delete — the one route that carries
 * IDENTITY rather than a LABEL, and the one route the product never names.
 * THE ESCAPE EXISTED BUT WAS UNNAMEABLE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY RENAME, AND NOT ONE OF THE THREE EXITS THAT WERE REJECTED.
 *
 *   MERGE the two options       → silently deletes a user's option. Over-
 *                                 suppression here is WORSE than the dead end.
 *   RENAME THEM FOR THE USER    → invents user-facing content (P5).
 *   PUT THE ID IN THE REPLAY    → collides head-on with this seam's copy
 *                                 contract: entities are named by their
 *                                 user-facing labels only, never `opt_*`.
 *   DECLINE                     → drops the turn to the edit LLM, i.e. the
 *                                 wrong-entity-write path `option-effect-write`
 *                                 exists to close. A visible dead end traded
 *                                 for a possible silent corruption.
 *
 * The fourth exit is the estate's ratified one for an unwinnable
 * disambiguation (CLAUDE.md trap 22f): MAKE THE AMBIGUITY THE PRODUCT. The
 * product genuinely cannot refer to these options by label, so it says exactly
 * that, and names the one action that resolves it without deleting anything,
 * without inventing anything and without an id — RENAME, which the user
 * performs through an identity-carrying canvas selection: the very surface
 * that made Delete work.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ IT SHIPS NO CHIP, DELIBERATELY. A chip's replay message is a SENTENCE, and
 * every sentence that names one of these options names both. A chip here could
 * only re-enter the loop it was minted to end — which is precisely how the
 * defect worked. The absence is asserted by the companion spec, so a later
 * tidy-up cannot add one back silently.
 *
 * ⚠ THE LABEL IS QUOTED EXACTLY ONCE, and the count is DERIVED. The old copy's
 * whole failure was repeating one string as if repetition distinguished it; a
 * three-way collision must read as "Three of your options share the name X",
 * never as the same string listed three times.
 *
 * COPY CONTRACT: "I have not changed the model." is taken VERBATIM from the
 * sibling `option-effect-ask-response.ts`, which ships it today — so it is
 * already proven against `FORBIDDEN_USER_FACING_PHRASES` (which bans
 * "nothing changed" and "no change was made", not this sentence).
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';

/**
 * Small counts read as words in ordinary English; anything larger reads better
 * as a digit. DERIVED from the count rather than written per-branch, so a
 * four-way collision cannot fall through to a sentence that says "two".
 */
function countWord(count: number): string {
  const words: Readonly<Record<number, string>> = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };
  return words[count] ?? String(count);
}

export interface ComposeDuplicateOptionLabelInput {
  /** The shared label, in the spelling the user sees. Quoted ONCE. */
  readonly collidingLabel: string;
  /** How many options carry it. Always >= 2 at every call site. */
  readonly collidingCount: number;
  readonly stage: StageType;
}

/**
 * Build the deterministic rename-coaching reply. Pure — no I/O, no LLM, no
 * invention: the label is a graph fact and the count is derived from it.
 */
export function composeDuplicateOptionLabelResponse(
  input: ComposeDuplicateOptionLabelInput,
): OlumiResponse {
  const assistant_text =
    `${countWord(input.collidingCount)} of your options share the name ` +
    `"${input.collidingLabel}", so I cannot tell which one you mean. ` +
    `I have not changed the model. Rename one of them on the canvas — select ` +
    `it and edit its name — then tell me the value again and I will record it.`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    // ⚠ EMPTY BY DESIGN — see the header. Every label-spelled chip re-enters
    // the collision, and an id-spelled one breaks the copy contract.
    suggested_actions: [],
  });
}
