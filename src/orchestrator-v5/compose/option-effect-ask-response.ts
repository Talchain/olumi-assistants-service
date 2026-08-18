/**
 * ⭐ ROADMAP 2.1266 — the ASK half of the option-effect write path.
 *
 * Reached when the sentence is unmistakably an option-effect request carrying
 * a usable value, and the ENTITY cannot be pinned down: the message names two
 * options, or two of one option's linked factors. The estate's ruling for that
 * state is to make the ambiguity the product (CLAUDE.md trap 22f) — never a
 * guess, and never the byte-identical refusal that trapped the witnessed user.
 *
 * ⚠ WHY THESE CHIPS ARE LEGITIMATE where `configure-option-clarify-response.ts`
 * deliberately ships none. There the missing ingredient is the VALUE, and a
 * chip would choose the user's number for them. Here the value is the USER'S
 * OWN, read off their sentence by a grammar that admits nothing but a
 * model-unit number; the only thing a chip completes is WHICH of the entities
 * they already named receives it, and every entity offered is a fact of the
 * persisted graph resolved by identity.
 *
 * Each chip's replay message is `buildConfigureOptionAdvisedFormat` — probe P1
 * verbatim, the one phrasing proven to route back into the lane that offered
 * it — so a click cannot fail to return. The companion spec DERIVES that claim
 * by running the router's own predicates over each emitted message (trap 12:
 * derive the check, never mirror the routing rules here).
 *
 * COPY CONTRACT: every string must survive `FORBIDDEN_USER_FACING_PHRASES`
 * (the guard replaces the WHOLE response on a hit) and must name entities by
 * their user-facing labels only — no `opt_*` / `fac_*` ids. The unit test
 * asserts both with the shipped detectors rather than by re-listing them.
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import type { OptionEffectCandidate } from '../routing/option-effect-write.js';

/**
 * At most this many chips. Same judgement as the sibling composers: beyond
 * three the copy stops reading as a next step and starts reading as a list to
 * audit. The prose names every candidate regardless.
 */
export const MAX_OPTION_EFFECT_ASK_CHIPS = 3;

/** Join as readable English: "A", "A and B", "A, B and C". */
function joinQuoted(labels: readonly string[]): string {
  const quoted = labels.map((l) => `"${l}"`);
  if (quoted.length === 1) return quoted[0]!;
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

export interface ComposeOptionEffectAskInput {
  /** Which half of the pair could not be pinned down. */
  readonly ambiguity: 'option' | 'factor';
  /** The user's value, verbatim from their sentence. */
  readonly value: number;
  /** Complete, routable candidates. May be empty when no chip is honest. */
  readonly candidates: readonly OptionEffectCandidate[];
  /** The option labels the message named (one, when the FACTOR is ambiguous). */
  readonly optionLabels: readonly string[];
  readonly stage: StageType;
}

/**
 * Build the deterministic disambiguation reply. Pure — no I/O, no LLM, no
 * invention: every label is a graph fact and the value is the user's own.
 */
export function composeOptionEffectAskResponse(
  input: ComposeOptionEffectAskInput,
): OlumiResponse {
  const offered = input.candidates.slice(0, MAX_OPTION_EFFECT_ASK_CHIPS);

  const named =
    input.ambiguity === 'option'
      ? joinQuoted(input.optionLabels)
      : joinQuoted(input.candidates.map((c) => c.factorLabel));

  // ⚠ THE COUNT IS DERIVED, NOT WRITTEN. The first draft said "two" because
  // two is the case that motivated the row — and the resolver can hand back
  // three. A sentence that miscounts what it is quoting back is a small lie of
  // exactly the class this seam exists to remove.
  const count = input.ambiguity === 'option' ? input.optionLabels.length : input.candidates.length;
  const subject = input.ambiguity === 'option' ? 'options' : 'factors';
  const opening =
    input.ambiguity === 'option'
      ? `Your message names ${count} ${subject} — ${named} — so I do not know which one ${input.value} belongs to.`
      : `Your message names ${count} ${subject} on "${input.optionLabels[0] ?? ''}" — ${named} — so I do not know which one ${input.value} belongs to.`;

  const closing =
    offered.length > 0
      ? 'Pick one below, or name the option and the factor together in your reply.'
      : 'Name the option and the factor together in your reply and I will set it.';

  // Named, then passed by ES6 shorthand — the same shape as
  // `edit-clarify-response.ts` and `repair-value-ask-response.ts`, so the
  // compose-site register keys this site as `assistant_text` rather than as
  // the template literal's own source text (a key that would change with every
  // wording edit). See `OPTION_EFFECT_ASK_SITES`.
  const assistant_text = `${opening} I have not changed the model. ${closing}`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    suggested_actions: offered.map((candidate, index) => ({
      id: `chip_prompt_option_effect_bind_${index + 1}`,
      label:
        input.ambiguity === 'option'
          ? `Apply ${input.value} to ${candidate.optionLabel}`
          : `Apply ${input.value} to ${candidate.factorLabel}`,
      message: `${buildConfigureOptionAdvisedFormat(
        candidate.optionLabel,
        candidate.factorLabel,
        String(input.value),
      )}.`,
    })),
  });
}
