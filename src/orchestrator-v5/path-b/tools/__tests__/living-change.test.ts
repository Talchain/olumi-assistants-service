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
import { KNOWN_ANSWER, OPTION_EFFECTS } from '../../living-model/__tests__/fixtures.js';
import { changeOperationId } from '../core-write.js';
import { applyLivingChange, proposeLivingChange } from '../living-change.js';
import { isChangeProposal } from '../change-tools.js';
import type { Rec } from './fixtures.js';
import { applyKernel } from '../../living-model/kernel.js';

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
const saidInChat = () => ({ ...corrected().factors[0]!, said_in: 'chat' as const });
const args = (model: LivingModelT, remove: string[] = []) => ({ public_label: 'Set f to 0.6, as you said', basis: 'The person corrected f.', model, remove });

describe('a core scenario changes through its living model', () => {
  it('the proposal writes nothing and shows exactly the one changed item; the approval writes it once on its base', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected()));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    const data = (out as { data: Rec }).data;
    // The host marks the corrected figure as said in this conversation (`said_in`, DL 22 Oct): the card shows the model it saves.
    expect(data.changes).toEqual([{ kind: 'factor', id: 'f', change: 'change', before: KNOWN_ANSWER.factors[0], after: saidInChat() }]);
    expect(p.registered).toHaveLength(0);
    // Its card's press is this path's apply_change (the route's core card fast path), never the full lane's writer.
    expect(isChangeProposal(proposals.get(String(data.proposal_id)))).toBe(true);

    const base = computeGraphIdentityHash(p.saved() as never)!.value;
    const applied = await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String(data.proposal_id));
    expect(applied).toMatchObject({ status: 'ok', mutated: true, data: { saved: true } });
    const saved = corrected();
    saved.factors[0] = saidInChat();
    expect(p.registered).toEqual([{ graph: postimage(saved), thin_core: true, expected_graph_identity_hash: base,
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
    next.factors.push({ id: 'h', label: 'h', kind: 'factor', estimate_by: null, value: 3, low: null, high: null, unit: null, defined_as: null, limit: null, source: 'user', party: null, quote: 'h is about 3' });
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

/**
 * Codex r6 on #3522: a condition could never be corrected. An edit is a removal plus an addition, and every condition removal
 * was refused, so a met prerequisite kept withholding the goal chance. SYNTHETIC wording.
 */
describe('a condition is corrected through a proposal the person approves, and kept in history', () => {
  const REQUIRED = 'Only after supplier approval can f be pushed.';
  const OBTAINED = 'We got the supplier approval yesterday.';
  const gated = (): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER),
    conditions: [{ text: 'Only after supplier approval', applies_to: ['f_g'], role: 'prerequisite', source: 'user', party: null, quote: REQUIRED }] });
  const resolved = (): LivingModelT => ({ ...gated(),
    conditions: [{ text: 'Supplier approval obtained', applies_to: ['f_g'], role: 'assumption', source: 'user', party: null, quote: OBTAINED }] });
  const goal = (g: Rec) => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
  const said = { ...ctx, verified_user_messages: [REQUIRED], user_turn_text: OBTAINED };

  it('"only after supplier approval" → "supplier approval obtained": the approval lifts the withheld chance and keeps the old condition', async () => {
    const p = product(gated());
    expect(goal(p.saved())).not.toHaveProperty('goal_threshold_raw');
    const proposals = new ProposalStore();
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, said, args(resolved()));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    const changes = (out as { data: Rec }).data.changes as Rec[];
    expect(changes.map((c) => `${c.kind}:${c.change}`).sort()).toEqual(['condition:add', 'condition:remove', 'history:add']);
    expect(p.registered).toHaveLength(0);

    const applied = await applyLivingChange({ dispatch: p.dispatch, proposals }, said, String((out as { data: Rec }).data.proposal_id));
    expect(applied).toMatchObject({ status: 'ok', mutated: true });
    expect(goal(p.saved())).toMatchObject({ goal_threshold_raw: 100 });
    const saved = p.saved().living_model as LivingModelT;
    expect(saved.conditions.map((c) => c.text)).toEqual(['Supplier approval obtained']);
    expect(saved.history).toEqual([{ id: 'condition', change: 'superseded', old: JSON.stringify(gated().conditions[0]), quote: OBTAINED }]);
  });

  it('NEGATIVE: Olumi removing the person\'s condition only proposes it; nothing changes until the person approves', async () => {
    const p = product(gated());
    const proposals = new ProposalStore();
    const olumiOnly = { ...gated(), conditions: [] };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, { ...said, user_turn_text: 'Run it again.' }, args(olumiOnly));
    expect(out).toMatchObject({ status: 'ok' });
    expect(p.registered).toHaveLength(0);
    expect(goal(p.saved())).not.toHaveProperty('goal_threshold_raw');
    const id = String((out as { data: Rec }).data.proposal_id);
    // Codex r1 on #3576: this turn's words do not state the change, so the kept condition carries no one's words.
    expect((proposals.get(id)!.living_model as LivingModelT).history).toEqual([{ id: 'condition', change: 'superseded', old: JSON.stringify(gated().conditions[0]), quote: null }]);
    expect(await applyLivingChange({ dispatch: p.dispatch, proposals }, { ...said, authenticated_user_id: 'user-b' }, id))
      .toMatchObject({ status: 'refused', reason: 'not_authorised' });
    expect(p.registered).toHaveLength(0);
    expect((p.saved().living_model as LivingModelT).conditions.map((c) => c.role)).toEqual(['prerequisite']);
  });

  it('NEGATIVE: a history entry the AI writes for the removed condition, with words the person never said, is replaced by the host\'s', async () => {
    const p = product(gated());
    const proposals = new ProposalStore();
    const forged = { ...resolved(), history: [{ id: 'condition', change: 'superseded' as const, old: JSON.stringify(gated().conditions[0]),
      quote: 'I withdraw the supplier prerequisite.' }] };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, said, args(forged));
    const history = (proposals.get(String((out as { data: Rec }).data.proposal_id))!.living_model as LivingModelT).history;
    expect(history).toEqual([{ id: 'condition', change: 'superseded', old: JSON.stringify(gated().conditions[0]), quote: OBTAINED }]);
  });
});

