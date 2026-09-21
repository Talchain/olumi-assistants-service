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
            description: "Between 0 and 1 — the share of the factor's range this option moves it by.",
          },
          amends_proposal_id: {
            type: 'string',
            description:
              'Only when the user is changing a number you already offered them. The id of that '
              + 'waiting offer. It is replaced, and the new number goes back to them to agree.',
          },
        },
        required: ['option_id', 'factor_id', 'value'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph == null) return { type: 'refused', content: NO_GRAPH };

      const optionId = typeof raw.option_id === 'string' ? raw.option_id : '';
      const factorId = typeof raw.factor_id === 'string' ? raw.factor_id : '';
      const value = typeof raw.value === 'number' ? raw.value : Number.NaN;

      const result = setOptionEffect({ graph, optionId, factorId, value });
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
        content: amends !== undefined
          ? `This replaces the earlier offer. Put the NEW number to them in their own terms and wait `
            + `for them to agree — it is not saved yet, and the earlier one can no longer be accepted.`
          : `This affects the comparison between ${result.option_label} and the other options through `
            + `${result.factor_label}. Say what it means for their decision, not just that you have offered it.`,
      };
    },
  };
}
