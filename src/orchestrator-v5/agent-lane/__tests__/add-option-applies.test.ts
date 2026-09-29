/**
 * ⛔ THE OLD ADD-OPTION APPLY IS RETIRED (C52; Paul's manual test, 25 Sep 17:26–17:54Z).
 *
 * It wrote an option and its links as separate system events (`structural_add`, then one
 * `structural_add_edge` per factor) and never linked the option FROM THE DECISION, so every option the
 * Agent added left the model un-runnable (`OPTION_NOT_LINKED_TO_DECISION`). Its partial-write, continuation
 * and per-link-retry machinery existed only because those writes were not atomic.
 *
 * New option proposals are held on the product's own typed add-option transaction and confirmed in ONE
 * commit (`agent-add-option-held-seam.test.ts`). What remains to pin here is the transition: a proposal of
 * the OLD shape — one restored from an answer row written before this change — is refused honestly and
 * writes NOTHING, rather than being applied incompletely.
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440000';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' };

describe('an old-shape add-option proposal is refused, never written', () => {
  it('refuses as superseded with plain words, and sends NO write of any kind', async () => {
    const writes: { path: string; body: unknown }[] = [];
    const d: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) {
        return { status: 200, json: { graph: { nodes: [{ id: 'dec', kind: 'decision', label: 'Decide' }, { id: 'f1', kind: 'factor', label: 'Price' }], edges: [] }, graph_hash: 'h0' } };
      }
      writes.push({ path, body });
      return { status: 200, json: {} };
    };
    const proposals = new ProposalStore();
    const legacy = createProposal({
      scenario_id: SCENARIO, user_id: 'u', base_graph_identity_hash: 'h0',
      operations: [
        { op: 'add_node', path: 'opt1', value: { kind: 'option', label: 'New price' } },
        { op: 'add_edge', path: 'opt1::f1', value: { direction: 'positive' } },
      ],
      provenance: { authored_by: 'user_stated', basis: 'an option the user asked to add' },
      validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: 'Add the option "New price", acting on Price',
    });
    proposals.put(legacy);
    const caps = createAgentCapabilities(d, proposals);
    const r = await caps.authoriseChange(ctx, { proposal_id: legacy.proposal_id } as never);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(String(r.detail)).toMatch(/can no longer be applied\. Nothing was changed/);
    expect(writes, 'no system event, no register, no turn').toEqual([]);
  });

  it('CONTRAST: a held add-option handle is routed to the held confirm, not the proposal store (no reader ⇒ it refuses as not waiting, and writes nothing)', async () => {
    const writes: string[] = [];
    const d: InternalDispatch = async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h0' } };
      writes.push(path);
      return { status: 200, json: {} };
    };
    const caps = createAgentCapabilities(d, new ProposalStore());
    const r = await caps.authoriseChange(ctx, { proposal_id: 'gmh_0123456789ab' } as never);
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'unknown_proposal' }));
    expect(writes).toEqual([]);
  });
});
