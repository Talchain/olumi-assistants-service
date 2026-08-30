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
  MISSING_VALUE_ASK_FORMAT_HINT,
  messageAnswersMissingValueAsk,
  readMissingValueAnswer,
} from '../routing/missing-value-answer.js';
import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import {
  buildConfigureOptionAdvisedFormat,
  buildConfigureOptionDirectSetSentence,
  messageNamesOptionEffectSlot,
} from '../configure-option-chip-text.js';

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

/**
 * Reply shapes this module KNOWINGLY CANNOT READ, pinned as data so the suite
 * REDs if the set GROWS or SHRINKS (the honest-gap protocol
 * `MISSING_VALUE_ANSWER_KNOWN_DROPPED` already uses one module over).
 *
 * ⚠⚠ THE SECOND MEMBER WAS THE PRODUCT'S OWN SUGGESTION UNTIL 2026-08-29.
 * The copy below ended `— 0.6, say.` and carried a comment calling the exemplar
 * "wire-proven to route". The exemplar was; the SHAPE the copy wrapped it in was
 * not. Measured against all three deterministic readers
 * (`matchBareRepairValue`, `messageAnswersMissingValueAsk`,
 * `readMissingValueAnswer`), `"0.6, say"` reads null/false/null — the same as a
 * fabricated control. `parameter-user-phrasing.ts` already states the rule this
 * broke: *recovery copy must only recommend an input the system can CURRENTLY
 * accept*, because recommending one it cannot manufactures a dead-end loop out
 * of a refusal that was recoverable in a single step.
 *
 * ⚠ THE FIRST MEMBER IS NOT CLOSED AND IS NOT CLOSEABLE HERE. Witnessed in
 * Paul's live session: he replied *"I think 0.6 makes sense."* and got the same
 * demand back. Widening a reader to accept an ordinary-English wrapper is the
 * pattern-only rule this codebase has already lost four consecutive rounds to,
 * each round fixing one direction and reopening the other. Its real exit is the
 * PENDING-QUESTION CONTRACT — persist the cell the product asked about, and bind
 * a short reply to it deterministically instead of re-deriving the referent from
 * prose every turn. That lives in the finalise path, not in this module, and is
 * a separate lane.
 */
