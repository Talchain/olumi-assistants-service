import { timingGated } from '../../../../../tests/helpers/scaling-ratio.js';
/**
 * ⭐ S-D — the ONE proposal object, its amendment, its lifecycle and its words (lane EDIT-PANEL; design
 * inflight/lane-edit-panel-DESIGN.md). Pure rows; the route-level journey is `held-proposal-user-in-control-seam.test.ts`.
 * Fixtures are the add-risk door's REAL batch shape (`add-risk-transaction.ts` + `hypothesisEdgeValue`).
 */
import { describe,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';

import { findForbiddenPhraseHit } from '../../../compose/forbidden-user-facing-phrases.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GM_HELD_HANDLER_ID } from '../../../handlers/edit-graph-referee-gate.js';
import { hypothesisEdgeValue } from '../../../routing/add-option-transaction.js';

import type { PendingAction } from '../../../session/pending-action.js';
import { amendHeldOperations,parseProposalEdits,proposalEditsDigest,readUserEdits } from '../amend.js';
import { PROPOSAL_IDLE_TTL_MS,reconcileHeldProposals } from '../lifecycle.js';
import { FIELD_CLASS_BY_OP,declinedProposalOf,heldChangeName,issuedTurnIdsForProposalRecords,productHoldRecord,proposalFieldsWire,proposalIssuances,proposalRecord,type ProposalIssuingRow } from '../record.js';
import { heldCardUnderReview } from '../still-applies.js';
import { editsRefusedSentence,heldDeclineSentence,heldLapseSentence,userEditsReceipt } from '../reply.js';

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

describe('P53 bounded issuing-answer lookup', () => {
  const emittedMs = Date.parse(hold().emitted_at_iso);
  const answer = (turnId: string, offsetMs: number, pending?: readonly unknown[]): ProposalIssuingRow => ({
    turn_id: turnId, created_at: new Date(emittedMs + offsetMs).toISOString(),
    request_hash: `agent_turn:${turnId}`, user_message: 'Continue the shared reasoning.', assistant_message: 'The change is held.',
    ...(pending === undefined ? {} : { pending_actions: pending }),
  });

  it('P53-r2-a: full microseconds order the issuer before a carry row whose turn id sorts first', async () => {
    const pending = hold({ emitted_at_iso: '2026-10-08T00:45:38.000000Z' });
    const record = proposalRecord(pending, graph)!;
    const rows = [
      { ...answer('a-carry', 0, [pending]), created_at: '2026-10-08T00:45:38.000900Z' },
      { ...answer('z-issuer', 0, [pending]), created_at: '2026-10-08 00:45:38.000100+00' },
      { ...answer('predecessor', 0, []), created_at: '2026-10-08T00:45:35.999999Z' },
    ];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBe('z-issuer');
  });

  it('P53-r2-b: the oldest carry within +1 s stays unknown when the loaded window is full', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const rows = [answer('later-carry', 2000, [pending]), answer('oldest-carry', 1000, [pending])];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, rows.length);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
  });

  it('P53-r2-c: identical full timestamps in PostgreSQL and ISO forms are ambiguous', async () => {
    const pending = hold({ emitted_at_iso: '2026-10-08T00:45:38.445629Z' });
    const record = proposalRecord(pending, graph)!;
    const rows = [
      { ...answer('a-carry', 0, [pending]), created_at: '2026-10-08T00:45:38.445629Z' },
      { ...answer('z-issuer', 0, [pending]), created_at: '2026-10-08 00:45:38.445629+00' },
    ];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
  });

  it('P53-r2-d: complete history binds an issuer that is its first public answer', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const rows = [answer('later-carry', 1000, [pending]), answer('first-issuer', 0, [pending])];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBe('first-issuer');
  });

  it('the inclusive skew cutoff preserves emission microseconds', async () => {
    const pending = hold({ emitted_at_iso: '2026-10-08T00:45:38.000100Z' });
    const record = proposalRecord(pending, graph)!;
    const rows = [
      { ...answer('issuer', 0, [pending]), created_at: '2026-10-08 00:45:36.000100+00' },
      { ...answer('predecessor', 0, []), created_at: '2026-10-08T00:45:36.000099Z' },
    ];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBe('issuer');
  });

  it('a tied predecessor cannot prove issuance even when the candidate timestamp is unique', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const rows = [answer('candidate', 0), answer('a-predecessor', -3000, [pending]), answer('z-predecessor', -3000, [])];
    const read = vi.fn(async () => ({ pending_actions: [pending] }));
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200, read);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('completeness counts raw loaded rows including claims and internal turns', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const rows = [answer('issuer', 0, [pending]), answer('claim:claim', 1000),
      { ...answer('internal', -3000), request_hash: 'sha256:internal' }];
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, rows.length);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
  });

  it.each(['carrying', 'missing row', 'missing carriers', 'failed read', 'not carrying'] as const)(
    'a %s predecessor is verified with at most two reads in a full window', async state => {
      const pending = hold(); const record = proposalRecord(pending, graph)!;
      const rows = [answer('candidate', 0), answer('predecessor', -3000)];
      const read = vi.fn(async (turnId: string) => {
        if (turnId === 'candidate') return { pending_actions: [pending] };
        if (state === 'failed read') throw new Error('Predecessor unavailable');
        if (state === 'missing row') return null;
        if (state === 'missing carriers') return {};
        return { pending_actions: state === 'carrying' ? [pending] : [] };
      });
      const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, rows.length, read);
      expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id)
        .toBe(state === 'not carrying' ? 'candidate' : null);
      expect(read.mock.calls).toEqual([['candidate'], ['predecessor']]);
    },
  );

  it('the inclusive 2 s skew boundary proves the earliest public answer starts the carry run, with two reads and the same digest', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const rows = [answer('later', 1000), answer('skew-boundary', -2000), answer('too-early', -2001),
      answer('claim:claim', -1500), { ...answer('internal', -1750), request_hash: 'sha256:internal' }];
    const read = vi.fn(async (turnId: string) => ({ pending_actions: turnId === 'too-early' ? [] : [pending] }));
    const before = JSON.stringify({ record, rows });
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200, read);
    expect([...issued]).toEqual([[record.revision, 'skew-boundary']]);
    expect(read.mock.calls).toEqual([['skew-boundary'], ['too-early']]);
    const bound = proposalFieldsWire([record], HASH, issued)!;
    expect(bound.proposals[0]!.issued_turn_id).toBe('skew-boundary');
    expect(bound.proposals[0]!.digest).toBe(record.digest);
    expect({ ...bound.proposals[0], issued_turn_id: null }).toEqual(proposalFieldsWire([record], HASH)!.proposals[0]);
    expect(JSON.stringify({ record, rows })).toBe(before);
  });

  it('a candidate carrying another revision stays unknown, even when a later answer has the requested hold', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const other = hold({ id: '22222222-2222-4222-8222-222222222222' });
    const read = vi.fn(async (turnId: string) => ({ pending_actions: turnId === 'first' ? [other] : [pending] }));
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), [answer('later', 5000), answer('first', 0)], 200, read);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
    expect(read.mock.calls).toEqual([['first']]);
  });

  it('one failed candidate read leaves only that hold unknown and verifies the other hold once', async () => {
    const first = hold();
    const second = hold({ id: '22222222-2222-4222-8222-222222222222', ref: 'gmh_bbbbbbbbbbbb',
      emitted_at_iso: new Date(emittedMs + 10_000).toISOString() });
    const records = [proposalRecord(first, graph)!, proposalRecord(second, graph)!];
    const read = vi.fn(async (turnId: string) => {
      if (turnId === 'first') throw new Error('Exact row unavailable');
      return { pending_actions: [first, second] };
    });
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances(records, [first, second]),
      [answer('later', 20_000), answer('second', 10_000), answer('second-predecessor', 7000, [first]), answer('first', 0)], 200, read);
    expect(proposalFieldsWire(records, HASH, issued)!.proposals.map(p => [p.revision, p.issued_turn_id]))
      .toEqual([[first.id, null], [second.id, 'second']]);
    expect(read.mock.calls).toEqual([['first'], ['second']]);
  });

  it.each([
    ['invalid emission', 'not-a-date', [answer('first', 0)]],
    ['undated rows', hold().emitted_at_iso, [{ ...answer('first', 0), created_at: undefined }]],
    ['mixed undated history', hold().emitted_at_iso, [answer('first', 0), { ...answer('unknown', -3000), created_at: undefined }]],
    ['invalid row date', hold().emitted_at_iso, [{ ...answer('first', 0), created_at: 'not-a-date' }]],
    ['invalid calendar date', hold().emitted_at_iso, [{ ...answer('first', 0), created_at: '2026-02-30T00:00:00.000Z' }]],
    ['no row at the cutoff', new Date(emittedMs + 10_000).toISOString(), [answer('first', 0)]],
    ['hold before the window', hold().emitted_at_iso, [answer('carried', 2001)]],
    ['only a claim row', hold().emitted_at_iso, [answer('claim:claim', 0)]],
    ['no public text', hold().emitted_at_iso, [{ ...answer('first', 0), user_message: null, assistant_message: null }]],
  ] as const)('%s stays unknown with zero verification reads', async (_reason, emittedAt, rows) => {
    const pending = hold({ emitted_at_iso: emittedAt }); const record = proposalRecord(pending, graph)!;
    const read = vi.fn(async () => ({ pending_actions: [pending] }));
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), rows, 200, read);
    expect(proposalFieldsWire([record], HASH, issued)!.proposals[0]!.issued_turn_id).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('inline carriers verify without a store read, and an empty inline candidate never retries a later carrier', async () => {
    const pending = hold(); const record = proposalRecord(pending, graph)!;
    const read = vi.fn(async () => ({ pending_actions: [pending] }));
    const issued = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), [answer('later', 5000, [pending]), answer('first', 0, [pending])], 200, read);
    expect([...issued]).toEqual([[record.revision, 'first']]);
    const unmatched = await issuedTurnIdsForProposalRecords(proposalIssuances([record], [pending]), [answer('later', 5000, [pending]), answer('first', 0, [])], 200, read);
    expect(proposalFieldsWire([record], HASH, unmatched)!.proposals[0]!.issued_turn_id).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

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
    // S2 also classifies the Agent's set_link_strength while keeping the original add_edge check.
    expect(Object.values(FIELD_CLASS_BY_OP).filter((v) => v === 'link_strength')).toHaveLength(2);
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
    expect(heldChangeName(hold())).toBe("The held change to add the risk 'Competitive response'");
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
    // ONE envelope over TYPE-SPECIFIC payloads (DL #87 6037446159 item 6): the edited op keeps every other key it was
    // stored with, never re-shaped into a generic value.
    const { strength: _s, provenance: _p, defaulted: _d, ...storedRest } = riskOps()[1]!.value as Record<string, unknown>;
    const { strength: _s2, provenance: _p2, ...editedRest } = edited;
    expect(editedRest).toEqual(storedRest);
    expect({ ...r.operations[1]!, value: undefined }).toEqual({ ...riskOps()[1]!, value: undefined });
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
    expect(reconcileHeldProposals({ ...base, atStart: [h], latest: [h], approved: new Set([h.chip_id]) })).toEqual({ carried: [], lapsed: [], review: [] });
    expect(reconcileHeldProposals({ ...base, atStart: [h], latest: [h], declined: new Set([h.chip_id]) })).toEqual({ carried: [], lapsed: [], review: [] });
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
      ...(['model_changed', 'idle', 'over_cap', 'gone', 'superseded'] as const).map((r) => heldLapseSentence("The held change to add the risk 'X'", r))]) {
      expect(findForbiddenPhraseHit(t), t).toBeNull();
      expect(t, t).not.toMatch(/—|\b(best|winner|recommend|leader|ahead|beats)\b/i);
    }
  });


});


