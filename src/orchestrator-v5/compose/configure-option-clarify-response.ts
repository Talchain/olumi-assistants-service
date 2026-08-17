/**
 * L16 / N16 — deterministic composer for the bare configure-option remedy.
 *
 * Turns the facts `configure-option-clarify.ts` derived from the graph into
 * the reply that replaces the walk's dead end:
 *
 *   BEFORE (staging `9a0541b`, `b-wire-r5-01-configure-chip-res.txt`):
 *     "I wasn't able to make that change safely. Can you describe what you'd
 *      like to add or change in simpler terms?"
 *     — no option named, no factor named, no format given, and the gate copy
 *       degraded to generic on the same turn.
 *
 *   AFTER: the blocked option by name, the factor it is actually linked to by
 *   name, and the one sentence that writes it.
 *
 * COPY CONTRACT — every string here must survive the V5 egress guards:
 *   - `FORBIDDEN_USER_FACING_PHRASES` replaces the WHOLE response on a hit, so
 *     no "couldn't", no "no change was made", no "let me know", no "previous
 *     analysis". The unit test asserts this with `findForbiddenPhraseHit`
 *     rather than by re-listing the patterns here (trap 12: derive the check,
 *     do not mirror the list).
 *   - No internal identifiers. Every entity is named by its user-facing
 *     `label`; `fac_*` / `opt_*` ids never reach this module's output.
 *
 * The instruction sentence is built by `buildConfigureOptionAdvisedFormat`,
 * NOT written here — the same builder the router's `effect_vocab` /
 * `option_value_set` triggers are calibrated against. A future change to the
 * accepted phrasing updates the suggestion and the route together, so this
 * reply can never start advising a sentence the product would reject (the
 * exact failure the 2.11 diagnosis recorded as "the assistant suggests
 * phrasings that cannot return to the lane that suggested them").
 */

import {
  messageAnswersMissingValueAsk,
  readMissingValueAnswer,
} from '../routing/missing-value-answer.js';
import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';

export interface ComposeConfigureOptionClarifyInput {
  readonly optionLabel: string;
  /** Real linked factors, already filtered to the unset ones. Non-empty. */
  readonly factorLabels: readonly string[];
  readonly stage: StageType;
  /**
   * THE MESSAGE THIS REPLY IS ANSWERING. Required, and that is the whole fix.
   *
   * ⭐⭐ IT REPLACED A `valueAlreadySupplied?: boolean` THE CALLER HAD TO
   * REMEMBER TO PASS — AND ONE OF THE TWO CALLERS DID NOT.
   * `route-v2.ts`'s pre-edit intercept passed only `optionLabel`, `factorLabels`
   * and `stage`, so at that site the terminating branch was UNREACHABLE: no
   * matter what the user said, they got the demand. An optional boolean that
   * selects between "repeat yourself" and "terminate" is a hand-maintained
   * mirror of the caller's diligence (CLAUDE.md trap 12), and it drifted exactly
   * as that trap predicts.
   *
   * With the message required, the composer derives the condition itself from
   * the estate's single owner (`routing/missing-value-answer.ts`), so THE SAME
   * UNMODIFIED DEMAND CANNOT BE RE-ISSUED TO AN ANSWER AT ANY CALL SITE,
   * present or future. There is no flag left to forget.
   *
   * ⚠ THE COPY STILL MUST NOT CLAIM POSSESSION OF A NUMBER. The predicate
   * answers "does this message look like an answer to the ask?", NOT "do I have
   * the user's number for THIS option on THIS factor?" — two different questions
   * (trap 21), and nothing in CEE records which slot was asked about. So every
   * sentence in the branches below is a claim about the MODEL (this option has
   * no effect value), which holds whatever the message contained. Asserting "I
   * have your number" off a text predicate would fabricate the user's input.
   */
  readonly message: string;
  /**
   * Whether the run would ACTUALLY proceed on the model as it now stands —
   * `resolveRunAdmission(...).willProceed`, computed by the caller.
   *
   * ⚠⚠ REQUIRED BECAUSE THE UNCONDITIONAL PROMISE WAS THIS PR'S OWN DEFECT ONE
   * LEVEL DOWN. The first version of the terminating branch said "the analysis
   * will run on the options that are set" with no knowledge of the graph — so
   * it said it when a structural blocker co-existed, and when exclusion leaves
   * fewer than two options. That is *offering a run the server refuses*, in
   * prose, by a composer whose input could not even express the condition.
   *
   * `undefined` means the caller could not determine it, and is treated exactly
   * like `false`: no promise is made. A claim about whether analysis can run is
   * never made on a guess.
   */
  readonly analysisWillProceed?: boolean;
  /**
   * The honest next step when the run would NOT proceed — the admission's own
   * `strict.nextStep`. Surfaced so the reply can say what to fix instead of
   * making a promise it cannot keep. Omitted/null ⇒ the copy simply makes no
   * claim about analysis.
   */
  readonly blockedNextStep?: string | null;
}

