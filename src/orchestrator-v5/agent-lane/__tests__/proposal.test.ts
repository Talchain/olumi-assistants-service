/**
 * Authorisation is bound to the exact proposal — tested as an attack, not as a
 * happy path. Each case below is a way the binding could be defeated.
 */

import { describe, it, expect } from 'vitest';
import { narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';
import {
  ProposalStore, createProposal, computeProposalId, MAX_PROPOSALS,
  type ProposalContent,
} from '../proposal.js';

const BASE = 'a'.repeat(64);
const MOVED = 'b'.repeat(64);
const SCENARIO = 'scn-1';
const USER = 'user-a';

const content = (over: Partial<ProposalContent> = {}): ProposalContent => ({
  scenario_id: SCENARIO,
  user_id: USER,
  base_graph_identity_hash: BASE,
  operations: [{ op: 'add_edge', path: 'competitor_price_reaction::churn_spike', value: { effect_direction: 'positive' } }],
  provenance: { authored_by: 'model_proposed', basis: 'widener proposal, user authorised' },
  validation: { admitted: true, loss_count: 2, refusals: [] },
  public_label: 'Add Competitor Price Reaction affecting the churn spike',
  ...over,
});

const req = (id: string, over: Partial<{ scenario_id: string; authenticated_user_id: string | null; current_graph_identity_hash: string }> = {}) => ({
  proposal_id: id, scenario_id: SCENARIO, authenticated_user_id: USER as string | null, current_graph_identity_hash: BASE, ...over,
});

describe('proposal identity is structural', () => {
  it('the id is a hash OVER THE CONTENT — same content, same id', () => {
    expect(createProposal(content()).proposal_id).toBe(createProposal(content()).proposal_id);
  });

  it('ANY content change changes the id — the payload cannot be swapped under an authorisation', () => {
    const base = createProposal(content()).proposal_id;
    const variants: ProposalContent[] = [
      content({ operations: [{ op: 'add_edge', path: 'competitor_price_reaction::churn_spike', value: { effect_direction: 'negative' } }] }),
      content({ operations: [{ op: 'remove_node', path: 'churn_spike' }] }),
      content({ base_graph_identity_hash: MOVED }),
      content({ scenario_id: 'scn-2' }),
      content({ user_id: 'user-b' }),
      content({ public_label: 'Something else entirely' }),
      content({ provenance: { authored_by: 'user_stated' } }),
    ];
    for (const v of variants) expect(computeProposalId(v), JSON.stringify(v).slice(0, 60)).not.toBe(base);
  });

  it('key order in operations does not change the id, but operation ORDER does', () => {
    const a = computeProposalId(content({ operations: [{ path: 'x', op: 'add_node', value: 1 }] }));
    const b = computeProposalId(content({ operations: [{ op: 'add_node', path: 'x', value: 1 }] }));
    expect(a).toBe(b);
    const two = computeProposalId(content({ operations: [{ op: 'add_node', path: 'x' }, { op: 'add_node', path: 'y' }] }));
    const rev = computeProposalId(content({ operations: [{ op: 'add_node', path: 'y' }, { op: 'add_node', path: 'x' }] }));
    expect(two, 'a different application order is a different change').not.toBe(rev);
  });
});

describe('authorisation applies the STORED proposal', () => {
  it('returns the stored object itself, not a description of it', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content()));
    const d = s.authorise(req(p.proposal_id));
    expect(d.status).toBe('execute');
    if (d.status === 'execute') {
      expect(d.proposal).toBe(p);                       // identity, not equality
      expect(d.proposal.operations).toEqual(p.operations);
    }
  });

  it('refuses when the model moved since the proposal was made', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content()));
    const d = s.authorise(req(p.proposal_id, { current_graph_identity_hash: MOVED }));
    expect(d.status).toBe('superseded');
    if (d.status === 'superseded') { expect(d.expected).toBe(BASE); expect(d.actual).toBe(MOVED); }
  });

  it('refuses a proposal belonging to another user or another scenario', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content()));
    expect(s.authorise(req(p.proposal_id, { authenticated_user_id: 'user-b' })).status).toBe('not_authorised');
    expect(s.authorise(req(p.proposal_id, { scenario_id: 'scn-2' })).status).toBe('not_authorised');
  });

  it('refuses an unknown proposal id', () => {
    expect(new ProposalStore().authorise(req('prop_nope')).status).toBe('unknown_proposal');
  });

  it('a second authorisation is already_applied, not a second write', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content()));
    expect(s.authorise(req(p.proposal_id)).status).toBe('execute');
    s.markApplied(p.proposal_id);
    const again = s.authorise(req(p.proposal_id));
    expect(again.status).toBe('already_applied');
    if (again.status === 'already_applied') expect(again.proposal).toBe(p);
  });

  it('detects stored content that no longer hashes to its id', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content()));
    // Simulate an in-memory swap of the payload under a known-good id.
    (p as unknown as { operations: unknown[] }).operations = [{ op: 'remove_node', path: 'mrr' }];
    expect(s.authorise(req(p.proposal_id)).status).toBe('integrity_failed');
  });

  it('is bounded', () => {
    const s = new ProposalStore();
    for (let i = 0; i < MAX_PROPOSALS + 10; i++) s.put(createProposal(content({ public_label: 'p' + i })));
    expect(s.size()).toBeLessThanOrEqual(MAX_PROPOSALS);
  });

  /**
   * ⛔ AN APPLIED PROPOSAL MUST NOT BECOME `unknown_proposal` BY EVICTION.
   *
   * `put` evicted the oldest id from `items` and never touched `applied`, while
   * `authorise` reads `items` FIRST and returns `unknown_proposal` before it ever
   * consults `applied`. So an approval that HAD been applied came back as
   * "no longer available".
   *
   * That is not a cosmetic wrong code. The refusal the user is shown for
   * `unknown_proposal` reads "that proposal is no longer available, so nothing was
   * changed — ask me to suggest it again and approve the new one"
   * (`write-outcome.ts` REFUSAL_WORDS). So the user is told nothing was saved when
   * it WAS, and invited to propose and approve the same change a second time. This
   * file's own docblock calls that family the single worst thing this loop can do.
   *
   * Eviction preferentially destroys exactly the wrong entries: `order` is FIFO and
   * an applied proposal is by definition one that has already been through a full
   * cycle, so it is among the oldest. The store is also a PROCESS-WIDE singleton
   * shared by every user and scenario (`agent-v1-turn.ts`), so the cap is reached
   * by total traffic, not by one conversation.
   */
  it('an applied proposal survives eviction pressure — already_applied, never unknown', () => {
    const s = new ProposalStore();
    const approved = s.put(createProposal(content({ public_label: 'the one the user approved' })));
    s.markApplied(approved.proposal_id, [{ version: 7, scenario_id: SCENARIO, label: 'v7' } as never]);
    // Push well past the cap. `approved` is the OLDEST, so FIFO eviction targets it first.
    for (let i = 0; i < MAX_PROPOSALS + 5; i++) s.put(createProposal(content({ public_label: 'filler ' + i })));
    const d = s.authorise(req(approved.proposal_id));
    expect(d.status, 'reporting an applied proposal as unknown invites a second write of a change already saved').toBe('already_applied');
    if (d.status === 'already_applied') {
      expect(d.receipts.map((r) => (r as { version?: number }).version), 'the receipts must survive with it, or the user cannot be told which version it became').toEqual([7]);
    }
  });

  /**
   * The discriminating half. If the fix above were "stop evicting", this fails —
   * an UNAPPLIED proposal must still be discarded and the bound must still hold.
   */
  it('still evicts an UNAPPLIED proposal, and the bound still holds', () => {
    const s = new ProposalStore();
    const neverApproved = s.put(createProposal(content({ public_label: 'offered and ignored' })));
    for (let i = 0; i < MAX_PROPOSALS + 5; i++) s.put(createProposal(content({ public_label: 'filler ' + i })));
    expect(s.authorise(req(neverApproved.proposal_id)).status, 'the fix must not work by never evicting').toBe('unknown_proposal');
    expect(s.size(), 'memory must stay bounded').toBeLessThanOrEqual(MAX_PROPOSALS);
  });
});

