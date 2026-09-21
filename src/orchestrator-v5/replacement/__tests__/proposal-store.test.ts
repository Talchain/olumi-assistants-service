/**
 * Proposal store — durable consent and truthful receipts.
 *
 * Every case is bound to a failure measured on 20 Sep 2026 and names it, so a
 * later reader can tell which real defect each guard holds shut.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_PROPOSAL_STORE,
  ProposalStateError,
  appliedProposals,
  authoriseProposal,
  beginApply,
  describeForUser,
  markStaleForRevision,
  needsReconciliation,
  openProposal,
  openProposals,
  operationsToApply,
  recordApplied,
  withdrawProposal,
  type ProposalStore,
} from '../proposal-store.js';

const T = '2026-09-20T12:00:00.000Z';
const REV_A = 'graph-rev-aaa';
const REV_B = 'graph-rev-bbb';

function proposed(): ProposalStore {
  return openProposal(EMPTY_PROPOSAL_STORE, {
    id: 'p1',
    operations: [{ kind: 'set_factor_value', summary: 'Set Monthly Churn Rate to 0.03' }],
    model_revision: REV_A,
    proposed_at: T,
    proposed_in_turn: 't1',
  });
}

function authorised(): ProposalStore {
  return authoriseProposal(proposed(), 'p1', {
    authorised_in_turn: 't2',
    authorised_at: T,
    current_model_revision: REV_A,
  });
}

describe('a proposal survives the turn it was made in', () => {
  it('"Yes, make that update now" finds the proposal — it is a durable object, not chat text', () => {
    const s = proposed();
    expect(openProposals(s)).toHaveLength(1);
    expect(openProposals(s)[0]?.operations[0]?.summary).toContain('Monthly Churn Rate');
  });

  it('refuses a proposal with no operations', () => {
    expect(() =>
      openProposal(EMPTY_PROPOSAL_STORE, {
        id: 'p0', operations: [], model_revision: REV_A, proposed_at: T, proposed_in_turn: 't1',
      }),
    ).toThrow(/not a proposal/);
  });

  it('refuses a proposal not bound to a model revision', () => {
    expect(() =>
      openProposal(EMPTY_PROPOSAL_STORE, {
        id: 'p0',
        operations: [{ kind: 'k', summary: 's' }],
        model_revision: '  ',
        proposed_at: T,
        proposed_in_turn: 't1',
      }),
    ).toThrow(/model_revision/);
  });
});

describe('authorisation is mandatory and must be the user\'s', () => {
  it('refuses to apply without authorisation — a suggestion never self-authorises by sitting in memory', () => {
    expect(() =>
      beginApply(proposed(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A }),
    ).toThrow(/authorisation is mandatory/);
  });

  it('refuses authorisation that does not name the user turn that gave it', () => {
    expect(() =>
      authoriseProposal(proposed(), 'p1', { authorised_in_turn: '', authorised_at: T, current_model_revision: REV_A }),
    ).toThrow(/name the user turn/);
  });

  it('refuses authorisation once the model has moved — consent was given against a specific state', () => {
    expect(() =>
      authoriseProposal(proposed(), 'p1', { authorised_in_turn: 't2', authorised_at: T, current_model_revision: REV_B }),
    ).toThrow(/re-propose/);
  });

  it('refuses a write against a revision the user did not consent to', () => {
    expect(() =>
      beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_B }),
    ).toThrow(/did not consent to/);
  });
});

describe('an interrupted save is survivable — and never guessed', () => {
  it('a started-but-unconfirmed save is flagged for reconciliation, not reported either way', () => {
    const s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    const pending = needsReconciliation(s);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.idempotency_key).toBe('k1');
    // Crucially it is NOT reported as applied...
    expect(appliedProposals(s)).toHaveLength(0);
    // ...and NOT offered as still open, which would invite a double-apply.
    expect(openProposals(s)).toHaveLength(0);
  });

  it('reconciliation discovering the write HAD landed records it once', () => {
    let s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    s = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: T });
    expect(needsReconciliation(s)).toHaveLength(0);
    expect(appliedProposals(s)).toHaveLength(1);
  });

  it('a retry with the SAME receipt is an idempotent no-op — it cannot double-apply', () => {
    let s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    s = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: T });
    const after = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: '2026-09-20T12:05:00.000Z' });
    expect(after).toEqual(s);
    expect(appliedProposals(after)).toHaveLength(1);
  });

  it('a SECOND, DIFFERENT receipt is raised — two writes landed is a fault, not something to absorb', () => {
    let s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    s = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: T });
    expect(() => recordApplied(s, 'p1', { receipt_id: 'r2', applied_at: T })).toThrow(/two writes landed/);
  });

  it('refuses a receipt that is not a receipt — a change without one is a claim', () => {
    const s = authorised();
    expect(() => recordApplied(s, 'p1', { receipt_id: '   ', applied_at: T })).toThrow(/receipt_id is required/);
  });
});

describe('the model moving does not silently apply or silently discard', () => {
  it('an un-applied proposal goes stale and is no longer answerable by "yes"', () => {
    const s = markStaleForRevision(proposed(), REV_B);
    expect(openProposals(s)).toHaveLength(0);
    expect(s.proposals[0]?.status).toBe('stale');
    expect(s.proposals[0]?.stale_reason).toBe('model_revision_moved');
    expect(s.proposals[0]?.stale_from_status).toBe('open');
  });

  it('an IN-FLIGHT save is NOT marked stale — that would assert a write did not land', () => {
    const inflight = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    const s = markStaleForRevision(inflight, REV_B);
    expect(s.proposals[0]?.status).toBe('apply_in_flight');
    expect(needsReconciliation(s)).toHaveLength(1);
  });

  it('an applied change is not disturbed by a later revision', () => {
    let s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    s = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: T });
    expect(markStaleForRevision(s, REV_B).proposals[0]?.status).toBe('applied');
  });

  it('an applied change cannot be withdrawn — undoing it needs its own consent', () => {
    let s = beginApply(authorised(), 'p1', { idempotency_key: 'k1', apply_started_at: T, current_model_revision: REV_A });
    s = recordApplied(s, 'p1', { receipt_id: 'r1', applied_at: T });
    expect(() => withdrawProposal(s, 'p1')).toThrow(/reversing change/);
  });
});

describe('the user is told in plain language, not internal status', () => {
  it('every status has a sentence a person can act on', () => {
    const statuses = ['open', 'authorised', 'apply_in_flight', 'applied', 'stale', 'withdrawn'] as const;
    const seen = new Set<string>();
    for (const status of statuses) {
      const text = describeForUser({
        id: 'p', status, operations: [{ kind: 'k', summary: 's' }],
        model_revision: REV_A, proposed_at: T, proposed_in_turn: 't1',
      });
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('_');           // no raw enum leaking to a user
      expect(seen.has(text)).toBe(false);        // each state says something different
      seen.add(text);
    }
  });

  it('the stale sentence offers a route back, which the live product did not', () => {
    const text = describeForUser({
      id: 'p', status: 'stale', operations: [{ kind: 'k', summary: 's' }],
      model_revision: REV_A, proposed_at: T, proposed_in_turn: 't1',
    });
    expect(text).toMatch(/put it to you again/);
  });
});

describe('purity and identity', () => {
  it('never mutates the input store', () => {
    const before = proposed();
    const snapshot = JSON.stringify(before);
    authoriseProposal(before, 'p1', { authorised_in_turn: 't2', authorised_at: T, current_model_revision: REV_A });
    markStaleForRevision(before, REV_B);
    withdrawProposal(before, 'p1');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses a duplicate proposal id rather than shadowing the earlier one', () => {
    expect(() =>
      openProposal(proposed(), {
        id: 'p1', operations: [{ kind: 'k', summary: 's' }], model_revision: REV_A, proposed_at: T, proposed_in_turn: 't9',
      }),
    ).toThrow(/duplicate/);
  });

  it('refuses any operation on an unknown proposal', () => {
    expect(() => withdrawProposal(EMPTY_PROPOSAL_STORE, 'nope')).toThrow(ProposalStateError);
  });
});

/**
 * Found by review, not by this suite — which is the reason these two cases
 * exist. `withdrawProposal` refused only `applied`, so a save whose outcome
 * was unknown could be cancelled out of existence.
 */
