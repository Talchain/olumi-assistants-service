/**
 * A program card's own rules (inventory F6 part b) give a program card exactly what the Living Model's chip, lifecycle and
 * still-applies rules gave it, on real program cards (`holdProgramCard`) over real saved programs (`withNewRun`). Differential:
 * each row runs the legacy function and the program's on the same inputs. Synthetic bakery.
 */
import { describe, expect, it } from 'vitest';
import { heldCardUnderReview, programChipsFor, programHoldApplies } from '../program-card.js';
import { readProgramHeldOffers, reconcileProgramCards } from '../program-card-turn.js';
import { withNewRun } from '../program-save.js';
import { MODEL_PROGRAM, savedProgramOf, type SavedProgram } from '../program-store.js';
import { holdProgramCard } from '../program-tools.js';
import { seedOf } from '../evaluate.js';
import { bakery, BRIEF } from './bakery.fixture.js';
import { approvalChipsFor, approvalChipIdFor, READING_APPROVE } from '../../agent-lane/approval-chips.js';
import { ProposalStore, type StructuredProposal } from '../../agent-lane/proposal.js';
import { proposalPendingAction, withApprovalOfferedOnRow } from '../../agent-lane/durable-proposal.js';
import { readExecutableHeldProposalOffers } from '../../agent-lane/held-approval-offers.js';
import { reconcileHeldProposals } from '../../agent-lane/proposal-object/lifecycle.js';
import { agentProposalOf, heldRecordAppliesAt, proposalRecord } from '../../agent-lane/proposal-object/record.js';
import { heldCardStillApplies, heldCardSubjectMoved } from '../../agent-lane/proposal-object/still-applies.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import type { PendingAction } from '../../session/pending-action.js';
import type { ToolResult } from '../../agent-lane/runtime/agent-tools.js';

type Rec = Record<string, unknown>;
const SCENARIO = 'd4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70';
const USER = 'u-1';
const NOW = Date.parse('2026-10-26T19:00:00.000Z');

const first = (): { graph: Rec; program: SavedProgram } => {
  const { graph } = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf(SCENARIO), person_words: [BRIEF], runs: [] });
  return { graph: graph as Rec, program: savedProgramOf(graph)! };
};
const hashOf = (g: Rec): string => computeAnalysisAffectingGraphHash(g as never)!;
const identityOf = (g: Rec): string => computeGraphIdentityHash(g as never)!.value;
/** The same model with one more of the person's words: its program revision moves. */
const moved = (p: SavedProgram): Rec => withNewRun({ ...p, person_words: [...p.person_words, 'And we bake on Sundays.'] }).graph as Rec;
/** A second Run stored on the unchanged model: its graph moves, its revision does not. */
const rerun = (p: SavedProgram): Rec => withNewRun(p).graph as Rec;

function card(store: ProposalStore, on: Rec, opts: { withBase?: boolean; reading?: true; label?: string } = {}): StructuredProposal {
  const base = savedProgramOf(on)!;
  return holdProgramCard(store, { scenarioId: SCENARIO, userId: USER, graphHash: hashOf(on), identity: identityOf(on), ...(opts.withBase === false ? {} : { base }) },
    { label: opts.label ?? 'Estimate the oven price', basis: 'a typical oven', program: withNewRun({ ...base, canonical: bakery() }).program, changes: [],
      ...(opts.reading === true ? { reading: true as const } : {}) });
}
function carrier(p: StructuredProposal, at = new Date(NOW).toISOString()): PendingAction {
  return proposalPendingAction(p, { id: approvalChipIdFor(p.proposal_id), label: 'Make this change', message: 'Yes, make that change.' },
    { scenario_id: SCENARIO, emitted_at_iso: at });
}