/**
 * ⛔ THE CORNER THE EVICTION ORDER CANNOT REACH (Codex 5807661105): when EVERY entry is applied, the
 * oldest applied proposal is still evicted, and a process restart forgets every proposal at once. So
 * `unknown_proposal` can name a change that WAS saved. What the user reads for it must therefore never
 * say nothing was changed, nor invite a blind second approval.
 */
describe('an unknown proposal is never told as "nothing was changed"', () => {
  const said = (refusal: string) => {
    const n = narrateWriteOutcome('Done.', [{ name: 'authorise_change', ok: false, mutated: false, refusal }], [{ ok: false, mutated: false, refusal }]);
    return withWriteOutcome(n.text, n.status);
  };

  it('RED: 200 applied proposals plus one more → the evicted applied id reads as possibly saved, never as unchanged', () => {
    const s = new ProposalStore();
    const first = s.put(createProposal(content({ public_label: 'applied 0' })));
    s.markApplied(first.proposal_id, [{ version: 1, scenario_id: SCENARIO, label: 'v1' } as never]);
    for (let i = 1; i < MAX_PROPOSALS; i++) {
      const p = s.put(createProposal(content({ public_label: 'applied ' + i })));
      s.markApplied(p.proposal_id);
    }
    s.put(createProposal(content({ public_label: 'one more' })));
    const d = s.authorise(req(first.proposal_id));
    expect(d.status, 'the control: this IS the all-applied corner, where the applied record goes too').toBe('unknown_proposal');

    const text = said(d.status);
    expect(text).not.toMatch(/nothing was changed/i);
    expect(text, 'it may already be saved: say so').toMatch(/may already be in the model/i);
    expect(text, 'no blind second approval').toMatch(/check the model before/i);
  });

  it('CONTRAST: a retained applied proposal still returns already_applied with its original receipt', () => {
    const s = new ProposalStore();
    const p = s.put(createProposal(content({ public_label: 'kept' })));
    s.markApplied(p.proposal_id, [{ version: 4, scenario_id: SCENARIO, label: 'v4' } as never]);
    const d = s.authorise(req(p.proposal_id));
    expect(d.status).toBe('already_applied');
    if (d.status === 'already_applied') expect(d.receipts.map((r) => (r as { version?: number }).version)).toEqual([4]);
  });
});

