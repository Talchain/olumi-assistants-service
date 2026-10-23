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
import { LivingCondition, type LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { KNOWN_ANSWER } from '../../living-model/__tests__/fixtures.js';
import { F1_CONTRADICTED, F1_DEFINED, F1_EXACT_LINKS, F1_OTHER_CAUSE } from '../../living-model/__tests__/track2-f1-identity.fixtures.js';
import { OLUMI_CHANCE } from '../../living-model/__tests__/track2-f2-event-risk.fixtures.js';
import { buildModel } from '../draft-tool.js';
import { applyLivingChange, proposeLivingChange, REPLACE_AIM } from '../living-change.js';
import { pathBTools, type ToolCallResult } from '../index.js';
import type { TraceRow } from '../outcome.js';
import { blockersOf, corePostimage, KEPT_AS_REFUSED, personContentLost, REPAIR_CHANGE, REPAIR_DRAFT, REPAIRS, selfCheck, STILL_ASK, type Restructure } from '../goal-path.js';
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

const olumi = { source: 'olumi' as const, party: null, quote: null };
const blockers = (out: unknown): Rec[] => ((out as { data?: Rec }).data?.blockers ?? []) as Rec[];
const codes = (out: unknown): string[] => blockers(out).map((b) => `${b.code}:${b.fix !== undefined ? 'fix' : b.ask ? 'ask' : 'said'}`);

describe('THE READINESS SELF-CHECK: a draft a Run would withhold the goal\'s chance on is said back with each blocker\'s fix or ask', () => {
  it('INVARIANCE (first): the dry run reads exactly the postimage the write registers', async () => {
    const p = product(null);
    expect(await buildModel({ dispatch: p.dispatch, restructure: { repairs: 0 } }, draftCtx, { brief: BRIEF, model: structuredClone(KNOWN_ANSWER) }))
      .toMatchObject({ status: 'ok', mutated: true, data: { run_ready: true } });
    const saved = p.registered[0]!.graph as Rec;
    const model = saved.living_model as LivingModelT;
    expect(corePostimage(mapLivingModel(model), model)).toEqual(saved);
    expect(projectCorePostimageForPersistence(corePostimage(mapLivingModel(model), model))).toEqual(projectCorePostimageForPersistence(saved));
    // The change's write too: the card's model, applied, registers the postimage the self-check read.
    const proposals = new ProposalStore();
    const next = structuredClone(model);
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const card = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure: { repairs: 0 } }, changeCtx, change(next));
    expect(card).toMatchObject({ status: 'ok', data: { run_ready: true } });
    await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String((card as { data: Rec }).data.proposal_id));
    const written = p.registered[1]!.graph as Rec;
    const kept = written.living_model as LivingModelT;
    expect(corePostimage(mapLivingModel(kept), kept)).toEqual(written);
  });

  it('DL 22 Oct (hiring on 2fa753d6): a missing input written as Olumi\'s prerequisite is said back with its fix; the retry is saved, Run-ready', async () => {
    const missing = 'Today\'s level of f is not yet specified';
    const asCondition = { ...structuredClone(KNOWN_ANSWER), conditions: [{ text: missing, applies_to: ['f_g'], role: 'prerequisite' as const, ...olumi }] };
    const p = product(null);
    const restructure = { repairs: 0 };
    const first = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: asCondition });
    // Bound by identity: the refusal names this condition, with the fix that removes a missing input.
    expect(first).toMatchObject({ status: 'refused', reason: 'not_run_ready', detail: REPAIR_DRAFT,
      data: { blockers: [{ code: 'condition_not_in_slice', items: [`condition:${missing}`], fix: expect.stringContaining('A missing input is never a condition: remove it') }] } });
    expect(p.registered).toHaveLength(0);
    const asked = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: structuredClone(KNOWN_ANSWER) });
    expect(asked).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: true } });
    expect(goalOf(p.saved())).toMatchObject({ goal_threshold: expect.anything() });
    expect((p.saved()!.living_model as LivingModelT).conditions).toEqual([]);
  });

  it('DL 22 Oct (pin): the drafter\'s schema says a missing input is never a condition, and no longer lists an input as a prerequisite; the repair never touches the person\'s content', () => {
    const role = LivingCondition.shape.role.description ?? '';
    expect(role).toContain('A missing input (a measure, today\'s level, a cost or a period nobody has given) is never a condition of any role: give it Olumi\'s labelled estimate as the figure rules allow, or ask the person for it.');
    expect(role).not.toContain('event or input');
    for (const t of [REPAIR_DRAFT, REPAIR_CHANGE]) expect(t).toContain('Never change or remove anything the person or a party gave (a figure, sign, range, unit, condition, target or link).');
  });

  // One row per fix group: the encoding a Run would withhold the goal's chance on, said back with its fix; the fixed retry is Run-ready.
  it.each([
    ['condition', withCondition('prerequisite'), withCondition('assumption'), 'condition_not_in_slice'],
    ['law', { ...structuredClone(KNOWN_ANSWER), links: [{ ...KNOWN_ANSWER.links[0]!, ...olumi, effect: { ...KNOWN_ANSWER.links[0]!.effect, sign: null } }] },
      { ...structuredClone(KNOWN_ANSWER), links: [{ ...KNOWN_ANSWER.links[0]!, ...olumi }] }, 'link_sign_unknown'],
    ['path', { ...structuredClone(KNOWN_ANSWER), links: [] }, { ...structuredClone(KNOWN_ANSWER), links: [{ ...KNOWN_ANSWER.links[0]!, ...olumi }] }, 'NO_PATH_TO_GOAL'],
    ['unit', { ...structuredClone(KNOWN_ANSWER), aims: [{ ...KNOWN_ANSWER.aims[0]!, ...olumi, target: { ...KNOWN_ANSWER.aims[0]!.target!, current_unit: 'kg' } }] },
      { ...structuredClone(KNOWN_ANSWER), aims: [{ ...KNOWN_ANSWER.aims[0]!, ...olumi }] }, 'current_unit_mismatch'],
    ['option', { ...structuredClone(KNOWN_ANSWER), options: [KNOWN_ANSWER.options[0]!, { ...KNOWN_ANSWER.options[1]!, ...olumi, settings: [] }] },
      { ...structuredClone(KNOWN_ANSWER), options: [KNOWN_ANSWER.options[0]!, { ...KNOWN_ANSWER.options[1]!, ...olumi, settings: [{ ...KNOWN_ANSWER.options[1]!.settings[0]!, ...olumi }] }] },
      'OPTION_NEEDS_MAPPING'],
  ] as const)('fix group %s: said back with its fix and nothing written; the fixed retry is saved Run-ready', async (_group, broken, fixed, code) => {
    const p = product(null);
    const restructure = { repairs: 0 };
    const first = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: broken as LivingModelT });
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'refused', reason: 'not_run_ready', data: { save_outcome: 'VERIFIED_NO_WRITE' } });
    expect(codes(first)).toContain(`${code}:fix`);
    expect(p.registered).toHaveLength(0);
    expect(restructure.repairs).toBe(1);
    const second = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: fixed as LivingModelT });
    expect(second, JSON.stringify(second)).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: true } });
    expect(blockers(second)).toEqual([]);
  });

  it('⛔ GUARD: a blocker on the person\'s own condition or figure is an ask, never a fix: saved on the first call with its asks, nothing of theirs changed', async () => {
    const said = 'only once the board signs off';
    const ctx = { ...draftCtx, verified_user_messages: [BRIEF, said] };
    const theirs = { ...structuredClone(KNOWN_ANSWER), conditions: [{ text: said, applies_to: ['f_g'], role: 'prerequisite' as const, source: 'user' as const, party: null, quote: said }] };
    theirs.links[0] = { ...theirs.links[0]!, effect: { ...theirs.links[0]!.effect, sign: null } };
    const p = product(null);
    const restructure = { repairs: 0 };
    const out = await buildModel({ dispatch: p.dispatch, restructure }, ctx, { brief: BRIEF, model: theirs });
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: false, note: STILL_ASK } });
    expect(codes(out)).toEqual(expect.arrayContaining(['condition_not_in_slice:ask', 'link_sign_unknown:ask']));
    expect(codes(out).filter((c) => c.endsWith(':fix')), 'no fix on the person\'s content, and no parallel link of Olumi\'s').toEqual([]);
    expect(restructure.repairs).toBe(0);
    const lm = p.saved()!.living_model as LivingModelT;
    expect(lm.conditions[0]).toMatchObject({ text: said, role: 'prerequisite', source: 'user' });
    expect(lm.links[0]!.effect.sign).toBeNull();
  });

  it('the cap: two repairs, then the third call is saved as it is, with its asks', async () => {
    const p = product(null);
    const restructure = { repairs: 0 };
    // Each retry changes only Olumi's own condition, so the person's content is kept and every call is a repair.
    const olumiCondition = (text: string): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER), conditions: [{ text, applies_to: ['f_g'], role: 'prerequisite', ...olumi }] });
    expect(await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: olumiCondition('first') })).toMatchObject({ reason: 'not_run_ready' });
    expect(await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: olumiCondition('second') })).toMatchObject({ reason: 'not_run_ready' });
    expect(restructure.repairs).toBe(REPAIRS);
    const third = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: olumiCondition('third') });
    expect(third, JSON.stringify(third)).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: false, note: STILL_ASK } });
    expect(codes(third)).toContain('condition_not_in_slice:fix');
    expect(p.registered).toHaveLength(1);
  });

  it('Codex r1 on #3689 (a): the person\'s content a LATER refused call added is protected too: a retry that drops it is not used, for a draft and a change', async () => {
    const said = 'Ana backs push';
    const olumiCondition = (text: string, m: LivingModelT = KNOWN_ANSWER): LivingModelT => ({ ...structuredClone(m), conditions: [{ text, applies_to: ['f_g'], role: 'prerequisite', ...olumi }] });
    const withView = (m: LivingModelT): LivingModelT => ({ ...m, views: [...m.views, { holder: 'Ana', position: 'backs push', quote: said }] });
    // Draft: call 2 adds the person's view and is refused; call 3 drops it, so call 2 is used as it was.
    const p = product(null);
    const restructure = { repairs: 0 };
    const ctx = { ...draftCtx, verified_user_messages: [BRIEF, said] };
    await buildModel({ dispatch: p.dispatch, restructure }, ctx, { brief: BRIEF, model: olumiCondition('first') });
    expect(await buildModel({ dispatch: p.dispatch, restructure }, ctx, { brief: BRIEF, model: withView(olumiCondition('second')) })).toMatchObject({ reason: 'not_run_ready' });
    const third = await buildModel({ dispatch: p.dispatch, restructure }, ctx, { brief: BRIEF, model: structuredClone(KNOWN_ANSWER) });
    expect(third, JSON.stringify(third)).toMatchObject({ status: 'ok', data: { restructure: { kept: 'refused_call', lost: [`views:Ana: backs push`] } } });
    expect((p.saved()!.living_model as LivingModelT).views.map((v) => v.holder)).toContain('Ana');
    // Change: the same chain on a card.
    const q = product(KNOWN_ANSWER);
    const r2 = { repairs: 0 };
    const cctx = { ...changeCtx, verified_user_messages: [said], user_turn_text: said };
    await proposeLivingChange({ dispatch: q.dispatch, proposals: new ProposalStore(), restructure: r2 }, cctx, change(olumiCondition('first')));
    expect(await proposeLivingChange({ dispatch: q.dispatch, proposals: new ProposalStore(), restructure: r2 }, cctx, change(withView(olumiCondition('second')))))
      .toMatchObject({ reason: 'not_run_ready' });
    const card = await proposeLivingChange({ dispatch: q.dispatch, proposals: new ProposalStore(), restructure: r2 }, cctx, change(structuredClone(KNOWN_ANSWER)));
    expect(card, JSON.stringify(card)).toMatchObject({ status: 'ok', data: { restructure: { kept: 'refused_call', lost: [`views:Ana: backs push`] } } });
  });

  it('Codex r1 on #3689 (b): the person\'s setting under an option of Olumi\'s, and today\'s level they set on an aim of Olumi\'s, are asked, never fixed', () => {
    const nested = structuredClone(KNOWN_ANSWER);
    nested.factors[0] = { ...nested.factors[0]!, ...olumi, unit: 'kg' };
    nested.options[1] = { ...nested.options[1]!, ...olumi, settings: [{ ...nested.options[1]!.settings[0]!, unit: 'hours' }] };
    const level = structuredClone(KNOWN_ANSWER);
    level.aims[0] = { ...level.aims[0]!, ...olumi, target: { ...level.aims[0]!.target!, current_source: 'user', current_unit: 'kg' } };
    for (const [model, code] of [[nested, 'setting_not_convertible'], [level, 'current_unit_mismatch']] as const) {
      const out = { data: { blockers: blockersOf(model, selfCheck(model, mapLivingModel(model))).all } };
      expect(codes(out)).toContain(`${code}:ask`);
      expect(codes(out).filter((c) => c.endsWith(':fix'))).toEqual([]);
    }
  });

  it('Codex r1 on #3689 (c): an Olumi link held on the goal\'s path (a one-sided range, a unit that is not the goal\'s) is never Run-ready: said with its fix', async () => {
    for (const [effect, code] of [[{ form: 'range' as const, value: null, sd: null, low: 5, high: null }, 'link_range_no_law'], [{ unit: '%' }, 'link_unit_mismatch']] as const) {
      const model = { ...structuredClone(KNOWN_ANSWER), links: [{ ...KNOWN_ANSWER.links[0]!, ...olumi, effect: { ...KNOWN_ANSWER.links[0]!.effect, ...effect } }] };
      const p = product(null);
      const out = await buildModel({ dispatch: p.dispatch, restructure: { repairs: 0 } }, draftCtx, { brief: BRIEF, model });
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
      expect(codes(out)).toContain(`${code}:fix`);
      // Saved as it is (no repair left), it says it is not Run-ready.
      const kept = await buildModel({ dispatch: p.dispatch }, draftCtx, { brief: BRIEF, model });
      expect(kept).toMatchObject({ status: 'ok', data: { run_ready: false } });
    }
  });

  it('Codex r2 on #3689: a held link that withholds nothing (the person\'s exact link restating a definition) never blocks; one held on a law still does', () => {
    const restated: LivingModelT = { ...structuredClone(F1_DEFINED), links: [{ id: 'total_rev', from: 'total', to: 'rev', source: 'user', party: null,
      quote: 'revenue is customers times the price', effect: { form: 'exact', estimate_by: null, value: 40, sd: null, low: null, high: null, unit: '£', sign: '+' } }] };
    const mapped = mapLivingModel(restated);
    expect(mapped.withheld, 'held, but withholding nothing').toContainEqual({ id: 'total_rev', reason: 'identity_restated' });
    expect(blockersOf(restated, selfCheck(restated, mapped)).all).toEqual([]);
    // CONTROL: the breakdown written only as exact links still withholds, and is said.
    expect(codes({ data: { blockers: blockersOf(F1_EXACT_LINKS, selfCheck(F1_EXACT_LINKS, mapLivingModel(F1_EXACT_LINKS))).all } })).toContain('exact_not_drawable:ask');
  });

  it('the bound: the refused draft sent again unchanged is saved as it is, its blockers said', async () => {
    const p = product(null);
    const restructure = { repairs: 0 };
    await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    const again = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    expect(again).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: false, draft: { withheld: expect.arrayContaining([{ id: 'g', reason: 'chance_rests_on_withheld' }]) } } });
    expect(p.registered).toHaveLength(1);
    expect(goalOf(p.saved())?.goal_threshold).toBeUndefined();
  });

  it('Codex r1 on #3672: the person\'s unsigned link or "exact" figure is an ask, never repaired; an identity\'s other cause or contradiction is said only', async () => {
    const unsigned = structuredClone(KNOWN_ANSWER);
    unsigned.links[0] = { ...unsigned.links[0]!, effect: { ...unsigned.links[0]!.effect, sign: null } };
    const exact = structuredClone(KNOWN_ANSWER);
    exact.links[0] = { ...exact.links[0]!, effect: { ...exact.links[0]!.effect, form: 'exact', sd: null } };
    for (const [model, reason] of [[unsigned, 'link_sign_unknown'], [exact, 'exact_not_drawable']] as const) {
      expect(mapLivingModel(model).rests_on, 'withheld on the path, as before').toEqual([{ id: 'f_g', reason }]);
      const p = product(null);
      const restructure = { repairs: 0 };
      const out = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model });
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
      expect(codes(out)).toContain(`${reason}:ask`);
      expect(restructure.repairs).toBe(0);
    }
    for (const [model, reason] of [[F1_OTHER_CAUSE, 'identity_other_cause'], [F1_CONTRADICTED, 'identity_contradicted']] as const) {
      expect(blockersOf(model, selfCheck(model, mapLivingModel(model))).all).toContainEqual(expect.objectContaining({ code: reason, said: true }));
    }
  });

  it('Codex r1 on #3691: a Run\'s readiness blockers (their own shape and words) never cost the call its row; its check keeps codes only', async () => {
    const calls: [TraceRow, ToolCallResult][] = [];
    const runAnalysis = vi.fn(async () => ({ ok: false, mutated: false, ran: false, refusal: 'analysis_not_ready',
      blockers: [{ code: 'MISSING_FACTOR_LEVEL', message: 'Say what f is today', factor_id: 'f' }, 'loose words', { message: 'no code here' }] }));
    const tools = pathBTools({ dispatch: product(KNOWN_ANSWER).dispatch, proposals: new ProposalStore(), runAnalysis },
      { ...draftCtx, authenticated_user_id: 'user-a', turn_id: 'turn-1' }, 'core', (row, result) => { calls.push([row, result]); }, 'core');
    await (tools.find((t) => t.name === 'run_analysis') as FunctionTool).invoke(new RunContext(), JSON.stringify({ reason: 'Analyse it.', effects_timing: null }));
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatchObject({ outcome: 'refused', refusal: 'analysis_not_ready' });
    expect(calls[0]![1].check).toEqual({ blockers: [{ code: 'MISSING_FACTOR_LEVEL' }] });
  });

  it('DL 93d79c3e (C1): a level the factor already holds (a bare range) is never asked for again; a factor with none is', () => {
    const level = (low: number | null, high: number | null): LivingModelT => {
      const m = structuredClone(KNOWN_ANSWER);
      m.factors[0] = { ...m.factors[0]!, value: null, low, high };
      return m;
    };
    const missing = (m: LivingModelT) => blockersOf(m, selfCheck(m, mapLivingModel(m))).all.filter((b) => b.code === 'MISSING_FACTOR_LEVEL');
    // The ask carries the readiness authority's own question (0 AI calls).
    expect(missing(level(null, null))).toEqual([{ code: 'MISSING_FACTOR_LEVEL', items: ['f'], ask: true,
      question: 'What is "f" today, before any option changes it? Without a current level the analysis would treat it as zero.' }]);
    expect(missing(level(0.4, 0.6))).toEqual([{ code: 'MISSING_FACTOR_LEVEL', items: ['f'], said: true }]);
  });

  it('Codex r2 on #3691: two items missing their levels are two asks, each with its own question; none is lost to the other', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.factors[0] = { ...m.factors[0]!, value: null };
    m.factors.push({ ...m.factors[0]!, id: 'h', label: 'h', source: 'olumi', quote: null });
    m.links.push({ ...m.links[0]!, id: 'h_g', from: 'h', source: 'olumi', quote: null });
    m.options[1]!.settings.push({ ...m.options[1]!.settings[0]!, factor_id: 'h', source: 'olumi', quote: null });
    const asks = blockersOf(m, selfCheck(m, mapLivingModel(m))).all.filter((b) => b.code === 'MISSING_FACTOR_LEVEL');
    expect(asks.map((b) => [b.items, b.question])).toEqual([
      [['f'], 'What is "f" today, before any option changes it? Without a current level the analysis would treat it as zero.'],
      [['h'], 'What is "h" today, before any option changes it? Without a current level the analysis would treat it as zero.']]);
  });

  it('DL 22 Oct (#3680 row :65): an identity the engine would refuse (a part at 0) reaches the loop as the identity composer\'s ask, never a fix', () => {
    // A living model defines only sums and products, so the shape is fed as the graph the postimage carries.
    const frame = (value: number) => ({ value: value / 100, raw_value: value, cap: 100, source: 'brief_extraction' });
    const nodes: Rec[] = [
      { id: 'stock', kind: 'factor', label: 'Specialists today', observed_state: frame(0) },
      { id: 'churn', kind: 'factor', label: 'Specialists leaving', observed_state: frame(0) },
      { id: 'inflow', kind: 'factor', label: 'Specialists joining', observed_state: frame(0) },
      { id: 'specialists', kind: 'outcome', label: 'Specialists', observed_state: frame(0),
        nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock', 'churn', 'inflow'], horizon_months: 1, rate_scale: 1 } },
      { id: 'each', kind: 'factor', label: 'Capacity each', observed_state: frame(12) },
      { id: 'total', kind: 'outcome', label: 'Additional capacity', observed_state: frame(0),
        nonlinear_identity: { operation: 'product', factor_ids: ['specialists', 'each'] } },
    ];
    const edges: Rec[] = [...['stock', 'churn', 'inflow'].map((from) => ({ from, to: 'specialists' })), ...['specialists', 'each'].map((from) => ({ from, to: 'total' }))];
    const mapped = { graph: { nodes, edges }, withheld: [], frames: new Map(), assumed: [] };
    expect(blockersOf(KNOWN_ANSWER, selfCheck(KNOWN_ANSWER, mapped)).all.find((b) => b.code === 'identity_zero_level')).toEqual({ code: 'identity_zero_level', items: ['total'], ask: true,
      question: '\u201cSpecialists today\u201d is 0 today, so \u201cAdditional capacity\u201d can\'t be worked out as \u201cSpecialists\u201d \u00d7 \u201cCapacity each\u201d. Is 0 right, or what is it?' });
    // CONTRAST: a stated product with no part at 0 asks nothing of its identity.
    expect(blockersOf(F1_DEFINED, selfCheck(F1_DEFINED, mapLivingModel(F1_DEFINED))).all.filter((x) => x.code.startsWith('identity_'))).toEqual([]);
  });

  it('CONTRAST: a cause only the person\'s input settles, a clean model, an assumption or a challenge: saved on the first call, no repair used', async () => {
    for (const model of [unconvertible(), KNOWN_ANSWER, withCondition('assumption'), withCondition('challenge')]) {
      const p = product(null);
      const restructure = { repairs: 0 };
      const out = await buildModel({ dispatch: p.dispatch, restructure }, draftCtx, { brief: BRIEF, model });
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', mutated: true });
      expect(restructure.repairs).toBe(0);
    }
    // The input-only case is still withheld and said, as before: a repair is not how it is asked for.
    expect(mapLivingModel(unconvertible()).withheld).toContainEqual({ id: 'g', reason: 'chance_rests_on_withheld' });
  });

  it('CONTRAST: a caller without the turn\'s repairs (any other route) saves the draft as before', async () => {
    const p = product(null);
    const out = await buildModel({ dispatch: p.dispatch }, draftCtx, { brief: BRIEF, model: withCondition('prerequisite') });
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { run_ready: false } });
  });
});

