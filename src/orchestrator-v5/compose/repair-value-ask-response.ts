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
 * ⭐⭐⭐ P8 SUPPRESSION (17 Aug 2026, Paul's ruling — STANDING-BRIEF-PREAMBLE P8:
 * *never ask what you cannot accept; an affordance that terminates in refusal is
 * the same defect as a fabrication wearing different clothes*).
 *
 * THE CHIPS ARE GONE. They were wire-witnessed TERMINATING IN REFUSAL on deployed
 * `8be62df` (`olumi-docs/witness-acceptance-2026-08-17/`, J4 t4): clicking
 * `chip_prompt_repair_value_bind_1` — a message this file authored — produced NO
 * edit fact, left the blocker count at 10→10, left `graph_hash` unchanged, and
 * replied *"To set it directly, open … on the canvas"*. The product offered a
 * one-click action and answered it with a canvas redirect: the Research-CTA shape
 * in miniature.
 *
 * ⚠ AND THE REASONING BELOW WAS CORRECT ABOUT THE WRONG QUESTION, which is why it
 * is kept rather than deleted. It establishes that a chip here would not FABRICATE
 * a value (the number is the user's own) — and that is true. What it never
 * established is that clicking the chip WRITES anything. The chip's replay routes
 * into the edit lane, whose write is an LLM proposal: on `c5e2430` that proposal
 * landed the intervention, on `8be62df` it landed a factor baseline or nothing at
 * all. **Routability was proven; landing was assumed.** A deterministic
 * option-intervention write would make the chip honest, and it is explicitly not
 * wired (`edit-graph.ts:1264-1277`, "a separate brief") — so until it exists, the
 * product must not offer the click.
 *
 * WHAT REPLACES IT, and why the user is strictly better off: the prose already
 * enumerates EVERY blocked pair, and the reply now hands over the exact sentence
 * to type — `buildRepairBindingInstruction`, the same probe-P1 advised format the
 * chips carried, as TEXT rather than as a one-click promise. Nothing the user
 * could learn from the chip is withheld; only the false affordance is.
 *
 * WHY THESE CHIPS WERE ARGUED LEGITIMATE where the L16 composer's were not
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
  const assistant_text =
    `You gave ${input.valueText}, and more than one effect value is still ` +
    `missing, so I want to be sure where to apply it before I change the ` +
    `model. Still unset: ${joinDescriptions(input.pairs.map(describePair))}. ` +
    `Name the option and factor in your reply, like this: ` +
    `${buildRepairBindingInstruction(input.pairs[0]!, input.valueText)}`;

  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text,
    stage: input.stage,
    // ⭐ P8: DELIBERATELY NONE. See the header. A chip must carry a complete
    // message AND a write that lands; this leg has the first and not the second,
    // and an affordance that terminates in refusal is the harm, not the remedy.
    // The exemplar above is the identical sentence, handed over as text to type.
    suggested_actions: [],
  });
}
