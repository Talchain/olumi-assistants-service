/**
 * ⭐ "BOUNDED COMPOUND PROPOSAL COMMITS" — Paul's directive, 21 Sep 2026.
 *
 * The constraint that makes this necessary rather than convenient: the writer
 * keys idempotency on `(scenario_id, turn_id)`, so a SECOND write under one
 * turn id is SWALLOWED — and swallowed is indistinguishable from saved. The
 * controller therefore refuses a second write per turn, and a user who agrees
 * to three changes at once is told two of them did not happen. One write
 * carrying all three is the only honest way to honour them.
 */
import { describe, it, expect } from 'vitest';
import {
  EMPTY_PROPOSAL_STORE,
  openProposal,
  authoriseProposal,
  operationsToApplyBatch,
  MAX_COMPOUND_OPERATIONS,
  type ProposalStore,
} from '../proposal-store.js';

const REV = 'rev-1';

function withProposal(
  store: ProposalStore,
  id: string,
  ops: ReadonlyArray<{ kind: string; summary: string }>,
  revision = REV,
): ProposalStore {
  return openProposal(store, {
    id,
    operations: ops,
    model_revision: revision,
    proposed_at: '2026-09-21T10:00:00Z',
    proposed_in_turn: 'turn-1',
  });
}

function authorise(store: ProposalStore, id: string, revision = REV): ProposalStore {
  return authoriseProposal(store, id, {
    authorised_in_turn: 'turn-2',
    authorised_at: '2026-09-21T10:01:00Z',
    current_model_revision: revision,
  });
}

function twoAuthorised(): ProposalStore {
  let s = withProposal(EMPTY_PROPOSAL_STORE, 'p1', [{ kind: 'set_option_effect', summary: 'A' }]);
  s = withProposal(s, 'p2', [{ kind: 'set_option_effect', summary: 'B' }]);
  return authorise(authorise(s, 'p1'), 'p2');
}

describe('several agreed changes become ONE write', () => {
  it('concatenates in the caller’s order and carries the shared revision', () => {
    const batch = operationsToApplyBatch(twoAuthorised(), ['p1', 'p2']);
    // Order is preserved because the operations are opaque here and a later
    // one may depend on an earlier one.
    expect(batch.operations.map((o) => o.summary)).toEqual(['A', 'B']);
    expect(batch.model_revision).toBe(REV);
    const reversed = operationsToApplyBatch(twoAuthorised(), ['p2', 'p1']);
    expect(reversed.operations.map((o) => o.summary)).toEqual(['B', 'A']);
  });

  it('refuses a member that was never agreed to', () => {
    let s = withProposal(EMPTY_PROPOSAL_STORE, 'p1', [{ kind: 'k', summary: 'A' }]);
    s = withProposal(s, 'p2', [{ kind: 'k', summary: 'B' }]);
    s = authorise(s, 'p1'); // p2 deliberately left open
    expect(() => operationsToApplyBatch(s, ['p1', 'p2'])).toThrow(/"p2" is "open"/);
  });

  it('⛔ refuses proposals agreed against DIFFERENT model revisions', () => {
    // Not a batch — two conversations. Concatenating them would apply one
    // against a state its user never saw.
    let s = withProposal(EMPTY_PROPOSAL_STORE, 'p1', [{ kind: 'k', summary: 'A' }], 'rev-1');
    s = withProposal(s, 'p2', [{ kind: 'k', summary: 'B' }], 'rev-2');
    s = authorise(s, 'p1', 'rev-1');
    s = authorise(s, 'p2', 'rev-2');
    expect(() => operationsToApplyBatch(s, ['p1', 'p2'])).toThrow(/different model revision/);
  });

  it('refuses the same proposal twice — it would be applied twice', () => {
    expect(() => operationsToApplyBatch(twoAuthorised(), ['p1', 'p1'])).toThrow(/appears twice/);
  });

  it('is BOUNDED, and the bound is on operations not proposals', () => {
    // One proposal may legitimately carry several operations, so a
    // proposal-count bound would bound the wrong thing.
    const many = Array.from({ length: MAX_COMPOUND_OPERATIONS + 1 }, (_, i) => ({
      kind: 'k',
      summary: `op-${i}`,
    }));
    const s = authorise(withProposal(EMPTY_PROPOSAL_STORE, 'big', many), 'big');
    expect(() => operationsToApplyBatch(s, ['big'])).toThrow(
      new RegExp(`at most ${MAX_COMPOUND_OPERATIONS} operations and this one has ${MAX_COMPOUND_OPERATIONS + 1}`),
    );
  });

  it('POSITIVE CONTROL: exactly at the bound is allowed', () => {
    // Without this, the bound test above would pass for a guard that refused
    // everything — the classic vacuous-refusal shape.
    const exact = Array.from({ length: MAX_COMPOUND_OPERATIONS }, (_, i) => ({
      kind: 'k',
      summary: `op-${i}`,
    }));
    const s = authorise(withProposal(EMPTY_PROPOSAL_STORE, 'big', exact), 'big');
    expect(operationsToApplyBatch(s, ['big']).operations).toHaveLength(MAX_COMPOUND_OPERATIONS);
  });

  it('an empty batch is not a commit', () => {
    expect(() => operationsToApplyBatch(twoAuthorised(), [])).toThrow(/at least one proposal/);
  });
});
