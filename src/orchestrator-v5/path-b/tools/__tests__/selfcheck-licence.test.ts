/**
 * ⭐ C1b: THE SELF-CHECK IS THE RUN'S OWN LICENCE DRY RUN (DL 93d79c3e). `run_ready` reads the Run's static verdict on the target
 * (`targetTestabilityOf`, on the postimage the write registers, 0 AI and 0 engine calls) beside readiness; every aim reading that
 * withholds the goal's chance is a fix (Olumi's) or an ask (the person's), in an existing composer's words; and a figure the item
 * already holds is never asked for again. A stateful product double; the kernel, the mapper and the write are real. SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../../context/graph-hash.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import { KNOWN_ANSWER as KNOWN } from '../../living-model/__tests__/fixtures.js';
import { buildModel } from '../draft-tool.js';
import { blockersOf, corePostimage, REPAIRS, selfCheck, STILL_ASK } from '../goal-path.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_c1b';
const BRIEF = 'we need at least 100 units; today we are at 70. f is at 0.5. push f to 1, or we hold. each +1 in f adds 50 units on average, with a standard deviation of 10';
const draftCtx = { scenario_id: SID, verified_user_messages: [BRIEF], user_turn_text: BRIEF };
const olumi = { source: 'olumi' as const, party: null, quote: null };
/** The known answer with its factor's unit stated, as every factor has one (drafting rules): an Olumi link from it can be sized per unit. */
const KNOWN_ANSWER: LivingModelT = { ...KNOWN, factors: KNOWN.factors.map((f) => ({ ...f, unit: 'level' })) };
const check = (m: LivingModelT) => blockersOf(m, selfCheck(m, mapLivingModel(m))).all;

/** The product's graph and register routes over one empty scenario (the draft's own write path). */
function product() {
  let graph: Rec | null = null;
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
    if (graph === null) return { status: 200, json: { graph: null, graph_present: false, graph_hash: null, graph_identity_hash: null } };
    return { status: 200, json: { graph, brief_text: BRIEF, graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: identity() } };
  });
  return { dispatch, registered };
}
/** A draft with no repair left: saved as it is, with `run_ready` and its blockers. */
const draft = async (model: LivingModelT) => {
  const p = product();
  const out = await buildModel({ dispatch: p.dispatch, restructure: { repairs: REPAIRS } }, draftCtx, { brief: BRIEF, model: structuredClone(model) });
  return { out: out as { status: string; data: Rec }, p };
};
const withAim = (t: Partial<NonNullable<LivingModelT['aims'][number]['target']>>, by: 'user' | 'olumi' = 'user'): LivingModelT => {
  const m = structuredClone(KNOWN_ANSWER);
  m.aims[0] = { ...m.aims[0]!, ...(by === 'olumi' ? olumi : {}), target: { ...m.aims[0]!.target!, ...t } };
  return m;
};
const withLink = (effect: Partial<LivingModelT['links'][number]['effect']>, by: 'user' | 'olumi' = 'user', base: LivingModelT = KNOWN_ANSWER): LivingModelT =>
  ({ ...structuredClone(base), links: [{ ...base.links[0]!, ...(by === 'olumi' ? olumi : {}), effect: { ...base.links[0]!.effect, ...effect } }] });

describe('C1b: run_ready is the Run\'s own licence dry run (DL 93d79c3e)', () => {
  it('readiness says ready, the Run\'s own target verdict withholds: the draft is saved with run_ready false, Olumi\'s unsized link a size fix', async () => {
    // Olumi's link from a factor with no unit: readiness admits a Run, but the Run cannot size it per unit of f, so it withholds.
    const unsized = withLink({}, 'olumi', KNOWN);
    const mapped = mapLivingModel(unsized);
    expect(assessCanonicalAnalysisReadiness(projectCorePostimageForPersistence(corePostimage(mapped, unsized)) as never).blockingIssues).toEqual([]);
    expect(targetTestabilityOf(projectCorePostimageForPersistence(corePostimage(mapped, unsized)))).toMatchObject({ kind: 'not_testable',
      failures: [{ precondition: 'P5', code: 'goal_path_unsized', links: [{ from: 'f', to: 'g' }] }] });
    const { out, p } = await draft(unsized);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { run_ready: false, note: STILL_ASK } });
    expect(out.data.blockers).toEqual([{ code: 'goal_path_unsized', items: ['f_g'], fix: expect.stringContaining('per one unit of what it comes from') }]);
    expect(p.registered).toHaveLength(1);
    // CONTRAST: the same link once f has its unit is sized: Run-ready, nothing said.
    const sized = await draft(withLink({}, 'olumi'));
    expect(sized.out, JSON.stringify(sized.out)).toMatchObject({ status: 'ok', data: { run_ready: true } });
    expect(sized.out.data.blockers).toBeUndefined();
  });

  it('the person\'s link the Run cannot size is an ask in the Run\'s own words; Olumi\'s is a fix', () => {
    const question = 'Olumi can compare your options, but can\'t yet test them against your target (at least 100 units), because it needs a size '
      + 'for the link from f to Reach 100 units. Roughly how much Reach 100 units in units does a change in f bring?';
    expect(check(withLink({ form: 'direction_only', value: null, sd: null }))).toEqual([{ code: 'goal_path_placeholder', items: ['f_g'], ask: true, question }]);
    expect(check(withLink({ form: 'direction_only', value: null, sd: null }, 'olumi'))).toEqual([{ code: 'goal_path_placeholder', items: ['f_g'],
      fix: expect.stringContaining('Size Olumi\'s link in the goal\'s own unit') }]);
  });

  it('a path failure on an identity\'s own edge is the engine\'s to judge, never said by the dry run (the P5 checks that need the engine are left out)', () => {
    // Synthetic: the total is the person's stated base plus an extra; the extra is Olumi's product of staff × output each; an option
    // adds one. The Run's ISL evaluation carries that product; before it, its operand edge reads unsized.
    const by = { source: 'user' as const, party: null, quote: 'stated' };
    const factor = (id: string, unit: string, value: number, extra: Rec = {}) => ({ estimate_by: null, kind: 'factor' as const, limit: null, id, label: id,
      value, low: null, high: null, unit, defined_as: null, ...by, ...extra });
    const m = structuredClone(KNOWN_ANSWER);
    m.aims[0] = { ...m.aims[0]!, id: 'total', defined_as: { op: 'sum', of: ['base', 'extra'], ...by },
      target: { ...m.aims[0]!.target!, quantity: 'units per week', unit: 'units per week', value: 100, current: 80 } };
    m.factors = [factor('base', 'units per week', 80), factor('people', 'staff', 0), factor('each', 'units per staff per week', 20),
      factor('extra', 'units per week', 0, { kind: 'outcome', defined_as: { op: 'product', of: ['people', 'each'], ...olumi } })] as LivingModelT['factors'];
    m.options = [{ ...m.options[0]!, settings: [] }, { ...m.options[1]!, settings: [{ ...m.options[1]!.settings[0]!, factor_id: 'people', value: 1 }] }];
    m.links = [];
    const verdict = targetTestabilityOf(projectCorePostimageForPersistence(corePostimage(mapLivingModel(m), m)));
    expect(verdict.kind === 'not_testable' && verdict.failures.some((f) => f.precondition === 'P5'), JSON.stringify(verdict)).toBe(true);
    expect(check(m).filter((b) => b.code.startsWith('goal_path') || b.code === 'identity_unconfirmed')).toEqual([]);
  });
});