describe('a change answers for the blockers it ADDS', () => {
  it('a change adding a prerequisite on the path: no card and no proposal; the repaired change gets its card', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const restructure = { repairs: 0 };
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, change(withCondition('prerequisite')));
    expect(first).toEqual({ status: 'refused', reason: 'not_run_ready', detail: REPAIR_CHANGE,
      data: { blockers: [{ code: 'condition_not_in_slice', items: [`condition:${PREREQ}`], fix: expect.any(String) }] } });
    expect(restructure.repairs).toBe(1);
    const second = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, change(withCondition('challenge')));
    expect(second).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String), run_ready: true } });
    expect(p.registered).toHaveLength(0);
  });

  it('a change on a base already withheld, adding no blocker, gets its card at once with the blockers said; no repair is used', async () => {
    const base = withCondition('prerequisite');
    const p = product(base);
    const restructure = { repairs: 0 };
    const next = structuredClone(base);
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String), run_ready: false, note: STILL_ASK } });
    expect(restructure.repairs).toBe(0);
  });

  it('Codex r1: a prerequisite with the same words on ANOTHER item is one the change adds: no card yet', async () => {
    const base = withCondition('prerequisite');
    const p = product(base);
    const next = structuredClone(base);
    next.conditions.push({ ...next.conditions[0]!, applies_to: ['f'] });
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure: { repairs: 0 } }, changeCtx, change(next));
    expect(out).toMatchObject({ status: 'refused', reason: 'not_run_ready', data: { blockers: [{ code: 'condition_not_in_slice', items: [`condition:${PREREQ}`] }] } });
  });

  it('the repairs are shared: with none left this turn, a change adding a blocker gets its card, said', async () => {
    const p = product(KNOWN_ANSWER);
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure: { repairs: REPAIRS } }, changeCtx,
      change(withCondition('prerequisite')));
    expect(out).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String), run_ready: false } });
  });
});

