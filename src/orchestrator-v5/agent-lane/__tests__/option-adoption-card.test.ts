import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, MUTATION_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import { optionAdoptionApproveMessage } from '../option-adoption-card.js';
import { carrierForAnswerRow, offeredApproveChipOnRow, proposalPendingAction, rehydrateProposals, type LiveCarrier } from '../durable-proposal.js';
import { applyOptionAdoptEdit, optionAdoptReadingToken } from '../../system-events/option-adopt-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { parsePendingAction } from '../../session/pending-action.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8')) as { runs: { run: number; graph: Json }[] };
const baseGraph = (): Json => {
  const graph = structuredClone(fixture.runs.find((r) => r.run === 0)!.graph);
  graph.nodes.find((n: Json) => n.id === 'raise_to_54').proposed_by = 'olumi';
  return graph;
};
const hashOf = (g: Json): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null, request_id: 'r' };

function world() {
  const state = { graph: baseGraph(), writes: 0, sent: [] as CommitOptionLevelsInput[] };
  const store = new ProposalStore();
  const dispatch: InternalDispatch = async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`unexpected dispatch ${path}`);
    return { status: 200, json: { graph: state.graph, graph_hash: hashOf(state.graph) } };
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    state.sent.push(input);
    const adoption = input.adopt_option!;
    const edit = applyOptionAdoptEdit({ persistedGraph: state.graph, option_id: adoption.option_id,
      words: adoption.words, reading_token: adoption.reading_token, expected_graph_hash: input.base_graph_hash });
    if (edit.kind === 'refused') return { status: 'refused', reason: `adopt_${edit.reason}` };
    state.graph = edit.mutatedGraph as Json;
    state.writes += 1;
    return { status: 'committed', graph_hash: hashOf(state.graph), already_applied: false,
      committed_levels: [], links_resized: [],
      receipt: { version: 2, version_id: 'v2', mutation_id: 'm2', source_turn_id: 't' } };
  };
  const caps = createAgentCapabilities(dispatch, store, undefined, 'full', undefined, { commitOptionLevels });
  const offer = () => caps.proposeOptionAdoption!(ctx, { option_id: 'raise_to_54' });
  const chips = (result: Json) => approvalChipsFor([
    { name: 'propose_option_adoption', ok: true, mutated: false, proposal_id: String(result.proposal_id) },
  ], (id) => ({ proposal: store.get(id), result: result as never }));
  const approve = (id: string, message: string, pressed = true) => caps.authoriseChange({ ...ctx,
    ...(pressed ? { typed_approval_of: id, typed_approval_words: message } : {}) }, { proposal_id: id });
  return { state, store, caps, offer, chips, approve };
}