describe('S-D slice 2 Agent envelope and typed amendment', () => {
  const fixture = async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin',
      operations: [
        { op: 'set_factor_value', path: 'fac_hours', value: { value: 10, unit: 'hours', cap: 40, declared_scale: 'unit_interval', basis: 'assumption', authored_by: 'model_proposed' } },
        { op: 'set_factor_value', path: 'fac_cost', value: { value: 200, unit: 'GBP', cap: 1000, authored_by: 'model_proposed', extra: { retained: true } } },
        { op: 'set_factor_value', path: 'fac_own', value: { value: 3, unit: '%', authored_by: 'user_stated' } },
      ], provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Starting assumptions' });
    const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Use these assumptions.' },
      { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
    const g = { nodes: [{ id: 'fac_hours', label: 'Hours' }, { id: 'fac_cost', label: 'Cost' }, { id: 'fac_own', label: 'Own', observed_state: { value: 3 } }], edges: [] };
    return { p, carrier, g, record: agentProposalRecord(carrier, g)! };
  };
  it('core living_change (Lenses #2880, 21 Oct: core cards carried no fields): a factor\'s new point value is a field, in the person\'s or Olumi\'s name, never editable', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const f = (id: string, value: number | null, source: string, more: Record<string, unknown> = {}) =>
      ({ id, label: id.toUpperCase(), value, low: null, high: null, unit: 'hours', defined_as: null, source, party: null, quote: null, ...more });
    const lc = (id: string, before: unknown, after: unknown) => ({ op: 'living_change' as const, path: `factor:${id}`, value: { change: 'change', before, after } });
    const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: [
      lc('f_olumi', f('f_olumi', null, 'olumi'), f('f_olumi', 24, 'olumi')),
      lc('f_user', f('f_user', 10, 'user', { quote: 'We have 10 hours.' }), f('f_user', 12, 'user', { quote: 'Make it 12 hours.' })),
      // Codex #3554 R1: the AI changes the figure under the person's EARLIER quote; it is not theirs, so not shown.
      lc('f_stale', f('f_stale', 10, 'user', { quote: 'We have 10 hours.' }), f('f_stale', 24, 'user', { quote: 'We have 10 hours.' })),
      lc('f_noquote', f('f_noquote', 10, 'user'), f('f_noquote', 24, 'user')),
      lc('f_party', f('f_party', 5, 'party'), f('f_party', 6, 'party')),
      lc('f_range', f('f_range', 5, 'user'), f('f_range', null, 'user', { low: 4, high: 8 })),
      lc('f_label', f('f_label', 7, 'user'), f('f_label', 7, 'user', { label: 'Renamed' })),
      { op: 'living_change' as const, path: 'link:l1', value: { change: 'change', before: {}, after: {} } },
    ], provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
    const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
      { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
    const record = agentProposalRecord(carrier, { nodes: [], edges: [] })!;
    expect(record.fields).toEqual([
      { field_id: 'factor_value:f_olumi', kind: 'factor_value', node_id: 'f_olumi', label: 'F_OLUMI', unit: 'hours',
        current: { value: 24, unit: 'hours', source: 'estimate' }, filled_missing: true, editable: false },
      { field_id: 'factor_value:f_user', kind: 'factor_value', node_id: 'f_user', label: 'F_USER', unit: 'hours',
        current: { value: 12, unit: 'hours', source: 'yours' }, filled_missing: false, editable: false },
    ]);
  });
  it('core living_change ADDS (DL lease, 21 Oct): a new factor or signed link is shown as Olumi\'s or the person\'s, never edited; a card adding nothing keeps its digest', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const { amendAgentProposal } = await import('../amend.js');
    const fac = (id: string, label: string, source: string, more: Record<string, unknown> = {}) =>
      ({ id, label, value: null, low: null, high: null, unit: 'tickets', defined_as: null, source, party: null, quote: null, ...more });
    const lnk = (id: string, from: string, to: string, sign: string | null, source: string, quote: string | null = null) =>
      ({ id, from, to, effect: { form: 'direction_only', value: null, sign }, source, party: null, quote });
    const add = (path: string, after: unknown) => ({ op: 'living_change' as const, path, value: { change: 'add', after } });
    const card = (operations: unknown[]) => {
      const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: operations as never,
        provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
      return { p, record: agentProposalRecord(carrier, { nodes: [{ id: 'capacity', label: 'Weekly support capacity' }], edges: [] })! };
    };
    const { p, record } = card([
      add('factor:sickness', fac('sickness', 'Capacity lost to sickness', 'olumi', { value: 5 })),
      add('factor:mine', fac('mine', 'Overtime hours', 'user', { quote: 'We do some overtime.' })),
      add('factor:range', fac('range', 'Backlog', 'olumi', { value: null, low: 10, high: 20 })),
      add('factor:noquote', fac('noquote', 'Morale', 'user')),
      add('factor:party', fac('party', 'Vendor delay', 'party', { party: 'Acme', quote: 'two weeks' })),
      add('link:l_sick', lnk('l_sick', 'sickness', 'capacity', '-', 'olumi')),
      add('link:l_mine', lnk('l_mine', 'mine', 'capacity', '+', 'user', 'overtime helps')),
      add('link:l_unsigned', lnk('l_unsigned', 'sickness', 'capacity', null, 'olumi')),
      add('link:l_ghostend', lnk('l_ghostend', 'nowhere', 'capacity', '+', 'olumi')),
    ]);
    expect(record.fields).toEqual([]);
    expect(record.adds?.filter((a) => a.kind !== 'change_note')).toEqual([
      { field_id: 'factor_add:sickness', kind: 'factor_add', node_id: 'sickness', label: 'Capacity lost to sickness', value: { value: 5, unit: 'tickets' }, source: 'estimate', editable: false },
      { field_id: 'factor_add:mine', kind: 'factor_add', node_id: 'mine', label: 'Overtime hours', value: null, source: 'yours', editable: false },
      { field_id: 'factor_add:range', kind: 'factor_add', node_id: 'range', label: 'Backlog', value: null, source: 'estimate', editable: false },
      { field_id: 'link_add:l_sick', kind: 'link_add', link_id: 'l_sick', from_id: 'sickness', to_id: 'capacity', from_label: 'Capacity lost to sickness',
        to_label: 'Weekly support capacity', direction: 'negative', source: 'estimate', editable: false },
      { field_id: 'link_add:l_mine', kind: 'link_add', link_id: 'l_mine', from_id: 'mine', to_id: 'capacity', from_label: 'Overtime hours',
        to_label: 'Weekly support capacity', direction: 'positive', source: 'yours', editable: false },
    ]);
    // On the wire under its own key (the editable `fields` keep their shape); an edit naming one is refused, never applied.
    const wire = proposalFieldsWire([record], 'pin')!.proposals[0];
    expect([wire.fields, wire.adds]).toEqual([[], record.adds]);
    expect(amendAgentProposal(record, p, [{ field_id: 'factor_add:sickness', value: 9 }])).toEqual({ ok: false, reason: 'unknown_field' });
    // ⛔ Codex R1: a condition's POSITIONAL id ('0') never lends its words to a card with that id.
    const positional = card([
      add('factor:0', fac('0', 'Queue length', 'olumi')),
      { op: 'living_change', path: 'condition:0', value: { change: 'add', after: { text: 'Only if the vendor agrees', applies_to: [], source: 'party' } } },
    ]).record;
    expect(positional.adds?.filter((f) => f.kind !== 'change_note').map((f) => f.kind === 'factor_add' && f.label)).toEqual(['Queue length']);
    expect(positional.adds?.filter((f) => f.kind === 'change_note').map((f) => f.kind === 'change_note' && f.text)).toEqual(['‘Queue length’: unit “tickets” (Olumi’s estimate).', 'Adds the condition \u201cOnly if the vendor agrees\u201d (a party\u2019s).']);
    // A card whose fields show every change it writes has no `adds` and the digest it always had (a removal is now a note).
    const plain = card([{ op: 'living_change', path: 'factor:x', value: { change: 'change', before: fac('x', 'X', 'olumi', { value: 3 }), after: fac('x', 'X', 'olumi', { value: 4 }) } }]).record;
    expect(plain.fields.map((f) => f.field_id)).toEqual(['factor_value:x']);
    expect(plain.adds).toBeUndefined();
    expect(plain.digest).toBe(createHash('sha256').update(JSON.stringify({ approve: plain.approve_action, decline: plain.decline_action, fields: plain.fields, g: 'pin', missing: [], p: plain.proposal_id, r: plain.revision },
      (_k, v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v))).digest('hex').slice(0, 32));
  });
  it('⭐ THE CARD SHOWS EVERY CHANGE IT WRITES (Track 3, 22 Oct: 12/12 core approvals wrote changes the card never showed)', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const fac = (id: string, label: string, more: Record<string, unknown> = {}) =>
      ({ id, label, value: null, low: null, high: null, unit: 'weeks', defined_as: null, source: 'olumi', party: null, quote: null, ...more });
    const lnk = (id: string, from: string, to: string, effect: Record<string, unknown>, source = 'olumi') =>
      ({ id, from, to, effect: { form: 'range', value: null, low: null, high: null, unit: 'features a week', sign: '+', ...effect }, source, party: null, quote: null });
    const opt = (id: string, label: string, settings: unknown[]) => ({ id, label, settings, status: 'feasible', developed_from: null, source: 'user', party: null, quote: 'hire' });
    const ch = (path: string, change: string, before?: unknown, after?: unknown) => ({ op: 'living_change' as const, path,
      value: { change, ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) } });
    const operations = [
      ch('factor:wait', 'add', undefined, fac('wait', 'External wait', { value: 1, low: 0, high: 8 })),
      ch('factor:cap', 'change', fac('cap', 'Capacity', { value: 4 }), fac('cap', 'Team capacity', { value: 4 })),
      ch('factor:old', 'remove', fac('old', 'Old backlog')),
      ch('factor:vendor', 'add', undefined, fac('vendor', 'Vendor delay', { source: 'party', party: 'Acme', value: 2 })),
      ch('link:mentor', 'add', undefined, lnk('mentor', 'cap', 'productivity', { value: -0.4, low: -0.8, high: 0, sign: '-' })),
      ch('link:fix', 'change', lnk('fix', 'cap', 'productivity', { value: 0.2 }, 'user'), lnk('fix', 'cap', 'productivity', { value: 0.4 }, 'user')),
      ch('option:lead', 'change', opt('lead', 'Hire a tech lead', []), opt('lead', 'Hire a tech lead', [{ factor_id: 'wait', value: 0.5, low: null, high: null, unit: 'weeks', source: 'olumi', party: null, quote: null, estimate_by: null }])),
      ch('condition:0', 'add', undefined, { text: 'Only if the budget is approved', applies_to: ['lead'], role: 'prerequisite', source: 'user', party: null, quote: 'if the budget is approved' }),
      ch('history:0', 'add', undefined, { id: 'old', change: 'withdrawn', item: '{}' }),
    ];
    const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: operations as never,
      provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
    const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
      { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
    // The aim has no graph node: its label comes from the saved living model (Track 3: that link was dropped, then written).
    const g = { nodes: [{ id: 'cap', label: 'Capacity' }], edges: [], living_model: { aims: [{ id: 'productivity', text: 'Productivity up 10%' }] } };
    const record = agentProposalRecord(carrier, g)!;
    // COVERAGE: every changed item but the host's history is named by a field, an add or a note on this card.
    const shown = new Set([...record.fields, ...(record.adds ?? [])].map((f) => f.field_id.slice(f.field_id.indexOf(':') + 1)));
    for (const o of operations.filter((x) => !x.path.startsWith('history:'))) expect(shown.has(o.path.slice(o.path.indexOf(':') + 1)) || shown.has(o.path), o.path).toBe(true);
    const notes = (record.adds ?? []).filter((a) => a.kind === 'change_note').map((a) => a.kind === 'change_note' ? a.text : '');
    expect(notes).toContain('‘External wait’: figure 1 week; low end 0 weeks; high end 8 weeks (Olumi’s estimate).');
    expect(notes).toContain('Removes ‘Old backlog’.');
    expect(notes).toContain('Adds the condition “Only if the budget is approved”: applies to ‘Hire a tech lead’; role a prerequisite; recorded words “if the budget is approved” (yours).');
    expect(notes).toContain('Changes ‘Team capacity’: name was “Capacity”, now “Team capacity” (Olumi’s estimate).');
    expect(notes).toContain('Changes ‘Hire a tech lead’: new setting for ‘External wait’ figure 0.5 weeks (Olumi’s estimate).');
    expect(notes).toContain('Adds the factor ‘Vendor delay’: figure 2 weeks (Acme’s).');
    expect(notes).toContain('Changes the link ‘Team capacity’ → ‘Productivity up 10%’: effect figure was 0.2 features a week, now 0.4 features a week (yours).');
    // A negative link's direction is on its add, in words; its note gives the figures exactly as approval writes them.
    expect(notes).toContain('‘Team capacity’ → ‘Productivity up 10%’: effect figure -0.4 features a week; effect low end -0.8 features a week; effect high end 0 features a week; effect form a range (Olumi’s estimate).');
    expect(record.adds?.some((a) => a.kind === 'link_add' && a.to_label === 'Productivity up 10%' && a.direction === 'negative')).toBe(true);
    expect(notes.some((t) => t.includes('history'))).toBe(false);
    // Bound: what the card SHOWS is in its digest, so a different note is a different card.
    const other = agentProposalRecord(carrier, { ...g, living_model: { aims: [{ id: 'productivity', text: 'Output up 10%' }] } })!;
    expect(other.digest).not.toBe(record.digest);
  });
  it('Codex r1 on #3632: whose a figure is, a signed or unsigned effect, an add\'s limit and definition, long lists and key order', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const card = (operations: unknown[]) => {
      const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: operations as never,
        provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
      return agentProposalRecord(carrier, { nodes: [{ id: 'out', label: 'Output' }, { id: 'sales', label: 'Sales' }], edges: [] })!;
    };
    const notesOf = (r: ReturnType<typeof card>) => (r.adds ?? []).flatMap((a) => (a.kind === 'change_note' ? [a] : []));
    const fac = (more: Record<string, unknown>) => ({ id: 'f', label: 'Orders', value: null, low: null, high: null, unit: 'units', defined_as: null, limit: null,
      estimate_by: null, source: 'user', party: null, quote: 'our orders', ...more });
    const lnk = (effect: Record<string, unknown>) => ({ id: 'l', from: 'out', to: 'sales', effect: { form: 'range', value: null, low: null, high: null, sd: null, unit: 'units', sign: '+', estimate_by: null, ...effect }, source: 'olumi', party: null, quote: null });
    const ch = (path: string, before: unknown, after: unknown) => ({ op: 'living_change', path, value: { change: 'change', before, after } });
    // (1) Olumi's labelled estimate on the person's item is Olumi's, never "yours".
    const owned = notesOf(card([ch('factor:f', fac({}), fac({ value: 10, low: 5, high: 15, estimate_by: 'olumi' }))]));
    expect(owned.map((n) => [n.text, n.source])).toEqual([['Changes ‘Orders’: figure was not stated, now 10 units; low end was not stated, now 5 units; high end was not stated, now 15 units (Olumi’s estimate); figure is now Olumi’s estimate (was yours).', 'estimate']]);
    // (2) A range across zero, or no stated sign: the figures as written, never an invented direction.
    const crossing = notesOf(card([ch('link:l', lnk({}), lnk({ low: -2, high: 2 }))]))[0]!.text;
    expect(crossing).toContain('effect low end was not stated, now -2 units; effect high end was not stated, now 2 units');
    const unsigned = notesOf(card([ch('link:l', lnk({}), lnk({ value: 2, sign: null }))]))[0]!.text;
    expect(unsigned).toContain('effect figure was not stated, now 2 units; effect direction was raises it, now not stated');
    // (3) A direction-only flip and a stated spread are said.
    expect(notesOf(card([ch('link:l', lnk({ form: 'direction_only' }), lnk({ form: 'direction_only', sign: '-' }))]))[0]!.text)
      .toContain('effect direction was raises it, now lowers it');
    expect(notesOf(card([ch('link:l', lnk({ form: 'normal', value: 3, sd: 1 }), lnk({ form: 'normal', value: 3, sd: 9 }))]))[0]!.text)
      .toContain('effect spread was 1 unit, now 9 units');
    // (4) A point-valued add with a limit and a definition: both are said beside the add.
    const added = card([{ op: 'living_change', path: 'factor:f', value: { change: 'add', after: fac({ source: 'olumi', quote: null, value: 40,
      limit: { comparator: '<=', value: 50, source: 'user', party: null, quote: 'no more than 50' }, defined_as: { op: 'sum', of: ['out'], source: 'olumi', party: null, quote: null } }) } }]);
    expect(notesOf(added).map((n) => n.text)).toEqual(['‘Orders’: definition kind the sum; definition parts ‘Output’ (Olumi’s estimate); limit comparison at most; limit figure 50 units; limit recorded words “no more than 50” (yours).']);
    // (5) Nine settings: split into parts the canvas reads in full, every figure on the card, never cut.
    const set = (k: number) => ({ factor_id: `fac_${k}`, value: 10 + k, low: null, high: null, unit: 'units', source: 'user', party: null, quote: 'set', estimate_by: null });
    const opt = (settings: unknown[]) => ({ id: 'o', label: 'A plan with a fairly long descriptive name for the comparison', settings, status: 'feasible', developed_from: null, source: 'user', party: null, quote: 'plan' });
    const long = notesOf(card([ch('option:o', opt([]), opt([1, 2, 3, 4, 5, 6, 7, 8, 9].map(set)))]));
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((n) => n.text.length <= 400)).toBe(true);
    for (let k = 1; k <= 9; k += 1) expect(long.some((n) => n.text.includes(`${10 + k} units`)), `setting ${k}`).toBe(true);
    // (6) Key order never changes what is shown: the same change with keys reordered binds the same digest.
    const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    // A unit and whose a figure is, with no figure yet: said in a fixed order, never the keys' order.
    const a = card([ch('factor:f', fac({}), fac({ unit: 'boxes', estimate_by: 'olumi' }))]);
    const b = card([ch('factor:f', reorder(fac({})), reorder(fac({ unit: 'boxes', estimate_by: 'olumi' })))]);
    expect(notesOf(a).map((n) => n.text)).toEqual(['Changes ‘Orders’: unit was “units”, now “boxes” (Olumi’s estimate); figure is now Olumi’s estimate (was yours).']);
    // Whose an item is, and the words recorded for it, are said with their new content.
    const said = notesOf(card([ch('factor:f', fac({}), fac({ quote: 'our new words', source: 'party', party: 'Acme' }))]))[0]!.text;
    expect(said).toBe('Changes ‘Orders’: recorded words were “our orders”, now “our new words” (Acme’s); it is now Acme’s (was yours).');
    expect(notesOf(b).map((n) => n.text)).toEqual(notesOf(a).map((n) => n.text));
  });
  it('Codex r2 on #3632: a point estimate on the person\'s item, each limit and definition change, and long notes', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const card = (operations: unknown[]) => {
      const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: operations as never,
        provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
      return agentProposalRecord(carrier, { nodes: [{ id: 'out', label: 'Output' }, { id: 'out2', label: 'Output' }], edges: [] })!;
    };
    const notesOf = (r: ReturnType<typeof card>) => (r.adds ?? []).flatMap((a) => (a.kind === 'change_note' ? [a] : []));
    const fac = (more: Record<string, unknown>) => ({ id: 'f', label: 'Orders', value: null, low: null, high: null, unit: 'units', defined_as: null, limit: null,
      estimate_by: null, source: 'user', party: null, quote: 'our orders', ...more });
    const ch = (path: string, before: unknown, after: unknown) => ({ op: 'living_change', path, value: { change: 'change', before, after } });
    // (1) Olumi's point estimate on the person's factor is Olumi's on the field and the add; the note says whose the factor is.
    const changed = card([ch('factor:f', fac({ value: 30, estimate_by: 'olumi' }), fac({ value: 40, estimate_by: 'olumi' }))]);
    expect(changed.fields.map((f) => f.kind === 'factor_value' ? f.current.source : f.kind)).toEqual(['estimate']);
    const added = card([{ op: 'living_change', path: 'factor:f', value: { change: 'add', after: fac({ value: 40, estimate_by: 'olumi' }) } }]);
    expect((added.adds ?? []).map((a) => [a.kind, a.source])).toEqual([['factor_add', 'estimate'], ['change_note', 'yours']]);
    expect(notesOf(added).map((n) => n.text)).toEqual(['‘Orders’ is yours: recorded words “our orders” (yours).']);
    // (3) Each limit and definition change is said on its own, compared by ids, not names.
    const lim = { comparator: '<=', value: 50, source: 'user', party: null, quote: 'no more than 50' };
    const def = (of: string[]) => ({ op: 'sum', of, source: 'olumi', party: null, quote: null });
    expect(notesOf(card([ch('factor:f', fac({ limit: lim, defined_as: def(['out']) }), fac({ defined_as: def(['out']) }))])).map((n) => n.text))
      .toEqual(['Changes ‘Orders’: limit removed (was comparison at most, figure 50 units, recorded words “no more than 50” (yours)).']);
    expect(notesOf(card([ch('factor:f', fac({ limit: lim, defined_as: def(['out']) }), fac({}))])).map((n) => n.text))
      .toEqual(['Changes ‘Orders’: definition removed (was kind the sum, parts ‘Output’ (Olumi’s estimate)); limit removed (was comparison at most, figure 50 units, recorded words “no more than 50” (yours)).']);
    expect(notesOf(card([ch('factor:f', fac({ defined_as: def(['out']) }), fac({ defined_as: def(['out2']) }))])).map((n) => n.text))
      .toEqual(['Changes ‘Orders’: definition parts were ‘Output’, now ‘Output’ (a different item with the same name) (Olumi’s estimate).']);
    expect(notesOf(card([ch('factor:f', fac({ limit: lim }), fac({ limit: { ...lim, source: 'olumi', quote: null } }))])).map((n) => n.text))
      .toEqual(['Changes ‘Orders’: limit recorded words were “no more than 50”, now not stated (Olumi’s estimate); limit is now Olumi’s estimate (was yours).']);
    // (4) An unbroken 401-character condition: every part fits the canvas; nothing is cut; a replaced condition's ids stay unique.
    const word = 'x'.repeat(401);
    const cond = notesOf(card([{ op: 'living_change', path: 'condition:0', value: { change: 'add', after: { text: word, applies_to: [], source: 'user', party: null, quote: word } } }]));
    expect(cond.length).toBeGreaterThan(1);
    expect(cond.every((n) => n.text.length <= 400)).toBe(true);
    // Its wording and its recorded words (the same 401 characters here), each in full.
    expect(cond.map((n) => n.text).join('').split('x').length - 1).toBe(802);
    const replaced = notesOf(card([
      { op: 'living_change', path: 'condition:0', value: { change: 'remove', before: { text: word, applies_to: [], source: 'user', party: null, quote: word } } },
      { op: 'living_change', path: 'condition:0', value: { change: 'add', after: { text: word, applies_to: [], source: 'user', party: null, quote: word } } }]));
    const ids = replaced.map((n) => n.field_id);
    expect(ids.length).toBeGreaterThan(2);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('buddy BLOCK on #3632: a risk\'s chance, window and what reduces it, an aim\'s target and an option\'s status are said with their content', async () => {
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    const { agentProposalRecord } = await import('../record.js');
    const card = (operations: unknown[]) => {
      const p = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: 'pin', operations: operations as never,
        provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Core change' });
      const carrier = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: p.public_label, message: 'Apply.' },
        { scenario_id: SID, emitted_at_iso: new Date().toISOString() });
      return agentProposalRecord(carrier, { nodes: [{ id: 'backup', label: 'Backup supplier' }], edges: [] })!;
    };
    const texts = (r: ReturnType<typeof card>) => (r.adds ?? []).flatMap((a) => (a.kind === 'change_note' ? [a.text] : []));
    const ch = (path: string, before: unknown, after: unknown) => ({ op: 'living_change', path, value: { change: 'change', before, after } });
    const risk = (more: Record<string, unknown>) => ({ id: 'r', label: 'Supplier fails', occurrence: { estimate_by: null, low: 0.1, high: 0.2 }, horizon_months: 12, horizon_by: null,
      mitigations: [], source: 'user', party: null, quote: 'our supplier may fail', ...more });
    expect(texts(card([ch('risk:r', risk({}), risk({ occurrence: { estimate_by: 'olumi', low: 0.3, high: 0.5 }, horizon_months: 6 }))])))
      .toEqual(['Changes ‘Supplier fails’: window was 12 months, now 6 months (yours); chance low end was 10%, now 30%; chance high end was 20%, now 50% (Olumi’s estimate); chance is now Olumi’s estimate (was yours).']);
    expect(texts(card([ch('risk:r', risk({}), risk({ mitigations: [{ factor_id: 'backup', reduction: 0.7, source: 'user', party: null, quote: 'cuts it by 70%' }] }))])))
      .toEqual(['Changes ‘Supplier fails’: new reduction by ‘Backup supplier’ 70%; new reduction by ‘Backup supplier’ recorded words “cuts it by 70%” (yours).']);
    const aim = (target: Record<string, unknown>) => ({ id: 'a', text: 'Grow revenue', status: 'current', source: 'user', party: null, quote: 'grow revenue',
      target: { quantity: 'revenue', comparator: '>=', value: 100, low: null, high: null, unit: '£k', by_when: 'next year', period_months: null, baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: null, ...target } });
    expect(texts(card([ch('aim:a', aim({}), aim({ value: 120, current: 90 }))])))
      .toEqual(['Changes ‘Grow revenue’: target figure was 100 £k, now 120 £k; target today’s level was not stated, now 90 £k (yours).']);
    const opt = (status: string) => ({ id: 'o', label: 'Open a second site', settings: [], status, developed_from: null, source: 'user', party: null, quote: 'second site' });
    expect(texts(card([ch('option:o', opt('feasible'), opt('infeasible'))]))).toEqual(['Changes ‘Open a second site’: status was compared, now ruled out (kept in view) (yours).']);
    // Codex r3 on #3632 (re-scoped: notes built by structure, so each part is said and attributed to its own record).
    const step = { factor_id: 'backup', reduction: 0.7, source: 'olumi', party: null, quote: null };
    expect(texts(card([ch('risk:r', risk({}), risk({ mitigations: [step] }))])))
      .toEqual(['Changes ‘Supplier fails’: new reduction by ‘Backup supplier’ 70% (Olumi’s estimate).']);
    expect(texts(card([ch('risk:r', risk({}), risk({ occurrence: { estimate_by: null, low: 0.0004, high: 0.0004 } }))]))[0])
      .toContain('chance low end was 10%, now 0.04%; chance high end was 20%, now 0.04%');
    expect(texts(card([ch('aim:a', aim({}), aim({ quantity: 'gross profit', value: 120 }))]))[0])
      .toBe('Changes ‘Grow revenue’: target measure was “revenue”, now “gross profit”; target figure was 100 £k, now 120 £k (yours).');
    const suggested = { id: 'a', text: 'Grow the community', status: 'current', source: 'user', party: null, quote: 'grow the community',
      target: { quantity: 'active members', comparator: '>=', value: null, low: null, high: null, unit: null, by_when: null, period_months: null, baseline: null, current: null, current_source: null, current_unit: null, change_kind: null, source: 'olumi' } };
    expect(texts(card([{ op: 'living_change', path: 'aim:a', value: { change: 'add', after: suggested } }])))
      .toEqual(['Adds the aim ‘Grow the community’: target measure “active members”; target comparison at least (Olumi’s estimate); recorded words “grow the community” (yours).']);
    const lim = (more: Record<string, unknown>) => ({ id: 'f', label: 'Orders', value: null, low: null, high: null, unit: 'units', defined_as: null, estimate_by: null,
      limit: { comparator: '<=', value: 50, source: 'user', party: null, quote: 'no more than 50', ...more }, source: 'user', party: null, quote: 'our orders' });
    expect(texts(card([ch('factor:f', lim({}), lim({ source: 'party', party: 'Acme', quote: 'Acme requires at most 50' }))])))
      .toEqual(['Changes ‘Orders’: limit recorded words were “no more than 50”, now “Acme requires at most 50” (Acme’s); limit is now Acme’s (was yours).']);
    // Codex r4 on #3632.
    const set2 = (v: number) => ({ factor_id: 'backup', value: v, low: null, high: null, unit: 'units', estimate_by: null, source: 'olumi', party: null, quote: null });
    const plan = (settings: unknown[]) => ({ id: 'o', label: 'Plan', settings, status: 'feasible', developed_from: null, source: 'olumi', party: null, quote: null });
    expect(texts(card([ch('option:o', plan([set2(2), set2(10)]), plan([set2(8), set2(10)]))]))[0]).toContain('setting for ‘Backup supplier’ figure was 2 units, now 8 units');
    const userLink = (sign: string, quote: string) => ({ id: 'l', from: 'backup', to: 'r', effect: { form: 'range', value: null, low: 1, high: 3, sd: null, unit: 'units', sign, estimate_by: 'olumi' },
      source: 'user', party: null, quote });
    expect(texts(card([ch('link:l', userLink('+', 'it helps'), userLink('-', 'it hurts'))])))
      .toEqual(['Changes the link ‘Backup supplier’ → ‘r’: effect direction was raises it, now lowers it; recorded words were “it helps”, now “it hurts” (yours).']);
    const fac = (limit: unknown) => ({ id: 'f', label: 'Orders', value: null, low: null, high: null, unit: 'units', defined_as: null, estimate_by: null, limit, source: 'user', party: null, quote: 'our orders' });
    const acme = card([ch('factor:f', fac({ comparator: '<=', value: 40, source: 'party', party: 'Acme', quote: 'no more than 40' }), fac(null))]);
    expect((acme.adds ?? []).flatMap((a) => (a.kind === 'change_note' ? [[a.text, a.source]] : [])))
      .toEqual([['Changes ‘Orders’: limit removed (was comparison at most, figure 40 units, recorded words “no more than 40” (Acme’s)).', 'party']]);
    const hours = { id: 'h', label: 'Overtime', value: null, low: null, high: null, unit: 'hours', defined_as: null, estimate_by: null, limit: null, source: 'user', party: null, quote: 'we do overtime' };
    expect(texts(card([{ op: 'living_change', path: 'factor:h', value: { change: 'add', after: hours } }]))).toEqual(['‘Overtime’: unit “hours”; recorded words “we do overtime” (yours).']);
    expect(texts(card([ch('risk:r', risk({}), risk({ occurrence: { estimate_by: null, low: 0.1234567890123, high: 0.2 } }))]))[0])
      .toContain('chance low end was 10%, now 12.34567890123%');
  });
  it('RED classifier assigns Agent factor and link kinds exhaustively', () => {
    expect(FIELD_CLASS_BY_OP.set_factor_value).toBe('factor_value');
    expect(FIELD_CLASS_BY_OP.set_link_strength).toBe('link_strength');
  });
  it('RED Agent record reads native figures, units, caps, scale, missing flag and per-value provenance', async () => {
    const { p, carrier, record } = await fixture();
    expect(record).toMatchObject({ proposal_id: p.proposal_id, revision: carrier.id, dialect: 'agent',
      decline_action: { id: `agent-decline-proposal:${p.proposal_id}`, label: 'Not now', message: 'Not now.' } });
    expect(record.operations).toBe((carrier.action as unknown as { inline_patch: { agent_proposal: { operations: unknown } } }).inline_patch.agent_proposal.operations);
    expect(record.fields[0]).toMatchObject({ current: { value: 10, unit: 'hours', source: 'estimate' }, cap: 40, declared_scale: 'unit_interval', filled_missing: true, editable: true });
    expect(record.fields[2]).toMatchObject({ current: { source: 'yours' }, editable: false, filled_missing: false });
  });
  it('RED amendment changes one typed op and leaves the other byte for byte with its own author', async () => {
    const { amendAgentProposal } = await import('../amend.js'); const { p, record } = await fixture();
    const r = amendAgentProposal(record, p, [{ field_id: 'factor_value:fac_hours', value: 12 }]);
    expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.proposal.proposal_id).not.toBe(p.proposal_id);
    expect(r.proposal.provenance.basis).toBe(`edited_from:${p.proposal_id}`);
    expect(r.proposal.operations[0]).toEqual({ ...p.operations[0], value: { ...(p.operations[0]!.value as object), value: 12, authored_by: 'user_stated' } });
    expect(r.proposal.operations[1]).toBe(p.operations[1]); expect(JSON.stringify(r.proposal.operations[1])).toBe(JSON.stringify(p.operations[1]));
    expect(readUserEdits(r.userEdits)).toEqual(r.userEdits);
    const receipt = userEditsReceipt(r.userEdits);
    expect(receipt).toContain('You set "Hours" to 12 hours; Olumi\'s estimate was 10 hours.');
    expect(receipt).toContain('Left as Olumi\'s estimate: "Cost" (£200).');
    expect(findForbiddenPhraseHit(receipt)).toBeNull(); expect(receipt).not.toContain('\u2014');
  });
  it('RED digest covers a label, figure, units and approve words', async () => {
    const { agentProposalRecord } = await import('../record.js'); const { p, carrier, g, record } = await fixture();
    const { createProposal } = await import('../../proposal.js');
    const { proposalPendingAction } = await import('../../durable-proposal.js');
    expect(agentProposalRecord(carrier, { ...g, nodes: [{ id: 'fac_hours', label: 'Renamed' }, ...g.nodes.slice(1)] })!.digest).not.toBe(record.digest);
    const c = { ...carrier, action: { ...carrier.action, public_message: 'Other approve words.' } } as PendingAction;
    expect(agentProposalRecord(c, g)!.digest).not.toBe(record.digest);
    for (const patch of [{ value: 11 }, { unit: 'days' }]) {
      const changed = createProposal({ ...p, operations: p.operations.map((o, i) => i === 0 ? { ...o, value: { ...(o.value as object), ...patch } } : o) });
      const changedCarrier = { ...proposalPendingAction(changed, { ...record.approve_action, id: `agent-approve-proposal:${changed.proposal_id}` },
        { scenario_id: SID, emitted_at_iso: carrier.emitted_at_iso }), id: carrier.id };
      const projected = agentProposalRecord(changedCarrier, g)!;
      expect(projected.proposal_id).toBe(changed.proposal_id);
      expect(projected.revision).toBe(record.revision);
      expect(projected.fields[0]!.current).toMatchObject(patch);
      expect(projected.digest).not.toBe(record.digest);
    }
  });
  it.each([-1, 41, NaN, Infinity])('RED native value bounds refuse %s before any amendment', async value => {
    const { amendAgentProposal } = await import('../amend.js'); const { p, record } = await fixture();
    expect(amendAgentProposal(record, p, [{ field_id: 'factor_value:fac_hours', value }])).toEqual({ ok: false, reason: 'value_not_allowed' });
  });
  it('RED validated prop decline ids and bounded whitespace regex timing', async () => {
    const { p } = await fixture(); expect(declinedProposalOf(`agent-decline-proposal:${p.proposal_id}`)).toBe(p.proposal_id);
    expect(declinedProposalOf('agent-decline-proposal:prop_bad')).toBeUndefined();
    const start = performance.now(); declinedProposalOf(`agent-decline-proposal:${' '.repeat(20_000)}`);
    if (timingGated) { expect(performance.now() - start).toBeLessThan(50); }
  });
  it('RED Agent lifecycle never re-pins, keeps a moved card for review (said once), says idle lapses, and refreshes each live item', async () => {
    const { carrier, g } = await fixture(); const nowMs = Date.now();
    const base = { atStart: [carrier], latest: [carrier], approved: new Set<string>(), declined: new Set<string>(), graph: g,
      graphHash: 'pin', scenarioId: SID, requestId: 'request', nowMs };
    const kept = reconcileHeldProposals(base); expect(kept.carried).toHaveLength(1);
    expect(Date.parse(kept.carried[0]!.expires_at_iso)).toBe(nowMs + PROPOSAL_IDLE_TTL_MS);
    const moved = reconcileHeldProposals({ ...base, graphHash: 'new pin' });
    // ⛔ CHANGED CONTRACT (DL-3 18 Oct, PR-2, no silent lapse; Codex co-design §2): a card whose model moved used to lapse
    // ("model_changed"). It is now KEPT, marked for review and said once, never applicable as it stands. Still never re-pinned.
    expect(moved.lapsed).toEqual([]); expect(moved.review).toEqual([carrier]);
    expect(moved.carried).toHaveLength(1); expect(heldCardUnderReview(moved.carried[0]!)).toBe(true);
    expect(moved.carried[0]!.id, 'the same revision').toBe(carrier.id);
    expect(moved.carried[0]!.preconditions, 'never re-pinned').toEqual(carrier.preconditions);
    const idle = { ...carrier, expires_at_iso: new Date(nowMs - 1).toISOString() };
    expect(reconcileHeldProposals({ ...base, latest: [idle] }).lapsed[0]?.reason).toBe('idle');
  });
  it('applied Agent carriers disappear silently before pin or idle checks, including a missing latest carrier', async () => {
    const { ProposalStore } = await import('../../proposal.js');
    const { p, carrier, g } = await fixture(); const nowMs = Date.now();
    const proposals = new ProposalStore(); proposals.put(p); proposals.markApplied(p.proposal_id);
    const base = { atStart: [carrier], approved: new Set<string>(), declined: new Set<string>(), graph: g,
      graphHash: 'own approval moved the pin', scenarioId: SID, requestId: 'request', nowMs,
      isApplied: (id: string) => proposals.isApplied(id) };
    for (const latest of [[carrier], [{ ...carrier, expires_at_iso: new Date(nowMs - 1).toISOString() }], []]) {
      expect(reconcileHeldProposals({ ...base, latest })).toEqual({ carried: [], lapsed: [], review: [] });
    }
    expect(proposals.authorise({ proposal_id: p.proposal_id, scenario_id: SID, authenticated_user_id: null,
      current_graph_identity_hash: base.graphHash }).status).toBe('already_applied');
  });

  it('RED bounds preserve a declared signed domain and do not invent a lower bound for unscaled figures', async () => {
    const { factorValueAllowed } = await import('../amend.js'); const { record } = await fixture();
    const f = record.fields[0]!; if (f.kind !== 'factor_value') throw new Error('Expected a factor field');
    expect(factorValueAllowed({ ...f, declared_scale: { min: -40, max: 40 } }, -12)).toBe(true);
    expect(factorValueAllowed({ ...f, cap: undefined, declared_scale: undefined }, -12)).toBe(true);
    expect(factorValueAllowed({ ...f, declared_scale: { min: -40, max: 40 } }, -41)).toBe(false);
  });

  it('R-keep-marker: an amended keep retains its keep predicate and hashes the original basis', async () => {
    const { p, record } = await fixture();
    const { createProposal, computeProposalId } = await import('../../proposal.js');
    const { KEEP_PROPOSAL_BASIS, isKeepProposal } = await import('../../approval-chips.js');
    const { amendAgentProposal } = await import('../amend.js');
    const keep = createProposal({ ...p, provenance: { authored_by: 'model_proposed', basis: KEEP_PROPOSAL_BASIS } });
    const edited = amendAgentProposal(record, keep, [{ field_id: 'factor_value:fac_hours', value: 12 }]);
    expect(edited.ok).toBe(true); if (!edited.ok) return;
    expect(edited.proposal.provenance).toMatchObject({ original_basis: KEEP_PROPOSAL_BASIS });
    expect(isKeepProposal(edited.proposal)).toBe(true);
    expect(computeProposalId({ ...edited.proposal, provenance: { ...edited.proposal.provenance, original_basis: 'changed' } })).not.toBe(edited.proposal.proposal_id);
  });

});