describe('the SDK tools: the route\'s repairs per turn; a refusal never makes the turn worse; the retry never loses the person\'s content', () => {
  /** One turn of the core route's tools: its offer (none for another caller), its recorded calls, the draft and change tools. */
  const turn = (p: ReturnType<typeof product>, offer = true) => {
    const restructure: Restructure | undefined = offer ? { repairs: 0 } : undefined;
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

  it('the first call in a turn is said back with its blockers; the repaired call in that turn is saved, and the turn\'s end has nothing left to do', async () => {
    const p = product(null);
    const t = turn(p);
    expect(await call(t.build, draft(withCondition('prerequisite')))).toMatchObject({ status: 'refused', reason: 'not_run_ready', detail: REPAIR_DRAFT,
      data: { blockers: [{ code: 'condition_not_in_slice', items: [`condition:${PREREQ}`] }] } });
    expect(await call(t.build, draft(withCondition('assumption')))).toMatchObject({ status: 'ok', mutated: true });
    await t.restructure!.settle!();
    expect(p.registered).toHaveLength(1);
    expect(t.calls).toHaveLength(2);
    expect(await call(turn(product(null)).build, draft(withCondition('prerequisite')))).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
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
    expect(await call(t.propose, args)).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
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
    expect(out).toMatchObject({ status: 'ok', mutated: true, data: { restructure: { kept: 'refused_call', lost: ['options:hold'], note: KEPT_AS_REFUSED } } });
    const b = await base(null, 'build', draft(withCondition('prerequisite')));
    expect(p.registered).toEqual(b.registered);
  });

  it('DL (b): a retry that changes the person\'s figure is not used either; nor, since the DL 22 Oct guard, one that re-reads their condition\'s role', async () => {
    const changed = withCondition('assumption');
    changed.links[0] = { ...changed.links[0]!, effect: { ...changed.links[0]!.effect, value: 60 } };
    expect(personContentLost(withCondition('prerequisite'), changed)).toEqual(['links:f_g']);
    expect(personContentLost(withCondition('prerequisite'), withCondition('assumption'))).toEqual([]);
    const theirs = withCondition('prerequisite');
    theirs.conditions[0] = { ...theirs.conditions[0]!, source: 'user', quote: PREREQ };
    expect(personContentLost(theirs, { ...theirs, conditions: [] })).toEqual([`conditions:${PREREQ}`]);
    expect(personContentLost(theirs, { ...theirs, conditions: [{ ...theirs.conditions[0]!, role: 'assumption' }] }), 'a person\'s condition is asked about, never re-read')
      .toEqual([`conditions:${PREREQ}`]);
    expect(personContentLost(theirs, { ...theirs, views: [] })).toEqual(['views:Sam: thinks push is too risky']);
  });

  it('Codex r1 on #3694: the kept refused change\'s authorship decisions still reach the turn log (the trace survives the fallback)', async () => {
    const p = product(KNOWN_ANSWER);
    const t = turn(p);
    const args = (model: LivingModelT) => ({ public_label: 'Update the model', basis: 'The person asked for it.', model, remove: [] as string[] });
    // The refused change adds a "user" item in words nobody said: the kernel relabels it.
    const unsaid = { ...withCondition('prerequisite'), factors: [...withCondition('prerequisite').factors,
      { ...KNOWN_ANSWER.factors[0]!, id: 'h', label: 'h', quote: 'h is about 3', value: 3 }] };
    await call(t.propose, args(unsaid));
    const out = await call(t.propose, args(withoutHold(withCondition('challenge'))));
    expect(out).toMatchObject({ status: 'ok', data: { restructure: { kept: 'refused_call', lost: ['options:hold'] } } });
    expect(JSON.stringify(out)).not.toContain('relabelled');
    expect(t.calls.at(-1)![1].check?.relabelled).toEqual([{ id: 'h', was: 'user' }]);
  });

  it('DL (b): a change\'s retry that leaves out the person\'s item is not carded; the refused change is', async () => {
    const p = product(KNOWN_ANSWER);
    const t = turn(p);
    const args = (model: LivingModelT) => ({ public_label: 'Update the model', basis: 'The person asked for it.', model, remove: [] as string[] });
    await call(t.propose, args(withCondition('prerequisite')));
    const out = await call(t.propose, args(withoutHold(withCondition('challenge'))));
    expect(out).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String), restructure: { kept: 'refused_call', lost: ['options:hold'] } } });
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
    expect(await call(t.propose, args)).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
    expect(await call(t.build, draft(KNOWN_ANSWER))).toMatchObject({ status: 'ok', mutated: false, data: { already_saved: true } });
    await t.restructure!.settle!();
    expect(t.calls.at(-1)![0]).toMatchObject({ name: 'propose_change', ok: true });
    expect(t.calls.at(-1)![1].proposal_id).toEqual(expect.any(String));
  });

  it('DL 22 Oct guard (supersedes Codex r2 on #3675): a retry that re-reads the person\'s saved condition is not used; the refused change is carded', async () => {
    const theirs = { text: 'if the supplier agrees', applies_to: ['push'], role: 'challenge' as const, source: 'user' as const, party: null, quote: 'if the supplier agrees' };
    const saved = { ...structuredClone(KNOWN_ANSWER), conditions: [theirs] };
    const p = product(saved);
    const t = turn(p);
    const args = (role: 'challenge' | 'assumption', prereq: 'prerequisite' | 'assumption') => ({ public_label: 'Update the model', basis: 'The person asked for it.', remove: [],
      model: { ...structuredClone(saved), conditions: [{ ...theirs, role }, { text: PREREQ, applies_to: ['f_g'], role: prereq, source: 'olumi' as const, party: null, quote: null }] } });
    expect(await call(t.propose, args('challenge', 'prerequisite'))).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
    const out = await call(t.propose, args('assumption', 'assumption'));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String),
      restructure: { kept: 'refused_call', lost: ['conditions:if the supplier agrees'] } } });
    // CONTRAST: re-reading only Olumi's own condition is a repair, and the retry is used.
    const q = turn(product(saved));
    await call(q.propose, args('challenge', 'prerequisite'));
    const used = await call(q.propose, args('challenge', 'assumption'));
    expect(used, JSON.stringify(used)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect((used.data as Rec).restructure).toBeUndefined();
  });

  it('Codex r2 on #3675: today\'s level the person set on an aim of Olumi\'s is theirs: a retry that drops it is not used', () => {
    const m = withCondition('prerequisite');
    m.aims[0] = { ...m.aims[0]!, source: 'olumi', quote: null, target: { ...m.aims[0]!.target!, current: 70, current_source: 'user' } };
    expect(personContentLost(m, { ...m, aims: [{ ...m.aims[0]!, target: { ...m.aims[0]!.target!, current: null, current_source: null } }] })).toEqual(['aims:g']);
    expect(personContentLost(m, m)).toEqual([]);
    // Codex r3: the unit it is read in counts (no current_unit: the target's), so 70 units never becomes 70 kg.
    expect(personContentLost(m, { ...m, aims: [{ ...m.aims[0]!, target: { ...m.aims[0]!.target!, unit: 'kg' } }] })).toEqual(['aims:g']);
  });

  it('CONTRAST: a caller without the route\'s repairs saves the first call, as before; its turn has nothing to settle', async () => {
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

  /** A change two weeks on that corrects f and, beside it, sends `aim` for the goal: the card has a row for f alone, and the write keeps the saved aim. */
  async function onlyF(saved: LivingModelT, aim: Partial<NonNullable<LivingModelT['aims'][number]['target']>>) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const p = product(saved);
    const proposals = new ProposalStore();
    const next = structuredClone(saved);
    Object.assign(next.aims[0]!.target!, aim);
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    expect(((out as { data: Rec }).data.changes as Rec[]).map((c) => c.id)).toEqual(['f']);
    expect(await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String((out as { data: Rec }).data.proposal_id))).toMatchObject({ status: 'ok' });
    return (p.saved()!.living_model as LivingModelT).aims[0]!;
  }

  it('Codex r2: the person\'s own saved duration stands while its words do; a reading beside it never replaces it', async () => {
    const saved = structuredClone(KNOWN_ANSWER);
    Object.assign(saved.aims[0]!.target!, { by_when: 'within 6 months, by the end of March', period_months: 6 });
    const aim = await onlyF(saved, { period_by: 'olumi', period_deadline: '2027-03-31', period_months: null });
    expect(aim.target).toMatchObject({ period_months: 6, period_by: null, period_deadline: null, period_read_on: null });
  });

  it('Codex r2: a saved reading the AI re-dated keeps its author; the person\'s aim never reads as changed', async () => {
    const saved = structuredClone(KNOWN_ANSWER);
    saved.aims[0] = { ...saved.aims[0]!, quote: 'reach the units by the end of September' };
    Object.assign(saved.aims[0]!.target!, { by_when: 'by the end of September', period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: '2026-10-22' });
    const aim = await onlyF(saved, { period_read_on: '2026-11-05', period_deadline: '2027-10-31' });
    expect(aim).toEqual(saved.aims[0]);
  });

  /** Saved: the person's aim, out of the verified window, with Olumi's reading of its calendar deadline. */
  const readSaved = (): LivingModelT => {
    const saved = structuredClone(KNOWN_ANSWER);
    saved.aims[0] = { ...saved.aims[0]!, quote: 'reach the units by the end of September' };
    Object.assign(saved.aims[0]!.target!, { by_when: 'by the end of September', period_by: 'olumi', period_deadline: '2027-09-30', period_read_on: '2026-10-22' });
    return saved;
  };

  it('Codex r3: the saved aim sent under another spelling of its id ("G") is matched as the kernel matches it, and keeps its author and reading', async () => {
    const saved = readSaved();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const p = product(saved);
    const proposals = new ProposalStore();
    const next = structuredClone(saved);
    next.aims[0] = { ...next.aims[0]!, id: 'G', target: { ...next.aims[0]!.target!, period_read_on: '2026-11-05' } };
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    expect(((out as { data: Rec }).data.changes as Rec[]).map((c) => c.id)).toEqual(['f']);
    await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String((out as { data: Rec }).data.proposal_id));
    expect((p.saved()!.living_model as LivingModelT).aims[0]).toEqual(saved.aims[0]);
  });

  it('Codex r3: a second aim whose raw id is the saved aim\'s ("G", "g" → g, g_2) never takes the saved reading; its own duration stays', async () => {
    const saved = readSaved();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    const p = product(saved);
    const proposals = new ProposalStore();
    const next = structuredClone(saved);
    const second = { ...structuredClone(saved.aims[0]!), id: 'g', text: 'A second aim', source: 'olumi' as const, quote: null,
      target: { ...saved.aims[0]!.target!, period_by: null, period_deadline: null, period_read_on: null, period_months: 18 } };
    next.aims = [{ ...next.aims[0]!, id: 'G' }, second];
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, change(next));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String((out as { data: Rec }).data.proposal_id));
    const aims = (p.saved()!.living_model as LivingModelT).aims;
    expect(aims.map((a) => a.id)).toEqual(['g', 'g_2']);
    expect(aims[0]).toEqual(saved.aims[0]);
    expect(aims[1]!.target).toMatchObject({ period_months: 18, period_by: null, period_deadline: null, period_read_on: null });
  });
});

