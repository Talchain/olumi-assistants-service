/**
 * ⭐ THE SUGGESTION PREVIEW (DL 5941839936): a display projection of the STORED proposal a consent chip names, with ids
 * and the band only. Pure rows; the route rows live with the Strengthen press (`strengthen-press.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { proposalPreviewFor } from '../turn-context/proposal-preview.js';
import { createProposal } from '../proposal.js';

const graph = { nodes: [{ id: 'a', kind: 'factor' }, { id: 'b', kind: 'factor' }, { id: 'goal', kind: 'goal' }], edges: [{ from: 'a', to: 'b' }] };
const make = (operations: { op: string; path: string; value?: unknown }[]) => createProposal({
  scenario_id: 'scn', user_id: null, base_graph_identity_hash: 'h', operations: operations as never,
  provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'card' });

describe('proposalPreviewFor', () => {
  it('a link strength → ids and the band ONLY (no magnitude, expectation, author or reason)', () => {
    const p = make([{ op: 'set_link_strength', path: 'a::b', value: { magnitude: 0.5, intent: 'set', expected: { mean: 0.25 }, band: 'moderate', author: 'model_proposed' } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toEqual({ proposal_id: p.proposal_id, ops: [{ op: 'set_link_strength', from_id: 'a', to_id: 'b', band: 'moderate' }] });
  });
  it('a new link and an edited link → their ends; a figure, level or target op has nothing to draw and is left out', () => {
    const p = make([{ op: 'add_edge', path: 'a::goal', value: { effect_direction: 'positive', magnitude: 0.5 } }, { op: 'update_edge', path: 'a::b', value: { x: 1 } },
      { op: 'set_factor_value', path: 'a', value: { value: 3 } }, { op: 'set_goal_target', path: 'goal', value: { target: 1 } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)?.ops).toEqual([{ op: 'add_edge', from_id: 'a', to_id: 'goal' }, { op: 'update_edge', from_id: 'a', to_id: 'b' }]);
  });
  it('NEGATIVES: another proposal\'s id, no proposal, no graph → none', () => {
    const p = make([{ op: 'add_edge', path: 'a::b' }]);
    expect(proposalPreviewFor('prop_other', p, graph)).toBeUndefined();
    expect(proposalPreviewFor(p.proposal_id, undefined, graph)).toBeUndefined();
    expect(proposalPreviewFor(p.proposal_id, p, null)).toBeUndefined();
  });
  it('FAIL CLOSED per op: an end the graph lacks, a key that is not exactly two ids, an unknown band → left out; nothing left → none', () => {
    const p = make([{ op: 'add_edge', path: 'a::missing' }, { op: 'add_edge', path: 'a::b::goal' }, { op: 'add_edge', path: '::b' },
      { op: 'set_link_strength', path: 'a::b', value: { band: 'huge' } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toBeUndefined();
    const mixed = make([{ op: 'add_edge', path: 'a::missing' }, { op: 'add_edge', path: 'a::goal' }]);
    expect(proposalPreviewFor(mixed.proposal_id, mixed, graph)?.ops).toEqual([{ op: 'add_edge', from_id: 'a', to_id: 'goal' }]);
  });
  it('only figures (nothing structural) → no preview', () => {
    const p = make([{ op: 'set_factor_value', path: 'a', value: { value: 3 } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toBeUndefined();
  });
});
