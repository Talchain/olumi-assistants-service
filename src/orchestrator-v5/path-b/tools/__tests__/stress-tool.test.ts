/**
 * TRACK 3 `stress_test`: the plan, the per-setting chances, the lowest and highest, and the adapter, on a living model shaped like brief
 * v1.0 §6 G2 (net contribution £k, target ≥ 90; A/B/C set their uplift, their exposure to demand and cost stress, and how
 * far they commit to growth; the stresses are the two exposure links, the alternative is "growth loses repeat customers").
 * The variant Run is a double that reads the MAPPED variant graph a Run would send (which edges exist, their existence
 * probability and their effect in the person's units) and computes each option's level independently, never through the
 * engine; it shows that level as the cell's figure only to bind each cell to its own variant. What a real variant Run shows is
 * `stressChancesOf` on a recorded Run (last block). SYNTHETIC wording.
 */
import { describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { assignEntityRefs } from '../../../graph/entity-refs.js';
import { mapLivingModel } from '../../living-model/mapper.js';
import { readFileSync } from 'node:fs';
import { STRESS_MAX_WALL_MS, planStress, stressTest, type StressChance, type StressTestArgs, type StressVariantRows } from '../stress-tool.js';
import { stressChancesOf } from '../../../handlers/stress-variant-run.js';
import { TOOL_DESCRIPTIONS } from '../index.js';
import { ZERO_SPREAD_LINE } from '../../../goal-target/goal-chance-licence.js';
import type { Rec } from './fixtures.js';
import { HALF_MITIGATION } from '../../living-model/__tests__/track2-f2-event-risk.fixtures.js';

const SID = 'scn_stress';
const user = { source: 'user' as const, party: null, quote: 'stated' };
const lvl = (factor_id: string, value: number) => ({ factor_id, value, low: null, high: null, unit: null, ...user });
const G2: LivingModelT = LivingModel.parse({
  aims: [{ id: 'c', text: '12-month net contribution', status: 'current', ...user,
    target: { quantity: 'net contribution', comparator: '>=', value: 90, low: null, high: null, unit: '£k', by_when: null, baseline: 'today', current: 95, current_source: 'user', current_unit: null, change_kind: null, source: null } }],
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
});
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
const shown = (level: number): StressChance => ({ display: String(level), pct: level, provisional: false, not_shown: null });
const engineDouble = () => vi.fn(async (v: RunArgs): Promise<StressVariantRows> =>
  ({ kind: 'rows', rows: new Map([...exactLevels(v.variantGraph)].map(([o, level]) => [o, shown(level)])) }));
const ctx = { scenario_id: SID };
type Data = Rec & { cells: Rec[]; chance_range: Record<string, Rec[]> };
const dataOf = (o: unknown) => (o as { data: Data }).data;

describe('stress_test on a G2-shaped living model', () => {
  it('each cell is its own variant\'s figure; per option and explanation the lowest and highest tested, never averaged or combined', async () => {
    const p = product(G2);
    const run = engineDouble();
    const out = await stressTest({ dispatch: p.dispatch, runStressVariant: run }, ctx, ARGS);
    expect(out.status).toBe('ok');
    const d = dataOf(out);
    expect(run).toHaveBeenCalledTimes(8);
    expect([d.variants_requested, d.variants_run, d.incomplete, d.persisted]).toEqual([8, 8, false, false]);
    expect(p.writes).toEqual([]);
    // Growth-first: today 95 + uplift 25, less 20 per exposure stressed; the alternative takes 30 more.
    expect(d.chance_range.A).toEqual([
      { hypothesis: 'H0', tested: 4, shown: 4, lowest: { chance: '80', setting: { dexp_c: -1, cexp_c: -1 } }, highest: { chance: '120', setting: { dexp_c: 0, cexp_c: 0 } } },
      { hypothesis: 'H1', tested: 4, shown: 4, lowest: { chance: '50', setting: { dexp_c: -1, cexp_c: -1 } }, highest: { chance: '90', setting: { dexp_c: 0, cexp_c: 0 } } }]);
    expect(d.cells.some((c) => 'pct' in c), 'no percentage travels to the AI (DL ruling C)').toBe(false);
    expect(d.reading_rule).toMatch(/never averaged/);
    expect(TOOL_DESCRIPTIONS.stress_test).toMatch(/^Only when the person asks to stress-test/);
    expect(TOOL_DESCRIPTIONS.stress_test).not.toMatch(/AVERAGE|average clears|k of n/);
    expect(JSON.stringify(d)).not.toMatch(/average_|\bbest\b|winner|recommend/i);
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

  it('a variant that did not run is not_run, with no figure, and is left out of the lowest and highest', async () => {
    const base = engineDouble();
    const flaky = vi.fn(async (v: RunArgs) => (flaky.mock.calls.length === 4 ? { kind: 'refused' as const, reason: 'timed_out' } : base(v)));
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: flaky }, ctx, ARGS));
    expect(d.incomplete).toBe(true);
    expect(d.cells.filter((c) => c.not_run !== undefined).map((c) => [c.not_run, c.display])).toEqual(Array(3).fill(['variant_timed_out', undefined]));
    expect(d.variants_run).toBe(7);
    expect(d.chance_range.A![0]).toMatchObject({ tested: 4, shown: 3 });
  });

  it('stops at the time limit and says so', async () => {
    let t = 0;
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble(), now: () => (t += STRESS_MAX_WALL_MS / 3) }, ctx, ARGS));
    expect(d.incomplete).toBe(true);
    expect(d.cells.some((c) => c.not_run === 'time_limit')).toBe(true);
  });

  it('the deadline aborts a variant in flight: it is not run, and its signal is aborted', async () => {
    const signals: AbortSignal[] = [];
    const hang = vi.fn((v: RunArgs) => { signals.push(v.signal); return new Promise<StressVariantRows>(() => undefined); });
    const clock = [0, STRESS_MAX_WALL_MS - 5];
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: hang, now: () => clock.shift() ?? STRESS_MAX_WALL_MS }, ctx, ARGS));
    expect(hang).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(d.variants_run).toBe(0);
    expect(d.cells.every((c) => c.not_run === 'time_limit')).toBe(true);
  });

  it('rows that settle after the deadline are not run, never counted', async () => {
    const clock = [0, 1_000, STRESS_MAX_WALL_MS + 1];
    const d = dataOf(await stressTest({ dispatch: product(G2).dispatch, runStressVariant: engineDouble(), now: () => clock.shift() ?? STRESS_MAX_WALL_MS + 2 }, ctx, ARGS));
    expect(d.variants_run).toBe(0);
    expect(d.cells.every((c) => c.not_run === 'time_limit')).toBe(true);
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

  it('a link from a risk the mapper holds back (risk_not_in_slice) reaches no Run: refused, though the link itself is not withheld', async () => {
    const m = LivingModel.parse(HALF_MITIGATION);
    const run = engineDouble();
    expect(await stressTest({ dispatch: product(m).dispatch, runStressVariant: run }, ctx,
      { reason: 'what if a failure costs twice as much?', stresses: [{ item_id: 'fails_gp', values: [-16000], values_source: 'olumi' }], alternative: null }))
      .toMatchObject({ status: 'refused', reason: 'stress_item_not_mapped', data: { item_ids: ['fails_gp'] } });
    expect(run).not.toHaveBeenCalled();
  });

  /** A save from before #3544: the person's option settings carried no `extractionType` label (it changes no number). */
  const pre3544 = (g: Rec): Rec => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => (n.interventions === undefined ? n : { ...n,
    interventions: Object.fromEntries(Object.entries(n.interventions as Rec).map(([id, x]) => { const { extractionType: _label, ...rest } = x as Rec; return [id, rest]; })) })) });
  const hasInterventionLabel = (m: LivingModelT) => JSON.stringify((mapLivingModel(m).graph.nodes as Rec[]).map((n) => n.interventions ?? {})).includes('extractionType');
  const goalOfGraph = (g: Rec) => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;

  it('the remap allow-list (DL 21 Oct): a save from before #3544, differing only by extractionType, runs', async () => {
    expect(hasInterventionLabel(G2), 'precondition: today\'s mapper labels the settings').toBe(true);
    const run = engineDouble();
    expect((await stressTest({ dispatch: product(G2, pre3544).dispatch, runStressVariant: run }, ctx, ARGS)).status).toBe('ok');
    expect(run).toHaveBeenCalledTimes(8);
  });

  it('the allow-list is NAMED: an added goal threshold, a changed setting and a missing field still refuse', async () => {
    expect(goalOfGraph(mapLivingModel(G2).graph).goal_threshold, 'precondition: today\'s mapper admits the threshold').toBeTypeOf('number');
    const noThreshold = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => { if (n.kind !== 'goal') return n; const { goal_threshold: _t, ...rest } = n; return rest; }) });
    const changedSetting = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => (n.id !== 'A' ? n : { ...n,
      interventions: { ...(n.interventions as Rec), uplift: { ...((n.interventions as Rec).uplift as Rec), raw_value: 26 } } })) });
    const missingField = (g: Rec) => ({ ...g, nodes: (g.nodes as Rec[]).map((n) => (n.id !== 'dexp' ? n : { ...n,
      observed_state: Object.fromEntries(Object.entries(n.observed_state as Rec).filter(([k]) => k !== 'raw_value')) })) });
    for (const [why, tweak] of [['added goal_threshold', noThreshold], ['changed setting', changedSetting], ['missing field', missingField]] as const) {
      const run = engineDouble();
      expect(await stressTest({ dispatch: product(G2, tweak).dispatch, runStressVariant: run }, ctx, ARGS), why)
        .toMatchObject({ status: 'refused', reason: 'saved_graph_not_reproducible' });
      expect(run, why).not.toHaveBeenCalled();
    }
  });

  it('a save from before #3544 still refuses a held risk\'s link: "reaches the Run" is judged on today\'s reading, never the older labels', async () => {
    const m = LivingModel.parse(HALF_MITIGATION);
    expect(hasInterventionLabel(m), 'precondition: the older save differs by its labels').toBe(true);
    const run = engineDouble();
    expect(await stressTest({ dispatch: product(m, pre3544).dispatch, runStressVariant: run }, ctx,
      { reason: 'what if a failure costs twice as much?', stresses: [{ item_id: 'fails_gp', values: [-16000], values_source: 'olumi' }], alternative: null }))
      .toMatchObject({ status: 'refused', reason: 'stress_item_not_mapped' });
    expect(run).not.toHaveBeenCalled();
  });

  it('is unavailable where the route has not wired the variant Run', async () => {
    expect(await stressTest({ dispatch: product(G2).dispatch }, ctx, ARGS)).toMatchObject({ status: 'unavailable', reason: 'stress_unavailable' });
  });
});

