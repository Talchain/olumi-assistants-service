/**
 * ⭐ THE SUGGESTION PREVIEW (DL 5941839936): a display projection of the STORED proposal a consent chip names, with ids
 * and the band only. Pure rows; the route rows live with the Strengthen press (`strengthen-press.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { previewBesideItsChip, proposalPreviewFor } from '../turn-context/proposal-preview.js';
import { readFileSync } from 'node:fs';
import { createProposal } from '../proposal.js';

const graph = { nodes: [{ id: 'a', kind: 'factor' }, { id: 'b', kind: 'factor' }, { id: 'goal', kind: 'goal' }, { id: 'winner', kind: 'option' }], edges: [{ from: 'a', to: 'b' }] };
const make = (operations: { op: string; path: string; value?: unknown }[]) => createProposal({
  scenario_id: 'scn', user_id: null, base_graph_identity_hash: 'h', operations: operations as never,
  provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'card' });

describe('proposalPreviewFor', () => {
  it('a link strength → ids, the band and whether it is a KEEP, ONLY (no magnitude, expectation, author or reason)', () => {
    const p = make([{ op: 'set_link_strength', path: 'a::b', value: { magnitude: 0.5, intent: 'set', expected: { mean: 0.25 }, band: 'moderate', author: 'model_proposed' } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toEqual({ proposal_id: p.proposal_id, ops: [{ op: 'set_link_strength', from_id: 'a', to_id: 'b', band: 'moderate', keeps: false }] });
  });
  it('Codex P1 #1: a KEEP at the current band (`confirm_current`) is marked `keeps: true`, never drawn as a change', () => {
    const p = make([{ op: 'set_link_strength', path: 'a::b', value: { magnitude: 0.25, intent: 'confirm_current', band: 'moderate' } },
      { op: 'update_edge', path: 'a::goal', value: { magnitude: 0.5, intent: 'confirm_current', direction_intent: 'preserve', expected: { effect_direction: 'positive' }, band: 'strong' } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)?.ops).toEqual([
      { op: 'set_link_strength', from_id: 'a', to_id: 'b', band: 'moderate', keeps: true },
      { op: 'update_edge', from_id: 'a', to_id: 'goal', band: 'strong', keeps: true, reverses: false }]);
  });
  it('Codex P1 #2: an edited link carries the band a Yes writes (strong ≠ very strong) and whether it reverses; a new link its band', () => {
    const edit = (band: string, dir: string) => make([{ op: 'update_edge', path: 'a::b', value: { magnitude: 0.7, intent: 'set', direction_intent: dir, expected: { effect_direction: 'positive' }, band } }]);
    const strong = edit('strong', 'preserve'); const very = edit('very strong', 'negative');
    expect(proposalPreviewFor(strong.proposal_id, strong, graph)?.ops).toEqual([{ op: 'update_edge', from_id: 'a', to_id: 'b', band: 'strong', keeps: false, reverses: false }]);
    expect(proposalPreviewFor(very.proposal_id, very, graph)?.ops).toEqual([{ op: 'update_edge', from_id: 'a', to_id: 'b', band: 'very strong', keeps: false, reverses: true }]);
    const added = make([{ op: 'add_edge', path: 'a::goal', value: { effect_direction: 'positive', magnitude: 0.5 } }, { op: 'add_edge', path: 'winner::a', value: { link_for_level: true } }]);
    const ops = proposalPreviewFor(added.proposal_id, added, graph)?.ops;
    expect(ops?.[0]).toMatchObject({ op: 'add_edge', from_id: 'a', to_id: 'goal' });
    expect((ops?.[0] as { band?: string }).band, 'the band its stored strength falls in').toBeDefined();
    expect(ops?.[1], 'a level link carries no strength, so no band').toEqual({ op: 'add_edge', from_id: 'winner', to_id: 'a' });
    expect(JSON.stringify(ops)).not.toContain('magnitude');
  });
  it('Codex P1 #3: an option taken out of (or put back into) the comparison is previewed by option id + status; a non-option id is not', () => {
    const out = make([{ op: 'set_option_status', path: 'winner', value: { status: 'removed', expected_status: 'feasible' } }]);
    expect(proposalPreviewFor(out.proposal_id, out, graph)?.ops).toEqual([{ op: 'set_option_status', option_id: 'winner', status: 'removed' }]);
    const notOption = make([{ op: 'set_option_status', path: 'a', value: { status: 'removed' } }]);
    expect(proposalPreviewFor(notOption.proposal_id, notOption, graph)).toBeUndefined();
    const unknown = make([{ op: 'set_option_status', path: 'winner', value: { status: 'archived' } }]);
    expect(proposalPreviewFor(unknown.proposal_id, unknown, graph)).toBeUndefined();
  });
  it('a new link and an edited link → their ends; a figure, level or target op has nothing to draw and is left out', () => {
    const p = make([{ op: 'add_edge', path: 'a::goal' }, { op: 'update_edge', path: 'a::b', value: { intent: 'set', band: 'weak', direction_intent: 'preserve', expected: { effect_direction: 'positive' } } },
      { op: 'set_factor_value', path: 'a', value: { value: 3 } }, { op: 'set_goal_target', path: 'goal', value: { target: 1 } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)?.ops).toEqual([{ op: 'add_edge', from_id: 'a', to_id: 'goal' }, { op: 'update_edge', from_id: 'a', to_id: 'b', band: 'weak', keeps: false, reverses: false }]);
  });
  it('NEGATIVES: another proposal\'s id, no proposal, no graph → none', () => {
    const p = make([{ op: 'add_edge', path: 'a::b' }]);
    expect(proposalPreviewFor('prop_other', p, graph)).toBeUndefined();
    expect(proposalPreviewFor(p.proposal_id, undefined, graph)).toBeUndefined();
    expect(proposalPreviewFor(p.proposal_id, p, null)).toBeUndefined();
  });
  it('FAIL CLOSED per op: an end the graph lacks, a key that is not exactly two ids, an unknown or missing band → left out; nothing left → none', () => {
    const p = make([{ op: 'add_edge', path: 'a::missing' }, { op: 'add_edge', path: 'a::b::goal' }, { op: 'add_edge', path: '::b' },
      { op: 'set_link_strength', path: 'a::b', value: { band: 'huge' } }, { op: 'update_edge', path: 'a::b', value: { intent: 'set' } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toBeUndefined();
    const mixed = make([{ op: 'add_edge', path: 'a::missing' }, { op: 'add_edge', path: 'a::goal' }]);
    expect(proposalPreviewFor(mixed.proposal_id, mixed, graph)?.ops).toEqual([{ op: 'add_edge', from_id: 'a', to_id: 'goal' }]);
  });
  it('only figures (nothing structural) → no preview', () => {
    const p = make([{ op: 'set_factor_value', path: 'a', value: { value: 3 } }]);
    expect(proposalPreviewFor(p.proposal_id, p, graph)).toBeUndefined();
  });
});

describe('the preview rides only beside its own consent chip, after the final egress (Codex P1 #4)', () => {
  const chipIdFor = (id: string) => `agent-approve-proposal:${id}`;
  const preview = { proposal_id: 'prop_abc123', ops: [{ op: 'add_edge' as const, from_id: 'winner', to_id: 'a' }] };
  it('kept, by identity, when the shipped chips still hold ITS chip; the ids are never touched', () => {
    expect(previewBesideItsChip(preview, chipIdFor, [{ id: 'agent-approve-proposal:prop_abc123' }, { id: 'agent-amend-proposal' }])).toBe(preview);
  });
  it('dropped when the egress removed its chip, kept another proposal\'s, or fell back to an envelope with no chips', () => {
    expect(previewBesideItsChip(preview, chipIdFor, [{ id: 'agent-amend-proposal' }])).toBeUndefined();
    expect(previewBesideItsChip(preview, chipIdFor, [{ id: 'agent-approve-proposal:prop_other' }])).toBeUndefined();
    expect(previewBesideItsChip(preview, chipIdFor, [])).toBeUndefined();
    expect(previewBesideItsChip(preview, chipIdFor, undefined)).toBeUndefined();
    expect(previewBesideItsChip(undefined, chipIdFor, [{ id: 'agent-approve-proposal:prop_abc123' }])).toBeUndefined();
  });
  it('the route attaches it AFTER the final egress (source order), so the egress walk never sees or half-scrubs it', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const egress = src.indexOf('enforceLeaderLicenceAtFinalEgress(wireBody');
    const attach = src.indexOf('proposal_preview: preview');
    expect(egress).toBeGreaterThan(0);
    expect(attach).toBeGreaterThan(egress);
    expect(src.split('proposal_preview:').length - 1, 'one attach site').toBe(1);
  });
});
