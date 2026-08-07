/**
 * ⭐ THE SINGLE PLACE A REFERENCE-CLASS REPLY IS ASSEMBLED — text AND chips.
 *
 * ROADMAP 2.688 slice 1. Design:
 * `parallel-briefs/BASE-RATE-ELICITED-DESIGN-2026-08-08.md` §3.4 / §4.
 *
 * ⭐⭐ I4 — NEVER A POINT WITHOUT ITS INTERVAL. There is ONE disclosure
 * builder and it emits the central estimate AND the q25-q75 band, or it
 * emits nothing. There is no rate-only formatting path in this module, so a
 * future call site cannot produce one by forgetting a condition — the same
 * unrepresentability discipline `buildCalibrationConfirmMessage` adopted
 * after a call site minted a chip for a value that did not exist.
 *
 * WHY THE BAND IS THE FEATURE, not decoration. The posterior IS the
 * principled widening relative to the raw K/N point: at N=7 the middle half
 * spans ~23 percentage points; at N=100 it narrows honestly. The 2.688 row's
 * "arithmetic + overconfidence widening" is satisfied by the posterior for
 * everything computable from what the user said. Anything MORE — discounting
 * N for imperfect comparability, widening for optimism in recall — needs a
 * constant nobody has ruled, so v1 applies NO extra-Beta widening (design
 * §3.3). The `comparability_caveats` ride the disclosure VERBATIM instead,
 * and the copy says plainly that the interval reflects the counts, not the
 * quality of the analogy. A silent discount factor would be an invented
 * number wearing a method card.
 *
 * ⭐ I3 — THE CLASS IS NAMED VERBATIM. Every interpolation below inserts
 * `class_description` / `outcome_description` UNMODIFIED. No casing change,
 * no truncation, no pluralisation. The spec asserts byte-equality.
 *
 * DETERMINISTIC — composed here, never by the model, for the same reason the
 * calibration preview is: a reply this module composes cannot carry the
 * model's routing deliberation, and cannot invent a number.
 */

import {
  formatPosteriorPercent,
  type ReferenceClassPosterior,
} from './beta-posterior.js';
import {
  posteriorFor,
  type ReferenceClassElicitation,
} from './reference-class-elicitation.js';
import {
  REFERENCE_CLASS_CONFIRM_PREFIX,
  type ParsedReferenceClass,
  type ReferenceClassRecognition,
} from './reference-class-grammar.js';

/**
 * The v1 honesty sentence (design §4.4). It is part of the disclosure, not a
 * footnote: v1 has NO compute effect, and a user who is not told that will
 * reasonably assume the number went into the model.
 */
export const NO_MODEL_EFFECT_SENTENCE =
  'This is context for your judgement — it does not change the model unless you change it.';

/** The preview's commitment sentence. Byte-identical to the calibration pre-route's. */
export const NOTHING_CHANGED_SENTENCE = 'Nothing has been changed.';

/**
 * The band clause. Extracted so I4's mutant (delete the interval) has exactly
 * one place to bite, and so no caller can assemble a half of it.
 */
function bandClause(posterior: ReferenceClassPosterior): string {
  return (
    `central estimate ${formatPosteriorPercent(posterior.mean)}, and the middle half of the ` +
    `evidence sits between ${formatPosteriorPercent(posterior.q25)} and ` +
    `${formatPosteriorPercent(posterior.q75)}`
  );
}

/**
 * The edge sentence. K=0 and K=N are where a raw ratio lies hardest ("0%",
 * "100%"), so they get copy that states what the counts DO support without
 * ever claiming impossibility or certainty — *never say never*.
 *
 * NO MINIMUM-N REFUSAL. At K=1, N=2 the band nearly spans the middle third of
 * the axis, and that IS the honest answer; a floor would be an undisclosed
 * constant refusing valid statements (the range spec's E6 reasoning).
 */
function sampleSentence(parsed: {
  readonly observed_k: number;
  readonly observed_n: number;
}): string {
  const { observed_k: k, observed_n: n } = parsed;
  if (k === 0) {
    return (
      `It hasn't happened in your ${n} cases — that supports a low rate, not an impossible one.`
    );
  }
  if (k === n) {
    return (
      `It happened every time in your ${n} cases — that supports a high rate, not a certain one.`
    );
  }
  return `With only ${n} cases, anywhere in that band is consistent with what you've seen.`;
}

/**
 * ⭐ THE DISCLOSURE. Mean AND band, class and outcome verbatim, caveats
 * verbatim, and the honest statement of what the number does.
 */
