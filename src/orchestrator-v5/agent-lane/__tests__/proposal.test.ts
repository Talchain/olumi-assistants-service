/**
 * Authorisation is bound to the exact proposal — tested as an attack, not as a
 * happy path. Each case below is a way the binding could be defeated.
 */

import { describe, it, expect } from 'vitest';
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

