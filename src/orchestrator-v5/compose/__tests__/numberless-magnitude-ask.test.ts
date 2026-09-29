/**
 * COPY MAY ONLY DESCRIBE WHAT THE INPUT ACTUALLY CONTAINED — the edge-strength
 * limb.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (deployed cee-staging, 2026-08-29, signed-in fresh
 * journey, run `20260829T163926Z-c2-d2842c`, scenario
 * 2a02c911-f093-4a7e-9ed6-ae1dcc84f205)
 *
 *   user     : "Strengthen the link from Current Monthly Churn Rate to Churn
 *               Remaining Elevated."      (a real edge, derived from the graph
 *                                          in hand; NO number anywhere)
 *   product  : "I couldn't use that as the strength of that link. Strength runs
 *               from minus one to plus one, where the sign sets the direction
 *               and the size sets how much it matters. Try a number in that
 *               range, like 0.7."
 *
 * The user gave no number. "I couldn't use THAT" names an input that does not
 * exist, and `parameter-user-phrasing.ts` says so itself at `echo_actual`: on
 * this path the number is the ROUTING MODEL's proposal, not the user's. So the
 * refusal attributes a PROPOSAL property to the USER — the exact defect class
 * ROADMAP 2.1261 closed one parameter over (`messageEvidencesUnit`, same file),
 * where the copy told a user they were "applying a value in %" on a unit-free
 * message.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PREDICATE IS A FACT CHECK, NOT AN INTENT PARSE — DELIBERATELY
 *
 * It asks ONE derivable question: does the user's message contain a digit at
 * all? If it does not, the rejected number cannot have come from them. It does
 * not attempt to read "strengthen", to rank magnitude words, or to decide what
 * the user meant — constraint parsing in this estate has already oscillated
 * through four consecutive rounds of exactly that, each fixing one direction
 * and reopening the other, and the ruling out of it is that no further
 * pattern-only rule settles such a question: where the value cannot be
 * determined, ASK.
 *
 * ⚠ WHAT IT DOES NOT DO, AND MUST NOT: it does not guess a number. "high",
 * "stronger" and "a lot" resolve to three different numbers across the estate's
 * six disagreeing band ladders (see `parameter-user-phrasing.ts` §2.384), and
 * `routing/readiness-answer-chips.ts` THE FABRICATION BOUNDARY bans a chip
 * carrying a value the PRODUCT chose. The reply asks; it never fills the slot.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CORPUS IS SOURCED FROM OUTSIDE THIS LANE'S HEAD
 *
 *   · the LIVE WIRE capture above (a real turn, a real graph, a real refusal);
 *   · the words the PRODUCT ITSELF shows for magnitude — `qualitativeBand`
 *     (`cee/factor-extraction/display-value.ts:174`: Low / Moderate / High /
 *     Very high) and the four words `parameter-user-phrasing.ts:173` names as
 *     "the words the product SHOWS" (strong / moderate / weak / slight). A user
 *     types the vocabulary the product taught them.
 *
 * EVERY CASE HAS ITS OPPOSITE-DIRECTION TWIN. The two harms cannot share one
 * window and are asserted separately:
 *   HARM A (a LIE about the user): the message carried no number and we imply
 *          it did.  → closed by this change.
 *   HARM B (a LIE the other way): the message DID carry a number and we tell
 *          the user it did not.  → guarded by the digit twins below, which must
 *          keep today's copy byte-for-byte.
 */
import { describe, it, expect } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import {
  NUMBERLESS_MAGNITUDE_KNOWN_DROPPED,
  PARAMETER_USER_PHRASING,
} from '../parameter-user-phrasing.js';
import { qualitativeBand } from '../../../cee/factor-extraction/display-value.js';
import type { ComposeContext } from '../types.js';
import type { HandlerValidationRegistry, ValidationError } from '../../routing/validator.js';

const REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};

/** The live wire error, verbatim in shape from `validator.ts`'s emission site. */
const strengthRejection = (actual: unknown): ValidationError => ({
  code: 'PARAMETER_INVALID',
  message: 'Parameter "strength" failed schema: Expected number, received string',
  details: {
    parameter: 'strength',
    issue: 'Expected number, received string',
    actual_value: actual,
    constraint_description: 'a number between -1 and 1',
    target_id: 'e-9a14decf-de4742d5',
  },
});