/**
 * Codex r7 on #3522: a view could never be corrected. "Sam thinks push is too risky" → "Sam now supports push" read as a
 * removal plus an addition, and every view removal was refused, so a changed mind stayed recorded as dissent. SYNTHETIC wording.
 */
describe('a view is corrected by its holder\'s new view, and kept in history', () => {
  const NOW = 'Sam now supports pushing f.';
  const RISKY = KNOWN_ANSWER.views[0]!;
  const supports = (holder = 'Sam'): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER), views: [{ holder, position: 'now supports push', quote: NOW }] });
  const said = { ...ctx, user_turn_text: NOW };
  const proposed = (proposals: ProposalStore, out: unknown) => proposals.get(String((out as { data: Rec }).data.proposal_id))!.living_model as LivingModelT;

  it('"Sam thinks push is too risky" → "Sam now supports push": the approval saves the new view and keeps the old one in history', async () => {
    expect(RISKY).toMatchObject({ holder: 'Sam', position: 'thinks push is too risky' });
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, said, args(supports()));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    expect(((out as { data: Rec }).data.changes as Rec[]).map((c) => `${c.kind}:${c.change}`).sort()).toEqual(['history:add', 'view:add', 'view:remove']);
    expect(p.registered).toHaveLength(0);

    const applied = await applyLivingChange({ dispatch: p.dispatch, proposals }, said, String((out as { data: Rec }).data.proposal_id));
    expect(applied).toMatchObject({ status: 'ok', mutated: true });
    const saved = p.saved().living_model as LivingModelT;
    expect(saved.views).toEqual([{ holder: 'Sam', position: 'now supports push', quote: NOW }]);
    expect(saved.history).toEqual([{ id: 'view', change: 'superseded', old: JSON.stringify(RISKY), quote: NOW }]);
  });

  it('CONTRAST: another holder\'s view never replaces Sam\'s, and a view dropped with no replacement is still refused', async () => {
    const p = product(KNOWN_ANSWER);
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, said, args(supports('Alex'))))
      .toMatchObject({ status: 'refused', reason: 'cannot_remove_here', data: { kinds: ['view'] } });
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, said, args({ ...structuredClone(KNOWN_ANSWER), views: [] })))
      .toMatchObject({ status: 'refused', reason: 'cannot_remove_here', data: { kinds: ['view'] } });
  });

  it('NEGATIVE: a new view whose words this turn does not hold, the brief\'s included, is kept in history with no one\'s words', async () => {
    for (const [turn, quote] of [['Run it again.', NOW], [NOW, 'we need at least 100 units']]) {
      const proposals = new ProposalStore();
      const model = { ...supports(), views: [{ holder: 'Sam', position: 'now supports push', quote }] };
      const out = await proposeLivingChange({ dispatch: product(KNOWN_ANSWER).dispatch, proposals }, { ...said, user_turn_text: turn }, args(model));
      expect(out, quote).toMatchObject({ status: 'ok' });
      expect(proposed(proposals, out).history, quote).toEqual([{ id: 'view', change: 'superseded', old: JSON.stringify(RISKY), quote: null }]);
    }
  });

  // Codex r1 on #3579: a holder names a person, not a view.
  it('NEGATIVE: one new view of Sam\'s never replaces two; the one Sam changed pairs once the other is kept', async () => {
    const OUTSOURCE = { holder: 'Sam', position: 'thinks outsourcing is too risky', quote: 'Sam disagrees' };
    const twoViews = { ...structuredClone(KNOWN_ANSWER), views: [RISKY, OUTSOURCE] };
    const p = product(twoViews);
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, said, args(supports())))
      .toMatchObject({ status: 'refused', reason: 'cannot_remove_here', data: { kinds: ['view'] } });
    const proposals = new ProposalStore();
    const keeps = { ...supports(), views: [{ holder: ' sam ', position: 'now supports push', quote: NOW }, OUTSOURCE] };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, said, args(keeps));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    expect(proposed(proposals, out).history).toEqual([{ id: 'view', change: 'superseded', old: JSON.stringify(RISKY), quote: NOW }]);
  });

  it('NEGATIVE: a history entry the AI writes for the replaced view is the host\'s instead, and saved history is never removed', async () => {
    const proposals = new ProposalStore();
    const forged = { ...supports(), history: [{ id: 'view', change: 'superseded' as const, old: JSON.stringify(RISKY), quote: 'I withdraw my objection.' }] };
    const out = await proposeLivingChange({ dispatch: product(KNOWN_ANSWER).dispatch, proposals }, said, args(forged));
    expect(proposed(proposals, out).history).toEqual([{ id: 'view', change: 'superseded', old: JSON.stringify(RISKY), quote: NOW }]);

    const withHistory = { ...supports(), history: [{ id: 'view', change: 'superseded' as const, old: JSON.stringify(RISKY), quote: NOW }] };
    expect(await proposeLivingChange({ dispatch: product(withHistory).dispatch, proposals: new ProposalStore() }, said, args({ ...withHistory, history: [] })))
      .toMatchObject({ status: 'refused', reason: 'cannot_remove_here', data: { kinds: ['history'] } });
  });
});

