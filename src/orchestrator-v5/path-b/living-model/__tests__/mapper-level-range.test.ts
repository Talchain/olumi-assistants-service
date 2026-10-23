import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { linkDefaultAssumptionsOf, readLinkDefaultAssumptions } from '../../../../cee/magnitude/link-default-assumptions.js';
import { withGoalChanceLicence, goalChanceLicenceForAgent } from '../../../goal-target/goal-chance-licence.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { mapLivingModel } from '../mapper.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../../tools/handlers/run-analysis.js';
import { KNOWN_ANSWER } from './fixtures.js';

type Rec = Record<string, any>;
const who = { source: 'user' as const, party: null, quote: 'Our capacity today is 80; one specialist adds 20, between 10 and 30.' };
function capacity(subject = 'cases'): LivingModelT {
  const model = structuredClone(KNOWN_ANSWER);
  Object.assign(model.aims[0]!, { text: `At least 100 ${subject}`, quote: `at least 100 ${subject}; today 80`,
    defined_as: { op: 'sum', of: ['today', 'added'], ...who } });
  Object.assign(model.aims[0]!.target!, { value: 100, current: 80, unit: subject, quantity: subject });
  const level = (id: string, value: number, unit: string) => ({ ...model.factors[0]!, id, label: id, value, unit, ...who });
  model.factors = [level('today', 80, subject), level('count', 0, 'specialists'),
    { ...level('each', 20, `${subject} per specialist`), low: 10, high: 30 },
    { ...level('added', 0, subject), defined_as: { op: 'product', of: ['count', 'each'], ...who } }];
  model.options[1]!.label = 'Add one specialist';
  model.options[1]!.settings = [{ ...model.options[1]!.settings[0]!, factor_id: 'count', value: 1, unit: 'specialists' }];
  model.links = [];
  return model;
}
const node = (graph: Rec, id = 'each'): Rec => graph.nodes.find((n: Rec) => n.id === id)!;
function run(graph: Rec, sentGraph = graph, engine?: Rec[]): Rec {
  const envelope = { option_comparison: engine ?? [{ option_id: 'hold', probability_of_goal: 0 }, { option_id: 'push', probability_of_goal: 0.5 }], inference_warnings: [] };
  const sentRun = { graph: sentGraph, goal_node_id: 'g', options: sentGraph.nodes.filter((n: Rec) => n.kind === 'option')
    .map((n: Rec) => ({ option_id: n.id, interventions: n.interventions })) };
  return withGoalChanceLicence(envelope, graph, 'g', undefined, undefined, graph, { sentRun }) as Rec;
}
const licence = (r: Rec): Rec => r.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