function composeWithMessage(error: ValidationError, userMessage?: string) {
  const ctx: ComposeContext = {
    handlerRegistry: REGISTRY,
    ...(userMessage !== undefined ? { userMessage } : {}),
  };
  return composeValidationFailure(error, ctx, 'frame');
}

/** Today's copy — the exact string the live wire returned on 29 Aug 2026. */
const LIVE_COPY =
  "I couldn't use that as the strength of that link. Strength runs from minus one to plus one, " +
  'where the sign sets the direction and the size sets how much it matters. ' +
  'Try a number in that range, like 0.7.';

/**
 * ⭐ THE WIRE-WITNESSED SENTENCE ITSELF, plus the product's own magnitude
 * vocabulary. Not one of these carries a digit.
 */
const NUMBERLESS_CORPUS: readonly string[] = [
  // the live capture, verbatim
  'Strengthen the link from Current Monthly Churn Rate to Churn Remaining Elevated.',
  // the product's own band words (qualitativeBand), asserted below to be the
  // real vocabulary rather than a hand-copy
  `Set the link from churn to revenue to ${qualitativeBand(0.9).toLowerCase()}.`,
  `Make that link ${qualitativeBand(0.6).toLowerCase()}.`,
  // the four words parameter-user-phrasing.ts names as the ones the product shows
  'Make the link from churn to revenue strong.',
  'Set that link to moderate.',
  'Make that link weak.',
  'Make the effect slight.',
  // ordinary comparative English with no number in it
  'Strengthen the link from churn to revenue.',
  'Weaken that link a lot.',
  'Make it much stronger please.',
];

/** The opposite-direction twins: the SAME intent, but the user DID give a number. */
const DIGIT_TWINS: readonly string[] = [
  'Set the link from churn to revenue to 0.7.',
  'Make that link 30.',
  'Strengthen the link from churn to revenue to 0.9.',
  'Set that link to -2.',
];

describe('the magnitude corpus is the PRODUCT’s vocabulary, not this lane’s', () => {
  it('qualitativeBand really does produce the words the corpus uses (positive control)', () => {
    // If the band ladder is renamed, the corpus above stops testing the words a
    // user is actually shown, and this control REDs rather than the corpus
    // quietly drifting into invention.
    expect(qualitativeBand(0.9)).toBe('Very high');
    expect(qualitativeBand(0.6)).toBe('High');
  });

  it('no member of the numberless corpus contains a digit (the predicate’s whole premise)', () => {
    for (const message of NUMBERLESS_CORPUS) {
      expect(/\d/.test(message), `corpus member carries a digit: ${message}`).toBe(false);
    }
  });

  it('every digit twin DOES contain a digit (contrast control for the same premise)', () => {
    for (const message of DIGIT_TWINS) {
      expect(/\d/.test(message), `twin carries no digit: ${message}`).toBe(true);
    }
  });
});

