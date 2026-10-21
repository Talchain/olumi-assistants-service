/**
 * TRACK 3 `stress_test`: the plan, the per-setting sides, the summary and the adapter, on a living model shaped like brief
 * v1.0 §6 G2 (net contribution £k, target ≥ 90; A/B/C set their uplift and their exposure to demand and cost stress; the
 * stresses are the two exposure links, the alternative is Growth-first's retention loss). The variant Run is a double: an
 * independent linear evaluator of each variant living model (never the mapper or the engine). The real engine path is
 * witnessed by Track 3's runner (ISL wip/track3-engine). SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { STRESS_MAX_WALL_MS, planStress, sideOf, stressTest, type StressRow, type StressTestArgs, type StressVariantRows } from '../stress-tool.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_stress';
const user = { source: 'user' as const, party: null, quote: 'stated' };
const lvl = (factor_id: string, value: number) => ({ factor_id, value, low: null, high: null, unit: null, ...user });
const G2: LivingModelT = {
  aims: [{ id: 'c', text: '12-month net contribution', status: 'current', ...user,
    target: { quantity: 'net contribution', comparator: '>=', value: 90, low: null, high: null, unit: '£k', by_when: null, baseline: 'today', current: 95, current_source: 'user', current_unit: null, change_kind: null } }],
  options: [
    { id: 'A', label: 'Growth-first', ...user, settings: [lvl('uplift', 25), lvl('dexp', 20), lvl('cexp', 20)] },
    { id: 'B', label: 'Balanced rollout', ...user, settings: [lvl('uplift', 10), lvl('dexp', 10), lvl('cexp', 5)] },
    { id: 'C', label: 'Protect margin', ...user, settings: [lvl('uplift', 0), lvl('dexp', 2), lvl('cexp', 2)] },
  ],
  factors: [
    { id: 'uplift', label: 'Planned uplift', value: 0, low: null, high: null, unit: '£k', ...user },
    { id: 'dexp', label: 'Demand-stress exposure', value: 0, low: null, high: null, unit: null, ...user },
    { id: 'cexp', label: 'Cost-stress exposure', value: 0, low: null, high: null, unit: null, ...user },
  ],
  links: [
    { id: 'uplift_c', from: 'uplift', to: 'c', ...user, effect: { form: 'point', value: 1, sd: null, low: null, high: null, unit: '£k', sign: '+' } },
    { id: 'dexp_c', from: 'dexp', to: 'c', ...user, effect: { form: 'point', value: 0, sd: null, low: null, high: null, unit: '£k', sign: '-' } },
    { id: 'cexp_c', from: 'cexp', to: 'c', ...user, effect: { form: 'point', value: 0, sd: null, low: null, high: null, unit: '£k', sign: '-' } },
  ],
  conditions: [], views: [], history: [],
};
const ARGS: StressTestArgs = {
  reason: 'where does growth-first fail?',
  stresses: [{ item_id: 'dexp_c', values: [-1], values_source: 'user' }, { item_id: 'cexp_c', values: [-1], values_source: 'user' }],
  alternative: { label: 'growth-first loses repeat customers', from: 'A', to: 'c', value: 30, sign: '-', source: 'olumi' },
};

/** Independent linear read of ONE variant living model, in the goal's units: today + Σ effect × (level − today level). */
function exactLevels(m: LivingModelT): Map<string, number> {
  const aim = m.aims[0]!;
  const today = new Map(m.factors.map((f) => [f.id, f.value ?? 0]));
  return new Map(m.options.map((o) => {
    const at = (id: string) => o.settings.find((s) => s.factor_id === id)?.value ?? today.get(id) ?? 0;
    let level = aim.target!.current!;
    for (const l of m.links.filter((x) => x.to === aim.id)) {
      const beta = (l.effect.sign === '-' ? -1 : 1) * Math.abs(l.effect.value ?? 0);
      level += m.options.some((x) => x.id === l.from) ? (l.from === o.id ? beta : 0) : beta * (at(l.from) - (today.get(l.from) ?? 0));
    }
    return [o.id, level];
  }));
}

