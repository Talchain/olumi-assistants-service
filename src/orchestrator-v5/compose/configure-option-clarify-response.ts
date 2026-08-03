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

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';

export interface ComposeConfigureOptionClarifyInput {
  readonly optionLabel: string;
  /** Real linked factors, already filtered to the unset ones. Non-empty. */
  readonly factorLabels: readonly string[];
  readonly stage: StageType;
}

/**
 * The placeholder the user replaces. Kept as the literal `<0-1>` the shared
 * template already establishes for prompt copy, and glossed in the next
 * sentence so it never reads as jargon — the walk logged a real
 * validator-jargon leak ("'strength' needs to be a number between -1 and 1.
 * You gave -30.") and this copy must not add another.
 */
const VALUE_PLACEHOLDER = '<0-1>';

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
    VALUE_PLACEHOLDER,
  );

  const assistant_text = [
    `"${optionLabel}" has no effect values yet, so the analysis cannot compare it with the others.`,
    linkSentence,
    `Tell me what it changes in this form: ${example}`,
    `Replace ${VALUE_PLACEHOLDER} with a number from 0 (this option does nothing to it) to 1 (this option drives it fully).`,
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
