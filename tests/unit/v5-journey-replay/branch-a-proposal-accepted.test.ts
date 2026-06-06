/**
 * V5 replay harness — Branch A proposal-acceptance assertion self-tests.
 *
 * Pins `assertProposalAccepted` (the "do it" → applied mutation step).
 * Accepts the #236 "Applying: …" resume echo OR a mutation-ack verb as
 * positive proof; rejects a clarification-back (the proposal failed to
 * resume) and empty/ack-less responses.
 */

import { describe, it, expect } from 'vitest';

import { assertProposalAccepted } from '../../../tools/v5-journey-replay/assertions.js';
import type { FetchResult } from '../../../tools/v5-journey-replay/client.js';

function mkText(text: string, status = 200): FetchResult {
  return { status, body: { assistant_text: text }, elapsed_ms: 5 };
}

describe('assertProposalAccepted — passes on applied mutation', () => {
  it('accepts the "Applying:" resume echo plus a mutation-ack verb', () => {
    const r = assertProposalAccepted(
      mkText('Applying: Test Hiring Budget at £50,000. Updated Hiring Budget from £40,000 to £50,000.'),
    );
    expect(r.ok).toBe(true);
  });

  it('accepts a bare mutation-ack verb (no echo)', () => {
    const r = assertProposalAccepted(mkText('Set Hiring Budget to £50,000.'));
    expect(r.ok).toBe(true);
  });

  it('accepts the resume echo alone', () => {
    const r = assertProposalAccepted(mkText('Applying: Test Hiring Budget at £50,000. Done.'));
    expect(r.ok).toBe(true);
  });
});

describe('assertProposalAccepted — fails honestly', () => {
  it('fails when the response asks for clarification (proposal did not resume)', () => {
    const r = assertProposalAccepted(mkText('Did you mean the hiring budget or the marketing budget?'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('proposal_accept_clarification_back_no_mutation');
  });

  it('fails when there is no echo and no mutation-ack verb', () => {
    const r = assertProposalAccepted(mkText('Here is some more information about your decision model.'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('proposal_accept_no_mutation_acknowledgement');
  });

  it('fails on empty assistant_text', () => {
    const r = assertProposalAccepted(mkText(''));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing_contract).toBe('proposal_accept_empty_text');
  });

  it('fails on a non-200 status via the core stack', () => {
    const r = assertProposalAccepted(mkText('Applying: Test X at 15. Updated X.', 500));
    expect(r.ok).toBe(false);
  });
});