export const SUGGESTED_PHRASING_KNOWN_DROPPED: readonly string[] = [
  // ⭐⭐ EMPTY — AND THAT IS A MEASUREMENT, NOT A DELETION (ROADMAP P0a).
  //
  // Both members read now. `readMissingValueAnswer` admits a CLOSED filler set
  // around a figure, inside its unchanged `^…$` anchor, so "0.6, say" and
  // "I think 0.6 makes sense." both resolve to a bind on the pair the product is
  // asking about. `__tests__/suggested-phrasing-is-readable.test.ts` asserts the
  // emptiness AND drives both former members to a bind, so this set cannot be
  // emptied by giving up — only by the gap actually closing.
  //
  // ⚠ THE SECOND MEMBER'S HEADER SAID ITS EXIT WAS ELSEWHERE — *"Widening a
  // reader to accept an ordinary-English wrapper is the pattern-only rule this
  // codebase has already lost four consecutive rounds to… Its real exit is the
  // PENDING-QUESTION CONTRACT."* That objection was RIGHT about the pattern class
  // and wrong about this shape. The four lost rounds were spent on a predicate
  // that had to infer DIRECTION from prose with no anchor. This is a closed
  // filler vocabulary inside a whole-message anchor: it can only ever admit a
  // message that names NO entity, and the slot still comes from
  // `deriveOnScreenEffectAsk` — i.e. from the product's own rendered question,
  // which is the pending-question contract's substance arriving by the route the
  // estate already built.
  //
  // The set is kept rather than removed so a future gap has its home, and so the
  // spec that guards it stays wired.
];

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
  const example = buildConfigureOptionAdvisedFormat(
    optionLabel,
    primaryFactor,
    CONFIGURE_OPTION_EXAMPLE_VALUE,
  );

  // ⭐⭐ THE OUT-OF-SCALE ANSWER — the user gave a NUMBER and the product refused
  // it while saying nothing about why.
  //
  // MEASURED at this tip before the fix, by driving this composer: `"40000"` and
  // `"£40,000"` produced BYTE-IDENTICAL copy to a message carrying no figure at
  // all — *"…still has no effect value…Send me just the number here"* — i.e. the
  // product asked for exactly what the user had just sent. Driven on deployed
  // `f18d941` against a single outstanding blocker, the assistant instead
  // composed a REFERENT-AMBIGUITY explanation (*"it isn't clear which one this
  // belongs to"*), so a tester who follows that coaching and names the factor is
  // refused again — the real blocker is the SCALE and the product never says so.
  //
  // ⭐ AND IT OFFERS THE PERCENTAGE READING RATHER THAN PERFORMING IT. A figure
  // above 1 and at most 100 is exactly the shape of someone answering "how
  // strong?" on a 0–100 calibration without writing the unit. The product does
  // NOT convert it — that would be inferring a scale from a magnitude, the
  // two-scales-under-one-name cliff this seam refuses (see the hint's header).
  // It asks the user to supply the unit, which costs one turn and cannot be
  // wrong. Above 100 there is no such reading, so none is offered.
  const outOfScale = (() => {
    if (answer === null || answer.kind !== 'numeric') return null;
    const canonical = answer.modelUnitText;
    if (canonical === null) return null;
    const parsed = Number(canonical);
    if (!Number.isFinite(parsed) || (parsed >= 0 && parsed <= 1)) return null;
    const asPercentage = parsed > 1 && parsed <= 100
      ? ` If you meant ${canonical}% of the strongest effect, write it with the % and I will set it.`
      : '';
    return [
      `I can't use ${answer.valueText} as that effect value — it is outside the range I can hold for this link.`,
      `${MISSING_VALUE_ASK_FORMAT_HINT}${asPercentage}`,
      ...(analysisSentence === null ? [] : [analysisSentence]),
    ].join(' ');
  })();

  const qualitativeText = answer !== null && answer.kind === 'qualitative'
    ? [
        `I can't put "${answer.term}" on that link — the effect value has to be a number.`,
        // ⭐ THE HUMAN ANCHORS, from the ONE owner. This sentence used to name
        // the internal 0-1 coefficient; a strategic user is never asked to
        // understand our normalised representation (founder ruling, 30 Aug).
        `Give me one for ${primaryFactor} on "${optionLabel}". ${MISSING_VALUE_ASK_FORMAT_HINT}`,
        ...(analysisSentence === null ? [] : [analysisSentence]),
      ].join(' ')
    : null;

  // ⭐⭐ IDENTIFICATION COMPLETE, VALUE ABSENT — the state the product's OWN
  // repair chip puts the user in, and the one state the bare-ask branch below
  // must never see.
  //
  // WITNESSED (UI `326970a7` · CEE `5f2e3fd`, guest): the chip labelled "Set
  // effect on Cash runway consumed" replayed its message, landed here with no
  // digit, and got the teach-the-format branch — *"Tell me what it changes, like
  // this: Set the rebuild our product on an AI-native architecture option's
  // effect on Cash runway consumed to 0.6."* **A button that says "Set effect on
  // X" handing back a sentence to retype, naming the option and factor the chip
  // had already named.**
  //
  // The bare-ask branch is not wrong — it is answering a DIFFERENT question. It
  // exists to teach the routable phrasing to a user who has named nothing, and
  // it stays exactly as it was for them (pinned by the opposite-direction cases
  // in `repair-chip-identification-complete.test.ts`). What was missing is that
  // naming the slot and naming a number are two different acts, and the product
  // treated the absence of the second as the absence of both.
  //
  // ⚠ IT STILL ASKS FOR THE NUMBER, and that is not a shortfall. The chip
  // withholds the value deliberately (`buildRepairPairChip`'s header): choosing
  // it would invent the user's figure, the fabrication class P5 exists to close.
  // So the honest move is to ask for the ONE thing that is not derivable — and
  // the answer is written by simply typing it here, which is a PROVEN path
  // (`interventions: {…, source: "user_specified"}`, verified after reload).
  //
  // ⚠⚠ AND IT DELIBERATELY DOES **NOT** APPEND
  // `buildConfigureOptionDirectSetSentence`. This branch already asks for the
  // number in its own words; appending a second ask would be the restatement
  // this branch exists to stop.
  //
  // ⚠ HISTORY, because the reason has changed and a stale reason is worse than
  // none: when #1113 wrote this note the sentence read "open <option> on the
  // canvas and add <factor> to what it changes", and it was withheld here
  // because it was FALSE — REFUTED BY A LIVE DRIVE on 2026-08-25 (the canvas
  // option panel renders the intervention row inside a `<fieldset disabled>` and
  // writes NOTHING; a forced native write produced zero wire calls; the panel's
  // own notice says it is read-only because the change "cannot yet be saved to
  // the shared model"). #1113 correctly declined to rewrite the `answered`
  // branch from inside its own evidence and REPORTED it instead. ROADMAP 2.1269
  // then fixed that branch: the sentence now points at chat and is no longer
  // false anywhere. It stays out of THIS branch for the redundancy reason above,
  // not the falsity one.
  //
  // Note the shape, which is why the sentence has its own owner and its own
  // spec: it was introduced to FIX a dead-end locus, was correct about which
  // field the write targets, and went false when the surface was disabled
  // underneath it — a cross-service hand-maintained mirror going stale exactly
  // as its own header warned (trap 12). It has now done that twice.
  const identificationComplete =
    !answered && qualitativeText === null && messageNamesOptionEffectSlot(input.message);

  const assistant_text = identificationComplete
    ? [
        `"${optionLabel}" has no effect value on ${primaryFactor} yet.`,
        // ⚠ THE EXEMPLAR IS LOAD-BEARING, NOT DECORATION — it steers off a value
        // the bare-answer path REFUSES BY DESIGN. `matchBareRepairValue` declines
        // a bare INTEGER as "an ordinal in disguise" (a naked `1` measured
        // binding as an effect value of 1.0 while the user meant "the first
        // one"), so the one token this gloss most invites — `1` — is exactly the
        // one that will not bind. `0.6` is the estate's existing exemplar
        // (`CONFIGURE_OPTION_EXAMPLE_VALUE`).
        //
        // ⚠⚠ THE SENTENCE USED TO END `— <value>, say.` AND THAT SHAPE DID NOT
        // PARSE. The claim here was "wire-proven to route", which was true of
        // the TOKEN and false of the FORM: measured 2026-08-29 against all three
        // deterministic readers, `"0.6, say"` reads null/false/null, identical
        // to a fabricated control. Witnessed live the same day — the user
        // replied in ordinary English around that exemplar and got the identical
        // demand back. The copy now names the shape the readers actually accept
        // (a bare number), which is the rule `parameter-user-phrasing.ts`
        // already applies to edge strengths: only ever recommend an input the
        // system can CURRENTLY accept. THE READERS ARE DELIBERATELY UNTOUCHED —
        // see `SUGGESTED_PHRASING_KNOWN_DROPPED` for the wrapper this does NOT
        // close, and for why widening a predicate is the wrong exit.
        //
        // This branch asks for a BARE number where the old copy advised a whole
        // sentence, so it raises the odds of that collision rather than
        // inheriting it — the exemplar is how this change pays for that.
        // ⚠⚠ THE EXEMPLAR WAS THE INTERNAL REPRESENTATION. This read *"Give me a
        // number from 0 … to 1 … Reply with just the number, like 0.6."* — and
        // `0.6` is Olumi's normalised coefficient, not a human quantity.
        // Manual testing found it unintuitive, and exposing an internal
        // representation because the parser happens to read it is a workaround
        // wearing a fix's clothes (founder ruling, 30 Aug 2026). The human
        // anchors come from the ONE owner beside the binder, so the ask and the
        // acceptance cannot drift (P8).
        MISSING_VALUE_ASK_FORMAT_HINT,
        ...(analysisSentence === null ? [] : [analysisSentence]),
      ].join(' ')
    : qualitativeText !== null
    ? qualitativeText
    : outOfScale !== null
    ? outOfScale
    : answered
    ? [
        `"${optionLabel}" still has no effect value on ${primaryFactor}, so that link is not carrying anything yet.`,
        ...(analysisSentence === null ? [] : [analysisSentence]),
        // ⚠ THE LOCUS, NOT THE COPY, HAS BEEN THE DEFECT TWICE. This sentence
        // first sent the user to the option→factor LINK (`EdgePanel`'s
        // intervention branch: two `<p>` tags, no controls — a witness reached a
        // dead end on 2026-08-19), then to the CANVAS OPTION PANEL, which renders
        // its intervention row inside a disabled fieldset and writes nothing
        // (ROADMAP 2.1269). It now points at CHAT — the only destination
        // witnessed to land this write. The single owner beside the
        // chip/advised-format builders carries the full derivation and states its
        // evidentiary rung exactly.
        buildConfigureOptionDirectSetSentence(),
      ].join(' ')
    : [
        `"${optionLabel}" has no effect values yet, so the analysis cannot compare it with the others.`,
        linkSentence,
        // ⚠⚠ THE EXEMPLAR STAYS ON THIS BRANCH, AND THAT IS A CORRECTION THIS
        // LANE MADE TO ITSELF. I removed it — on the ground that the percentage
        // answer binds on its own — and an EXISTING guard caught it:
        // `repair-chip-identification-complete.test.ts`, *"identification NOT
        // complete — the teach-the-format branch is untouched"*. It is right.
        // This branch is reached when the product does NOT know which pair is
        // meant, and there the user must NAME the pair; the only sentence that
        // routes back into this lane is the advised format, whose value slot
        // must stay a bare decimal because `readOptionEffectValue`
        // (`option-effect-write.ts:365`) declines a percent sign.
        //
        // ⚠ STATED RESIDUAL: this is the one branch where the internal
        // representation is still shown, and it is unavoidable HERE today.
        // Closing it means teaching the routing form to read a percent, which
        // lives in `option-effect-write.ts` — a shared writer this lane does not
        // own. The IDENTIFIED branches, which are the common path, now carry the
        // human anchors instead.
        `Tell me what it changes, like this: ${example}`,
        MISSING_VALUE_ASK_FORMAT_HINT,
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