describe('cancellation is not rollback', () => {
  function inFlight(): ProposalStore {
    return beginApply(authorised(), 'p1', {
      idempotency_key: 'key-1',
      apply_started_at: T,
      current_model_revision: REV_A,
    });
  }

  it('refuses to withdraw a save that is already in flight', () => {
    expect(() => withdrawProposal(inFlight(), 'p1')).toThrow(ProposalStateError);
    expect(() => withdrawProposal(inFlight(), 'p1')).toThrow(/outcome is unknown/);
  });

  it('the unknown outcome survives the attempt — it is still awaiting reconciliation', () => {
    const store = inFlight();
    try {
      withdrawProposal(store, 'p1');
    } catch {
      /* expected */
    }
    expect(needsReconciliation(store)).toHaveLength(1);
    expect(needsReconciliation(store)[0]?.idempotency_key).toBe('key-1');
  });

  it('a proposal that was never sent can still be withdrawn — the guard is narrow', () => {
    // Contrast control. Without this, a guard that refused EVERY withdrawal
    // would pass the two cases above while breaking the feature.
    const withdrawn = withdrawProposal(proposed(), 'p1');
    expect(openProposals(withdrawn)).toHaveLength(0);
    expect(needsReconciliation(withdrawn)).toHaveLength(0);
  });

  it('an authorised but unsent proposal can still be withdrawn', () => {
    expect(() => withdrawProposal(authorised(), 'p1')).not.toThrow();
  });
});

