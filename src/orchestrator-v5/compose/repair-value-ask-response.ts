/**
 * ⭐ ROADMAP 2.1261 — the ASK half of repair-leg bare-value binding.
 *
 * Reached when the user supplied a bare compliant value ("Set it to 0.12.")
 * and MORE THAN ONE effect value is missing, so the referent is genuinely
 * ambiguous. The estate's ruling for that state is to make the ambiguity the
 * product (CLAUDE.md trap 22f): name each candidate pair and let the user
 * pick — never guess, and never re-serve the refusal that trapped the
 * wire-witnessed user (req b90d62e0).
 *
 * WHY THESE CHIPS ARE LEGITIMATE where the L16 composer's were not
 * (`configure-option-clarify-response.ts` deliberately ships none): there the
 * missing ingredient was the VALUE, and a chip would have chosen the user's
 * number for them. Here the value is the USER'S OWN, captured by a
 * whole-message anchor that admits nothing but the instruction and the
 * number — the only choice a chip completes is WHICH already-missing slot
 * receives it, and every slot offered is a fact read off the same readiness
 * payload the blocker copy came from.
 *
 * Each chip's replay message is `buildRepairBindingInstruction` — the advised
 * format (probe P1 verbatim) with the user's value — so a click routes on the
 * `effect_vocab` trigger into the edit lane, the one chat path that writes
 * option interventions. The companion spec DERIVES that claim by running the
 * router's own predicates over each emitted message (trap 12: derive the
 * check, never mirror the routing rules here).
 */

import type { OlumiResponse, StageType } from '@talchain/schemas/boundary';

import { composeDirectAnswerResponse } from '../compose.js';
import {
  buildRepairBindingInstruction,
  type MissingEffectPair,
} from '../routing/repair-value-binding.js';

/**
 * At most this many pair chips. Mirrors the L16 composer's judgement that
 * beyond three the copy stops reading as a next step; the prose invites a
 * typed reply for anything not offered.
 */
export const MAX_REPAIR_PAIR_CHIPS = 3;

/** Truncate a label for chip copy; the full labels appear in the prose. */
function chipLabel(pair: MissingEffectPair, cap = 56): string {
  const label = pair.factorLabel.trim();
  return label.length <= cap ? label : `${label.slice(0, cap - 1)}…`;
}

function describePair(pair: MissingEffectPair): string {
  return `"${pair.factorLabel}" for "${pair.optionLabel}"`;
}

/** Join as readable English: "A", "A and B", "A, B and C". */
function joinDescriptions(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export interface ComposeRepairValueAskInput {
  readonly pairs: readonly MissingEffectPair[];
  /** The user's value, verbatim. */
  readonly valueText: string;
  readonly stage: StageType;
}

/**
 * Build the deterministic disambiguation reply. Pure — no I/O, no LLM, no
 * invention: every label is a graph fact, the value is the user's own.
 */
export function composeRepairValueAskResponse(
  input: ComposeRepairValueAskInput,
): OlumiResponse {
  const offered = input.pairs.slice(0, MAX_REPAIR_PAIR_CHIPS);
  const assistant_text =
    `You gave ${input.valueText}, and more than one effect value is still ` +
    `missing, so I want to be sure where to apply it before I change the ` +
    `model. Still unset: ${joinDescriptions(input.pairs.map(describePair))}. ` +
    `Pick one below, or name the option and factor in your reply.`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    suggested_actions: offered.map((pair, index) => ({
      id: `chip_prompt_repair_value_bind_${index + 1}`,
      label: `Apply ${input.valueText} to ${chipLabel(pair)}`,
      message: buildRepairBindingInstruction(pair, input.valueText),
    })),
  });
}
