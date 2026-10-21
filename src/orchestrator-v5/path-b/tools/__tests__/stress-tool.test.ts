/**
 * TRACK 3 `stress_test`: the plan, the per-setting sides, the summary and the adapter, on a living model shaped like brief
 * v1.0 §6 G2 (net contribution £k, target ≥ 90; A/B/C set their uplift, their exposure to demand and cost stress, and how
 * far they commit to growth; the stresses are the two exposure links, the alternative is "growth loses repeat customers").
 * The variant Run is a double that reads the MAPPED variant graph a Run would send (which edges exist, their existence
 * probability and their effect in the person's units) and computes each option's level independently, never through the
 * engine. The real engine path is witnessed by Track 3's runner (ISL wip/track3-engine). SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { LivingModelT } from '../../../../schemas/living-model.js';
import { assignEntityRefs } from '../../../graph/entity-refs.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { STRESS_MAX_WALL_MS, planStress, sideOf, stressTest, type StressRow, type StressTestArgs, type StressVariantRows } from '../stress-tool.js';
import { TOOL_DESCRIPTIONS } from '../index.js';
import type { Rec } from './fixtures.js';

const SID = 'scn_stress';
const user = { source: 'user' as const, party: null, quote: 'stated' };
const lvl = (factor_id: string, value: number) => ({ factor_id, value, low: null, high: null, unit: null, ...user });
const G2: LivingModelT = {
  aims: [{ id: 'c', text: '12-month net contribution', status: 'current', ...user,
    target: { quantity: 'net contribution', comparator: '>=', value: 90, low: null, high: null, unit: '£k', by_when: null, baseline: 'today', current: 95, current_source: 'user', current_unit: null, change_kind: null } }],
  options: [
    { id: 'A', label: 'Growth-first', ...user, settings: [lvl('uplift', 25), lvl('dexp', 20), lvl('cexp', 20), lvl('growth', 1)] },
    { id: 'B', label: 'Balanced rollout', ...user, settings: [lvl('uplift', 10), lvl('dexp', 10), lvl('cexp', 5), lvl('growth', 0)] },
    { id: 'C', label: 'Protect margin', ...user, settings: [lvl('uplift', 0), lvl('dexp', 2), lvl('cexp', 2), lvl('growth', 0)] },
  ],
  factors: [
    { id: 'uplift', label: 'Planned uplift', value: 0, low: null, high: null, unit: '£k', ...user },
    { id: 'dexp', label: 'Demand-stress exposure', value: 0, low: null, high: null, unit: null, ...user },
    { id: 'cexp', label: 'Cost-stress exposure', value: 0, low: null, high: null, unit: null, ...user },
    { id: 'growth', label: 'Growth commitment', value: 0, low: null, high: null, unit: null, ...user },
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
  alternative: { label: 'growth loses repeat customers', from: 'growth', to: 'c', value: 30, sign: '-', source: 'olumi' },
};

/** Independent read of ONE mapped variant: today + Σ over the goal's mapped edges of P(exists) × effect × (level − today). */
function exactLevels(g: Rec): Map<string, number> {
  const m = g.living_model as LivingModelT;
  const aim = m.aims[0]!;
  const today = new Map(m.factors.map((f) => [f.id, f.value ?? 0]));
  const edges = (g.edges as Rec[]).filter((e) => e.to === aim.id);
  return new Map(m.options.map((o) => {
    const at = (id: string) => o.settings.find((s) => s.factor_id === id)?.value ?? today.get(id) ?? 0;
    let level = aim.target!.current!;
    for (const e of edges) {
      const amount = ((e.provenance as Rec).natural_effect as Rec).amount as number;
      level += (e.exists_probability as number) * amount * (at(String(e.from)) - (today.get(String(e.from)) ?? 0));
    }
    return [o.id, level];
  }));
}