/**
 * Consent binds to the operations as they were OFFERED.
 *
 * The failure this prevents is subtle and invisible downstream: the user says
 * yes, the assistant re-derives the change from the conversation, and applies
 * something adjacent to what was shown. The mutation path receives a valid
 * operation and cannot tell.
 */
describe('consent binds to the exact executable change', () => {
  it('returns the stored operations and the revision they were bound to', () => {
    const got = operationsToApply(authorised(), 'p1');
    expect(got.operations).toEqual([
      { kind: 'set_factor_value', summary: 'Set Monthly Churn Rate to 0.03' },
    ]);
    expect(got.model_revision).toBe(REV_A);
  });

  it('refuses a proposal that has not been agreed to', () => {
    expect(() => operationsToApply(proposed(), 'p1')).toThrow(/only an authorised proposal/);
  });

  it('refuses to hand out the operations a second time once a save is in flight', () => {
    const flying = beginApply(authorised(), 'p1', {
      idempotency_key: 'key-1',
      apply_started_at: T,
      current_model_revision: REV_A,
    });
    expect(() => operationsToApply(flying, 'p1')).toThrow(/apply_in_flight/);
  });

  it('refuses a stale proposal — the model moved, so the offer must be made again', () => {
    const stale = markStaleForRevision(authorised(), REV_B);
    expect(() => operationsToApply(stale, 'p1')).toThrow(/stale/);
  });

  /**
   * The four cases above left two of the six statuses untested, and a mutant
   * that accepted `applied` survived the whole suite. A predicate over an
   * enum is only pinned when every member is named.
   */
  it('refuses an already-applied proposal — re-issuing its operations IS the double-apply', () => {
    const done = recordApplied(
      beginApply(authorised(), 'p1', {
        idempotency_key: 'key-1', apply_started_at: T, current_model_revision: REV_A,
      }),
      'p1',
      { receipt_id: 'r1', applied_at: T },
    );
    expect(() => operationsToApply(done, 'p1')).toThrow(/applied/);
  });

  it('refuses a withdrawn proposal', () => {
    expect(() => operationsToApply(withdrawProposal(authorised(), 'p1'), 'p1')).toThrow(/withdrawn/);
  });
});
