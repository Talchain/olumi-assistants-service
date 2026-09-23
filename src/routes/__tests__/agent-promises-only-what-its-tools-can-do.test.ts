import { describe, expect, it } from 'vitest';

import { AGENT_TOOLS } from '../../orchestrator-v5/agent-lane/runtime/agent-tools.js';
import { AGENT_INSTRUCTIONS } from '../agent-v1-turn.js';

/**
 * ⛔ THE LANE MUST NOT OFFER AN ACT NO TOOL OF ITS OWN CAN PERFORM.
 *
 * Measured on `a693ba60` with a COMPLETE manifest of all eight agent tools, not a
 * sample: nothing can put a new option or a new factor into a model that already
 * exists. `propose_model_change` relates two labels that must already be there;
 * `propose_assumptions` says "only factors the model actually has";
 * `propose_option_interventions` and `propose_starting_point` set levels and values
 * on entities that exist; `build_model_from_brief` is for when the model is EMPTY,
 * by its own description, and refuses `model_already_exists`.
 *
 * The ideation instruction nevertheless ended "offer to add any the user picks". So
 * the journey ran: the user asks what options they are missing, the Agent lists three
 * to five and offers to add one, the user picks — and there is no tool to call. A
 * dead end in the ACT verb, reached by the most natural question a user asks of a
 * reasoning assistant.
 *
 * These specs are deliberately bound in BOTH directions. If someone later ships a
 * tool that can create an entity, the manifest spec goes red and whoever ships it is
 * made to come back and restore the offer — the honest wording is not meant to
 * outlive the limitation that forced it.
 */
describe('the agent lane promises only what its own tools can do', () => {
  const MANIFEST_WHEN_THIS_WAS_WRITTEN = [
    'get_canonical_state',
    'propose_model_change',
    'authorise_change',
    'run_analysis',
    'build_model_from_brief',
    'propose_assumptions',
    'propose_option_interventions',
    'propose_starting_point',
  ];

  it('pins the tool manifest — a new tool must re-open the promise below', () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(MANIFEST_WHEN_THIS_WAS_WRITTEN);
  });

  it('propose_model_change can only relate labels that already exist', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'propose_model_change');
    expect(tool).toBeDefined();
    const params = tool?.parameters as { properties?: Record<string, unknown> };
    // No parameter names a NEW entity to create — every one of these is a reference
    // to something `get_canonical_state` already returned, or prose about the link.
    expect(Object.keys(params.properties ?? {}).sort()).toEqual(
      ['direction', 'from_label', 'rationale', 'to_label'],
    );
  });

  it('never offers to add an option or factor, because no tool can', () => {
    const instructions = AGENT_INSTRUCTIONS;
    // THE INVARIANT. Reverting the instruction fix turns exactly this red.
    expect(instructions).not.toMatch(/offer to add any/i);
    expect(instructions).toMatch(
      /no tool that can put a new option or factor into a model that already exists/,
    );
  });

  it('still tells the user plainly that nothing was added', () => {
    // The fix removes a false offer; it must not also remove the honest disclosure
    // that the ideas are not in the model. That sentence is the whole reason a user
    // does not go looking for options that were never written.
    expect(AGENT_INSTRUCTIONS).toMatch(/none has been added to the model/);
  });
});
