/**
 * ⭐ CLASS 3: THE MAPPER'S VERDICT AS TOOL FEEDBACK. A draft or a change whose OWN encoding of an item on the goal's path would
 * withhold the goal's chance is said back once, with the typed reasons, and nothing is written; the agent's next call is saved
 * (or carded) as it is. A cause only the person's input can settle never triggers it, nor does a clean model, and a change
 * answers only for the causes it adds. A stateful product double; the kernel, the mapper and the write are real. SYNTHETIC wording.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunContext, type FunctionTool } from '@openai/agents';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { KNOWN_ANSWER } from '../../living-model/__tests__/fixtures.js';
import { F1_CONTRADICTED, F1_OTHER_CAUSE } from '../../living-model/__tests__/track2-f1-identity.fixtures.js';
import { buildModel } from '../draft-tool.js';
import { proposeLivingChange } from '../living-change.js';
import { pathBTools, type ToolCallResult } from '../index.js';
import type { TraceRow } from '../outcome.js';
import { goalPathEncodingCauses, KEPT_AS_REFUSED, personContentLost, RESTRUCTURE_CHANGE, RESTRUCTURE_DRAFT, type Restructure } from '../goal-path.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_1';
const BRIEF = 'we need at least 100 units; today we are at 70. f is at 0.5. push f to 1, or we hold. each +1 in f adds 50 units on average, with a standard deviation of 10';
const postimage = (m: LivingModelT): Rec => ({ ...mapLivingModel(m).graph, living_model: m });
const PREREQ = 'only once the board signs off';

/** The product's graph, register and versions routes over one scenario (empty, or saved), with CAS on the full identity. */
function product(initial: LivingModelT | null) {
  let graph: Rec | null = initial === null ? null : postimage(initial);
  const registered: Rec[] = [];
  const identity = () => computeGraphIdentityHash(graph as never)!;
  const dispatch = vi.fn(async (path: string, body?: unknown) => {
    const b = (body ?? {}) as Rec;
    if (path.endsWith('/graph/register')) {
      if (b.expected_graph_identity_hash !== (graph === null ? null : identity().value)) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph as Rec;
      registered.push(b);
      return { status: 200, json: { graph_identity_hash: identity(), graph_hash: computeAnalysisAffectingGraphHash(graph as never),
        model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
          creation_kind: 'committed_mutation', graph_identity_hash: identity().value, analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(graph as never) } } };
    }
    if (path.endsWith('/versions')) {
      return { status: 200, json: { versions: registered.map((r, i) => ({ version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-22T18:00:00.000Z',
        creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId(SID, String(r.operation_id)) } })) } };
    }
    if (graph === null) return { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } };
    return { status: 200, json: { graph, brief_text: BRIEF, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: identity() } };
  });
  return { dispatch, registered, saved: () => graph };
}

const withCondition = (role: 'prerequisite' | 'assumption' | 'challenge', base: LivingModelT = KNOWN_ANSWER): LivingModelT =>
  ({ ...structuredClone(base), conditions: [{ text: PREREQ, applies_to: ['f_g'], role, source: 'olumi', party: null, quote: null }] });
/** A setting in a unit its factor cannot take: withheld, but only the person's input settles it. */
const unconvertible = (): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.factors[0] = { ...m.factors[0]!, unit: 'kg' };
  m.options[1]!.settings[0] = { ...m.options[1]!.settings[0]!, unit: 'hours' };
  return m;
};
const goalOf = (graph: Rec | null): Rec | undefined => ((graph?.nodes ?? []) as Rec[]).find((n) => n.kind === 'goal');
const draftCtx = { scenario_id: SID, verified_user_messages: [BRIEF], user_turn_text: BRIEF };
const changeCtx = { scenario_id: SID, authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [] as string[], user_turn_text: 'Actually f is at 0.6 now.' };
const change = (model: LivingModelT) => ({ public_label: 'Update the model', basis: 'The person asked for it.', model, remove: [] as string[] });