function product(initial: LivingModelT) {
  let graph: Rec = { ...mapLivingModel(initial).graph, living_model: initial };
  const writes: string[] = [];
  const dispatch = vi.fn(async (path: string) => {
    if (!path.endsWith('/graph')) writes.push(path);
    return { status: 200, json: { graph, brief_text: 'synthetic', graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never) } };
  });
  return { dispatch, writes, move: (m: LivingModelT) => { graph = { ...mapLivingModel(m).graph, living_model: m }; } };
}
const engineDouble = (sd = 0.5) => vi.fn(async (v: { variantGraph: Rec }): Promise<StressVariantRows> => {
  const levels = exactLevels(v.variantGraph.living_model as LivingModelT);
  return { kind: 'rows', targetLicensed: true, rows: new Map([...levels].map(([o, mean]) => [o, { goal: null, mean, sd, n: 2000 } satisfies StressRow])) };
});
const ctx = { scenario_id: SID };
type Data = Rec & { options: Record<string, Rec>; cells: Rec[]; joint_failure_witnesses: Rec[]; explanation_disagreements: Rec[]; most_favourable_level_per_setting: { options: string[]; setting: Rec; hypothesis: string }[] };

describe('stress_test on a G2-shaped living model', () => {
  it('reproduces the brief reference: counts by side, worst tested level, maximum tested regret; ties stay UNRESOLVED', async () => {
    const p = product(G2);
    const run = engineDouble();
    const out = await stressTest({ dispatch: p.dispatch, runStressVariant: run }, ctx, ARGS);
    expect(out.status).toBe('ok');
    const d = (out as unknown as { data: Data }).data;
    expect(run).toHaveBeenCalledTimes(8);
    expect(d.variants_requested).toBe(8);
    expect(d.incomplete).toBe(false);
    expect(d.persisted).toBe(false);
    expect(p.writes).toEqual([]);
    expect(d.options.A).toMatchObject({ requested: 8, met: 3, unresolved: 1, fell_short: 4, worst_tested_level: 50 });
    expect(d.options.B).toMatchObject({ met: 6, unresolved: 2, fell_short: 0, worst_tested_level: 90 });
    expect(d.options.C).toMatchObject({ met: 8, unresolved: 0, fell_short: 0, worst_tested_level: 91 });
    expect([d.options.A.max_tested_regret, d.options.B.max_tested_regret, d.options.C.max_tested_regret]).toEqual([41, 15, 25]);
  });

  it('finds the joint failure (A under the saved model only) and where the explanations disagree', async () => {
    const p = product(G2);
    const d = ((await stressTest({ dispatch: p.dispatch, runStressVariant: engineDouble() }, ctx, ARGS)) as unknown as { data: Data }).data;
    expect(d.joint_failure_witnesses).toEqual([{ hypothesis: 'H0', option_id: 'A' }]);
    expect(d.explanation_disagreements.map((x) => [x.option_id, x.saved_model, x.alternative])).toEqual([['A', 'meets', 'falls_short'], ['A', 'meets', 'falls_short']]);
  });

  it('keeps a tie at the most favourable level as a tie, never one option', async () => {
    const p = product(G2);
    const d = ((await stressTest({ dispatch: p.dispatch, runStressVariant: engineDouble() }, ctx, ARGS)) as unknown as { data: Data }).data;
    const tie = d.most_favourable_level_per_setting.find((x) => x.hypothesis === 'H0' && x.setting.dexp_c === 0 && x.setting.cexp_c === -1);
    expect(tie?.options).toEqual(['A', 'B']);
  });

  it('a variant that did not run is not_run, never a pass, and its regret is withheld', async () => {
    const p = product(G2);
    const base = engineDouble();
    const flaky = vi.fn(async (v: { variantGraph: Rec; seed: number; goalNodeId: string; goalLevelTarget: number | null }) =>
      (flaky.mock.calls.length === 4 ? { kind: 'refused' as const, reason: 'timed_out' } : base(v)));
    const d = ((await stressTest({ dispatch: p.dispatch, runStressVariant: flaky }, ctx, ARGS)) as unknown as { data: Data }).data;
    expect(d.incomplete).toBe(true);
    expect(d.cells.filter((c) => c.side === 'not_run').every((c) => c.reason === 'variant_timed_out')).toBe(true);
    expect(d.options.A.not_run).toBe(1);
    expect(d.options.A.max_tested_regret).toBeNull();
  });

  it('stops at the time limit and says so', async () => {
    const p = product(G2);
    let t = 0;
    const d = ((await stressTest({ dispatch: p.dispatch, runStressVariant: engineDouble(), now: () => (t += STRESS_MAX_WALL_MS / 3) }, ctx, ARGS)) as unknown as { data: Data }).data;
    expect(d.incomplete).toBe(true);
    expect(d.cells.some((c) => c.reason === 'time_limit')).toBe(true);
  });

  it('a model changed during the test returns no rows', async () => {
    const p = product(G2);
    const run = vi.fn(async (v: { variantGraph: Rec }) => { p.move({ ...G2, factors: G2.factors.map((f) => ({ ...f, quote: 'moved' })) }); return engineDouble()(v as never); });
    const out = await stressTest({ dispatch: p.dispatch, runStressVariant: run as never }, ctx, ARGS);
    expect(out).toMatchObject({ status: 'unavailable', reason: 'model_changed_during_stress' });
  });

  it('is unavailable where the route has not wired the variant Run', async () => {
    expect(await stressTest({ dispatch: product(G2).dispatch }, ctx, ARGS)).toMatchObject({ status: 'unavailable', reason: 'stress_unavailable' });
  });
});