describe('DL 22 Oct (marketing on 7ee0d90f): a change never silently cuts the goal\'s path (NO_PATH_TO_GOAL, fix: Olumi\'s labelled links)', () => {
  /** The goal re-measured in customers, its one link (in units) removed, nothing in its place: no option reaches it. */
  const remeasured = (): LivingModelT => {
    const m = structuredClone(KNOWN_ANSWER);
    m.aims[0]!.target = { ...m.aims[0]!.target!, quantity: 'new customers', unit: 'customers', value: 20, current: null };
    m.links = [];
    return m;
  };
  /** The retry: what drives the goal linked to it under the new measure, as Olumi's own provisional estimate. */
  const relinked = (): LivingModelT => ({ ...remeasured(), links: [{ id: 'f_customers', from: 'f', to: 'g', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: null, low: 2, high: 8, sd: null, unit: 'customers', sign: '+' } }] });
  const args = (model: LivingModelT, remove: string[]) => ({ public_label: 'Measure the goal in customers', basis: 'The person restated the goal.', model, remove });

  it('the change that removes every link into the goal: no card and no proposal, the missing path said with its fix; the re-linked retry gets its card', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const restructure: Restructure = { repairs: 0 };
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, args(remeasured(), ['f_g']));
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'refused', reason: 'not_run_ready', detail: REPAIR_CHANGE });
    expect(blockers(first)).toContainEqual({ code: 'NO_PATH_TO_GOAL', items: ['hold', 'push'], fix: expect.stringContaining('adding each missing link with Olumi\'s own labelled estimate') });
    expect(restructure.pending).toMatchObject({ tool: 'propose_change' });
    const second = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, args(relinked(), ['f_g']));
    expect(second, JSON.stringify(second)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(codes(second), 'reached; only today\'s level, the person\'s, is asked').toEqual(['goal_level_unknown:ask']);
  });

  it('DL (base fallback): the person asked to remove the link; the same change sent again is carded with the removal, as base would', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const restructure: Restructure = { repairs: 0 };
    const asked = { ...changeCtx, user_turn_text: 'Remove the link from f to the goal.' };
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, asked, args(remeasured(), ['f_g'])))
      .toMatchObject({ status: 'refused', reason: 'not_run_ready' });
    const again = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, asked, args(remeasured(), ['f_g']));
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(((again as { data: Rec }).data.changes as Rec[]).filter((c) => c.kind === 'link').map((c) => [c.id, c.change])).toEqual([['f_g', 'remove']]);
    expect((again as { data: Rec }).data.restructure, 'nothing of the person’s was lost, so no fallback note').toBeUndefined();
    expect(restructure.pending).toBeUndefined();
    expect(again, 'the pathless card says why a Run would withhold the chance').toMatchObject({ data: { run_ready: false, note: STILL_ASK } });
    expect(codes(again)).toContain('NO_PATH_TO_GOAL:fix');
  });

  it('DL 22 Oct (marketing on 68ca54f0): Olumi\'s missing-input prerequisite AND the cut path are said back in ONE feedback; the repaired change reaches the goal', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const deps = { dispatch: p.dispatch, proposals, restructure: { repairs: 0 } as Restructure };
    const missing = 'How a new customer is counted is not yet defined';
    const withCondition = { ...remeasured(), conditions: [{ text: missing, applies_to: ['g'], role: 'prerequisite' as const, source: 'olumi' as const, party: null, quote: null }] };
    const first = await proposeLivingChange(deps, changeCtx, args(withCondition, ['f_g']));
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
    expect(codes(first)).toEqual(expect.arrayContaining(['condition_not_in_slice:fix', 'NO_PATH_TO_GOAL:fix', 'goal_level_unknown:ask']));
    const linked = await proposeLivingChange(deps, changeCtx, args(relinked(), ['f_g']));
    expect(linked, JSON.stringify(linked)).toMatchObject({ status: 'ok' });
    expect(codes(linked)).toEqual(['goal_level_unknown:ask']);
    await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String((linked as { data: Rec }).data.proposal_id));
    expect((p.saved()!.living_model as LivingModelT).links).toEqual([expect.objectContaining({ id: 'f_customers', to: 'g', source: 'olumi', quote: null })]);
    const readiness = assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse(p.saved()!)) as never);
    expect(JSON.stringify(readiness), 'a path exists').not.toContain('NO_PATH_TO_GOAL');
  });

  it('DL 22 Oct (acceptance): the re-measured goal re-linked with Olumi\'s labelled estimate: carded, written, analysable; the person\'s figures byte-unchanged', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const said = 'we need at least 20 customers; today we have 12';
    const next = structuredClone(KNOWN_ANSWER);
    next.aims[0] = { ...next.aims[0]!, quote: said, target: { ...next.aims[0]!.target!, quantity: 'customers', unit: 'customers', value: 20, current: 12 } };
    next.links = [{ id: 'f_customers', from: 'f', to: 'g', source: 'olumi', party: null, quote: null,
      effect: { estimate_by: null, form: 'range', value: null, low: 4, high: 12, sd: null, unit: 'customers', sign: '+' } }];
    const ctx = { ...changeCtx, user_turn_text: `Measure the goal in customers: ${said}.` };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure: { repairs: 0 } }, ctx, args(next, ['f_g']));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { run_ready: true } });
    expect(await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((out as { data: Rec }).data.proposal_id))).toMatchObject({ status: 'ok', mutated: true });
    const saved = p.saved()!;
    const lm = saved.living_model as LivingModelT;
    expect(lm.links).toEqual([expect.objectContaining({ id: 'f_customers', source: 'olumi', quote: null })]);
    expect(lm.factors).toEqual(KNOWN_ANSWER.factors);
    expect(lm.options).toEqual(KNOWN_ANSWER.options);
    expect(goalOf(saved)).toMatchObject({ id: 'g', goal_threshold: expect.anything() });
    const readiness = assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse(saved)) as never);
    expect(JSON.stringify(readiness), 'a Run can start: no option is cut off from the goal').not.toContain('NO_PATH_TO_GOAL');
    // CONTRAST, same probe: the same change with no link into the goal, written, is cut off.
    const q = product(KNOWN_ANSWER);
    const qs = new ProposalStore();
    const bare = await proposeLivingChange({ dispatch: q.dispatch, proposals: qs }, ctx, args({ ...structuredClone(next), links: [] }, ['f_g']));
    await applyLivingChange({ dispatch: q.dispatch, proposals: qs }, ctx, String((bare as { data: Rec }).data.proposal_id));
    expect(JSON.stringify(assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(GraphV3.parse(q.saved()!)) as never))).toContain('NO_PATH_TO_GOAL');
  });

  it('DL 22 Oct (contrast): a re-measured goal keeps the person\'s own stated link into it as theirs; nothing of Olumi\'s is added', async () => {
    const p = product(KNOWN_ANSWER);
    const proposals = new ProposalStore();
    const said = 'we need at least 120 units shipped';
    const next = structuredClone(KNOWN_ANSWER);
    next.aims[0] = { ...next.aims[0]!, quote: said, target: { ...next.aims[0]!.target!, quantity: 'units shipped', value: 120 } };
    const ctx = { ...changeCtx, user_turn_text: `Measure it as units shipped: ${said}.` };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure: { repairs: 0 } }, ctx, args(next, []));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { run_ready: true } });
    await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((out as { data: Rec }).data.proposal_id));
    expect((p.saved()!.living_model as LivingModelT).links).toEqual(KNOWN_ANSWER.links);
  });

  it('#3679 follow-ups: a re-id\'d goal that drops its link, a risk\'s links into the goal removed, or the goal\'s definition dropped: each is said as NO_PATH_TO_GOAL', async () => {
    const reid = { ...remeasured(), aims: [{ ...remeasured().aims[0]!, id: 'g2' }] };
    const goal = OLUMI_CHANCE.aims[0]!.id;
    const unlinked = { ...structuredClone(OLUMI_CHANCE), links: OLUMI_CHANCE.links.filter((l) => l.to !== goal) };
    const undefined_ = { ...structuredClone(F1_DEFINED), aims: [{ ...structuredClone(F1_DEFINED).aims[0]!, defined_as: null }] };
    for (const [base, next, remove] of [[KNOWN_ANSWER, reid, ['g', 'f_g']], [OLUMI_CHANCE, unlinked, OLUMI_CHANCE.links.map((l) => l.id)], [F1_DEFINED, undefined_, []]] as const) {
      const out = await proposeLivingChange({ dispatch: product(base).dispatch, proposals: new ProposalStore(), restructure: { repairs: 0 } },
        changeCtx, args(next, [...remove]));
      expect(out, JSON.stringify(out)).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
      expect(codes(out)).toContain('NO_PATH_TO_GOAL:fix');
    }
  });

  it('the agent stops after the cut is said: the turn\'s end cards the change as base would', async () => {
    const p = product(KNOWN_ANSWER);
    const calls: [TraceRow, ToolCallResult][] = [];
    const restructure: Restructure = { repairs: 0 };
    const propose = pathBTools({ dispatch: p.dispatch, proposals: new ProposalStore(), runAnalysis: vi.fn(), restructure },
      { ...changeCtx, verified_user_messages: [BRIEF] }, 'core', (row, result) => { calls.push([row, result]); }, 'core').find((t) => t.name === 'propose_change') as FunctionTool;
    expect(JSON.parse(String(await propose.invoke(new RunContext(), JSON.stringify(args(remeasured(), ['f_g'])))))).toMatchObject({ status: 'refused', reason: 'not_run_ready' });
    await restructure.settle!();
    expect(calls.map(([row]) => [row.name, row.outcome])).toEqual([['propose_change', 'refused'], ['propose_change', 'ok']]);
    expect(calls[1]![1].proposal_id).toEqual(expect.any(String));
  });

  it('CONTRAST: a change that removes one link while an option still reaches the goal, or one on a model already without a path, gets its card at once', async () => {
    const two = structuredClone(KNOWN_ANSWER);
    two.factors.push({ ...two.factors[0]!, id: 'f2', label: 'f2', quote: null, source: 'olumi', value: 1 });
    two.links.push({ ...two.links[0]!, id: 'f2_g', from: 'f2', source: 'olumi', quote: null });
    two.options[1]!.settings.push({ ...two.options[1]!.settings[0]!, factor_id: 'f2', value: 2, source: 'olumi', quote: null });
    const less = { ...structuredClone(two), links: two.links.filter((l) => l.id !== 'f_g') };
    const restructure: Restructure = { repairs: 0 };
    expect(await proposeLivingChange({ dispatch: product(two).dispatch, proposals: new ProposalStore(), restructure }, changeCtx, args(less, ['f_g'])))
      .toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(restructure.repairs).toBe(0);
    const pathless = remeasured();
    const fewer = structuredClone(pathless);
    fewer.factors[0] = { ...fewer.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    expect(await proposeLivingChange({ dispatch: product(pathless).dispatch, proposals: new ProposalStore(), restructure }, changeCtx, args(fewer, [])))
      .toMatchObject({ status: 'ok' });
    expect(restructure.repairs).toBe(0);
  });
});

