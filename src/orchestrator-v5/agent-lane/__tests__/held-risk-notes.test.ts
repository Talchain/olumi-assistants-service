import { describe, expect, it } from 'vitest';
import { HELD_RISK_CAUSE_NOTE, HELD_RISK_WINDOW_NOTE } from '../held-risk-notes.js';
import { composeProposalReply } from '../proposal-reply.js';

const notes = [
  { name: 'cause', note: HELD_RISK_CAUSE_NOTE },
  { name: 'missing time window', note: HELD_RISK_WINDOW_NOTE },
];

function expectHeldDisclosure(text: string): void {
  expect(text).not.toMatch(/\bI(?:'|’| ha)ve added\b/i);
  expect(text).not.toMatch(/\badded it\b/i);
  expect(text).toContain('until you approve');
}

/** The ordinary held-risk shapes produced by agent-event-risk-door-seam.test.ts's caused/no-window offers. */
function heldRiskWithNote(note: string, caused: boolean): Record<string, unknown> {
  return {
    ok: true,
    mutated: false,
    proposal_id: 'gmh_held_competitive_response',
    public_label: caused ? 'Approve 3 changes' : 'Approve 2 changes',
    held_message: caused
      ? "Yes, add risk 'Competitive response', link 'Competitive response' to 'Revenue' and link 'Price' to 'Competitive response'."
      : "Yes, add risk 'Competitive response' and link 'Competitive response' to 'Revenue'.",
    base_revision: 'a'.repeat(64),
    risk: {
      label: 'Competitive response',
      threatens: ['Revenue (lowers it)'],
      driven_by: caused ? ['Price (more of it makes the risk more likely)'] : [],
      how_strongly: 'not known yet: Olumi uses a placeholder strength for each link, not an estimate',
    },
    note: `Nothing has changed yet. ${note}`,
  };
}

describe('held ordinary-risk disclosures wait for approval', () => {
  it.each(notes)('guard: $name constant does not claim an applied change', ({ note }) => {
    expectHeldDisclosure(note);
  });

  it.each(notes)('guard: $name disclosure in a composed held-risk reply does not claim an applied change', ({ name, note }) => {
    const result = heldRiskWithNote(note, name === 'cause');
    const reply = composeProposalReply('propose_new_risk', { whole_request: true }, result, '');
    expect(reply).not.toBeNull();
    expect(reply).toContain(note);
    expectHeldDisclosure(reply!);
  });

  it('path 1: the whole-request held risk with a stated cause includes its approval-gated cause note', () => {
    const result = heldRiskWithNote(HELD_RISK_CAUSE_NOTE, true);
    const reply = composeProposalReply('propose_new_risk', { whole_request: true }, result, '');
    expect(result.mutated).toBe(false);
    expect(reply).not.toBeNull();
    expect(reply).toContain(HELD_RISK_CAUSE_NOTE);
    expectHeldDisclosure(reply!);
  });

  it('path 1: the whole-request held risk without a time window includes its approval-gated window note', () => {
    const result = heldRiskWithNote(HELD_RISK_WINDOW_NOTE, false);
    const reply = composeProposalReply('propose_new_risk', { whole_request: true }, result, '');
    expect(result.mutated).toBe(false);
    expect(reply).not.toBeNull();
    expect(reply).toContain(HELD_RISK_WINDOW_NOTE);
    expectHeldDisclosure(reply!);
  });
});
