/**
 * ⛔ WHAT A USER READS WHEN THE FINAL ANSWER WAS CUT SHORT (AIX-001; R&C #2009 B1/B2): never a promise to
 * "continue" a partial answer that was neither shown nor kept, and never "nothing happened" after a change.
 */
import { describe, it, expect } from 'vitest';
import { unfinishedAnswerText, interpretationUnavailableText } from '../../../routes/agent-v1-turn.js';

describe('unfinishedAnswerText', () => {
  it('RED (R&C B2): a turn that CHANGED the model says so', () => {
    const t = unfinishedAnswerText({ tool_calls: [{ name: 'build_model_from_brief' }], tool_results: [{ ok: true, mutated: true }], mutated: true });
    expect(t).toBe('Your model was updated, but my reply ran too long and was cut short, so I have not shown it. Ask me what changed.');
  });

  it('RED (R&C B1): nothing changed and nothing ran → shorter questions, never "continue"', () => {
    const t = unfinishedAnswerText({ tool_calls: [], tool_results: [], mutated: false });
    expect(t).toBe('My answer ran too long and was cut short, so I have not shown it. Try asking about one part at a time.');
    expect(t).not.toMatch(/continue/i);
  });

  it("CONTROL: after a run, the run's own sentence (unchanged by this fix)", () => {
    const run = { ok: true, ran: true };
    expect(unfinishedAnswerText({ tool_calls: [{ name: 'run_analysis' }], tool_results: [run], mutated: false })).toBe(interpretationUnavailableText(run));
  });
});
