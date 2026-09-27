/**
 * ⛔ PAUL'S TEST, 27 Sep (export `90b8f080`, turns 19→12, UI e8ba18e6 / CEE 263dbd5): the Agent asked "Would you like to
 * add competitive response as a specific risk?", Paul said "Yes.", and the reply opened "There is no specific change
 * awaiting approval yet, so nothing has been altered." Two turns later: "I cannot add it faithfully with the available
 * model changes". The prompt read ANY yes as "call authorise_change" and gave no rule for a yes to an offer made only
 * in words, nor against offering a change no tool can make.
 *
 * These rows pin the two rules in the instructions the Agent receives; the served proof is the re-witness of Paul's
 * turns after the all-clear (a model's words cannot be proved by a unit test).
 */
import { describe, it, expect } from 'vitest';
import { AGENT_INSTRUCTIONS } from '../../../routes/agent-v1-turn.js';

describe('the Agent acts on a yes to its own offer, and offers only what it can do', () => {
  it('RED (turn 17, "Yes." → plumbing): a yes to an offer made in words is the instruction to PROPOSE it now, never "nothing is awaiting approval"', () => {
    expect(AGENT_INSTRUCTIONS).toContain('If nothing is awaiting approval and the user says yes to a change you offered in words, that yes is the instruction to PROPOSE that change now, in this turn, with the tool that makes it.');
    expect(AGENT_INSTRUCTIONS).toContain('Never reply that nothing is awaiting approval, and never open by describing how approvals work.');
  });

  it('RED (turns 19→12, an offered risk no tool could add): offer only changes a tool can propose; otherwise say so once and offer the nearest one', () => {
    expect(AGENT_INSTRUCTIONS).toContain('Offer only changes one of your tools can propose. If no tool can make what the user wants, say so plainly in one sentence and offer the nearest change you CAN propose');
  });

  it('CONTRAST: the existing approval rule still stands — a yes with something awaiting approval authorises THAT proposal', () => {
    expect(AGENT_INSTRUCTIONS).toContain('When the user approves, agrees, or says yes, that is an instruction to call authorise_change.');
    // Order: the approval rule comes first, so a yes with a live proposal is never re-proposed.
    expect(AGENT_INSTRUCTIONS.indexOf('that is an instruction to call authorise_change')).toBeLessThan(AGENT_INSTRUCTIONS.indexOf('If nothing is awaiting approval and the user says yes'));
  });
});