describe('HARM A — a numberless message must never be told its number was unusable', () => {
  it.each(NUMBERLESS_CORPUS)(
    'asks for a number instead of rejecting one: %s',
    (userMessage) => {
      const { response, template_id } = composeWithMessage(
        strengthRejection('stronger'),
        userMessage,
      );
      expect(template_id).toBe('parameter_invalid_numberless_magnitude');
      // It must NOT claim the user gave something.
      expect(response.assistant_text).not.toContain("couldn't use that as");
      expect(response.assistant_text).not.toContain('You gave');
      // It must say what is missing, in the product's words.
      expect(response.assistant_text).toBe(
        "I don't have a number to set that link's strength to. " +
          PARAMETER_USER_PHRASING.strength?.guidance,
      );
      // Still recoverable in one step: the scale and a usable example survive.
      expect(response.assistant_text).toContain('minus one to plus one');
      expect(response.assistant_text).toContain('0.7');
      // Still actionable.
      expect(response.suggested_actions.length).toBeGreaterThan(0);
    },
  );

  it('never fills the slot for the user (THE FABRICATION BOUNDARY)', () => {
    const { response } = composeWithMessage(
      strengthRejection('stronger'),
      'Strengthen the link from churn to revenue.',
    );
    // No chip may carry a value the PRODUCT chose, and the reply may not claim
    // a change happened.
    for (const action of response.suggested_actions) {
      expect(action.message ?? '').not.toMatch(/-?\d/);
    }
    expect(response.assistant_text.toLowerCase()).not.toContain('i have set');
    expect(response.assistant_text.toLowerCase()).not.toContain('updated');
  });

  it('does not leak the internal parameter name or the validator’s vocabulary', () => {
    const { response } = composeWithMessage(
      strengthRejection('stronger'),
      'Strengthen the link from churn to revenue.',
    );
    expect(response.assistant_text).not.toContain("'strength'");
    expect(response.assistant_text).not.toContain('a number between -1 and 1');
    expect(response.assistant_text).not.toContain('e-9a14decf-de4742d5');
  });

  it('applies to the uncertainty parameter on the same path (std)', () => {
    const { response, template_id } = composeWithMessage(
      {
        code: 'PARAMETER_INVALID',
        message: 'Parameter "std" failed schema: Expected number, received string',
        details: { parameter: 'std', actual_value: 'a bit', constraint_description: 'x' },
      },
      'Make that link less certain.',
    );
    expect(template_id).toBe('parameter_invalid_numberless_magnitude');
    expect(response.assistant_text).toBe(
      "I don't have a number to set that link's uncertainty to. " +
        PARAMETER_USER_PHRASING.std?.guidance,
    );
  });
});

describe('HARM B — a message that DID carry a number keeps today’s copy, byte for byte', () => {
  it.each(DIGIT_TWINS)('leaves the live copy unchanged: %s', (userMessage) => {
    const { response, template_id } = composeWithMessage(strengthRejection(30), userMessage);
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toBe(LIVE_COPY);
  });

  it('a turn with NO user message keeps today’s copy (fail-open, as messageEvidencesUnit does)', () => {
    const { response, template_id } = composeWithMessage(strengthRejection(30));
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toBe(LIVE_COPY);
  });

  it('a parameter with no numberless phrasing is untouched even on a numberless message', () => {
    // `value` owns its own qualitative branch (2.384) and must not be
    // intercepted by this one; `label`/`unit` are not magnitudes at all.
    const { template_id } = composeWithMessage(
      {
        code: 'PARAMETER_INVALID',
        message: 'Parameter "label" failed schema: too short',
        details: { parameter: 'label', actual_value: '', constraint_description: 'x' },
      },
      'Rename that thing to something better.',
    );
    expect(template_id).not.toBe('parameter_invalid_numberless_magnitude');
  });
});

describe('THE KNOWN-DROPPED SET — pinned as data, RED if it grows OR shrinks', () => {
  it('is exactly this set', () => {
    expect([...NUMBERLESS_MAGNITUDE_KNOWN_DROPPED]).toEqual([
      'Strengthen the link from Q3 revenue to churn.',
      'Strengthen the link from churn to revenue by 20 percent.',
    ]);
  });

  it('every member really is dropped — it keeps today’s copy (the gap is REAL, not asserted)', () => {
    for (const message of NUMBERLESS_MAGNITUDE_KNOWN_DROPPED) {
      const { response, template_id } = composeWithMessage(strengthRejection(30), message);
      expect(template_id, `known-dropped member was actually handled: ${message}`).toBe(
        'parameter_invalid',
      );
      expect(response.assistant_text).toBe(LIVE_COPY);
    }
  });

  it('every member carries a digit, which is WHY it is dropped (the reason, not a label)', () => {
    // The digit belongs to a label ("Q3") or to a quantity that is not a
    // strength ("by 20 percent"). The predicate cannot tell those apart from a
    // stated strength without becoming the pattern-matching rule this estate
    // ruled against, so it declines and today's copy stands. Declining is a
    // gap, never a lie.
    for (const message of NUMBERLESS_MAGNITUDE_KNOWN_DROPPED) {
      expect(/\d/.test(message), message).toBe(true);
    }
  });
});