describe('a draft whose own encoding withholds its goal is said back once, then saved as the agent sends it', () => {
  it('a prerequisite on the goal\'s path: refused with its typed cause and nothing written; the restructured draft is saved with its chance', async () => {
    const p = product(null);
    const restructure = { offered: false };
    const first = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    expect(first).toEqual({ status: 'refused', reason: 'goal_path_withheld', detail: RESTRUCTURE_DRAFT,
      data: { goal_path: [{ id: `condition:${PREREQ}`, reason: 'condition_not_in_slice', item: PREREQ, applies_to: ['f_g'] }], save_outcome: 'VERIFIED_NO_WRITE' } });
    expect(p.registered).toHaveLength(0);
    expect(restructure.offered).toBe(true);

    // The agent restructures: the board's sign-off is an assumption the result is worked out under. Same figures, saved once.
    const second = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('assumption') });
    expect(second).toMatchObject({ status: 'ok', mutated: true, data: { save_outcome: 'VERIFIED_SAVED' } });
    expect(p.registered).toHaveLength(1);
    expect(goalOf(p.saved())?.goal_threshold).toBe(0.8);
  });

  it('the bound: the same draft sent again is saved as it is, its chance withheld and said', async () => {
    const p = product(null);
    const restructure = { offered: false };
    await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    const again = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    expect(again).toMatchObject({ status: 'ok', mutated: true, data: { draft: { withheld: expect.arrayContaining([{ id: 'g', reason: 'chance_rests_on_withheld' }]) } } });
    expect(p.registered).toHaveLength(1);
    expect(goalOf(p.saved())?.goal_threshold).toBeUndefined();
  });

  it('Codex r1: ONLY a prerequisite is offered. An unsigned link (maybe the person\'s own uncertainty), an "exact" figure and a cause into a defined total are withheld and saved as before', async () => {
    const unsigned = structuredClone(KNOWN_ANSWER);
    unsigned.links[0] = { ...unsigned.links[0]!, effect: { ...unsigned.links[0]!.effect, sign: null } };
    const exact = structuredClone(KNOWN_ANSWER);
    exact.links[0] = { ...exact.links[0]!, effect: { ...exact.links[0]!.effect, form: 'exact', sd: null } };
    for (const [model, reason] of [[unsigned, 'link_sign_unknown'], [exact, 'exact_not_drawable']] as const) {
      expect(mapLivingModel(model).rests_on, 'withheld on the path, as before').toEqual([{ id: 'f_g', reason }]);
      const p = product(null);
      const restructure = { offered: false };
      const out = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model });
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
      expect(restructure.offered).toBe(false);
    }
    expect(mapLivingModel(F1_OTHER_CAUSE).rests_on).toEqual([{ id: 'mkt_total', reason: 'identity_other_cause' }]);
    expect(goalPathEncodingCauses(mapLivingModel(F1_OTHER_CAUSE))).toEqual([]);
    expect(goalPathEncodingCauses(mapLivingModel(F1_CONTRADICTED))).toEqual([]);
  });

  it('CONTRAST: a cause only the person\'s input settles, a clean model, an assumption or a challenge: saved on the first call, no offer used', async () => {
    for (const model of [unconvertible(), KNOWN_ANSWER, withCondition('assumption'), withCondition('challenge')]) {
      const p = product(null);
      const restructure = { offered: false };
      const out = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model });
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
      expect(restructure.offered).toBe(false);
    }
    // The input-only case is still withheld and said, as before: the offer is not how it is asked for.
    expect(mapLivingModel(unconvertible()).withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
  });

  it('CONTRAST: a caller without the turn\'s offer (any other route) saves the draft as before', async () => {
    const p = product(null);
    const out = await buildModel({ dispatch: p.dispatch }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    expect(out).toMatchObject({ status: 'ok', mutated: true });
  });
});

describe('a change answers once for the goal-path causes it ADDS', () => {
  it('a change adding a prerequisite on the path: no card and no proposal; the restructured change gets its card', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const restructure = { offered: false };
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, change(withCondition('prerequisite')));
    expect(first).toEqual({ status: 'refused', reason: 'goal_path_withheld', detail: RESTRUCTURE_CHANGE,
      data: { goal_path: [{ id: `condition:${PREREQ}`, reason: 'condition_not_in_slice', item: PREREQ, applies_to: ['f_g'] }] } });
    expect(restructure.offered).toBe(true);
    const second = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, change(withCondition('challenge')));
    expect(second).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(p.registered).toHaveLength(0);
  });

  it('a change on a base already withheld, adding no cause, gets its card at once; the offer is not used', async () => {
    const base = withCondition('prerequisite');
    const p = product(base);
    const restructure = { offered: false };
    const next = structuredClone(base);
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(restructure.offered).toBe(false);
  });

  it('Codex r1: a prerequisite with the same words on ANOTHER item is one the change adds: no card yet', async () => {
    const base = withCondition('prerequisite');
    const p = product(base);
    const next = structuredClone(base);
    next.conditions.push({ ...next.conditions[0]!, applies_to: ['f'] });
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure: { offered: false } }, changeCtx, change(next));
    expect(out).toMatchObject({ status: 'refused', reason: 'goal_path_withheld',
      data: { goal_path: [{ id: `condition:${PREREQ}`, reason: 'condition_not_in_slice', item: PREREQ, applies_to: ['f'] }] } });
  });

  it('one offer per turn, shared: once the draft used it, a change adding a cause gets its card', async () => {
    const p = product(KNOWN_ANSWER);
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure: { offered: true } }, changeCtx,
      change(withCondition('prerequisite')));
    expect(out).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
  });
});