function product(initial: LivingModelT, tweak: (g: Rec) => Rec = (g) => g) {
  let graph: Rec = tweak({ ...mapLivingModel(initial).graph, living_model: initial });
  const writes: string[] = [];
  const dispatch = vi.fn(async (path: string) => {
    if (!path.endsWith('/graph')) writes.push(path);
    return { status: 200, json: { graph, brief_text: 'synthetic', graph_hash: computeAnalysisAffectingGraphHash(graph as never), graph_identity_hash: computeGraphIdentityHash(graph as never) } };
  });
  return { dispatch, writes, move: (m: LivingModelT) => { graph = { ...mapLivingModel(m).graph, living_model: m }; } };
}
type RunArgs = { variantGraph: Rec; signal: AbortSignal };
const engineDouble = (sd = 0.5) => vi.fn(async (v: RunArgs): Promise<StressVariantRows> => {
  const levels = exactLevels(v.variantGraph);
  return { kind: 'rows', targetLicensed: true, rows: new Map([...levels].map(([o, mean]) => [o, { goal: null, mean, sd, n: 2000 } satisfies StressRow])) };
});
const ctx = { scenario_id: SID };
type Data = Rec & { options: Record<string, Rec>; cells: Rec[]; joint_shortfall_witnesses: Rec[]; explanation_disagreements: Rec[]; most_favourable_average_per_setting: { options: string[]; setting: Rec; hypothesis: string }[] };
const dataOf = (o: unknown) => (o as { data: Data }).data;