export function buildReferenceClassDisclosure(
  elicitation: Pick<
    ReferenceClassElicitation,
    'class_description' | 'outcome_description' | 'observed_k' | 'observed_n'
  > & { readonly comparability_caveats?: string },
): string {
  const posterior = posteriorFor(elicitation);
  const parts = [
    `Of the ${elicitation.observed_n} ${elicitation.class_description} you cited, ` +
      `${elicitation.observed_k} ${elicitation.outcome_description}.`,
    `Treating those ${elicitation.observed_n} as the reference class: ${bandClause(posterior)}.`,
    sampleSentence(elicitation),
  ];
  if (elicitation.comparability_caveats !== undefined) {
    // VERBATIM, and it is the user's own hedge — the system does not act on
    // it (no effective-N discount in v1), it repeats it so the reader can.
    parts.push(`You also said: ${elicitation.comparability_caveats}.`);
    parts.push('That band reflects the counts, not how comparable the cases are.');
  }
  return parts.join(' ');
}

/**
 * The PREVIEW. Same disclosure, plus the commitment sentence and the honest
 * statement of effect. Creates nothing: the object does not exist until the
 * confirm chip is taken (I8).
 */
export function buildReferenceClassPreviewText(parsed: ParsedReferenceClass): string {
  return `${buildReferenceClassDisclosure(parsed)} ${NOTHING_CHANGED_SENTENCE} ${NO_MODEL_EFFECT_SENTENCE}`;
}

/**
 * The confirm chip's replay message — an explicit imperative carrying the
 * FULL K / N / class / outcome, so the confirm turn re-parses to exactly the
 * statement the preview showed and travels the ordinary path.
 *
 * The prefix is what makes confirmation structural: the grammar returns
 * `kind: 'confirm'` only for a message bearing it, and only that branch
 * reaches the object constructor.
 */
export function buildReferenceClassConfirmMessage(parsed: ParsedReferenceClass): string {
  return (
    `${REFERENCE_CLASS_CONFIRM_PREFIX} of the ${parsed.observed_n} ${parsed.class_description}, ` +
    `${parsed.observed_k} ${parsed.outcome_description}.`
  );
}

/** The message the "Correct the numbers" chip replays. Deliberately not a command. */
export function buildReferenceClassCorrectMessage(parsed: ParsedReferenceClass): string {
  return (
    `Those numbers aren't right for ${parsed.class_description} — let me restate how many cases ` +
    'there were and how many had the outcome.'
  );
}

/** The confirmed acknowledgement. Carries the disclosure so the numbers stay on screen. */
export function buildReferenceClassRecordedText(
  elicitation: ReferenceClassElicitation,
): string {
  return `${buildReferenceClassDisclosure(elicitation)} ${NO_MODEL_EFFECT_SENTENCE}`;
}

export interface ReferenceClassReply {
  readonly assistant_text: string;
  readonly suggested_actions: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly message: string;
  }>;
}

/**
 * ⭐ THE ONE ASSEMBLY POINT — text AND chips, for every recognition kind the
 * pre-route acts on.
 *
 * NO CHIP WHEN THE GRAMMAR IS ASKING. A `clarify` turn gets the question and
 * an EMPTY chip set: offering "Record this base rate" beside a question about
 * what the numbers are would invite the user to confirm counts the system
 * does not have — the `targetLabel === null` posture `buildCalibrationReply`
 * takes, for the same reason.
 *
 * Throws on `kind: 'none'` — the caller must not have routed here.
 */
export function buildReferenceClassReply(
  recognition: ReferenceClassRecognition,
): ReferenceClassReply {
  if (recognition.kind === 'none') {
    throw new Error('buildReferenceClassReply called with no recognition');
  }
  if (recognition.kind === 'clarify') {
    return { assistant_text: recognition.question, suggested_actions: [] };
  }
  if (recognition.kind === 'confirm') {
    // The confirm turn's text is built by the caller from the CREATED object,
    // so the acknowledgement can never describe something that was not
    // recorded. This branch exists so the union is exhaustive at the type
    // level; it returns the same disclosure with no further chip to take.
    return {
      assistant_text: buildReferenceClassDisclosure(recognition.parsed),
      suggested_actions: [],
    };
  }
  return {
    assistant_text: buildReferenceClassPreviewText(recognition.parsed),
    suggested_actions: [
      {
        // `chip_prompt_*` (suggestion family), not `chip_clarify_*`: a route
        // the user MAY take, not an answer to a question we asked — the same
        // classification the calibration confirm chip carries, which the
        // egress chip finaliser sizes and dedupes accordingly.
        id: 'chip_prompt_reference_class_record',
        label: 'Record this base rate',
        message: buildReferenceClassConfirmMessage(recognition.parsed),
      },
      {
        id: 'chip_prompt_reference_class_correct',
        label: 'Correct the numbers',
        message: buildReferenceClassCorrectMessage(recognition.parsed),
      },
    ],
  };
}
