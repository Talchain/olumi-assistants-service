/**
 * ⭐ S-D — the ONE proposal object, its amendment, its lifecycle and its words (lane EDIT-PANEL; design
 * inflight/lane-edit-panel-DESIGN.md). Pure rows; the route-level journey is `held-proposal-user-in-control-seam.test.ts`.
 * Fixtures are the add-risk door's REAL batch shape (`add-risk-transaction.ts` + `hypothesisEdgeValue`).
 */
import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { findForbiddenPhraseHit } from '../../../compose/forbidden-user-facing-phrases.js';
import { GM_HELD_HANDLER_ID } from '../../../handlers/edit-graph-referee-gate.js';
import { hypothesisEdgeValue } from '../../../routing/add-option-transaction.js';
import { tryShortConfirmResume } from '../../../routing/deterministic-short-confirm.js';
import type { PendingAction } from '../../../session/pending-action.js';
import { amendHeldOperations, parseProposalEdits, proposalEditsDigest, readUserEdits } from '../amend.js';
import { FIELD_CLASS_BY_OP, declinedProposalOf, heldChangeName, productHoldRecord, proposalFieldsWire } from '../record.js';
import { PROPOSAL_IDLE_TTL_MS, reconcileHeldProposals, refreshedHold } from '../lifecycle.js';
import { editsRefusedSentence, heldDeclineSentence, heldLapseSentence, userEditsReceipt } from '../reply.js';

