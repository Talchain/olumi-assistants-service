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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../runtime/agent-tools.js';

// AIE #94 6140145484 supersedes the complete description, byte for byte.
const approvedBytes = readFileSync(new URL('./fixtures/aie-a2-assumption-authorship-20261013.json', import.meta.url));
const approved = JSON.parse(approvedBytes.toString('utf8'));
const RULE = "When the user requests a revision without a replacement figure, ask what figure they would use; never supply a number or an instruction for them to repeat as their own.";

describe('propose_assumptions: a revision without the user\'s figure asks for it, never scripts one', () => {
  const tool = AGENT_TOOLS.find((t) => t.name === 'propose_assumptions');

  it('the tool exists (the probe sees the description it pins)', () => {
    expect(tool, 'propose_assumptions is in the served tool list').toBeDefined();
    expect(tool!.description).toContain('unless revise is true');
  });

  it('carries the AIE\'s approved sentence verbatim, immediately after the revise:true restriction', () => {
    const d = tool!.description;
    const restrictionEnd = d.indexOf("Never replace someone's figure with one of your own under revise.");
    expect(restrictionEnd, 'the existing restriction is unchanged').toBeGreaterThan(-1);
    const at = d.indexOf(RULE);
    expect(at, 'the rule is present, verbatim').toBeGreaterThan(-1);
    const between = d.slice(restrictionEnd + "Never replace someone's figure with one of your own under revise.".length, at);
    expect(between, 'nothing sits between the restriction and the rule').toBe(' ');
  });
});

// Exact contract pins: adding the field to both entry points prevents the combined caller from dropping it.
describe('A2i6 approved assumption tool surface', () => {
  it('pins the approved artifact and the WHOLE tool description', () => {
    expect(createHash('sha256').update(approvedBytes).digest('hex')).toBe('4de5e7f71fd603d03e39483d1064dfbc94425a0e4208e280441f124b5a924f86');
    expect(AGENT_TOOLS.find(t => t.name === 'propose_assumptions')!.description).toBe(approved.tool_description.after);
  });
  it.each(['propose_assumptions', 'propose_starting_point'])('%s requires the exact typed field contract', name => {
    const tool = AGENT_TOOLS.find(t => t.name === name)!;
    const items = (tool.parameters as any).properties.assumptions.items;
    expect(items.properties.user_stated).toEqual(approved.field.schema);
    expect(items.required).toEqual(['factor_label', 'value', 'unit', 'basis', 'user_stated']);
  });
});