describe('saved Olumi option adoption through an explicit approval card', () => {
  it('shows the stored reading, then makes one canonical write and verifies the marker cleared', async () => {
    const w = world();
    expect(MUTATION_TOOLS).toContain('propose_option_adoption');
    const offered = await dispatchTool('propose_option_adoption', JSON.stringify({ option_id: 'raise_to_54' }), ctx, w.caps) as Json;
    expect(offered).toMatchObject({ ok: true, mutated: false, card: { words: expect.stringContaining('Olumi suggested') } });
    expect(w.state.writes).toBe(0);
    const chip = w.chips(offered)[0]!;
    expect(chip).toMatchObject({ id: approvalChipIdFor(offered.proposal_id), label: 'Add to comparison',
      detail: offered.card.words, message: optionAdoptionApproveMessage(offered.card.words) });
    const beforeHash = hashOf(w.state.graph);
    const applied = await w.approve(offered.proposal_id, chip.message!) as Json;
    expect(applied).toMatchObject({ ok: true, applied: true, mutated: true, receipts: [{ version: 2 }] });
    expect(String(applied.follow_up)).toContain('run it again');
    expect(w.state.writes).toBe(1);
    expect(w.state.sent[0]).toMatchObject({ base_graph_hash: beforeHash, links: [], levels: [],
      adopt_option: { option_id: 'raise_to_54', words: offered.card.words,
        reading_token: optionAdoptReadingToken({ option_id: 'raise_to_54', words: offered.card.words }) } });
    expect(w.state.graph.nodes.find((n: Json) => n.id === 'raise_to_54').proposed_by).toBeUndefined();
    expect(hashOf(w.state.graph)).not.toBe(beforeHash);
    const again = await w.approve(offered.proposal_id, chip.message!) as Json;
    expect(again).toMatchObject({ ok: true, applied: true, already_applied: true, mutated: false });
    expect(w.state.writes).toBe(1);
  });

  it('words or a proposal id alone never approve an option', async () => {
    const w = world();
    const offered = await w.offer() as Json;
    const chip = w.chips(offered)[0]!;
    expect(await w.approve(offered.proposal_id, chip.message!, false)).toMatchObject({ ok: false, reason: 'approve_on_the_card' });
    expect(await w.approve(offered.proposal_id, chip.message!.replace('Olumi suggested', 'The user chose')))
      .toMatchObject({ ok: false, reason: 'reading_not_confirmed' });
    expect(w.state.writes).toBe(0);
  });

  it('a restarted worker and replay still show the full consent reading before approval', async () => {
    const w = world();
    const offered = await w.offer() as Json;
    const chip = w.chips(offered)[0]!;
    const proposal = w.store.get(offered.proposal_id)!;
    const subject = { scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id };
    const pending = parsePendingAction(JSON.parse(JSON.stringify(proposalPendingAction(proposal, chip,
      { scenario_id: ctx.scenario_id, emitted_at_iso: new Date().toISOString() }))));
    expect(pending).not.toBeNull();
    const freshStore = new ProposalStore();
    let restored: LiveCarrier | undefined;
    expect(rehydrateProposals([pending], freshStore, subject, Date.now(), (carrier) => { restored = carrier; })).toBe(1);
    expect(restored?.chip).toEqual(chip);
    expect(offeredApproveChipOnRow([pending!], subject)).toEqual(chip);
    expect(w.state.writes).toBe(0);

    const carried = carrierForAnswerRow({ offered: undefined, carried: restored, store: freshStore,
      subject, currentGraphHash: hashOf(w.state.graph), emittedAtIso: new Date().toISOString() });
    expect(carried).toBeDefined();
    let restoredAfterCarry: LiveCarrier | undefined;
    expect(rehydrateProposals([carried], new ProposalStore(), subject, Date.now(), (carrier) => { restoredAfterCarry = carrier; })).toBe(1);
    expect(restoredAfterCarry?.chip.detail).toBe(chip.detail);
    expect(offeredApproveChipOnRow([carried!], subject)).toBeUndefined();

    const changedMessage = structuredClone(pending!);
    (changedMessage.action as { public_message: string }).public_message = 'Yes, add it.';
    let changedCarrier: LiveCarrier | undefined;
    expect(rehydrateProposals([changedMessage], new ProposalStore(), subject, Date.now(), (carrier) => { changedCarrier = carrier; })).toBe(1);
    expect(changedCarrier?.chip.detail).toBeUndefined();
    expect(offeredApproveChipOnRow([changedMessage], subject)?.detail).toBeUndefined();
  });

  it('a moved model invalidates the displayed card before the writer is called', async () => {
    const w = world();
    const offered = await w.offer() as Json;
    const chip = w.chips(offered)[0]!;
    w.state.graph.nodes.find((n: Json) => n.id === 'raise_to_59').interventions = { changed: { value: 0.7 } };
    expect(await w.approve(offered.proposal_id, chip.message!)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(w.state.sent).toEqual([]);
  });

  it('an unmarked option is not offered, and read-only preview cannot propose', async () => {
    const w = world();
    expect(await w.caps.proposeOptionAdoption!(ctx, { option_id: 'raise_to_59' })).toMatchObject({ ok: false, refusal: 'not_proposed' });
    expect(await dispatchTool('propose_option_adoption', JSON.stringify({ option_id: 'raise_to_54' }), ctx, w.caps, 'preview'))
      .toMatchObject({ ok: false, refusal: 'read_only_preview' });
  });
});
