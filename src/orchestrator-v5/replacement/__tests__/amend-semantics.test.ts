/**
 * ⭐ THE THIRD VERB — "explicit confirm/amend/reject semantics for durable
 * proposals" (Paul's directive, 21 Sep 2026).
 *
 * The harm this closes, measured earlier and written down before it was built:
 * an authorised change replays from its STORED OPERATIONS and never re-reads
 * the user's message. So "yes, but make it 0.6" cannot be honoured by widening
 * the confirmation predicate — that writes the OFFER's number, discards the
 * user's, and issues a receipt saying it saved what they asked for. The
 * predicate is RIGHT to refuse a value restatement. The remedy is a separate
 * verb, which is what this pins.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_PROPOSAL_STORE,
  openProposal,
  authoriseProposal,
  amendProposal,
  beginApply,
  withdrawProposal,
  describeForUser,
  type ProposalStore,
} from '../proposal-store.js';

const REV = 'rev-1';
const OFFERED = [{ kind: 'set_option_effect', summary: 'Set SMB investment to 0.55' }];
const ASKED_FOR = [{ kind: 'set_option_effect', summary: 'Set SMB investment to 0.6' }];

function opened(): ProposalStore {
  return openProposal(EMPTY_PROPOSAL_STORE, {
    id: 'p1',
    operations: OFFERED,
    model_revision: REV,
    proposed_at: '2026-09-21T10:00:00Z',
    proposed_in_turn: 'turn-1',
  });
}

function amend(store: ProposalStore) {
  return amendProposal(store, 'p1', {
    amended_id: 'p2',
    operations: ASKED_FOR,
    amended_at: '2026-09-21T10:01:00Z',
    amended_in_turn: 'turn-2',
    current_model_revision: REV,
  });
}

const byId = (s: ProposalStore, id: string) => s.proposals.find((p) => p.id === id)!;

describe('amend is neither accept nor reject', () => {
  it('supersedes the original and opens the amendment, linked both ways', () => {
    const s = amend(opened());
    expect(byId(s, 'p1').status).toBe('superseded');
    expect(byId(s, 'p1').superseded_by).toBe('p2');
    expect(byId(s, 'p2').amends).toBe('p1');
    expect(byId(s, 'p2').amended_in_turn).toBe('turn-2');
  });

  it('the amendment carries the USER’s operations, the original keeps its own', () => {
    const s = amend(opened());
    expect(byId(s, 'p2').operations).toEqual(ASKED_FOR);
    expect(byId(s, 'p1').operations, 'the record of what we offered must survive').toEqual(OFFERED);
  });

  it('⛔ AN AMENDMENT DOES NOT INHERIT CONSENT — the load-bearing rule', () => {
    // Authorisation binds to SPECIFIC operations. Once they change, the earlier
    // consent does not cover them. Inheriting it would write 0.6 with a receipt
    // the user never authorised — the exact harm the separate verb exists for.
    const authorised = authoriseProposal(opened(), 'p1', {
      authorised_in_turn: 'turn-2',
      authorised_at: '2026-09-21T10:00:30Z',
      current_model_revision: REV,
    });
    expect(byId(authorised, 'p1').status, 'precondition: we are amending an AUTHORISED proposal').toBe('authorised');

    const s = amend(authorised);
    expect(byId(s, 'p2').status, 'the amendment must go back to the user').toBe('open');
    expect(byId(s, 'p2').authorised_in_turn).toBeUndefined();
    expect(byId(s, 'p2').authorised_at).toBeUndefined();
  });

  it('refuses once the bytes are already gone', () => {
    const inFlight = beginApply(
      authoriseProposal(opened(), 'p1', {
        authorised_in_turn: 'turn-2',
        authorised_at: '2026-09-21T10:00:30Z',
        current_model_revision: REV,
      }),
      'p1',
      { idempotency_key: 'k1', apply_started_at: '2026-09-21T10:00:40Z', current_model_revision: REV },
    );
    expect(() => amend(inFlight)).toThrow(/cannot amend a proposal in status "apply_in_flight"/);
  });

  it('identical operations are not an amendment', () => {
    expect(() =>
      amendProposal(opened(), 'p1', {
        amended_id: 'p2',
        operations: OFFERED,
        amended_at: '2026-09-21T10:01:00Z',
        amended_in_turn: 'turn-2',
        current_model_revision: REV,
      }),
    ).toThrow(/identical operations/);
  });

  it('a client retry of the same amendment is a no-op, a different one is loud', () => {
    const once = amend(opened());
    expect(amend(once), 'same amendment twice = the retry working').toEqual(once);
    expect(() =>
      amendProposal(once, 'p1', {
        amended_id: 'p3',
        operations: [{ kind: 'set_option_effect', summary: 'Set SMB investment to 0.9' }],
        amended_at: '2026-09-21T10:02:00Z',
        amended_in_turn: 'turn-3',
        current_model_revision: REV,
      }),
    ).toThrow(/already amended by "p2"/);
  });

  it('never tells the user their change was set aside', () => {
    const s = amend(opened());
    const superseded = describeForUser(byId(s, 'p1'));
    // POSITIVE CONTROL: withdraw genuinely does say "set aside", so this
    // assertion is discriminating rather than passing on an empty string.
    const withdrawn = describeForUser(byId(withdrawProposal(opened(), 'p1'), 'p1'));
    expect(withdrawn).toBe('set aside');
    expect(superseded).not.toBe('set aside');
    expect(superseded).toContain('amended');
  });
});