describe('the program card\'s chips are the legacy chips for every program tool (inventory F6 part b)', () => {
  const store = new ProposalStore();
  const { graph } = first();
  const a = card(store, graph);
  const b = card(store, graph, { label: 'Estimate the flour cost' });
  const r = card(store, graph, { reading: true, label: 'Here is what I understood' });
  const ok = (p: StructuredProposal, name: string, extra: Partial<ToolResult> = {}) =>
    ({ call: { name, ok: true, mutated: false, proposal_id: p.proposal_id }, result: { ok: true, proposal_id: p.proposal_id, public_label: p.public_label, ...extra } as ToolResult });
  const cases: [string, ReturnType<typeof ok>[], { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[]?][] = [
    ['one prepared card, its words as the result returned them', [ok(a, 'propose_change')]],
    ['one prepared card, the result returned other words', [ok(a, 'propose_change', { public_label: 'Something else' })]],
    ['⛔ two cards waiting: no button (one approval carries one change)', [ok(a, 'propose_change'), ok(b, 'propose_change')]],
    ['the reading card', [ok(r, 'confirm_reading')]],
    ['the paused apply', [ok(a, 'apply_change')]],
    ['a card made before a change to the model is stale: no button', [ok(a, 'propose_change')], [{ name: 'apply_change', ok: true, mutated: true, proposal_id: b.proposal_id }]],
    ['a refused proposal: no button', [{ ...ok(a, 'propose_change'), call: { name: 'propose_change', ok: false, mutated: false, proposal_id: a.proposal_id } }]],
  ];
  it.each(cases)('%s', (_name, calls, after = []) => {
    const toolCalls = [...calls.map((c) => c.call), ...after];
    const sourceFor = (id: string) => ({ proposal: store.get(id), result: calls.find((c) => c.call.proposal_id === id)?.result });
    const legacy = approvalChipsFor(toolCalls, sourceFor);
    expect(programChipsFor(toolCalls, sourceFor)).toEqual(legacy);
    // CONTRAST: each case is the shape it names.
    if (_name.startsWith('⛔') || _name.includes('no button')) expect(legacy).toEqual([]);
    else expect(legacy[0]!.id).toBe(approvalChipIdFor(calls[0]!.call.proposal_id));
  });
  it('the reading card says the reading words', () => {
    const { call, result } = ok(r, 'confirm_reading');
    expect(programChipsFor([call], () => ({ proposal: r, result }))[0]).toMatchObject(READING_APPROVE);
  });
});

describe('the program card\'s turn and reload rules are the legacy ones on a program card', () => {
  const store = new ProposalStore();
  const { graph, program } = first();
  const keep = card(store, graph);
  const old = card(store, graph, { withBase: false, label: 'Held before the revision was recorded' });
  const states: [string, Rec][] = [['the same model', graph], ['its revision moved', moved(program)], ['a Run stored on it', rerun(program)]];
  const legacyReconcile = (atStart: PendingAction[], latest: PendingAction[], g: Rec, declined: Set<string>, applied: Set<string>) =>
    reconcileHeldProposals({ atStart, latest, approved: new Set(), isApplied: (id) => applied.has(id), declined, graph: g, graphHash: hashOf(g),
      scenarioId: SCENARIO, requestId: 'r', nowMs: NOW,
      stillApplies: (h) => { const p = agentProposalOf(h); return p !== undefined && heldCardStillApplies(p, g); },
      subjectMoved: (h) => { const p = agentProposalOf(h); return p !== undefined && heldCardSubjectMoved(p, g); } });

  it.each(states)('on %s: the same cards carried (and kept for review), the same lapsed', (_name, g) => {
    const expired = carrier(card(store, graph, { label: 'An old card' }), new Date(NOW - 3 * 86_400_000).toISOString());
    const vanished = carrier(card(store, graph, { label: 'Gone from the latest row' }));
    const declined = carrier(card(store, graph, { label: 'Declined' }));
    const applied = carrier(card(store, graph, { label: 'Applied' }));
    const expiredRow = { ...expired, expires_at_iso: new Date(NOW - 1).toISOString() };
    const latest = [carrier(keep), carrier(old), expiredRow, declined, applied];
    const atStart = [...latest, vanished];
    const ids = { declined: new Set([agentProposalOf(declined)!.proposal_id]), applied: new Set([agentProposalOf(applied)!.proposal_id]) };
    const legacy = legacyReconcile(atStart, latest, g, ids.declined, ids.applied);
    const program = reconcileProgramCards({ atStart, latest, isApplied: (id) => ids.applied.has(id), declined: ids.declined, graph: g, graphHash: hashOf(g),
      scenarioId: SCENARIO, nowMs: NOW });
    expect(program.carried).toEqual(legacy.carried);
    expect(program.lapsed.map((h) => h.chip_id).sort()).toEqual(legacy.lapsed.map((l) => l.hold.chip_id).sort());
    // CONTRAST: the rows move with the model as named: carried on the same model, reviewed when the revision or pin moved.
    expect(legacy.carried).toHaveLength(2);
    expect(legacy.lapsed).toHaveLength(2);
    const reviewed = Object.fromEntries(legacy.carried.map((h) => [agentProposalOf(h)!.public_label, heldCardUnderReview(h)]));
    if (_name === 'the same model') expect(Object.values(reviewed)).toEqual([false, false]);
    if (_name === 'its revision moved') expect(reviewed['Estimate the oven price']).toBe(true);
    if (_name === 'a Run stored on it') expect(reviewed['Estimate the oven price']).toBe(false);
  });

  it.each(states)('on %s: each card is shown by the same rule', (_name, g) => {
    for (const h of [carrier(keep), carrier(old)]) {
      const record = proposalRecord(h, g, NOW)!;
      expect(programHoldApplies(h, g, hashOf(g))).toBe(heldRecordAppliesAt(h, record, g, hashOf(g)));
    }
    expect(programHoldApplies(carrier(keep), g, undefined)).toBe(heldRecordAppliesAt(carrier(keep), proposalRecord(carrier(keep), g, NOW)!, g, undefined));
  });

  it.each(states)('on %s: the reload offers the same waiting button', async (_name, g) => {
    const only = card(new ProposalStore(), graph, { label: 'The one waiting card' });
    const row = withApprovalOfferedOnRow(carrier(only, new Date().toISOString()), true);
    const input = { scenarioId: SCENARIO, userId: USER, graphHash: hashOf(g), latest: [row], graph: g, rows: [{ turn_id: 't-1' }],
      store: { readCommittedTurn: async () => ({ pending_actions: [row] }) } };
    const legacy = await readExecutableHeldProposalOffers(input);
    expect(await readProgramHeldOffers(input)).toEqual(legacy);
    // CONTRAST: on the same model the button is offered; when the revision moved it is not.
    if (_name === 'the same model') expect(legacy).toHaveLength(1);
    if (_name === 'its revision moved') expect(legacy).toEqual([]);
  });
});
