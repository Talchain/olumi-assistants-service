/**
 * ⭐⭐ THE OPTION-LABEL CLARIFY — the ASK the product was throwing away.
 *
 * ═══ THE DEFECT ═══
 * The founder typed "Should we increase the Pro plan price from £49 to £59?"
 * and the product INVENTED option names he never used, one of which then won
 * the comparison. The mechanism is upstream and structural: the tool schema
 * sets `required: ['label']` (`tools/propose-add-option.ts:334`), so the model
 * MUST produce a name and has no legal way to decline, and `clarification` is
 * scoped to "which decision owns this option" (`:319`) — label ambiguity is
 * explicitly out of scope.
 *
 * ⚠ THIS FILE DOES NOT FIX THAT GENERAL CASE. It ships the ONE case already
 * detected deterministically and currently discarded: `labelIsTheDecisionItself`
 * (`:489`) — equality after head-noun stripping, a CLOSED rule that cannot
 * oscillate. Until now it returned `LABEL_IS_THE_PARENT_DECISION` and every
 * non-`composed` status fell through to the generic edit lane with telemetry
 * only, so the user saw a generic "tell me the specific factor, edge, option,
 * or value to change" and never learned what was actually wrong.
 *
 * ═══ WHY THIS COMPOSER EXISTS RATHER THAN REUSING `composeEditClarifyResponse` ═══
 * Measured at this tip, not assumed:
 *   · `composeEditClarifyResponse` (`edit-clarify-response.ts:145`) has FIXED
 *     copy (`LEAD_TEXT` + `CLOSING_TEXT`) and draws its chips from GRAPH NODES.
 *     It cannot carry a question about a NAME.
 *   · `buildLabelChip` (`:380`) builds a VALUE-change chip — label
 *     `"Change X"`, message `"For X, what value should we use?"`. Wrong
 *     question entirely.
 * The precedent this file actually follows is
 * `compose/duplicate-option-label-response.ts`: a dedicated composer for an
 * add-option exit, FACTS IN / BYTES OUT, no invention.
 *
 * ⚠⚠ IT SHIPS NO CHIP, DELIBERATELY, AND THIS IS THE LOAD-BEARING DESIGN
 * DECISION. A chip is a REPLAY MESSAGE. The only names this seam holds are the
 * rejected label and the decision's own name, and a chip spelling EITHER
 * re-enters the exact rejection it was minted to end — the closed loop
 * `duplicate-option-label-response.ts:133-137` documents for its own seam.
 * Inventing a third name is the compelled-invention defect one level up. The
 * absence is asserted below so a later tidy-up cannot add one back silently.
 *
 * ⚠ THE COPY IS CHECKED BY EXECUTION, NOT BY INSPECTION. `findForbiddenPhraseHit`
 * and `findSuccessClaimHit` run over the composed bytes here, because the
 * natural phrasings for this sentence ("no changes were made", "I have added")
 * are exactly the ones the egress guard replaces WHOLESALE.
 */
import { describe, it, expect } from 'vitest';

import {
  composeOptionLabelClarifyResponse,
  OPTION_LABEL_CLARIFY_UNCHANGED_SENTENCE,
} from '../option-label-clarify-response.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';

const PROPOSED = 'Geographic expansion';
const DECISION = 'Geographic expansion strategy';

function compose() {
  return composeOptionLabelClarifyResponse({
    proposedLabel: PROPOSED,
    decisionLabel: DECISION,
    stage: 'decide',
  });
}

describe('composeOptionLabelClarifyResponse — the ask, not the silent decline', () => {
  it('names the rejected label AND the decision it collided with, both verbatim', () => {
    const text = compose().assistant_text;
    // Bound by IDENTITY (the exact strings), never by a value predicate: a
    // generic "that is the decision" sentence naming neither would satisfy a
    // looser assertion while telling the user nothing they can act on.
    expect(text).toContain(`"${PROPOSED}"`);
    expect(text).toContain(`"${DECISION}"`);
  });

  it('⭐ ASKS FOR THE NAME — it does not invent one, and does not merely decline', () => {
    const text = compose().assistant_text;
    expect(text).toContain('?');
    // The ask must be about the NAME. A question about a factor/edge/value is
    // the generic edit-lane copy this exit exists to replace.
    expect(text.toLowerCase()).toContain('call');
  });

  it('states the model is unchanged, using the VERBATIM already-proven sentence', () => {
    // Taken from `duplicate-option-label-response.ts` / `option-effect-ask-response.ts`,
    // which ship it today — so it is proven against FORBIDDEN_USER_FACING_PHRASES
    // rather than re-invented here (the banned variants "nothing changed" /
    // "no change was made" read perfectly and are landmines).
    expect(OPTION_LABEL_CLARIFY_UNCHANGED_SENTENCE).toBe('I have not changed the model.');
    expect(compose().assistant_text).toContain(OPTION_LABEL_CLARIFY_UNCHANGED_SENTENCE);
  });

  it('⚠ SHIPS NO CHIP — every spellable replay re-enters the rejection', () => {
    expect(compose().suggested_actions).toEqual([]);
  });

  it('⭐ the composed bytes pass the egress guards BY EXECUTION', () => {
    const text = compose().assistant_text;
    expect(findForbiddenPhraseHit(text), `forbidden phrase in: ${text}`).toBeNull();
    expect(findSuccessClaimHit(text), `success claim in: ${text}`).toBeNull();
  });

  it('POSITIVE CONTROL — the guards used above can actually fire', () => {
    // Without this, the five assertions above could pass by testing nothing
    // (trap 13: an absence assertion needs a demonstrated presence).
    expect(findForbiddenPhraseHit('Sorry, nothing changed.')).not.toBeNull();
    expect(findSuccessClaimHit('I have added the option.')).not.toBeNull();
  });

  it('is a functional direct answer on the stage it was given', () => {
    expect(compose().stage_indicator).toBe('decide');
  });
});