describe('DL 22 Oct (Lenses\' step 3): the person\'s approved chat correction is saved as theirs, never as the brief\'s figure', () => {
  const nodeOf = (g: Rec, id: string) => (g.nodes as Rec[]).find((n) => n.id === id)!;
  const factorOf = (g: Rec, id: string) => ((g.living_model as LivingModelT).factors).find((f) => f.id === id)!;
  /** The correction (this turn's words) and, in the SAME change, an item in the brief's own words. */
  const withBriefItem = (): LivingModelT => {
    const m = corrected();
    m.factors.push({ id: 'h', label: 'h', kind: 'factor', estimate_by: null, value: 1, low: null, high: null, unit: null, defined_as: null, limit: null,
      said_in: null, source: 'user', party: null, quote: 'push f to 1' });
    return m;
  };

  it('approve: the corrected figure is the person\'s chat edit (user_override); the brief\'s words in the same change stay the brief\'s', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    expect(nodeOf(p.saved(), 'f').observed_state, 'precondition: the brief\'s figure').toMatchObject({ source: 'brief_extraction', raw_value: 0.5 });
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(withBriefItem()));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    expect(nodeOf(p.saved(), 'f').observed_state, 'a proposal writes nothing').toMatchObject({ source: 'brief_extraction', raw_value: 0.5 });
    await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((out as { data: Rec }).data.proposal_id));
    expect(nodeOf(p.saved(), 'f').observed_state).toMatchObject({ source: 'user_override', raw_value: 0.6 });
    expect(factorOf(p.saved(), 'f')).toMatchObject({ source: 'user', quote: 'Actually f is at 0.6 now.', said_in: 'chat' });
    // CONTRAST: the brief's own words, approved in the same change, are still the brief's.
    expect(nodeOf(p.saved(), 'h').observed_state).toMatchObject({ source: 'brief_extraction', raw_value: 1 });
    expect(factorOf(p.saved(), 'h')).not.toHaveProperty('said_in');
  });

  it('a later change keeps it: the unchanged corrected figure is still the person\'s chat edit', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected()));
    await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((first as { data: Rec }).data.proposal_id));
    const later = { ...ctx, turn_id: 'turn-2', user_turn_text: 'Also m is about 2.' };
    const next = structuredClone(p.saved().living_model as LivingModelT);
    next.factors.push({ id: 'm', label: 'm', kind: 'factor', estimate_by: null, value: 2, low: null, high: null, unit: null, defined_as: null, limit: null,
      said_in: null, source: 'user', party: null, quote: 'Also m is about 2.' });
    const second = await proposeLivingChange({ dispatch: p.dispatch, proposals }, later, args(next));
    expect(second.status, JSON.stringify(second)).toBe('ok');
    await applyLivingChange({ dispatch: p.dispatch, proposals }, later, String((second as { data: Rec }).data.proposal_id));
    expect(nodeOf(p.saved(), 'f').observed_state).toMatchObject({ source: 'user_override', raw_value: 0.6 });
    expect(nodeOf(p.saved(), 'm').observed_state).toMatchObject({ source: 'user_override', raw_value: 2 });
  });

  it('INVARIANCE (DL): with said_in absent or null the saved graph is byte for byte today\'s; "chat" moves only that figure\'s stamp', () => {
    for (const m of [KNOWN_ANSWER, OPTION_EFFECTS]) {
      const absent = structuredClone(m);
      for (const f of absent.factors) delete (f as Partial<typeof f>).said_in;
      const nulls: LivingModelT = { ...m, factors: m.factors.map((f) => ({ ...f, said_in: null })) };
      expect(JSON.stringify(mapLivingModel(nulls))).toBe(JSON.stringify(mapLivingModel(absent)));
    }
    const chat: LivingModelT = { ...KNOWN_ANSWER, factors: KNOWN_ANSWER.factors.map((f) => ({ ...f, said_in: 'chat' as const })) };
    const before = mapLivingModel(KNOWN_ANSWER);
    const after = mapLivingModel(chat);
    const stampOf = (g: typeof before) => (g.graph.nodes as Rec[]).find((n) => n.id === 'f')!.observed_state as Rec;
    expect([stampOf(before).source, stampOf(after).source]).toEqual(['brief_extraction', 'user_override']);
    const unstamped = (g: typeof before) => JSON.stringify({ ...g, graph: { ...g.graph, nodes: (g.graph.nodes as Rec[]).map((n) =>
      (n.id === 'f' ? { ...n, observed_state: { ...(n.observed_state as Rec), source: null } } : n)) } });
    expect(unstamped(after)).toBe(unstamped(before));
  });

  it('the AI cannot set it through propose_change (DL): what it sends is replaced by the host\'s reading, both ways', async () => {
    const p = product(KNOWN_ANSWER);
    const sent = withBriefItem();
    sent.factors = sent.factors.map((f) => ({ ...f, said_in: f.id === 'f' ? null : 'chat' as const }));
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, ctx, args(sent));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    const after = Object.fromEntries(((out as { data: Rec }).data.changes as Rec[]).map((c) => [c.id, (c.after as Rec).said_in ?? null]));
    expect(after).toEqual({ f: 'chat', h: null });
  });

  it('Codex r1 on #3661: the AI clearing the mark never reauthors the person\'s saved chat figure, after its words leave the window', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals }, ctx, args(corrected()));
    await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((first as { data: Rec }).data.proposal_id));
    // A later turn: the correction's words are no longer in the verified window, and the AI sends f unchanged with said_in null.
    const later = { ...ctx, turn_id: 'turn-2', verified_user_messages: [], user_turn_text: 'Also m is about 2.' };
    const next = structuredClone(p.saved().living_model as LivingModelT);
    next.factors = next.factors.map((f) => (f.id === 'f' ? { ...f, said_in: null } : f));
    next.factors.push({ id: 'm', label: 'm', kind: 'factor', estimate_by: null, value: 2, low: null, high: null, unit: null, defined_as: null, limit: null,
      source: 'user', party: null, quote: 'Also m is about 2.' });
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, later, args(next));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    expect(((out as { data: Rec }).data.relabelled as Rec[]).map((r) => r.id)).not.toContain('f');
    await applyLivingChange({ dispatch: p.dispatch, proposals }, later, String((out as { data: Rec }).data.proposal_id));
    expect(factorOf(p.saved(), 'f')).toMatchObject({ source: 'user', said_in: 'chat' });
    expect(nodeOf(p.saved(), 'f').observed_state).toMatchObject({ source: 'user_override', raw_value: 0.6 });
  });

  it('the person\'s own words for Olumi\'s or an unverified figure, verbatim in their chat, label it theirs (numbers unchanged)', async () => {
    const said = 'We measured f at 0.5.';
    for (const was of ['olumi', 'unverified'] as const) {
      const saved = structuredClone(KNOWN_ANSWER);
      saved.factors[0] = { ...saved.factors[0]!, source: was, quote: null, low: 0.3, high: 0.7 };
      const p = product(saved);
      const proposals = new ProposalStore();
      const adopted = structuredClone(saved);
      adopted.factors[0] = { ...adopted.factors[0]!, source: 'user', quote: said };
      const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, { ...ctx, user_turn_text: said }, args(adopted));
      expect(out.status, `${was}: ${JSON.stringify(out)}`).toBe('ok');
      await applyLivingChange({ dispatch: p.dispatch, proposals }, { ...ctx, user_turn_text: said }, String((out as { data: Rec }).data.proposal_id));
      expect(factorOf(p.saved(), 'f'), was).toMatchObject({ source: 'user', said_in: 'chat', value: 0.5 });
      expect(nodeOf(p.saved(), 'f').observed_state, was).toMatchObject({ source: 'user_override', raw_value: 0.5 });
    }
  });

  it('a quote found nowhere in the person\'s words is no one\'s: unverified, never labelled (the plan\'s fallback)', async () => {
    const p = product(KNOWN_ANSWER);
    const sent = corrected();
    sent.factors[0] = { ...sent.factors[0]!, quote: 'We moved f to 0.6 last week.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, ctx, args(sent));
    expect(out.status, JSON.stringify(out)).toBe('ok');
    const f = ((out as { data: Rec }).data.changes as Rec[]).find((c) => c.id === 'f')!.after as Rec;
    expect(f.source).toBe('unverified');
    expect(f.said_in ?? null).toBeNull();
  });

  it('the label is the person\'s words, never a figure proof: words with no figure, found verbatim in their chat, label the item', () => {
    const said = 'Please update f.';
    const sent = structuredClone(KNOWN_ANSWER);
    sent.factors[0] = { ...sent.factors[0]!, value: 0.6, quote: said };
    expect(applyKernel(sent, [BRIEF, said], KNOWN_ANSWER, BRIEF).model.factors[0]!.said_in).toBe('chat');
    // CONTRAST: the same words only in the brief are the brief's.
    expect(applyKernel(sent, [said], KNOWN_ANSWER, said).model.factors[0]).not.toHaveProperty('said_in');
    // Brief words repeated in a chat message stay the brief's (a first message is often the brief itself, give or take a word).
    const briefSaid = structuredClone(KNOWN_ANSWER);
    briefSaid.factors[0] = { ...briefSaid.factors[0]!, value: 0.6, quote: 'f is at 0.5' };
    expect(applyKernel(briefSaid, [BRIEF, `As I said, ${BRIEF}`], KNOWN_ANSWER, BRIEF).model.factors[0]).not.toHaveProperty('said_in');
    // Only the person's own items: Olumi's, or a named party's, are never labelled, whatever words are quoted.
    for (const who of [{ source: 'olumi' as const, party: null }, { source: 'party' as const, party: 'Sam' }]) {
      const theirs = structuredClone(sent);
      theirs.factors[0] = { ...theirs.factors[0]!, ...who };
      expect(applyKernel(theirs, [BRIEF, said], KNOWN_ANSWER, BRIEF).model.factors[0], who.source).not.toHaveProperty('said_in');
    }
    // The person's factor with Olumi's estimated figure is never labelled theirs, whatever words are quoted.
    const olumiFigure = structuredClone(KNOWN_ANSWER);
    olumiFigure.factors[0] = { ...olumiFigure.factors[0]!, value: 0.7, estimate_by: 'olumi' };
    const estimate = structuredClone(olumiFigure);
    estimate.factors[0] = { ...estimate.factors[0]!, quote: said };
    expect(applyKernel(estimate, [BRIEF, said], olumiFigure, BRIEF).model.factors[0]).toMatchObject({ estimate_by: 'olumi' });
    expect(applyKernel(estimate, [BRIEF, said], olumiFigure, BRIEF).model.factors[0]).not.toHaveProperty('said_in');
  });

  it('the host sets it, never the AI: an unchanged brief figure the AI marks "chat" stays the brief\'s; a first draft says nothing', () => {
    const marked = structuredClone(KNOWN_ANSWER);
    marked.factors[0] = { ...marked.factors[0]!, said_in: 'chat' };
    expect(applyKernel(marked, [BRIEF], KNOWN_ANSWER, BRIEF).model.factors[0]).not.toHaveProperty('said_in');
    expect(applyKernel(marked, [BRIEF]).model.factors[0], 'a draft: the brief\'s').not.toHaveProperty('said_in');
    // An unknown brief cannot tell chat from brief: as before (null), never a guess.
    expect(applyKernel(corrected(), [BRIEF, ctx.user_turn_text], KNOWN_ANSWER, null).model.factors[0]).not.toHaveProperty('said_in');
    expect(applyKernel(corrected(), [BRIEF, ctx.user_turn_text], KNOWN_ANSWER, BRIEF).model.factors[0]!.said_in).toBe('chat');
  });
});