describe('a stated level range supplies its own provisional spread', () => {
  it.each(['cases', 'parcels'])('capacity sum/product: %s keeps the value author and discloses its spread once', async subject => {
    const model = capacity(subject), before = structuredClone(model);
    expect(LivingModel.safeParse(model).success).toBe(true);
    const mapped = mapLivingModel(model);
    expect(mapped.withheld).toEqual([]);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model })) as Rec;
    const each = node(graph), cap = each.observed_state.cap;
    const { uncertainty_defaults, ...observed } = each.observed_state;
    expect(observed).toEqual({ value: 20 / cap, raw_value: 20, cap, unit: `${subject} per specialist`,
      source: 'brief_extraction', extractionType: 'explicit', std: (30 - 10) / Math.sqrt(12) / cap, std_source: 'olumi' });
    expect(each.observed_state.std * cap).toBeCloseTo(5.773502691896258, 12);
    const loss = linkDefaultAssumptionsOf(each);
    expect(uncertainty_defaults).toEqual(loss);
    expect(loss).toEqual([{ code: 'CLAMP_STD_MINIMUM', layer: 'cee', field_path: 'nodes[each].observed_state.std', before: null,
      after: each.observed_state.std, severity: 'info', reason: `The calculation uses 20 ${subject} per specialist for each, with a spread matching your range, 10 ${subject} per specialist to 30 ${subject} per specialist; the spread is Olumi's assumption.` }]);
    const scenarioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const snapshot = await loadScenarioSnapshotForRunAnalysis(scenarioId, 'level-range', {
      loadGraphAndBriefText: async () => ({ graph, briefText: null }), readMostRecentPendingActions: async () => [],
    } as never);
    let sent: Rec | undefined;
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: {} as never,
      probe: async (p: { plotPayload: Rec }) => { sent = p.plotPayload; } } as never);
    await handler({ payload: { scenario_id: scenarioId, turn_id: 'level-range', kind: 'message', message: 'Run analysis.' },
      requestId: 'level-range', signal: new AbortController().signal, context: {}, orientationText: '' } as never);
    expect(sent).toBeDefined();
    expect(node(sent!.graph).observed_state.std).toBe(each.observed_state.std);
    expect(node(sent!.graph).observed_state.std_source).toBe('olumi');
    if (process.env.LEVELRANGE_OUT) writeFileSync(`${process.env.LEVELRANGE_OUT}/${subject}.cee-to-plot.json`, JSON.stringify(sent, null, 2));
    const engineFile = process.env.LEVELRANGE_OUT && `${process.env.LEVELRANGE_OUT}/${subject}.isl-response.json`;
    const engine = engineFile && existsSync(engineFile) ? JSON.parse(readFileSync(engineFile, 'utf8')).results : undefined;
    const result = run(graph, sent!.graph, engine), earned = licence(result);
    if (process.env.LEVELRANGE_OUT) writeFileSync(`${process.env.LEVELRANGE_OUT}/${subject}.cee-licensed.json`, JSON.stringify(result, null, 2));
    expect(earned.pct_by_option).toEqual({ push: 50 }); // fixture by default; optional local engine witness rounds to the same headline
    expect(earned.provisional).toBe(true);
    expect(earned.default_assumptions.nodes).toEqual([{ id: 'each', loss }]);
    expect(earned.default_assumptions.links).toEqual([]);
    expect(earned.notes.filter((s: string) => s === earned.default_assumptions.status)).toHaveLength(1);
    expect(JSON.stringify(earned).split(loss[0]!.reason)).toHaveLength(2);
    expect(readLinkDefaultAssumptions({ ...earned.default_assumptions, nodes: [{ id: 'another', loss }] })).toBeUndefined();
    expect(mapped.assumed.filter(a => a.id === 'each')).toEqual([]);
    expect(readLinkDefaultAssumptions(earned.default_assumptions)).toEqual(earned.default_assumptions);
    expect(goalChanceLicenceForAgent(result)?.default_assumptions).toEqual(earned.default_assumptions);
    expect(model).toEqual(before);
    expect(graph.living_model).toEqual(before);
  });

  it('a lever keeps base behaviour: no unused spread, false disclosure or provisional chance', () => {
    const model = structuredClone(KNOWN_ANSWER), base = mapLivingModel(model);
    Object.assign(model.factors[0]!, { low: 0.2, high: 0.8 });
    const mapped = mapLivingModel(model), level = node(mapped.graph, 'f');
    expect(mapped.graph).toEqual(base.graph);
    expect(mapped.frames).toEqual(base.frames);
    expect(level.observed_state).not.toHaveProperty('std');
    expect(linkDefaultAssumptionsOf(level)).toEqual([]);
    expect(mapped.assumed.filter(a => a.id === 'f')).toEqual([{ id: 'f', text:
      'The calculation uses 0.5 for f. The range, 0.2 to 0.8, is kept with the model but is not used as a spread.' }]);
    expect(licence(run(mapped.graph))).toEqual(licence(run(base.graph)));
    expect(licence(run(mapped.graph)).provisional).not.toBe(true);
    expect(licence(run(mapped.graph)).default_assumptions).toBeUndefined();
  });

  it.each([
    [20, 10, 30, true], [2, 0, 8, false], [0.5, 0.2, 0.8, true], [-3, -10, 5, true],
    [8, 0, 8, false], [-2, -8, 0, false], [-20, -30, -10, true],
  ])('observable %s in %s to %s: spread eligibility is %s, with its own value and frame', (value, low, high, eligible) => {
    const model = capacity();
    Object.assign(model.factors[2]!, { value, low, high });
    const before = structuredClone(model);
    const noRange = structuredClone(model);
    Object.assign(noRange.factors[2]!, { low: null, high: null });
    const mapped = mapLivingModel(model), base = mapLivingModel(noRange), level = node(mapped.graph);
    const { std, std_source, uncertainty_defaults, ...observed } = level.observed_state;
    const baseState = node(base.graph).observed_state;
    const { value: _value, cap: _cap, ...physical } = observed;
    const { value: _oldValue, cap: _oldCap, ...oldPhysical } = baseState;
    expect(physical).toEqual(oldPhysical);
    expect(observed.value * observed.cap).toBeCloseTo(baseState.value * baseState.cap, 12);
    // A wider own range may change the numerical frame, never the effect per natural unit.
    for (const e of mapped.graph.edges) {
      const from = mapped.frames.get(String(e.from)), to = mapped.frames.get(String(e.to));
      const oldFrom = base.frames.get(String(e.from)), oldTo = base.frames.get(String(e.to));
      if (!from || !to || !oldFrom || !oldTo) continue;
      const old = base.graph.edges.find(x => x.id === e.id)!;
      expect((e.strength as Rec).mean * to.cap / from.cap).toBeCloseTo((old.strength as Rec).mean * oldTo.cap / oldFrom.cap, 12);
      expect((e.strength as Rec).std * to.cap / from.cap).toBeCloseTo((old.strength as Rec).std * oldTo.cap / oldFrom.cap, 12);
    }
    if (eligible) {
      expect(std).toBe((high - low) / Math.sqrt(12) / observed.cap);
      expect(std_source).toBe('olumi');
      expect(uncertainty_defaults).toEqual(linkDefaultAssumptionsOf(level));
      expect(licence(run(mapped.graph)).provisional).toBe(true);
    } else {
      expect(std).toBeUndefined();
      expect(std_source).toBeUndefined();
      expect(uncertainty_defaults).toBeUndefined();
      expect(observed.raw_value).toBe(baseState.raw_value);
      expect(mapped.assumed.filter(a => a.id === 'each')).toEqual([{ id: 'each', text:
        `The calculation uses ${value} cases per specialist for each. The range, ${low} cases per specialist to ${high} cases per specialist, is kept with the model but is not used as a spread.` }]);
      expect(licence(run(mapped.graph))).toEqual(licence(run(base.graph)));
    }
    expect(model).toEqual(before);
  });

  it('source and frame class: no range credits another figure, party or an unrelated number', () => {
    for (const source of ['user', 'party', 'olumi', 'unverified'] as const) for (const estimate_by of [null, 'olumi'] as const) for (const value of [20, 200]) {
      const model = capacity();
      Object.assign(model.factors[2]!, { source, estimate_by, party: source === 'party' ? 'Operations' : null,
        value, low: value / 2, high: value * 1.5, quote: 'Revenue was 2m as of 2026-09-01; capacity is separate.' });
      const graph = mapLivingModel(model).graph, each = node(graph);
      const own = estimate_by === 'olumi' ? 'olumi' : source;
      expect(each.observed_state.std).toBe((value * 1.5 - value / 2) / Math.sqrt(12) / each.observed_state.cap);
      expect(each.observed_state.raw_value).toBe(value);
      expect(each.observed_state.source).toBe(own === 'olumi' ? 'cee_inference' : own === 'unverified' ? undefined : 'brief_extraction');
      const owner = own === 'user' ? 'your' : own === 'party' ? 'Operations’s' : own === 'olumi' ? "Olumi's estimated" : 'the given (its source is not confirmed)';
      expect(linkDefaultAssumptionsOf(each)[0]!.reason).toBe(`The calculation uses ${value} cases per specialist for each, with a spread matching ${owner} range, ${value / 2} cases per specialist to ${value * 1.5} cases per specialist; the spread is Olumi's assumption.`);
    }
  });

  it('checked node entries reject another node, changed spread/owner, missing sent node and off-goal data', () => {
    const graph = mapLivingModel(capacity()).graph, each = node(graph), state = each.observed_state;
    expect(linkDefaultAssumptionsOf(each, { ...each, id: 'today' })).toEqual([]);
    expect(linkDefaultAssumptionsOf(each, { ...each, observed_state: { ...state, value: state.value / 2 } })).toEqual([]);
    expect(linkDefaultAssumptionsOf(each, { ...each, observed_state: { ...state, source: 'cee_inference' } })).toEqual([]);
    expect(linkDefaultAssumptionsOf(each, { ...each, observed_state: { ...state, std: state.std * 2 } })).toEqual([]);
    expect(linkDefaultAssumptionsOf(each, { ...each, observed_state: { ...state, std_source: 'user' } })).toEqual([]);
    const sent = structuredClone(graph);
    sent.nodes = sent.nodes.filter(n => n.id !== 'each');
    expect(licence(run(graph, sent))?.default_assumptions).toBeUndefined();
    const off = structuredClone(graph);
    delete node(off).observed_state.uncertainty_defaults;
    off.nodes.push({ ...each, id: 'unrelated', observed_state: { ...state, uncertainty_defaults: each.observed_state.uncertainty_defaults.map((r: Rec) => ({ ...r, field_path: 'nodes[unrelated].observed_state.std' })) } });
    expect(licence(run(off)).default_assumptions).toBeUndefined();
    expect(licence(run(off)).provisional).not.toBe(true);
  });

  it('a supported bare range is Olumi-derived; no-range/point and every link form stay byte-identical to base', () => {
    const bare = capacity();
    bare.factors[2]!.value = null;
    expect(mapLivingModel(bare).withheld).not.toContainEqual({ id: 'each', reason: 'level_range_not_in_slice' });
    expect(node(mapLivingModel(bare).graph).observed_state).toMatchObject({ raw_value: 20, source: 'cee_inference', std_source: 'olumi' });
    for (const form of ['point', 'normal', 'exact', 'range'] as const) {
      const model = structuredClone(KNOWN_ANSWER);
      Object.assign(model.links[0]!.effect, { form, value: form === 'range' ? null : 50, low: form === 'range' ? 30 : null, high: form === 'range' ? 70 : null });
      const baseHashes = { point: '4dc6086fc4d18d979d52630fe21b016df9247af55aa89fc846fd1b78cf91d7df',
        normal: '3ed816f64be7d890505b824337ff9e4168b674e9a6bd4f9818e81522266e179f',
        exact: '712e1ea87991a1a73c7a9e6b4b453ec1b0a8567a9a693f31b0170aa8ebcfffa3',
        range: '2b84fbfd1d4a1b8bbc5c67657b8be6c47dfd0ae0abf429d1b1bc61e9a5ac717b' };
      expect(hash(mapLivingModel(model))).toBe(baseHashes[form]);
      const withRange = structuredClone(model);
      Object.assign(withRange.factors[0]!, { low: 0.2, high: 0.8 });
      expect(JSON.stringify(mapLivingModel(withRange).graph.edges)).toBe(JSON.stringify(mapLivingModel(model).graph.edges));
    }
  });
});
