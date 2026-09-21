/**
 * Replacement conversation layer — the change tools the model may call.
 *
 * Each one RETURNS operations. None of them writes. The write happens only
 * through `accept_proposal`, against a proposal the user has already seen.
 *
 * WHY `set_option_effect` IS FIRST
 * ---------------------------------
 * Its absence ended a live session. 20 Sep, 11:52:49Z: the assistant had
 * taught the user how to configure an option and asked him to choose a level;
 * he answered "I think we should go for full parity"; the model proposed
 * exactly the right action and the validator threw it out with
 * ENTITY_KIND_MISMATCH, because `set_factor_value` writes a FACTOR's own
 * value and there was no operation for an OPTION's effect on a factor. He was
 * shown "I wasn't sure what you meant by Increase Price for New Customers
 * Only" and a list of every node in the graph. That was the last thing he saw.
 *
 * WHAT THE DESCRIPTIONS ARE FOR
 * ------------------------------
 * A tool description is a prompt. These say what the operation MEANS in the
 * user's terms and when NOT to reach for it, because the measured failure was
 * not a model that could not call a tool — it was a model reaching for a
 * mutation when the user had made an observation.
 */

import { setOptionEffect, type EffectGraph } from './set-option-effect.js';
import type { AgentTool, AgentToolOutcome } from './agent-loop.js';

export interface ProposeToolDeps {
  /** The graph as it stands. `null` when there is none — every tool then
   *  refuses with that as the reason rather than throwing. */
  readonly getGraph: () => EffectGraph | null | undefined;
}

const NO_GRAPH =
  'There is no model on screen yet, so there is nothing to change. Talk the decision through first.';

/**
 * Propose what an option does to a factor.
 *
 * Refusals are the interesting part. Every one names what to do next: an
 * unlinked factor is answered with the list of factors the option DOES
 * affect, so the conversation offers a route rather than a dead end.
 */