describe('C1b: every aim reading that withholds the goal\'s chance is a fix or an ask, in the held-target composer\'s words (DL 93d79c3e, 00:48Z)', () => {
  it('the person\'s "exactly" target: the draft is saved with run_ready false and the ask carries the composer\'s question; Olumi\'s is a target fix', async () => {
    const { out } = await draft(withAim({ comparator: '=' }));
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'ok', data: { run_ready: false, note: STILL_ASK } });
    expect((out.data.blockers as Rec[]).find((b) => b.code === 'exact_target_not_in_slice')).toEqual({ code: 'exact_target_not_in_slice', items: ['g'], ask: true,
      question: 'One gap: ‘Reach 100 units’ aims for exactly 100 units. Would at least 100 units, or at most 100 units, count as meeting it?' });
    expect(check(withAim({ comparator: '=' }, 'olumi')).find((b) => b.code === 'exact_target_not_in_slice')).toEqual({ code: 'exact_target_not_in_slice',
      items: ['g'], fix: expect.stringContaining('at least or at most it, never exactly equal and never a range') });
  });

  it.each([
    ['target_range_not_in_slice', withAim({ value: null, low: 90, high: 110 }),
      'One gap: ‘Reach 100 units’ aims for between 90 units and 110 units. Does meeting it mean reaching at least 90 units, staying at most 110 units, or both?'],
    ['target_not_theirs', withAim({ source: 'olumi' }), 'One gap: Olumi suggested measuring ‘Reach 100 units’ as units. What figure would count as meeting it?'],
  ] as const)('%s: the person\'s, asked in the composer\'s words', (code, model, question) => {
    expect(check(model).find((b) => b.code === code)).toEqual({ code, items: ['g'], ask: true, question });
  });

  it('stay_within_base_not_theirs is an ask (no composer has words for it, so none is invented); aim_not_in_slice stays out of the loop', () => {
    const stay = withAim({ comparator: '<=', value: 100, current: 70 });
    stay.aims[0] = { ...stay.aims[0]!, ...olumi };
    expect(check(stay)).toEqual([{ code: 'stay_within_base_not_theirs', items: ['g'], ask: true }]);
    const two = structuredClone(KNOWN_ANSWER);
    two.aims.push({ ...two.aims[0]!, id: 'g2', text: 'Another aim' });
    expect(mapLivingModel(two).withheld.map((w) => w.reason)).toEqual(['aim_not_in_slice']);
    expect(check(two)).toEqual([]);
  });
});

describe('C1b: a figure the item already holds is never asked for again (DL 93d79c3e)', () => {
  it('the person\'s link holding a figure the Run reads as a placeholder is said, never asked; one with no figure is asked', () => {
    expect(check(withLink({ form: 'unknown', sd: null }))).toEqual([{ code: 'goal_path_placeholder', items: ['f_g'], said: true }]);
    expect(check(withLink({ form: 'direction_only', value: null, sd: null }))).toEqual([expect.objectContaining({ code: 'goal_path_placeholder', ask: true })]);
  });

  it('the person\'s relative change on today\'s level of 0: that held level is said, never asked again; with no level today, it is asked in the composer\'s words', () => {
    const change = { comparator: 'increase' as const, value: 20, unit: '%', current_unit: 'units', change_kind: 'relative' as const };
    expect(check(withAim({ ...change, current: 0 })).find((b) => b.items.includes('g'))).toEqual({ code: 'change_base_invalid', items: ['g'], said: true });
    expect(check(withAim({ ...change, current: null })).find((b) => b.items.includes('g'))).toEqual({ code: 'goal_level_unknown', items: ['g'], ask: true,
      question: 'One gap: ‘Reach 100 units’ is a change from today’s level of units, which isn’t given yet. What is today’s level of units?' });
  });
});