describe('outstanding — an approval must have something to bind to', () => {
  /**
   * ⛔ MEASURED on the deployed build: the user said "Yes, apply it" and the
   * turn called NO tools, replying that the change "has been proposed but not
   * approved or applied". Two proposals were outstanding and the Agent could
   * name neither. The user believes the model changed; it did not.
   */
  const content = (label: string, ops: number) => ({
    scenario_id: 's1', user_id: 'u1', base_graph_identity_hash: 'h0',
    operations: Array.from({ length: ops }, (_, i) => ({ op: 'add_edge' as const, path: `a${i}::b${i}` })),
    provenance: { authored_by: 'model_proposed' as const },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: label,
  });

  it('returns unapplied proposals NEWEST FIRST, so "yes" binds to what was just shown', () => {
    const store = new ProposalStore();
    const first = store.put(createProposal(content('Connect A to B', 1)));
    const second = store.put(createProposal(content('Set three option levels', 3)));
    expect(store.outstanding('s1', 'u1').map((p) => p.public_label))
      .toEqual(['Set three option levels', 'Connect A to B']);
    expect(store.outstanding('s1', 'u1')[0].proposal_id).toBe(second.proposal_id);
    expect(first.proposal_id).not.toBe(second.proposal_id);
  });

  it('drops one once applied', () => {
    const store = new ProposalStore();
    const a = store.put(createProposal(content('Connect A to B', 1)));
    store.put(createProposal(content('Set three option levels', 3)));
    store.markApplied(a.proposal_id);
    expect(store.outstanding('s1', 'u1').map((p) => p.public_label)).toEqual(['Set three option levels']);
  });

  it('never leaks another scenario or another subject — the contrast control', () => {
    const store = new ProposalStore();
    store.put(createProposal(content('Mine', 1)));
    store.put(createProposal({ ...content('Another scenario', 2), scenario_id: 's2' }));
    store.put(createProposal({ ...content('Another user', 2), user_id: 'u2' }));
    expect(store.outstanding('s1', 'u1').map((p) => p.public_label)).toEqual(['Mine']);
  });
});

