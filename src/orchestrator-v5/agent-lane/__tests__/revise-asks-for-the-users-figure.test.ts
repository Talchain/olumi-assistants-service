/**
 * The Agent never supplies the figure a user is to type as their own (AIQ ruling #75 5921113788; PTL decision #78
 * 5921683490). Served 30 Sep (52f8cd 5921103828): asked to revise Olumi's 4/month, the Agent told the user to type
 * "Set Warm introductions to 2 per month" — which the store records as `user_override` and shows as "Set by you",
 * laundering Olumi's number into the user's authorship.
 *
 * The rule sits at the first instruction boundary that was silent on it: `propose_assumptions`' description, right
 * after the `revise: true` restriction. The wording is the PTL's, verbatim. The served row (a figure-free question on
 * "revise the 4/month"; the user's own "2 per month" stays theirs) is measured on the deployed build, not here.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';

const RULE =
  'When the user asks to revise an existing value without supplying a replacement figure, ask what figure they ' +
  'would use; never supply a number or an instruction for them to repeat as their own.';

describe('propose_assumptions: a revision without the user\'s figure asks for it, never scripts one', () => {
  const tool = AGENT_TOOLS.find((t) => t.name === 'propose_assumptions');

  it('the tool exists (the probe sees the description it pins)', () => {
    expect(tool, 'propose_assumptions is in the served tool list').toBeDefined();
    expect(tool!.description).toContain('revise: true');
  });

  it('carries the PTL\'s sentence verbatim, immediately after the revise:true restriction', () => {
    const d = tool!.description;
    const restrictionEnd = d.indexOf('Never set it to replace someone’s figure with one of your own.');
    expect(restrictionEnd, 'the existing restriction is unchanged').toBeGreaterThan(-1);
    const at = d.indexOf(RULE);
    expect(at, 'the rule is present, verbatim').toBeGreaterThan(-1);
    const between = d.slice(restrictionEnd + 'Never set it to replace someone’s figure with one of your own.'.length, at);
    expect(between, 'nothing sits between the restriction and the rule').toBe(' ');
  });
});