/**
 * The value phrasings this lane RECOGNISES BUT CANNOT BIND TO A NUMBER — pinned
 * as an explicit set rather than left silent (trap 22f's honest-gap protocol).
 *
 * ⚠⚠ THIS SET'S MEANING CHANGED, and the change is recorded rather than the set
 * quietly deleted (trap 14 — an honest label must not be overwritten). It used
 * to mean *"phrasings the demand REPEATS on"*: `carriesConfigureOptionValuePayload`
 * requires a digit, so a qualitative answer got the identical demand back. That
 * was measured still live at this tip — the product advises "…to {value}", the
 * user answers "…to high", and the product repeats itself.
 *
 * It now means *"phrasings that TERMINATE the demand but cannot be written"*.
 * Each member reaches the CHANGED ASK: the word is quoted back, the slot is
 * named, and a number on the 0–1 scale is requested. Nothing is guessed.
 *
 * ⭐ WHY THE REMAINING GAP IS NOT CLOSED BY MAPPING WORDS TO NUMBERS. "high"
 * would have to become a figure, and choosing it is inventing the user's value —
 * the fabrication class the sibling claim guard exists to close (P5), bought to
 * save one turn. The ambiguity is the product (trap 22f), not a lookup table.
 */
export const QUALITATIVE_VALUE_KNOWN_DROPPED: readonly string[] = [
  "Set the X option's effect on Y to high",
  "Set the X option's effect on Y to about a third",
  "Set the X option's effect on Y to roughly half",
  "Set the X option's effect on Y to low",
];

/**
 * A CONCRETE example value, not a placeholder.
 *
 * ⚠ THIS WAS `'<0-1>'` AND THE ANGLE BRACKETS REACHED REAL USER COPY (NEW-5,
 * simulated-user run 2026-08-16): *"Set the … option's effect on … to `<0-1>`
 * Replace `<0-1>` with a number from 0 … to 1."* A strategic user was being
 * asked to hand-type a templated command string and mentally expand a
 * placeholder — the L-38 template-syntax-in-prose family, and a worse instance
 * of it than the one that was filed.
 *
 * A real number in the slot makes the sentence directly copyable, which is the
 * whole point of advising a phrasing at all: it is `PROBE_P1` verbatim, the form
 * proven to route (`configure-option-chip-text.ts`), and the routing witness
 * only requires a digit after `to`, so a decimal is accepted exactly as the
 * placeholder form was. The 0-to-1 meaning is still glossed in the next
 * sentence — the gloss was never the problem; the placeholder was.
 */
export const CONFIGURE_OPTION_EXAMPLE_VALUE = '0.6';

/** Join labels as readable English: "A", "A and B", "A, B and C". */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Build the deterministic remedy reply. Pure — no I/O, no LLM, no invention.
 */