describe('stress_test on a G2-shaped living model', () => {
  it('reproduces the brief reference: counts by side of the AVERAGE, worst tested average, maximum tested regret; ties are too close to call', async () => {
    const p = product(G2);
    const run = engineDouble();
    const out = await stressTest({ dispatch: p.dispatch, runStressVariant: run }, ctx, ARGS);
    expect(out.status).toBe('ok');
    const d = dataOf(out);
    expect(run).toHaveBeenCalledTimes(8);
    expect(d.variants_requested).toBe(8);
    expect(d.incomplete).toBe(false);
    expect(d.persisted).toBe(false);
    expect(p.writes).toEqual([]);
    expect(d.cells.every((c) => !('goal_chance' in c))).toBe(true);
    expect(d.options.A).toMatchObject({ requested: 8, average_clears: 3, too_close_to_call: 1, average_short: 4, worst_tested_average: 50 });
    expect(d.options.B).toMatchObject({ average_clears: 6, too_close_to_call: 2, average_short: 0, worst_tested_average: 90 });
    expect(d.options.C).toMatchObject({ average_clears: 8, too_close_to_call: 0, average_short: 0, worst_tested_average: 91 });
    expect([d.options.A.max_tested_average_regret, d.options.B.max_tested_average_regret, d.options.C.max_tested_average_regret]).toEqual([41, 15, 25]);
  });

  it('says AVERAGE, never "meets the goal": every side, the reading rule and the tool description (Science, 21 Oct)', async () => {
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble() }, ctx, ARGS));
    expect(new Set(d.cells.map((c) => c.side))).toEqual(new Set(['average_clears', 'average_short', 'too_close_to_call']));
    expect(d.reading_rule).toContain('never means "meets the goal"');
    expect(TOOL_DESCRIPTIONS.stress_test).toContain('AVERAGE level with the target');
    expect(TOOL_DESCRIPTIONS.stress_test).toContain('Never say an option meets the goal from this test');
    expect(TOOL_DESCRIPTIONS.stress_test).not.toMatch(/\bas met\b|met at k of n/);
  });

  it('under H1 the alternative HOLDS: Olumi\'s link reaches the Run with existence 1, and only under H1', async () => {
    const run = engineDouble();
    await stressTest({ dispatch: product(G2).dispatch, runStressVariant: run }, ctx, ARGS);
    const alt = (g: Rec) => (g.edges as Rec[]).find((e) => e.id === 'stress_alternative_0');
    const held = run.mock.calls.map(([v]) => alt(v.variantGraph)).filter((e) => e !== undefined);
    expect(held.map((e) => e!.exists_probability)).toEqual([1, 1, 1, 1]);
    expect(held.map((e) => (e!.provenance as Rec).magnitude)).toEqual(Array(4).fill('olumi_estimate'));
  });

  it('H1 touches only the ADDED link: a saved Olumi link already called stress_alternative_0 keeps 0.8', async () => {
    const taken = { ...G2, links: G2.links.map((l) => (l.id === 'cexp_c' ? { ...l, id: 'stress_alternative_0', source: 'olumi' as const, quote: null } : l)) };
    const run = engineDouble();
    await stressTest({ dispatch: product(taken).dispatch, runStressVariant: run }, ctx, { ...ARGS, stresses: [ARGS.stresses[0]!] });
    const h1 = run.mock.calls.map(([v]) => v.variantGraph.edges as Rec[]).filter((es) => es.some((e) => e.id === 'stress_alternative_1'));
    expect(h1).toHaveLength(2);
    expect(h1.map((es) => [es.find((e) => e.id === 'stress_alternative_0')!.exists_probability, es.find((e) => e.id === 'stress_alternative_1')!.exists_probability]))
      .toEqual([[0.8, 1], [0.8, 1]]);
  });

  it('finds the joint shortfall of the average (A under the saved model only) and where the explanations disagree', async () => {
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble() }, ctx, ARGS));
    expect(d.joint_shortfall_witnesses).toEqual([{ hypothesis: 'H0', option_id: 'A' }]);
    expect(d.explanation_disagreements.map((x) => [x.option_id, x.saved_model, x.alternative])).toEqual([['A', 'average_clears', 'average_short'], ['A', 'average_clears', 'average_short']]);
  });

  it('a joint shortfall needs the average to clear under each stress alone: an option already failing on one stress is no witness', async () => {
    const args = { ...ARGS, stresses: [{ item_id: 'dexp_c', values: [-2], values_source: 'user' as const }, ARGS.stresses[1]!] };
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble() }, ctx, args));
    expect(d.joint_shortfall_witnesses).toEqual([{ hypothesis: 'H0', option_id: 'C' }, { hypothesis: 'H1', option_id: 'C' }]);
  });

  it('keeps a tie at the most favourable average as a tie, never one option', async () => {
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble() }, ctx, ARGS));
    const tie = d.most_favourable_average_per_setting.find((x) => x.hypothesis === 'H0' && x.setting.dexp_c === 0 && x.setting.cexp_c === -1);
    expect(tie?.options).toEqual(['A', 'B']);
  });

  it('a variant that did not run is not_run, never a pass, and its regret is withheld', async () => {
    const base = engineDouble();
    const flaky = vi.fn(async (v: RunArgs) => (flaky.mock.calls.length === 4 ? { kind: 'refused' as const, reason: 'timed_out' } : base(v)));
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: flaky }, ctx, ARGS));
    expect(d.incomplete).toBe(true);
    expect(d.cells.filter((c) => c.side === 'not_run').every((c) => c.reason === 'variant_timed_out')).toBe(true);
    expect(d.options.A.not_run).toBe(1);
    expect(d.options.A.max_tested_average_regret).toBeNull();
  });

  it('stops at the time limit and says so', async () => {
    let t = 0;
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble(), now: () => (t += STRESS_MAX_WALL_MS / 3) }, ctx, ARGS));
    expect(d.incomplete).toBe(true);
    expect(d.cells.some((c) => c.reason === 'time_limit')).toBe(true);
  });

  it('the deadline aborts a variant in flight: it is not run, and its signal is aborted', async () => {
    const signals: AbortSignal[] = [];
    const hang = vi.fn((v: RunArgs) => { signals.push(v.signal); return new Promise<StressVariantRows>(() => undefined); });
    const clock = [0, STRESS_MAX_WALL_MS - 5];
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: hang, now: () => clock.shift() ?? STRESS_MAX_WALL_MS }, ctx, ARGS));
    expect(hang).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(d.variants_run).toBe(0);
    expect(d.cells.every((c) => c.side === 'not_run' && c.reason === 'time_limit')).toBe(true);
  });

  it('rows that settle after the deadline are not run, never counted', async () => {
    const clock = [0, 1_000, STRESS_MAX_WALL_MS + 1];
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble(), now: () => clock.shift() ?? STRESS_MAX_WALL_MS + 2 }, ctx, ARGS));
    expect(d.variants_run).toBe(0);
    expect(d.cells.every((c) => c.side === 'not_run' && c.reason === 'time_limit')).toBe(true);
  });

  it('a model changed during the test returns no rows', async () => {
    const p = product(G2);
    const run = vi.fn(async (v: RunArgs) => { p.move({ ...G2, factors: G2.factors.map((f) => ({ ...f, quote: 'moved' })) }); return engineDouble()(v); });
    expect(await stressTest({ dispatch: p.dispatch, runStressVariant: run }, ctx, ARGS)).toMatchObject({ status: 'unavailable', reason: 'model_changed_during_stress' });
  });

  it('a saved graph today\'s mapper does not reproduce is refused: H0 must be the saved model', async () => {
    const drift = (g: Rec) => ({ ...g, edges: (g.edges as Rec[]).map((e) => (e.id === 'uplift_c' ? { ...e, exists_probability: 0.5 } : e)) });
    const run = engineDouble();
    expect(await stressTest({ dispatch: product(G2, drift).dispatch, runStressVariant: run }, ctx, ARGS)).toMatchObject({ status: 'refused', reason: 'saved_graph_not_reproducible' });
    expect(run).not.toHaveBeenCalled();
  });

  it('a served-shape saved graph (display refs and their counter, issued by the register route) passes, and every variant carries them', async () => {
    const issued = (g: Rec) => assignEntityRefs(g, { nodes: [] }).graph;
    const p = product(G2, issued);
    const saved = issued({ ...mapLivingModel(G2).graph, living_model: G2 });
    const refOf = (g: Rec) => new Map((g.nodes as Rec[]).map((n) => [n.id, n.ref]));
    expect([...refOf(saved).values()].every((r) => typeof r === 'string')).toBe(true);
    const run = engineDouble();
    expect((await stressTest({ dispatch: p.dispatch, runStressVariant: run }, ctx, ARGS)).status).toBe('ok');
    for (const [v] of run.mock.calls) {
      expect(v.variantGraph.ref_high_water).toEqual(saved.ref_high_water);
      for (const [id, ref] of refOf(saved)) expect(refOf(v.variantGraph).get(id)).toBe(ref);
    }
  });

  it('a Run input the mapper does not write (a goal deadline) is refused: the variants would silently drop it', async () => {
    const deadline = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => (n.kind === 'goal' ? { ...n, goal_horizon: { deadline: '2027-04-09' } } : n)) });
    const run = engineDouble();
    expect(await stressTest({ dispatch: product(G2, deadline).dispatch, runStressVariant: run }, ctx, ARGS)).toMatchObject({ status: 'refused', reason: 'saved_graph_not_reproducible' });
    expect(run).not.toHaveBeenCalled();
  });

  it('a tested link the mapper holds back, or replaces with its placeholder, is refused, never a silent no-op', async () => {
    const unsigned = { ...G2, links: G2.links.map((l) => (l.id === 'dexp_c' ? { ...l, effect: { ...l.effect, value: 1, sign: null } } : l)) };
    const wrongUnit = { ...G2, links: G2.links.map((l) => (l.id === 'dexp_c' ? { ...l, effect: { ...l.effect, unit: 'kg' } } : l)) };
    const placeholder = (mapLivingModel(wrongUnit).graph.edges as Rec[]).find((e) => e.id === 'dexp_c');
    expect(placeholder).toMatchObject({ defaulted: true });
    for (const m of [unsigned, wrongUnit]) {
      const run = engineDouble();
      expect(await stressTest({ dispatch: product(m).dispatch, runStressVariant: run }, ctx, ARGS)).toMatchObject({ status: 'refused', reason: 'stress_item_not_mapped' });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('is unavailable where the route has not wired the variant Run', async () => {
    expect(await stressTest({ dispatch: product(G2).dispatch }, ctx, ARGS)).toMatchObject({ status: 'unavailable', reason: 'stress_unavailable' });
  });
});

describe('planStress refuses what it cannot test as asked', () => {
  it('an unknown item, an unsized link, too many combinations, an alternative from an option, a duplicated alternative', () => {
    expect(planStress(G2, { ...ARGS, stresses: [{ item_id: 'nope', values: [1], values_source: 'user' }] })).toMatchObject({ refusal: 'stress_item_unknown' });
    const unsized = { ...G2, links: G2.links.map((l) => (l.id === 'dexp_c' ? { ...l, effect: { ...l.effect, value: null } } : l)) };
    expect(planStress(unsized, ARGS)).toMatchObject({ refusal: 'stress_item_not_sized' });
    const many = { ...ARGS, alternative: null, stresses: ['uplift_c', 'dexp_c', 'cexp_c'].map((item_id) => ({ item_id, values: [-1, -2, -3], values_source: 'olumi' as const })) };
    expect(planStress(G2, many)).toMatchObject({ refusal: 'stress_budget_exceeded', data: { requested: 64, allowed: 16 } });
    expect(planStress(G2, { ...ARGS, alternative: { ...ARGS.alternative!, from: 'A' } })).toMatchObject({ refusal: 'alternative_endpoint_unknown' });
    expect(planStress(G2, { ...ARGS, alternative: { ...ARGS.alternative!, from: 'uplift', to: 'c' } })).toMatchObject({ refusal: 'alternative_duplicates_link' });
  });

  it('a tested value never relabels its item (attribution is the existence belief); its stale quote goes; the saved model is untouched', () => {
    const olumiLink = { ...G2, links: G2.links.map((l) => (l.id === 'cexp_c' ? { ...l, source: 'olumi' as const, quote: null } : l)) };
    const plan = planStress(olumiLink, { ...ARGS, stresses: [{ item_id: 'dexp_c', values: [-1], values_source: 'olumi' }, { item_id: 'cexp_c', values: [-1], values_source: 'user' }] });
    if ('refusal' in plan) throw new Error(plan.refusal);
    const both = plan.variants.find((v) => v.hypothesis === 'H0' && v.setting.dexp_c === -1 && v.setting.cexp_c === -1)!;
    expect(both.living.links.find((l) => l.id === 'dexp_c')).toMatchObject({ source: 'user', quote: null, effect: { value: 1, sign: '-' } });
    expect(both.living.links.find((l) => l.id === 'cexp_c')).toMatchObject({ source: 'olumi', quote: null });
    const edges = mapLivingModel(both.living).graph.edges as Rec[];
    expect(edges.find((e) => e.id === 'dexp_c')?.exists_probability).toBe(1);
    expect(edges.find((e) => e.id === 'cexp_c')?.exists_probability).toBe(0.8);
    expect(plan.coordinates.map((c) => [c.item_id, c.values_source])).toEqual([['dexp_c', 'olumi'], ['cexp_c', 'user']]);
    expect(G2.links.find((l) => l.id === 'dexp_c')).toMatchObject({ quote: 'stated', effect: { value: 0 } });
  });
});

describe('sideOf: a side only beyond the precision band; exact levels are exact', () => {
  it('an average within 4 SE of the target is too close to call, an exact tie clears an inclusive target, an unlicensed target says so', () => {
    expect(sideOf({ goal: null, mean: 90.01, sd: 0.5, n: 2000 }, 90, '>=', true).side).toBe('too_close_to_call');
    expect(sideOf({ goal: null, mean: 91, sd: 0.5, n: 2000 }, 90, '>=', true).side).toBe('average_clears');
    expect(sideOf({ goal: null, mean: 90, sd: 0, n: 2000 }, 90, '>=', true).side).toBe('average_clears');
    expect(sideOf({ goal: null, mean: 90, sd: 0, n: 2000 }, 90, '>', true).side).toBe('average_short');
    expect(sideOf({ goal: null, mean: 80, sd: 0.5, n: 2000 }, 90, '<=', true).side).toBe('average_clears');
    expect(sideOf({ goal: null, mean: 95, sd: 0.5, n: 2000 }, 90, '>=', false)).toMatchObject({ side: 'too_close_to_call', reason: 'target_not_licensed' });
  });
});