/** The served core shape (R2, 21 Oct): every effect is an option's own exact link to the goal, which the mapper sends as that
 *  option's setting on the exact sum's `<goal>__change`, not as an edge. SYNTHETIC wording. */
const SUM: LivingModelT = LivingModel.parse({
  aims: [{ id: 'w', text: 'Widgets per week', status: 'current', ...user,
    target: { quantity: 'widgets', comparator: '>=', value: 100, low: null, high: null, unit: 'widgets', by_when: null, baseline: 'today', current: 80, current_source: null, current_unit: null, change_kind: null, source: null } }],
  options: [{ id: 'X', label: 'Second shift', ...user, settings: [] }, { id: 'Y', label: 'Faster jig', ...user, settings: [] }],
  factors: [],
  links: [
    { id: 'x_w', from: 'X', to: 'w', ...user, effect: { form: 'exact', value: 25, sd: null, low: null, high: null, unit: 'widgets', sign: '+' } },
    { id: 'y_w', from: 'Y', to: 'w', ...user, effect: { form: 'exact', value: 15, sd: null, low: null, high: null, unit: 'widgets', sign: '+' } },
  ],
  conditions: [], views: [], history: [],
});
/** Independent read of the mapped wire: today + each option's raw setting on the exact sum's change part; exact (sd 0). */
const sumDouble = () => vi.fn(async (v: RunArgs): Promise<StressVariantRows> => {
  const m = v.variantGraph.living_model as LivingModelT;
  const nodes = v.variantGraph.nodes as Rec[];
  const rows = new Map(m.options.map((o) => {
    const set = (nodes.find((n) => n.id === o.id)?.interventions ?? {}) as Record<string, { raw_value?: number }>;
    const change = Object.entries(set).filter(([k]) => k.endsWith('__change')).reduce((a, [, x]) => a + (x.raw_value ?? 0), 0);
    return [o.id, shown(m.aims[0]!.target!.current! + change)];
  }));
  return { kind: 'rows', rows };
});