describe('DL 22 Oct (marketing on 4a4c338c): a change that adds the person\'s own aim with its target makes it the goal', () => {
  /** Saved: the person's aim with no target is the goal; f reaches it. */
  const untargeted = (): LivingModelT => {
    const m = structuredClone(KNOWN_ANSWER);
    m.aims[0] = { ...m.aims[0]!, text: 'Grow the units', target: null };
    return m;
  };
  /** The change adds the person's own aim, with the target they stated, and nothing linked to it. */
  const stated = (src: 'user' | 'olumi' = 'user'): LivingModelT['aims'][number] => ({ ...structuredClone(KNOWN_ANSWER.aims[0]!), id: 'g2', text: 'Reach 100 units',
    source: src, quote: src === 'user' ? 'we need at least 100 units' : null });
  const added = (src: 'user' | 'olumi' = 'user'): LivingModelT => ({ ...untargeted(), aims: [...untargeted().aims, stated(src)] });
  /** The retry: what drives it linked to it, as Olumi's own provisional estimate. */
  const linked = (): LivingModelT => ({ ...added(), links: [...added().links, { id: 'f_g2', from: 'f', to: 'g2', source: 'olumi', party: null, quote: null,
    effect: { estimate_by: null, form: 'range', value: null, low: 20, high: 60, sd: null, unit: 'units', sign: '+' } }] });
  const args = (model: LivingModelT) => ({ public_label: 'Add your target', basis: 'The person stated their target.', model, remove: [] as string[] });
  const ctx = { ...changeCtx, user_turn_text: 'Our target: we need at least 100 units.' };

  it('no option reaches the added aim: the aim is said once; the linked retry is carded and written with that aim as the goal', async () => {
    const p = product(untargeted());
    const proposals = new ProposalStore();
    const restructure: Restructure = { repairs: 0 };
    expect(goalOf(p.saved())?.id).toBe('g');
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, ctx, args(added()));
    expect(first, JSON.stringify(first)).toMatchObject({ status: 'refused', reason: 'not_run_ready', detail: REPAIR_CHANGE });
    expect(codes(first)).toContain('NO_PATH_TO_GOAL:fix');
    expect(p.registered).toHaveLength(0);
    const second = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, ctx, args(linked()));
    expect(second, JSON.stringify(second)).toMatchObject({ status: 'ok', data: { proposal_id: expect.any(String) } });
    expect(((second as { data: Rec }).data.withheld as Rec[]).filter((w) => w.id === 'g2'), 'the stated aim is the goal, never held').toEqual([]);
    expect(await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((second as { data: Rec }).data.proposal_id)))
      .toMatchObject({ status: 'ok', mutated: true });
    expect(goalOf(p.saved())).toMatchObject({ id: 'g2', goal_threshold: expect.anything() });
  });

  it('base fallback: the same change sent again is carded as it is, the stated aim the goal', async () => {
    const p = product(untargeted());
    const proposals = new ProposalStore();
    const restructure: Restructure = { repairs: 0 };
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, ctx, args(added()))).toMatchObject({ reason: 'not_run_ready' });
    const again = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, ctx, args(added()));
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'ok' });
    await applyLivingChange({ dispatch: p.dispatch, proposals }, ctx, String((again as { data: Rec }).data.proposal_id));
    expect(goalOf(p.saved())?.id).toBe('g2');
  });

  it('JOINT: two stated aims added: the first is the goal, the second stays out of the slice', async () => {
    const two = linked();
    two.aims.push({ ...stated(), id: 'g3', text: 'Reach 100 units again' });
    const out = await proposeLivingChange({ dispatch: product(untargeted()).dispatch, proposals: new ProposalStore(), restructure: { repairs: 0 } }, ctx, args(two));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok' });
    expect(((out as { data: Rec }).data.withheld as Rec[]).filter((w) => w.id === 'g2' || w.id === 'g3')).toEqual([{ id: 'g3', reason: 'aim_not_in_slice' }]);
  });

  it('CONTRAST: a saved goal with its own target, or an aim Olumi adds, never moves the goal and is carded at once', async () => {
    const restructure: Restructure = { repairs: 0 };
    const keeps = { ...structuredClone(KNOWN_ANSWER), aims: [...structuredClone(KNOWN_ANSWER).aims, stated()] };
    const a = await proposeLivingChange({ dispatch: product(KNOWN_ANSWER).dispatch, proposals: new ProposalStore(), restructure }, ctx, args(keeps));
    expect(a, JSON.stringify(a)).toMatchObject({ status: 'ok' });
    expect(((a as { data: Rec }).data.withheld as Rec[]).filter((w) => w.id === 'g2')).toEqual([{ id: 'g2', reason: 'aim_not_in_slice' }]);
    const b = await proposeLivingChange({ dispatch: product(untargeted()).dispatch, proposals: new ProposalStore(), restructure }, ctx, args(added('olumi')));
    expect(b, JSON.stringify(b)).toMatchObject({ status: 'ok' });
    expect(((b as { data: Rec }).data.withheld as Rec[]).filter((w) => w.id === 'g2')).toEqual([{ id: 'g2', reason: 'aim_not_in_slice' }]);
    expect(restructure.repairs).toBe(0);
  });
});