export function createSetOptionEffectTool(deps: ProposeToolDeps): AgentTool {
  return {
    kind: 'propose',
    definition: {
      name: 'set_option_effect',
      description:
        "Propose how much one option moves one factor, as a share of that factor's range from 0 to 1. " +
        'Use this when the user has told you what an option does — not to fill in a number they have ' +
        'not given you. If you do not know the value, ask; do not estimate one and offer it as theirs. ' +
        'This proposes only: nothing is saved until they agree. ' +
        '⭐ IF THE USER GAVE A FIGURE IN THEIR OWN UNITS — "£59", "three months" — PUT IT IN ' +
        'native_value AND LEAVE value OUT. read_workspace shows you each factor\'s range, and this ' +
        'tool converts against that same range, so you never have to work the share out yourself. ' +
        'Never convert a figure by hand: if the range you used is wrong the number still looks ' +
        'perfectly reasonable, and the user agrees to a receipt for a model that is quietly wrong. ' +
        'If they are changing a number you already offered — "yes, but make it 0.6" — set ' +
        'amends_proposal_id to that offer instead of accepting it. Accepting saves the number YOU ' +
        'offered, not the one they just said.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          option_id: { type: 'string', description: 'The option whose effect is being set.' },
          factor_id: { type: 'string', description: 'The factor it affects.' },
          value: {
            type: 'number',
            description:
              "Between 0 and 1 — the share of the factor's range this option moves it by. Give this "
              + 'ONLY when the user spoke in shares. If they gave a figure in real units, use '
              + 'native_value instead and leave this out.',
          },
          native_value: {
            type: 'number',
            description:
              'The figure the user actually said, in the factor\'s own units — 59 for "£59", 3 for '
              + '"three months". The share is worked out from the range on the model, so their number '
              + 'reaches the graph without you having to convert it. What they said and what gets '
              + 'stored are both put back to them before anything is saved.',
          },
          amends_proposal_id: {
            type: 'string',
            description:
              'Only when the user is changing a number you already offered them. The id of that '
              + 'waiting offer. It is replaced, and the new number goes back to them to agree.',
          },
        },
        // ⚠ `value` IS NO LONGER REQUIRED, AND THE CONTRACT IS UNCHANGED.
        // It is still the encoded share and still refused outside [0, 1]; it
        // is simply not the only way to say what the user meant. A call with
        // neither number is refused below by name rather than defaulting.
        required: ['option_id', 'factor_id'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph == null) return { type: 'refused', content: NO_GRAPH };

      const optionId = typeof raw.option_id === 'string' ? raw.option_id : '';
      const factorId = typeof raw.factor_id === 'string' ? raw.factor_id : '';
      const hasNative = typeof raw.native_value === 'number';
      const hasShare = typeof raw.value === 'number';

      // Neither number given: refused by name. `value` used to be required by
      // the schema, so its absence arrived here as NaN and fell into the
      // out-of-range refusal — which would now say "I was given NaN" about a
      // call whose real problem is that it said nothing about the size of the
      // effect at all.
      if (!hasNative && !hasShare) {
        return {
          type: 'refused',
          content:
            'That call says which option and which factor but not how much. Give native_value if the '
            + 'user spoke in real units, or value if they spoke in shares of the range. Do not pick a '
            + 'number yourself — ask them.',
        };
      }

      const result = setOptionEffect({
        graph,
        optionId,
        factorId,
        ...(hasShare ? { value: raw.value as number } : {}),
        ...(hasNative ? { nativeValue: raw.native_value as number } : {}),
      });
      if (!result.ok) {
        // The refusal message already names the next move; the reason code is
        // appended for the model, not for the user, and never surfaces as-is.
        return { type: 'refused', content: result.refusal.message };
      }

      // ⭐ THE AMEND ROUTE. Deliberately NOT a second tool: an amendment needs
      // every refusal this one already makes (unlinked factor, unknown option,
      // out-of-range value), and a parallel tool would drift from them.
      //
      // ⛔ It is still `kind: 'propose'`, so the loop's own invariant applies —
      // a propose tool MAY NOT record consent. The amended number goes back to
      // the user. That is the whole point: accepting would save the number WE
      // offered, which is the harm the third verb exists to prevent.
      const amends = typeof raw.amends_proposal_id === 'string' && raw.amends_proposal_id.length > 0
        ? raw.amends_proposal_id
        : undefined;

      return {
        type: 'proposed',
        summary: result.summary,
        operations: result.operations,
        ...(amends !== undefined ? { amends } : {}),
        // ⭐ THE RANGE REACHES THE USER THROUGH THE MODEL'S OWN SENTENCE, NOT
        // THROUGH THE OFFER STRING. It is not in `result.summary` on purpose
        // — see the block in `set-option-effect.ts` explaining how putting it
        // there would let a user naming a RANGE BOUND accept an offer about a
        // different number. Here it is instruction to the model, and the
        // model says it in prose, so the user can check the conversion while
        // the acceptance guard's digit set stays exactly the offer's own two
        // numbers.
        content: (result.native_value !== undefined
          ? `You gave their figure in their own units and it was converted against the range on the `
            + `model: ${result.factor_label} runs ${result.range}, so `
            + `${String(result.native_value)}${result.native_unit === undefined ? '' : ` ${result.native_unit}`} `
            + `is ${String(result.value)} of it. TELL THEM BOTH — the figure they gave and the range it `
            + `was measured against — before they agree. If that range is not what they meant, they must `
            + `be able to say so now, not discover it later in a result. `
          : '')
          + (amends !== undefined
          ? `This replaces the earlier offer. Put the NEW number to them in their own terms and wait `
            + `for them to agree — it is not saved yet, and the earlier one can no longer be accepted.`
          : `This affects the comparison between ${result.option_label} and the other options through `
            + `${result.factor_label}. Say what it means for their decision, not just that you have offered it.`),
      };
    },
  };
}