const SID = '5c0e1d2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const graph = {
  nodes: [
    { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
    { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
    { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
  ],
  edges: [
    { from: 'dec_x', to: 'opt_a', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_a', to: 'fac_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'fac_price', to: 'goal_x', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
};
const HASH = computeAnalysisAffectingGraphHash(graph as never)!;
const riskOps = () => [
  { op: 'add_node', path: 'risk_competitive_response', value: { id: 'risk_competitive_response', kind: 'risk', label: 'Competitive response' } },
  { op: 'add_edge', path: 'risk_competitive_response::goal_x', value: hypothesisEdgeValue('risk_competitive_response', 'goal_x', 'negative') },
  { op: 'add_edge', path: 'fac_price::risk_competitive_response', value: hypothesisEdgeValue('fac_price', 'risk_competitive_response', 'positive') },
];
const hold = (over: Partial<PendingAction> & { ops?: unknown[]; ref?: string } = {}): PendingAction => ({
  id: over.id ?? '11111111-1111-4111-8111-111111111111',
  scenario_id: SID,
  chip_id: over.ref ?? 'gmh_aaaaaaaaaaaa',
  action: {
    kind: 'apply_proposed_change', proposal_ref: over.ref ?? 'gmh_aaaaaaaaaaaa',
    inline_patch: { handler_id: GM_HELD_HANDLER_ID, apply_wiring: 'held_execute_v1', operations: over.ops ?? riskOps(), operations_count: 3 },
    public_label: 'Approve 3 changes',
    public_message: "Yes, add risk 'Competitive response', link 'Competitive response' to 'Revenue' and link 'Price' to 'Competitive response'.",
  } as PendingAction['action'],
  preconditions: { graph_hash: HASH },
  expires_at_turn_count: 4,
  expires_at_iso: '2099-01-01T00:00:00.000Z',
  emitted_at_iso: '2026-10-07T09:05:55.000Z',
  ...over,
});
const TO_GOAL = 'link_strength:risk_competitive_response::goal_x';
const FROM_PRICE = 'link_strength:fac_price::risk_competitive_response';

describe('the ONE proposal object (record.ts)', () => {
  it('a held risk projects one field per held link — bound to the op path — with whose each value is, and its missing level', () => {
    const r = productHoldRecord(hold(), graph)!;
    expect(r.proposal_id).toBe('gmh_aaaaaaaaaaaa');
    expect(r.revision).toBe('11111111-1111-4111-8111-111111111111');
    expect(r.fields.map((f) => f.field_id)).toEqual([TO_GOAL, FROM_PRICE]);
    expect(r.fields[0]).toEqual(expect.objectContaining({ from_label: 'Competitive response', to_label: 'Revenue', direction: 'negative',
      current: { band: 'strong', source: 'placeholder' }, editable: true }));
    expect(r.missing).toEqual([{ node_id: 'risk_competitive_response', label: 'Competitive response', kind: 'risk', what: 'level_today' }]);
    expect(r.approve_action.id).toBe('agent-approve-proposal:gmh_aaaaaaaaaaaa');
    expect(r.approve_action.message).toBe(hold().action.kind === 'apply_proposed_change' ? (hold().action as { public_message: string }).public_message : '');
    expect(r.decline_action.id).toBe('agent-decline-proposal:gmh_aaaaaaaaaaaa');
  });

  it('whose a link is comes from its own provenance: an estimate, the user’s, and by-definition (not editable)', () => {
    const ops = riskOps();
    (ops[1]!.value as Record<string, unknown>)['provenance'] = { source: 'cee_hypothesis', magnitude: 'olumi_estimate' };
    (ops[2]!.value as Record<string, unknown>)['provenance'] = { source: 'user_specified' };
    const r = productHoldRecord(hold({ ops }), graph)!;
    expect(r.fields.map((f) => f.current.source)).toEqual(['estimate', 'yours']);
    (ops[1]!.value as Record<string, unknown>)['provenance'] = { source: 'cee_hypothesis', definitional: true };
    expect(productHoldRecord(hold({ ops }), graph)!.fields[0]!.editable).toBe(false);
  });

  it('CONTROL: not a product hold, expired, unpinned, or a hold that adds nothing (H4/H5, slice 2) → no record', () => {
    expect(productHoldRecord(hold({ ref: 'prop_abcdef' }), graph)).toBeUndefined();
    expect(productHoldRecord(hold({ expires_at_iso: '2020-01-01T00:00:00.000Z' }), graph)).toBeUndefined();
    expect(productHoldRecord(hold({ preconditions: {} }), graph)).toBeUndefined();
    expect(productHoldRecord(hold({ ops: [riskOps()[1]!] }), graph)).toBeUndefined();
  });

  it('every op either dialect holds is classified (a new op is a compile error until it is)', () => {
    expect(FIELD_CLASS_BY_OP.add_edge).toBe('link_strength');
    expect(Object.values(FIELD_CLASS_BY_OP).filter((v) => v === 'link_strength')).toHaveLength(1);
  });

  it('RED (Codex r1 P1 on #2743): the digest binds what the panel SHOWS: a rename under the same analysis hash changes it; the same model and hold keep it', () => {
    const r = productHoldRecord(hold(), graph)!;
    expect(r.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(productHoldRecord(hold(), graph)!.digest, 'stable for the same hold on the same model').toBe(r.digest);
    const renamed = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'fac_price' ? { ...n, label: 'Advertising spend' } : n)) };
    expect(computeAnalysisAffectingGraphHash(renamed as never), 'precondition: the hash cannot see a rename').toBe(HASH);
    const after = productHoldRecord(hold(), renamed)!;
    expect(after.fields.find((f) => f.field_id === FROM_PRICE)!.from_label).toBe('Advertising spend');
    expect(after.digest).not.toBe(r.digest);
    expect(productHoldRecord(hold({ id: '22222222-2222-4222-8222-222222222222' }), graph)!.digest, 'another revision').not.toBe(r.digest);
  });

  it('the wire carries only proposals pinned to the model the user sees', () => {
    const r = productHoldRecord(hold(), graph)!;
    expect(proposalFieldsWire([r], HASH)!.proposals.map((p) => p.proposal_id)).toEqual(['gmh_aaaaaaaaaaaa']);
    expect(proposalFieldsWire([r], 'f'.repeat(64))).toBeUndefined();
    expect(proposalFieldsWire([], HASH)).toBeUndefined();
  });

  it('names the change in the user’s words, and reads only the typed decline press', () => {
    expect(heldChangeName(hold())).toBe("the risk 'Competitive response'");
    expect(declinedProposalOf('agent-decline-proposal:gmh_aaaaaaaaaaaa')).toBe('gmh_aaaaaaaaaaaa');
    expect(declinedProposalOf('agent-decline-proposal:prop_1234')).toBeUndefined();
    expect(declinedProposalOf('Not now.')).toBeUndefined();
  });
});

describe('approve-with-edits (amend.ts)', () => {
  const record = () => productHoldRecord(hold(), graph)!;

  it('RED-spec: the named link gets the user’s band (midpoint, signed by the held direction), the user’s provenance and no `defaulted`; the other link is untouched byte for byte', () => {
    const r = amendHeldOperations(record(), [{ field_id: TO_GOAL, band: 'very_strong' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const edited = r.operations[1]!.value as Record<string, unknown>;
    expect((edited['strength'] as { mean: number }).mean).toBeCloseTo(-0.85, 12);
    expect(edited['provenance']).toEqual({ source: 'user_specified' });
    expect(Object.hasOwn(edited, 'defaulted')).toBe(false);
    expect(r.operations[2]).toEqual(riskOps()[2]);
    expect(r.operations[0]).toEqual(riskOps()[0]);
    expect(r.userEdits).toEqual([
      { field_id: TO_GOAL, from_label: 'Competitive response', to_label: 'Revenue', olumi: { band: 'strong', source: 'placeholder' }, user: { band: 'very_strong' } },
      { field_id: FROM_PRICE, from_label: 'Price', to_label: 'Competitive response', olumi: { band: 'strong', source: 'placeholder' }, user: null },
    ]);
    expect(readUserEdits(JSON.parse(JSON.stringify(r.userEdits)))).toEqual(r.userEdits);
  });

  it('re-stating the band a link already sits in keeps its strength and makes it the user’s (no figure moves unseen)', () => {
    const r = amendHeldOperations(record(), [{ field_id: TO_GOAL, band: 'strong' }]);
    if (!r.ok) throw new Error(r.reason);
    const v = r.operations[1]!.value as Record<string, unknown>;
    expect(v['strength']).toEqual((riskOps()[1]!.value as Record<string, unknown>)['strength']);
    expect(v['provenance']).toEqual({ source: 'user_specified' });
  });

  it('NEGATIVE: unknown field, duplicate field, out-of-vocabulary band, a by-definition link → refused whole (never a partial amendment)', () => {
    expect(amendHeldOperations(record(), [{ field_id: 'link_strength:fac_price::goal_x', band: 'strong' }])).toEqual({ ok: false, reason: 'unknown_field' });
    expect(amendHeldOperations(record(), [{ field_id: TO_GOAL, band: 'strong' }, { field_id: TO_GOAL, band: 'slight' }])).toEqual({ ok: false, reason: 'duplicate_field' });
    expect(amendHeldOperations(record(), [{ field_id: TO_GOAL, band: 'enormous' as never }])).toEqual({ ok: false, reason: 'band_not_allowed' });
    const ops = riskOps();
    (ops[1]!.value as Record<string, unknown>)['provenance'] = { definitional: true };
    expect(amendHeldOperations(productHoldRecord(hold({ ops }), graph)!, [{ field_id: TO_GOAL, band: 'slight' }])).toEqual({ ok: false, reason: 'not_editable' });
  });

  it('parse is by shape; the digest binds the values (same press, other values → another request)', () => {
    const SHOWN = 'd'.repeat(32);
    expect(parseProposalEdits(undefined)).toBeUndefined();
    expect(parseProposalEdits({ proposal_id: 'gmh_aaaaaaaaaaaa', digest: SHOWN, graph_hash: HASH, fields: [] })).toBeNull(); // no revision
    // no digest of what the panel showed (Codex r1 P1 on #2743): the hash and revision alone do not bind the words on screen
    expect(parseProposalEdits({ proposal_id: 'gmh_aaaaaaaaaaaa', revision: 'r1', graph_hash: HASH, fields: [] })).toBeNull();
    const a = parseProposalEdits({ proposal_id: 'gmh_aaaaaaaaaaaa', revision: 'r1', digest: SHOWN, graph_hash: HASH, fields: [{ field_id: TO_GOAL, band: 'slight' }] })!;
    const b = parseProposalEdits({ proposal_id: 'gmh_aaaaaaaaaaaa', revision: 'r1', digest: SHOWN, graph_hash: HASH, fields: [{ field_id: TO_GOAL, band: 'strong' }] })!;
    expect(a).not.toBeNull();
    expect(proposalEditsDigest(a)).not.toBe(proposalEditsDigest(b));
    expect(proposalEditsDigest(a), 'what was shown is part of the request').not.toBe(proposalEditsDigest({ ...a, digest: 'e'.repeat(32) }));
    expect(proposalEditsDigest(a)).toBe(proposalEditsDigest({ ...a, fields: [...a.fields] }));
  });
});

describe('the ONE lifecycle (lifecycle.ts): held until approved or declined, never silently gone', () => {
  const base = { approved: new Set<string>(), declined: new Set<string>(), graph, graphHash: HASH, scenarioId: SID, requestId: 'req', nowMs: Date.parse('2026-10-07T09:14:06.000Z') };

  it('RED-spec (D-08): a hold whose stored count ran down to 1 is carried with a fresh lifetime on the same model', () => {
    const h = hold({ expires_at_turn_count: 1, expires_at_iso: '2026-10-07T09:15:55.000Z' });
    const r = reconcileHeldProposals({ ...base, atStart: [h], latest: [h] });
    expect(r.lapsed).toEqual([]);
    expect(r.carried.map((c) => c.chip_id)).toEqual(['gmh_aaaaaaaaaaaa']);
    expect(r.carried[0]!.expires_at_turn_count).toBeGreaterThan(4);
    expect(Date.parse(r.carried[0]!.expires_at_iso) - base.nowMs).toBe(PROPOSAL_IDLE_TTL_MS);
    expect(r.carried[0]!.id, 'the same revision').toBe(h.id);
  });

  it('approved or declined → gone and NOT said; already in the model → gone and not said', () => {
    const h = hold();
    expect(reconcileHeldProposals({ ...base, atStart: [h], latest: [h], approved: new Set([h.chip_id]) })).toEqual({ carried: [], lapsed: [] });
    expect(reconcileHeldProposals({ ...base, atStart: [h], latest: [h], declined: new Set([h.chip_id]) })).toEqual({ carried: [], lapsed: [] });
    const applied = { ...graph, nodes: [...graph.nodes, { id: 'risk_competitive_response', kind: 'risk', label: 'Competitive response' }],
      edges: [...graph.edges, { from: 'risk_competitive_response', to: 'goal_x' }, { from: 'fac_price', to: 'risk_competitive_response' }] };
    expect(reconcileHeldProposals({ ...base, atStart: [h], latest: [], graph: applied }).lapsed).toEqual([]);
  });

  it('a hold found at the start and gone from the latest row is SAID — and never put back (another request may have declined it)', () => {
    const h = hold();
    const r = reconcileHeldProposals({ ...base, atStart: [h], latest: [] });
    expect(r.carried).toEqual([]);
    expect(r.lapsed.map((l) => l.reason)).toEqual(['gone']);
  });

  it('past its lifetime → lapsed and said; the model moved under it and its batch no longer referees → lapsed and said', () => {
    const idle = hold({ expires_at_iso: '2026-10-06T00:00:00.000Z' });
    expect(reconcileHeldProposals({ ...base, atStart: [idle], latest: [idle] }).lapsed.map((l) => l.reason)).toEqual(['idle']);
    // The goal the risk threatens was removed: its link has nowhere to go.
    const moved = { ...graph, nodes: graph.nodes.filter((n) => n.id !== 'goal_x'), edges: graph.edges.filter((e) => e.to !== 'goal_x') };
    const r = reconcileHeldProposals({ ...base, atStart: [hold()], latest: [hold()], graph: moved, graphHash: computeAnalysisAffectingGraphHash(moved as never)! });
    expect(r.lapsed.map((l) => l.reason)).toEqual(['model_changed']);
    expect(r.carried).toEqual([]);
  });

  it('CONTROL: the model moved but the batch still referees → re-pinned to the new model and carried', () => {
    const moved = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'opt_a' ? { ...n, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : n)) };
    const movedHash = computeAnalysisAffectingGraphHash(moved as never)!;
    expect(movedHash).not.toBe(HASH);
    const r = reconcileHeldProposals({ ...base, atStart: [hold()], latest: [hold()], graph: moved, graphHash: movedHash });
    expect(r.lapsed).toEqual([]);
    expect(r.carried.map((c) => c.preconditions.graph_hash)).toEqual([movedHash]);
  });
});

describe('the words (reply.ts) and the conventional bare-confirm window', () => {
  it('says what the user set vs Olumi’s, and what was left as Olumi’s; no forbidden phrase', () => {
    const text = userEditsReceipt([
      { field_id: TO_GOAL, from_label: 'Competitive response', to_label: 'Revenue', olumi: { band: 'strong', source: 'placeholder' }, user: { band: 'very_strong' } },
      { field_id: 'x', from_label: 'Price', to_label: 'Demand', olumi: { band: 'moderate', source: 'estimate' }, user: { band: 'slight' } },
      { field_id: FROM_PRICE, from_label: 'Price', to_label: 'Competitive response', olumi: { band: 'strong', source: 'placeholder' }, user: null },
    ]);
    expect(text).toBe('You set how strongly "Competitive response" affects "Revenue": very strong. Olumi had only a placeholder there, not an estimate. '
      + 'You set how strongly "Price" affects "Demand": slight; Olumi\'s estimate was moderate. '
      + 'Left as Olumi\'s placeholder: "Price" → "Competitive response".');
    for (const t of [text, heldDeclineSentence("the risk 'X'"), editsRefusedSentence('stale'), editsRefusedSentence('refused'),
      ...(['model_changed', 'idle', 'over_cap', 'gone'] as const).map((r) => heldLapseSentence("the risk 'X'", r))]) {
      expect(findForbiddenPhraseHit(t), t).toBeNull();
      expect(t, t).not.toMatch(/—|\b(best|winner|recommend|leader|ahead|beats)\b/i);
    }
  });

  it('a hold KEPT by the Agent lane (marked) never binds a bare "yes" on the conventional route — retention is not consent; an unmarked hold is untouched', async () => {
    const now = Date.parse('2026-10-07T10:00:00.000Z');
    // Kept by the Agent lane's lifecycle (marked): offered a minute ago, or an hour ago, a bare "yes" binds neither.
    for (const emitted of ['2026-10-07T09:59:00.000Z', '2026-10-07T09:00:00.000Z']) {
      const kept = refreshedHold(hold({ emitted_at_iso: emitted }), now);
      const bare = tryShortConfirmResume({ message: 'yes', pendingActions: [kept], currentTurnIndex: 3, nowMs: now });
      expect(bare.matched && bare.dispatch === 'pending_action', emitted).toBe(false);
    }
    // (Its exact card words resolve it by the label pick, `turn-executor.ts` `tryProposalOrdinalSelect`, as before —
    // the route-level seam test approves kept proposals across turns through that path.)
    // CONTROL: an UNMARKED hold (every conventional hold, every existing fixture) still binds a bare "yes" exactly as before.
    const unmarked = hold({ emitted_at_iso: '2026-10-07T09:59:00.000Z', expires_at_iso: '2099-01-01T00:00:00.000Z' });
    const legacy = tryShortConfirmResume({ message: 'yes', pendingActions: [unmarked], currentTurnIndex: 3, nowMs: now });
    expect(legacy.matched && legacy.dispatch === 'pending_action' ? legacy.pending.chip_id : undefined).toBe('gmh_aaaaaaaaaaaa');
  });
});