describe('stress_test on the served exact-sum shape (an option\'s own link to the goal)', () => {
  it('the tested value reaches the Run as the option\'s setting', async () => {
    const run = sumDouble();
    const out = await stressTest({ dispatch: product(SUM).dispatch, runStressVariant: run }, ctx,
      { reason: 'what if the second shift adds less?', stresses: [{ item_id: 'x_w', values: [10, 20], values_source: 'user' }], alternative: null });
    expect(out.status).toBe('ok');
    const d = dataOf(out);
    expect(run).toHaveBeenCalledTimes(3);
    expect(d.chance_range.X![0]).toMatchObject({ lowest: { chance: '90', setting: { x_w: 10 } }, highest: { chance: '105', setting: { x_w: 25 } } });
    expect(d.chance_range.Y![0]).toMatchObject({ lowest: { chance: '95' }, highest: { chance: '95' } });
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

/** ST1's served bakery model, Run by the REAL handler on a local PLoT b60fe4fb → ISL 8d862f5a (recorded; see `_meta`). */
const BAKERY = JSON.parse(readFileSync('tests/fixtures/stress/served-bakery-run-20261021.json', 'utf8')) as { graph: Rec; result: Rec };

describe('stressChancesOf: each option as the variant Run\'s own result shows it (ST1, 21 Oct)', () => {
  it('the licensed figure and its words, provisional on Olumi\'s estimates; never PLoT\'s untyped average', () => {
    const rows = (BAKERY.result.enrichment as Rec).option_comparison as Rec[];
    expect(rows.map((r) => [r.option_id, (r.outcome as Rec).mean])).toEqual([['second_oven', expect.closeTo(0.774, 3)], ['longer_hours', expect.closeTo(0.733, 3)]]);
    expect([...stressChancesOf(BAKERY.result, BAKERY.graph)]).toEqual([
      ['second_oven', { display: 'about 40%', pct: 40, provisional: true, not_shown: null }],
      ['longer_hours', { display: 'about 9%', pct: 9, provisional: true, not_shown: null }]]);
  });

  it('a chance the stored licence withholds is not shown: its own words, no figure', () => {
    const result = structuredClone(BAKERY.result) as Rec & { enrichment: { inference_warnings: Rec[] } };
    const licence = result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_CHANCE_LICENSED')!;
    Object.assign(licence, { pct_by_option: { longer_hours: 9 }, display_rounding_by_option: { longer_hours: 'whole' }, withheld_option_ids: ['second_oven'],
      withheld_reason_by_option: { second_oven: { reason: 'zero_spread', side: 'meets', line: ZERO_SPREAD_LINE } } });
    expect(stressChancesOf(result, BAKERY.graph).get('second_oven')).toEqual({ display: null, pct: null, provisional: false, not_shown: ZERO_SPREAD_LINE });
    expect(stressChancesOf(result, BAKERY.graph).get('longer_hours')).toMatchObject({ display: 'about 9%', pct: 9 });
  });
});