describe('C3 (DL 93d79c3e 01:56Z; marketing set b r1): the person\'s stated goal REPLACES a drafted aim that is no goal, never sits beside it', () => {
  // The drafted aim: an option clause read as the goal, the person's words with Olumi's suggested measure and no figure.
  const task = (): LivingModelT['aims'][number] => ({ id: 't', text: 'push f to 1, or we hold', status: 'current', defined_as: null, source: 'user',
    party: null, quote: 'push f to 1, or we hold', target: { ...KNOWN_ANSWER.aims[0]!.target!, quantity: 'the plan settled', comparator: '=',
      value: null, unit: null, baseline: null, current: null, source: 'olumi' } });
  const drafted = (): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER), aims: [task()], links: [] });
  const stated = (): LivingModelT => ({ ...structuredClone(KNOWN_ANSWER), aims: [task(), structuredClone(KNOWN_ANSWER.aims[0]!)] });
  const cardOf = (out: unknown) => (out as { data: Rec }).data;

  it('the replace: asked once with the aim it names; naming it in remove makes the card, and a Run tests the person\'s goal', async () => {
    const p = product(drafted());
    const proposals = new ProposalStore();
    const restructure: Restructure = { repairs: 0 };
    const first = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx, change(stated()));
    expect(first, JSON.stringify(first)).toEqual({ status: 'refused', reason: 'goal_beside_no_goal', detail: REPLACE_AIM,
      data: { aim: { id: 't', text: 'push f to 1, or we hold' } } });
    expect(restructure.repairs).toBe(1);
    const card = await proposeLivingChange({ dispatch: p.dispatch, proposals, restructure }, changeCtx,
      { ...change({ ...stated(), aims: [structuredClone(KNOWN_ANSWER.aims[0]!)] }), remove: ['t'] });
    expect(card, JSON.stringify(card)).toMatchObject({ status: 'ok', data: { run_ready: true } });
    expect(cardOf(card).restructure, 'the replace is not a loss: the retry is carded').toBeUndefined();
    expect(cardOf(card).changes).toContainEqual(expect.objectContaining({ kind: 'aim', id: 't', change: 'remove' }));
    await applyLivingChange({ dispatch: p.dispatch, proposals }, changeCtx, String(cardOf(card).proposal_id));
    expect(goalOf(p.saved())?.id).toBe('g');
    expect((p.saved()!.living_model as LivingModelT).aims.map((a) => a.id)).toEqual(['g']);
  });

  it('⛔ the person\'s own aim is never dropped: sent unchanged, the card keeps it; a figured goal of theirs is never asked about', async () => {
    const p = product(drafted());
    const restructure: Restructure = { repairs: 0 };
    await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(stated()));
    const kept = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(stated()));
    expect(kept, JSON.stringify(kept)).toMatchObject({ status: 'ok' });
    expect(cardOf(kept).changes).not.toContainEqual(expect.objectContaining({ kind: 'aim', id: 't' }));
    const q = product(structuredClone(KNOWN_ANSWER));
    const second = { ...structuredClone(KNOWN_ANSWER.aims[0]!), id: 'g2', text: 'Reach 70 units', quote: 'today we are at 70' };
    const r2: Restructure = { repairs: 0 };
    const both = await proposeLivingChange({ dispatch: q.dispatch, proposals: new ProposalStore(), restructure: r2 }, changeCtx,
      change({ ...structuredClone(KNOWN_ANSWER), aims: [structuredClone(KNOWN_ANSWER.aims[0]!), second] }));
    expect(both, JSON.stringify(both)).toMatchObject({ status: 'ok' });
    expect(r2.repairs).toBe(0);
  });

  it('Codex r1 on #3697 (P1): the replace is the NEXT call\'s only; after another refusal, dropping the aim the person has since given words is kept as refused', async () => {
    const olumiTask = { ...task(), source: 'olumi' as const, quote: null };
    const ctx = { ...changeCtx, user_turn_text: 'we need at least 200 units' };
    const p = product({ ...drafted(), aims: [olumiTask] });
    const restructure: Restructure = { repairs: 0 };
    const deps = { dispatch: p.dispatch, proposals: new ProposalStore(), restructure };
    expect(await proposeLivingChange(deps, ctx, change({ ...stated(), aims: [olumiTask, structuredClone(KNOWN_ANSWER.aims[0]!)] })))
      .toMatchObject({ reason: 'goal_beside_no_goal' });
    const theirs = { ...structuredClone(KNOWN_ANSWER.aims[0]!), id: 't', text: 'Reach 200 units', quote: 'we need at least 200 units',
      target: { ...KNOWN_ANSWER.aims[0]!.target!, value: 200 } };
    // Another refusal between: today's goal t gets its own link and an Olumi prerequisite on it.
    const toT = { ...structuredClone(KNOWN_ANSWER.links[0]!), id: 'f_t', to: 't' };
    const between = { ...stated(), aims: [theirs, structuredClone(KNOWN_ANSWER.aims[0]!)], links: [...stated().links, toT],
      conditions: [{ text: PREREQ, applies_to: ['f_t'], role: 'prerequisite' as const, ...olumi }] };
    expect(await proposeLivingChange(deps, ctx, change(between))).toMatchObject({ reason: 'not_run_ready' });
    const dropped = await proposeLivingChange(deps, ctx, { ...change({ ...stated(), aims: [structuredClone(KNOWN_ANSWER.aims[0]!)] }), remove: ['t'] });
    expect(dropped, JSON.stringify(dropped)).toMatchObject({ status: 'ok', data: { restructure: { kept: 'refused_call', lost: expect.arrayContaining(['aims:t']) } } });
    expect(cardOf(dropped).changes).not.toContainEqual(expect.objectContaining({ kind: 'aim', id: 't', change: 'remove' }));
  });

  it('Codex r1 on #3697 (P2): an aim the change itself adds is never asked to be removed (there is no saved one to name)', async () => {
    const p = product({ ...drafted(), aims: [] });
    const restructure: Restructure = { repairs: 0 };
    const out = await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(stated()));
    expect((out as { reason?: string }).reason, JSON.stringify(out).slice(0, 300)).not.toBe('goal_beside_no_goal');
    expect(restructure.replace).toBeUndefined();
  });

  it('only what the change brings: a model that already held the drafted aim beside the person\'s goal is not held up', async () => {
    const p = product(stated());
    const restructure: Restructure = { repairs: 0 };
    const next = stated();
    next.factors[0] = { ...next.factors[0]!, value: 0.6, quote: 'Actually f is at 0.6 now.' };
    expect(await proposeLivingChange({ dispatch: p.dispatch, proposals: new ProposalStore(), restructure }, changeCtx, change(next)))
      .toMatchObject({ status: 'ok' });
    expect(restructure.repairs).toBe(0);
  });
});