describe('the SDK tools: the route\'s one offer per turn; a refusal never makes the turn worse; the retry never loses the person\'s content', () => {
  /** One turn of the core route's tools: its offer (none for another caller), its recorded calls, the draft and change tools. */
  const turn = (p: ReturnType<typeof product>, offer = true) => {
    const restructure: Restructure | undefined = offer ? { offered: false } : undefined;
    const calls: [TraceRow, ToolCallResult][] = [];
    const tools = pathBTools({ dispatch: p.dispatch, proposals: new ProposalStore(), runAnalysis: vi.fn(), ...(restructure !== undefined ? { restructure } : {}) },
      { ...draftCtx, authenticated_user_id: 'user-a', turn_id: 'turn-1' }, 'core', (row, result) => { calls.push([row, result]); }, 'core');
    const named = (n: string) => tools.find((t) => t.name === n) as FunctionTool;
    return { restructure, calls, build: named('build_model_from_brief'), propose: named('propose_change') };
  };
  const call = async (tool: FunctionTool, args: Rec) => JSON.parse(String(await tool.invoke(new RunContext(), JSON.stringify(args)))) as Rec;
  const draft = (model: LivingModelT) => ({ brief: BRIEF, model });
  /** What base does with the same first call: no offer, saved (or carded) at once. */
  const base = async (initial: LivingModelT | null, tool: 'build' | 'propose', args: Rec) => {
    const p = product(initial);
    const t = turn(p, false);
    await call(t[tool], args);
    return { registered: p.registered, calls: t.calls };
  };
  /** The same model, less the person's option "Hold": a retry that loses their content. */
  const withoutHold = (m: LivingModelT): LivingModelT => ({ ...m, options: m.options.filter((o) => o.id !== 'hold') });

  it('the first call in a turn is said back with goal_path; the second in that turn is saved, and the turn\'s end has nothing left to do', async () => {
    const p = product(null);
    const t = turn(p);
    expect(await call(t.build, draft(withCondition('prerequisite')))).toMatchObject({ status: 'refused', reason: 'goal_path_withheld', detail: RESTRUCTURE_DRAFT,
      data: { goal_path: [{ reason: 'condition_not_in_slice', item: PREREQ }] } });
    expect(await call(t.build, draft(withCondition('assumption')))).toMatchObject({ status: 'ok', mutated: true });
    await t.restructure!.settle!();
    expect(p.registered).toHaveLength(1);
    expect(t.calls).toHaveLength(2);
    expect(await call(turn(product(null)).build, draft(withCondition('prerequisite')))).toMatchObject({ status: 'refused', reason: 'goal_path_withheld' });
  });

  it('DL (a): the agent stops after the refusal: the turn\'s end saves the draft byte-identical to base, with the receipt base gives', async () => {
    const p = product(null);
    const t = turn(p);
    await call(t.build, draft(withCondition('prerequisite')));
    expect(p.registered).toHaveLength(0);
    await t.restructure!.settle!();
    const b = await base(null, 'build', draft(withCondition('prerequisite')));
    expect(p.registered).toEqual(b.registered);
    expect(t.calls.at(-1)).toEqual(b.calls[0]);
    expect(t.calls.at(-1)![1].receipts).toHaveLength(1);
    await t.restructure!.settle!();
    expect(p.registered, 'once only').toHaveLength(1);
    expect(t.calls).toHaveLength(2);
  });

  it('DL (a): a change the agent left refused is carded at the turn\'s end, as base cards it', async () => {
    const p = product(KNOWN_ANSWER);
    const t = turn(p);
    const args = { public_label: 'Update the model', basis: 'The person asked for it.', model: withCondition('prerequisite'), remove: [] };
    expect(await call(t.propose, args)).toMatchObject({ status: 'refused', reason: 'goal_path_withheld' });
    await t.restructure!.settle!();
    const b = await base(KNOWN_ANSWER, 'propose', args);
    const [row, result] = t.calls.at(-1)!;
    expect(row).toMatchObject({ name: 'propose_change', ok: true });
    expect(result.proposal_id).toEqual(expect.any(String));
    expect({ ...row, args: undefined }).toEqual({ ...b.calls[0]![0], args: undefined });
  });

  it('DL (b): a retry that leaves out the person\'s own item is not used: the refused draft is saved, byte-identical to base, and the AI is told', async () => {
    const p = product(null);
    const t = turn(p);
    await call(t.build, draft(withCondition('prerequisite')));
    const out = await call(t.build, draft(withoutHold(withCondition('assumption'))));
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { restructure: { kept: 'first_call', lost: ['options:hold'], note: KEPT_AS_REFUSED } } });
    const b = await base(null, 'build', draft(withCondition('prerequisite')));
    expect(p.registered).toEqual(b.registered);
  });

  it('DL (b): a retry that changes the person\'s figure is not used either; one that re-reads only the condition\'s role is', async () => {
    const changed = withCondition('assumption');
    changed.links[0] = { ...changed.links[0]!, effect: { ...changed.links[0]!.effect, value: 60 } };
    expect(personContentLost(withCondition('prerequisite'), changed)).toEqual(['links:f_g']);
    expect(personContentLost(withCondition('prerequisite'), withCondition('assumption'))).toEqual([]);
    const theirs = withCondition('prerequisite');
    theirs.conditions[0] = { ...theirs.conditions[0]!, source: 'user', quote: PREREQ };
    expect(personContentLost(theirs, { ...theirs, conditions: [] })).toEqual([`conditions:${PREREQ}`]);
    expect(personContentLost(theirs, { ...theirs, conditions: [{ ...theirs.conditions[0]!, role: 'assumption' }] }), 'its role is the one part re-read').toEqual([]);
    expect(personContentLost(theirs, { ...theirs, views: [] })).toEqual(['views:Sam: thinks push is too risky']);
  });

  it('DL (b): a change\'s retry that leaves out the person\'s item is not carded; the refused change is', async () => {
    const p = product(KNOWN_ANSWER);
    const t = turn(p);
    const args = (model: LivingModelT) => ({ public_label: 'Update the model', basis: 'The person asked for it.', model, remove: [] as string[] });
    await call(t.propose, args(withCondition('prerequisite')));
    const out = await call(t.propose, args(withoutHold(withCondition('challenge'))));
    expect(out).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String), restructure: { kept: 'first_call', lost: ['options:hold'] } } });
    const b = await base(KNOWN_ANSWER, 'propose', args(withCondition('prerequisite')));
    expect((out.data as Rec).changes).toEqual(((await call(turn(product(KNOWN_ANSWER), false).propose, args(withCondition('prerequisite')))).data as Rec).changes);
    expect(b.calls).toHaveLength(1);
  });

  it('Codex r1 on #3675: the person\'s record nested in an item of Olumi\'s counts; so does each of two same-words conditions; a kernel-only difference does not', () => {
    const nested = withCondition('prerequisite');
    nested.options[1] = { ...nested.options[1]!, source: 'olumi', quote: null };
    const moved = structuredClone(nested);
    moved.options[1]!.settings[0] = { ...moved.options[1]!.settings[0]!, value: 99 };
    expect(personContentLost(nested, moved)).toEqual(['options:push']);
    const two = withCondition('prerequisite');
    two.conditions = [{ ...two.conditions[0]!, source: 'user', quote: PREREQ }, { ...two.conditions[0]!, source: 'party', party: 'Sam', quote: PREREQ }];
    expect(personContentLost(two, { ...two, conditions: [two.conditions[1]!] })).toEqual([`conditions:${PREREQ}`]);
    expect(personContentLost(two, { ...two, views: [...two.views, ...two.views] }), 'nothing of theirs is gone').toEqual([]);
    expect(personContentLost({ ...two, views: [...two.views, ...two.views] }, two)).toEqual(['views:Sam: thinks push is too risky']);
  });

  it('Codex r1 on #3675: a retry that differs from the refused draft only as the kernel reads it (an id\'s case) is used, with its chance', async () => {
    const p = product(null);
    const t = turn(p);
    await call(t.build, draft(withCondition('prerequisite')));
    const upper = withCondition('assumption');
    upper.factors[0] = { ...upper.factors[0]!, id: 'F' };
    upper.options[1]!.settings[0] = { ...upper.options[1]!.settings[0]!, factor_id: 'F' };
    upper.links[0] = { ...upper.links[0]!, from: 'F' };
    const out = await call(t.build, draft(upper));
    expect(out).toMatchObject({ status: 'ok', mutated: true });
    expect((out.data as Rec).restructure).toBeUndefined();
    expect(goalOf(p.saved())?.goal_threshold).toBe(0.8);
  });

  it('Codex r1 on #3675: another tool\'s success never discards a pending change: a draft "already saved" leaves it, and the turn\'s end cards it', async () => {
    const p = product(null);
    const t = turn(p);
    expect(await call(t.build, draft(KNOWN_ANSWER))).toMatchObject({ status: 'ok', mutated: true });
    const args = { public_label: 'Update the model', basis: 'The person asked for it.', model: withCondition('prerequisite'), remove: [] };
    expect(await call(t.propose, args)).toMatchObject({ status: 'refused', reason: 'goal_path_withheld' });
    expect(await call(t.build, draft(KNOWN_ANSWER))).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
    await t.restructure!.settle!();
    expect(t.calls.at(-1)![0]).toMatchObject({ name: 'propose_change', ok: true });
    expect(t.calls.at(-1)![1].proposal_id).toEqual(expect.any(String));
  });

  it('Codex r2 on #3675: a role-only re-read of the person\'s saved condition, its quote outside this turn\'s words, is no loss: the retry is used', async () => {
    const theirs = { text: 'if the supplier agrees', applies_to: ['push'], role: 'challenge' as const, source: 'user' as const, party: null, quote: 'if the supplier agrees' };
    const saved = { ...structuredClone(KNOWN_ANSWER), conditions: [theirs] };
    const p = product(saved);
    const t = turn(p);
    const args = (role: 'challenge' | 'assumption', prereq: 'prerequisite' | 'assumption') => ({ public_label: 'Update the model', basis: 'The person asked for it.', remove: [],
      model: { ...structuredClone(saved), conditions: [{ ...theirs, role }, { text: PREREQ, applies_to: ['f_g'], role: prereq, source: 'olumi' as const, party: null, quote: null }] } });
    expect(await call(t.propose, args('challenge', 'prerequisite'))).toMatchObject({ status: 'refused', reason: 'goal_path_withheld' });
    const out = await call(t.propose, args('assumption', 'assumption'));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect((out.data as Rec).restructure).toBeUndefined();
  });

  it('Codex r2 on #3675: today\'s level the person set on an aim of Olumi\'s is theirs: a retry that drops it is not used', () => {
    const m = withCondition('prerequisite');
    m.aims[0] = { ...m.aims[0]!, source: 'olumi', quote: null, target: { ...m.aims[0]!.target!, current: 70, current_source: 'user' } };
    expect(personContentLost(m, { ...m, aims: [{ ...m.aims[0]!, target: { ...m.aims[0]!.target!, current: null, current_source: null } }] })).toEqual(['aims:g']);
    expect(personContentLost(m, m)).toEqual([]);
    // Codex r3: the unit it is read in counts (no current_unit: the target's), so 70 units never becomes 70 kg.
    expect(personContentLost(m, { ...m, aims: [{ ...m.aims[0]!, target: { ...m.aims[0]!.target!, unit: 'kg' } }] })).toEqual(['aims:g']);
  });

  it('CONTRAST: a caller without the route\'s offer saves the first call, as before; its turn has nothing to settle', async () => {
    const p = product(null);
    const t = turn(p, false);
    expect(await call(t.build, draft(withCondition('prerequisite')))).toMatchObject({ status: 'ok', mutated: true });
    expect(t.restructure).toBeUndefined();
  });
});

describe('Codex r1 on #3674: the tools record the day of a calendar reading, the host\'s, and a change keeps a saved reading', () => {
  afterEach(() => vi.useRealTimers());

  it('a draft\'s new reading is saved with the host\'s day and no count; a change that sends another day keeps the saved reading', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
    const m = structuredClone(KNOWN_ANSWER);
    Object.assign(m.aims[0]!.target!, { by_when: 'by the end of September', period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: '2031-01-01', period_months: 9 });
    const p = product(null);
    expect(await buildModel({ dispatch: p.dispatch }, draftCtx, { brief: BRIEF, model: m })).toMatchObject({ status: 'ok', mutated: true });
    const reading = { period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: '2026-10-22', period_months: null };
    expect((p.saved()!.living_model as LivingModelT).aims[0]!.target).toMatchObject(reading);
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const next = structuredClone(p.saved()!.living_model as LivingModelT);
    Object.assign(next.aims[0]!.target!, { period_read_on: '2026-11-05' });
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore() }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    expect(((out as { data: Rec }).data.changes as Rec[]).map((c) => c.id), 'the reading is unchanged, so no row for the aim').toEqual(['f']);
  });
});