describe('planStress refuses what it cannot test as asked', () => {
  it('an unknown item, an unsized link, too many combinations and a duplicated alternative', () => {
    expect(planStress(G2, { ...ARGS, stresses: [{ item_id: 'nope', values: [1], values_source: 'user' }] })).toMatchObject({ refusal: 'stress_item_unknown' });
    const unsized = { ...G2, links: G2.links.map((l) => (l.id === 'dexp_c' ? { ...l, effect: { ...l.effect, value: null } } : l)) };
    expect(planStress(unsized, ARGS)).toMatchObject({ refusal: 'stress_item_not_sized' });
    const many = { ...ARGS, alternative: null, stresses: ['uplift_c', 'dexp_c', 'cexp_c'].map((item_id) => ({ item_id, values: [-1, -2, -3], values_source: 'olumi' as const })) };
    expect(planStress(G2, many)).toMatchObject({ refusal: 'stress_budget_exceeded', data: { requested: 64, allowed: 16 } });
    expect(planStress(G2, { ...ARGS, alternative: { ...ARGS.alternative!, from: 'uplift', to: 'c' } })).toMatchObject({ refusal: 'alternative_duplicates_link' });
  });

  it('a stress Olumi proposed is labelled Olumi\'s in the variant; the person\'s stays theirs; the saved model is untouched', () => {
    const plan = planStress(G2, { ...ARGS, stresses: [{ item_id: 'dexp_c', values: [-1], values_source: 'olumi' }, { item_id: 'cexp_c', values: [-1], values_source: 'user' }] });
    if ('refusal' in plan) throw new Error(plan.refusal);
    const both = plan.variants.find((v) => v.hypothesis === 'H0' && v.setting.dexp_c === -1 && v.setting.cexp_c === -1)!;
    expect(both.living.links.find((l) => l.id === 'dexp_c')).toMatchObject({ source: 'olumi', quote: null, effect: { value: 1, sign: '-' } });
    expect(both.living.links.find((l) => l.id === 'cexp_c')).toMatchObject({ source: 'user', quote: 'stated' });
    expect(G2.links.find((l) => l.id === 'dexp_c')!.effect.value).toBe(0);
    const alt = plan.variants.find((v) => v.hypothesis === 'H1')!.living.links.find((l) => l.id === 'stress_alternative');
    expect(alt).toMatchObject({ from: 'A', to: 'c', source: 'olumi', effect: { form: 'point', value: 30, sign: '-', unit: '£k' } });
  });
});

describe('sideOf: a side only beyond the precision band; exact levels are exact', () => {
  it('within 4 SE of the target is unresolved, an exact tie meets an inclusive target, an unlicensed target says so', () => {
    expect(sideOf({ goal: null, mean: 90.01, sd: 0.5, n: 2000 }, 90, '>=', true).side).toBe('unresolved');
    expect(sideOf({ goal: null, mean: 91, sd: 0.5, n: 2000 }, 90, '>=', true).side).toBe('meets');
    expect(sideOf({ goal: null, mean: 90, sd: 0, n: 2000 }, 90, '>=', true).side).toBe('meets');
    expect(sideOf({ goal: null, mean: 90, sd: 0, n: 2000 }, 90, '>', true).side).toBe('falls_short');
    expect(sideOf({ goal: null, mean: 80, sd: 0.5, n: 2000 }, 90, '<=', true).side).toBe('meets');
    expect(sideOf({ goal: null, mean: 95, sd: 0.5, n: 2000 }, 90, '>=', false)).toMatchObject({ side: 'unresolved', reason: 'target_not_licensed' });
  });
});