export function composeConfigureOptionClarifyResponse(
  input: ComposeConfigureOptionClarifyInput,
): OlumiResponse {
  const { optionLabel, factorLabels } = input;
  const primaryFactor = factorLabels[0];

  const linkSentence =
    factorLabels.length === 1
      ? `It is linked to ${primaryFactor}, and that link has no value yet.`
      : `It is linked to ${joinLabels(factorLabels)}, and those links have no values yet.`;

  const example = buildConfigureOptionAdvisedFormat(
    optionLabel,
    primaryFactor,
    CONFIGURE_OPTION_EXAMPLE_VALUE,
  );

  // THE TERMINATING BRANCH. The user already gave a number and it did not
  // attach, so asking again in the same words says nothing new and blames them
  // for it. Say what is true instead — and say the thing that is now WORTH
  // knowing: since the two-term run admission landed
  // (`tools/handlers/analysis-ready-core.ts::resolveRunAdmission`), an option
  // with no effect values no longer stops the analysis. It is left out of the
  // comparison and named, which the run already discloses.
  // THE TERMINATING BRANCH. Every sentence here is a claim about the MODEL, not
  // about the message: the predicate that selects this branch is a TEXT
  // predicate and cannot tell whose value it saw (see the `message` field's
  // doc), so "I have your number" would be a fabrication. What IS true either
  // way is that the option still has no effect values.
  const analysisSentence =
    input.analysisWillProceed === true
      // Only ever said when the caller has DERIVED that the run proceeds.
      ? `You do not have to set it before analysing: the analysis will run on the options that are set, and it will name "${optionLabel}" as left out of the comparison rather than scoring it.`
      : typeof input.blockedNextStep === 'string' && input.blockedNextStep.length > 0
        // No promise. The honest alternative, in the admission's own words.
        ? `The analysis cannot run on this model yet. ${input.blockedNextStep}`
        // Nothing derivable ⇒ say nothing about analysis at all. Silence is the
        // only honest option when the condition is unknown.
        : null;

  // ⭐ THE TERMINATING DERIVATION, in ONE place. `answered` is deliberately
  // WIDER than `bindable`: a hedged, targeted or qualitative answer cannot be
  // written to a slot and is still unmistakably an answer, and repeating the
  // demand at it is the witnessed defect. See `messageAnswersMissingValueAsk`.
  const answer = readMissingValueAnswer(input.message);
  const answered = messageAnswersMissingValueAsk(input.message);

  // ⭐⭐ THE CHANGED ASK. The user answered the product's own template with a
  // WORD where it wanted a number ("…to high", "…to about a third" — the
  // QUALITATIVE_VALUE_KNOWN_DROPPED set, measured looping at this tip). The demand
  // must not repeat, and the word must not be silently mapped to a number: that
  // would invent the user's figure, the exact class the sibling claim guard
  // exists to close (P5). So the ask CHANGES — their word is quoted back, the
  // slot is named, and the scale is stated. Progress, or a different question;
  // never the same one twice.
  const qualitativeText = answer !== null && answer.kind === 'qualitative'
    ? [
        `I can't put "${answer.term}" on that link — the effect value has to be a number.`,
        `Give me one for ${primaryFactor} on "${optionLabel}", from 0 (this option does nothing to it) to 1 (this option drives it fully).`,
        ...(analysisSentence === null ? [] : [analysisSentence]),
      ].join(' ')
    : null;

  const assistant_text = qualitativeText !== null
    ? qualitativeText
    : answered
    ? [
        `"${optionLabel}" still has no effect value on ${primaryFactor}, so that link is not carrying anything yet.`,
        ...(analysisSentence === null ? [] : [analysisSentence]),
        `To set it directly, open "${optionLabel}" on the canvas and enter the value on its link to ${primaryFactor}.`,
      ].join(' ')
    : [
        `"${optionLabel}" has no effect values yet, so the analysis cannot compare it with the others.`,
        linkSentence,
        `Tell me what it changes, like this: ${example}`,
        `Use a number from 0 (this option does nothing to it) to 1 (this option drives it fully).`,
      ].join(' ');

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    // Deliberately none. A chip must carry a COMPLETE message, and completing
    // this one means choosing the user's number for them — see the header of
    // `routing/configure-option-clarify.ts`.
    suggested_actions: [],
  });
}
