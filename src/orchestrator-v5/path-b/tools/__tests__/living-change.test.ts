/**
 * THIN CORE CHANGE: on a core scenario a proposal is the COMPLETE next living model; it writes nothing; the card is exactly
 * its per-item diff; the approval writes that model and its regenerated graph as ONE core write on the proposal's base, and
 * a retry, a moved model and an earlier own save each say what is true. A stateful product double (CAS on the identity,
 * versions by operation); the kernel, the mapper and the write are real. SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { KNOWN_ANSWER } from '../../living-model/__tests__/fixtures.js';
import { changeOperationId } from '../core-write.js';
import { applyLivingChange, proposeLivingChange } from '../living-change.js';
import { isChangeProposal } from '../change-tools.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_1';
const BRIEF = 'we need at least 100 units; today we are at 70. f is at 0.5. push f to 1, or we hold. each +1 in f adds 50 units on average, with a standard deviation of 10';
const postimage = (m: LivingModelT): Rec => ({ ...mapLivingModel(m).graph, living_model: m });

/** The product's graph, register and versions routes over one saved scenario, with CAS on the full identity. */
function product(initial: LivingModelT) {
  let graph = postimage(initial);
  const registered: Rec[] = [];
  const identity = () => computeGraphIdentityHash(graph as never)!;
  const dispatch = vi.fn(async (path: string, body?: unknown) => {
    const b = (body ?? {}) as Rec;
    if (path.endsWith('/graph/register')) {
      if (b.expected_graph_identity_hash !== identity().value) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph as Rec;
      registered.push(b);
      return { status: 200, json: { graph_identity_hash: identity(), graph_hash: computeAnalysisAffectingGraphHash(graph as never),
        model_version: { version_id: `v_${registered.length + 1}`, version_number: registered.length + 1, mutation_id: `m_${registered.length}`,
          creation_kind: 'committed_mutation', graph_identity_hash: identity().value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(graph as never) } } };
    }
    if (path.endsWith('/versions')) {
      return { status: 200, json: { versions: registered.map((r, i) => ({ version_id: `v_${i + 2}`, sequence: i + 2,
        creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId(SID, String(r.operation_id)) } })) } };
    }
    return { status: 200, json: { graph, brief_text: BRIEF, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: identity() } };
  });
  return { dispatch, registered, saved: () => graph, move: (m: LivingModelT) => { graph = postimage(m); } };
}

const ctx = { scenario_id: SID, authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [] as string[], user_turn_text: 'Actually f is at 0.6 now.' };
const corrected = (): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.factors[0] = { ...m.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
  return m;
};
const args = (model: LivingModelT, remove: string[] = []) => ({ public_label: 'Set f to 0.6, as you said', basis: 'The person corrected f.', model, remove });

describe('a core scenario changes through its living model', () => {
  it('the proposal writes nothing and shows exactly the one changed item; the approval writes it once on its base', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected()));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    const data = (out as { data: Rec }).data;
    expect(data.changes).toEqual([{ kind: 'factor', id: 'f', change: 'change', before: KNOWN_ANSWER.factors[0], after: corrected().factors[0] }]);
    expect(p.registered).toHaveLength(0);
    // Its card's press is this path's apply_change (the route's core card fast path), never the full lane's writer.
    expect(isChangeProposal(proposals.get(String(data.proposal_id)))).toBe(true);

    const base = computeGraphIdentityHash(p.saved() as never)!.value;
    const applied = await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String(data.proposal_id));
    expect(applied).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    expect(p.registered).toEqual([{ graph: postimage(corrected()), thin_core: true, expected_graph_identity_hash: base,
      operation_id: changeOperationId(SID, String(data.proposal_id)) }]);
    expect((p.saved().nodes as Rec[]).find((n) => n.id === 'f')).toMatchObject({ observed_state: { value: 0.6, raw_value: 0.6 } });

    // A retry of the same approval is that operation's earlier save, never a second write.
    const again = await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String(data.proposal_id));
    expect(again).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
    expect(p.registered).toHaveLength(1);
  });

  it('a model that moved after the proposal supersedes it: nothing is written', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected()));
    const moved = structuredClone(KNOWN_ANSWER);
    moved.views.push({ holder: 'Ana', position: 'prefers hold', quote: null });
    p.move(moved);
    const applied = await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((out as { data: Rec }).data.proposal_id));
    expect(applied).toMatchObject({ status: 'refused', reason: 'superseded' });
    expect(p.registered).toHaveLength(0);
  });

  it('a saved person\'s item carried over unchanged keeps its label; a new "user" item whose words they never wrote is unverified', async () => {
    const p = product(KNOWN_ANSWER);
    const next = corrected();
    next.factors.push({ id: 'h', label: 'h', value: 3, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: 'h is about 3' });
    // The brief's words are gone from this turn's window: only the saved model vouches for the carried-over items.
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, { ...ctx, verified_user_messages: [] }, args(next));
    const data = (out as { data: Rec }).data;
    expect(data.relabelled).toEqual([{ id: 'h', was: 'user' }]);
    const after = (data.changes as Rec[]);
    expect(after.find((c) => c.id === 'h')).toMatchObject({ change: 'add', after: { source: 'unverified' } });
    expect(after.find((c) => c.id === 'f')).toMatchObject({ after: { source: 'user', value: 0.6 } });
    expect(after.some((c) => c.id === 'g' || c.id === 'push' || c.id === 'f_g')).toBe(false);
  });

  it('an item left out is never removed unseen: a removal must be named, and a view is never removed here', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const omits = corrected();
    omits.options = omits.options.filter((o) => o.id !== 'hold');
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(omits)))
      .toMatchObject({ status: 'refused', reason: 'removal_not_named', data: { left_out: ['hold'] } });
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected(), ['hold'])))
      .toMatchObject({ status: 'refused', reason: 'removal_not_applied', data: { still_present: ['hold'] } });
    const named = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(omits, ['hold']));
    expect(named).toMatchObject({ status: 'ok' });
    const noView = corrected();
    noView.views = [];
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(noView)))
      .toMatchObject({ status: 'refused', reason: 'cannot_remove_here', data: { kinds: ['view'] } });
  });

  it('no change, or a scenario without a living model, prepares nothing', async () => {
    const p = product(KNOWN_ANSWER);
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, ctx, args(structuredClone(KNOWN_ANSWER))))
      .toMatchObject({ status: 'refused', reason: 'no_change' });
    const legacy = product(KNOWN_ANSWER);
    legacy.dispatch.mockImplementation((async () => ({ status: 200, json: { graph: mapLivingModel(KNOWN_ANSWER).graph, graph_hash: 'h', graph_identity_hash: 'i' } })) as never);
    expect(await proposeLivingChange({ dispatch: legacy.dispatch, proposals: new ProposalStore() }, ctx, args(corrected())))
      .toMatchObject({ status: 'refused', reason: 'not_a_core_scenario' });
  });
});
