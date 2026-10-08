/** Science 393023 (a),(c); row 6.1, identities from goals_s2_frame.py.
 * Local mocks only: no database, network or language model.
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { GraphV3Schema } from '@talchain/schemas';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { Graph } from '../../../schemas/graph.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { untestedHorizonLine } from '../../agent-lane/decision-input-ask.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';
import { withHeldUserLinks } from '../held-user-links.js';
import { SHARE_BY_DATE_UNIT, goalKindOf, shareByDateGoalOf } from '../goal-kind.js';
import {
  teamShareMoments, paceShareMoments, extraShareMoments, exactChance, normalChance, gate,
  EXACT_INTEGRATION_STEPS, SHARE_GATE_MAX_ERROR_POINTS, type ShareParts,
} from '../event-by-date-share.js';
import { sharePartsForOption, withShareByDateFrame } from '../share-by-date-run.js';
import * as shareRun from '../share-by-date-run.js';
import { GOAL_CHANCE_LICENSED, goalChanceLicenceOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { GOAL_CHANCE_RANGE, withShareByDateChanceGate } from '../goal-chance-range.js';
import { goalChanceRangeDisplayForAgent, goalChanceFactsForAgent } from '../goal-chance-range-agent.js';
import { goalChanceWithheldForAgent } from '../../agent-lane/goal-chance-withheld.js';
import { goalChanceSideOf } from '../goal-chance-sides.js';

type Rec = Record<string, any>;
const DEADLINE = '2027-04-07';
const UNIT = '% of launch';
const TEAM = teamShareMoments(6, 6, 10);
const EXTRA = extraShareMoments(0.1, 6, 3, 5);
const CARRY: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6, high: 10 } };
const HIRE: ShareParts = { ...CARRY, extra: { monthlyShare: 0.1, D: 6, leadLow: 3, leadHigh: 5 } };
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function graph(): Rec {
  return { nodes: [
    { id: 'launch_share', kind: 'goal', label: 'Launch share', goal_horizon: { deadline: DEADLINE },
      goal_threshold_frame: 'level', goal_threshold: 1, goal_threshold_raw: 100, goal_threshold_cap: 100,
      goal_threshold_unit: UNIT, goal_direction: '>=' },
    { id: 'team_share', kind: 'factor', category: 'observable', label: 'Team launch share', observed_state: {
      ...{ value: TEAM.mean, std: TEAM.sd }, unit: UNIT, cap: 100, source: 'user_override',
      stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months',
        deadline: DEADLINE, reference_date: '2026-10-07' } } },
    { id: 'two_devs', kind: 'factor', category: 'controllable', label: 'Two developers', observed_state: {
      value: 0, source: 'cee_inference', extra_share_by_date: { monthly_share: 10, lead_low: 3, lead_high: 5,
        unit: `${UNIT} per month`, deadline: DEADLINE, reference_date: '2026-10-07' } } },
    { id: 'launch_decision', kind: 'decision', label: 'How to launch on time' },
    { id: 'status_quo', kind: 'option', label: 'Carry on', is_baseline: true, interventions: { two_devs: { value: 0 } } },
    { id: 'hire', kind: 'option', label: 'Two developers', interventions: { two_devs: { value: 1 } } },
  ], edges: [
    { from: 'team_share', to: 'launch_share', exists_probability: 0.8, strength: { mean: 1, std: 0.1 }, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', definitional: true, natural_effect: {
        amount: 1, amount_unit: UNIT, per_source_change: 1, per_source_change_unit: UNIT,
        strength_mean: 1, strength_mean_frame: 'edge_strength' } } },
    { from: 'two_devs', to: 'launch_share', exists_probability: 1, strength: { mean: EXTRA.mean, std: EXTRA.sd }, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
        amount: 20, amount_unit: UNIT, per_source_change: 1, per_source_change_unit: 'switch',
        strength_mean: EXTRA.mean, strength_mean_frame: 'edge_strength' } } },
    // Structure only (analysis-ready): the decision's options and the option switch they set.
    ...['status_quo', 'hire'].flatMap((o) => [
      { from: 'launch_decision', to: o, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: o, to: 'two_devs', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ]),
  ] };
}
const goal = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === 'launch_share');
const team = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === 'team_share');
function paceGraph(): Rec {
  const g = graph(), os = team(g).observed_state;
  const moments = paceShareMoments(6, 0.1, 1 / 6);
  os.value = moments.mean; os.std = moments.sd;
  os.stated_time = { ...os.stated_time, quantity: 'share_per_month', low: 10, high: 100 / 6, unit: `${UNIT} per month` };
  return g;
}
const result = (): Rec => ({ option_comparison: [
  { option_id: 'status_quo', probability_of_goal: 0.019, probability_of_goal_precision: { n_met: 190, n_informative: 10000 } },
  { option_id: 'hire', probability_of_goal: 0.390 },
] });

/** Real Run handler; only the two external boundaries are in-process mocks. */
async function runGraph(g: Rec): Promise<{ payload: Rec; result: Rec }> {
  let payload: Rec | undefined;
  const response = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
  response.results = response.results.map((r: Rec, i: number) => ({ ...r,
    option_id: i === 0 ? 'status_quo' : 'hire', probability_of_goal: i === 0 ? 0.019 : 0.390 }));
  const run = vi.fn(async (body: Rec) => { payload = body; return structuredClone(response); });
  const options = g.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({
    id: n.id, option_id: n.id, label: n.label,
    interventions: Object.fromEntries(Object.entries(n.interventions as Rec).map(([k, v]) => [k, v.value])),
  }));
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn(async () => ({})) } as never,
    scenarioReader: vi.fn(async () => ({ graph: g, rawPersistedGraph: g, options, goal_node_id: 'launch_share', seed: 7, n_samples: 10000 })),
  });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-s2a', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-s2a', signal: new AbortController().signal, orientationText: '',
  } as never);
  expect(run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
  expect(fact).toBeDefined();
  return { payload: payload!, result: (fact as unknown as Rec).result };
}

describe('row 6.1: quantity-stated maths (fractions; literal ruled answers)', () => {
  it('time moments and pace moments preserve different beliefs', () => {
    expect(TEAM.mean).toBeCloseTo(0.766, 3);
    // Required formula: use the unrounded sd for the gate.
    expect(TEAM.sd).toBeCloseTo(0.113484, 6);
    expect(paceShareMoments(6, 0.1, 1 / 6).mean).toBeCloseTo(0.8, 12);
    expect(paceShareMoments(6, 0.1, 1 / 6).sd).toBeCloseTo(0.1154700538, 9);
    expect(teamShareMoments(6, 8, 8)).toEqual({ mean: 0.75, sd: 0 });
  });
  it('extra capacity moments and a lead range straddling D', () => {
    expect(EXTRA.mean).toBeCloseTo(0.2, 12); expect(EXTRA.sd).toBeCloseTo(0.0577, 4);
    expect(extraShareMoments(0.1, 6, 5, 7).mean).toBeCloseTo(0.025, 12);
    expect(extraShareMoments(0.1, 6, 5, 7).sd).toBeCloseTo(0.0322748612, 9);
    expect(extraShareMoments(0.1, 6, 7, 9)).toEqual({ mean: 0, sd: 0 });
  });
  it('exact time chance is 0.385; a uniform PACE would instead give 0.500', () => {
    expect(exactChance(CARRY, 1)).toBe(0);
    expect(exactChance(HIRE, 1)).toBeCloseTo(0.385, 3);
    expect(exactChance({ ...HIRE, team: { quantity: 'share_per_month', D: 6, low: 0.1, high: 1 / 6 } }, 1)).toBeCloseTo(0.5, 6);
    expect(100 / EXACT_INTEGRATION_STEPS).toBeLessThan(0.05);
  });
  it('normal tails use unrounded moments', () => {
    expect(Math.abs(normalChance(HIRE, 1) - 0.396)).toBeLessThan(0.002);
    expect(Math.abs(normalChance(CARRY, 1) - 0.020)).toBeLessThan(0.002);
    expect(SHARE_GATE_MAX_ERROR_POINTS).toBe(2);
  });
  // Science §d: total variance includes held spread; a near-extreme point is displayed in its exact class.
  it.each([
    ['two devs', HIRE, 1.05857509],
    ['carry on', CARRY, 1.97059483],
  ] as const)('%s: total-variance TIME error stays within two points', (_name, parts, errorPoints) => {
    expect(gate(parts, 1).form).toBe('point');
    expect(gate(parts, 1).error_points).toBeCloseTo(errorPoints, 1);
  });
  it('Science’s recorded delta harness 0.390 binds EXACT 0.385, with MC + approximation tolerance', () => {
    const approximationPoints = Math.abs(normalChance(HIRE, 1) - exactChance(HIRE, 1)) * 100;
    expect(Math.abs(0.390 - 0.385) * 100).toBeLessThanOrEqual(0.95 + approximationPoints);
    expect(approximationPoints).toBeCloseTo(1.1, 0);
  });
  it('validates domains; exact atoms include the >= boundary', () => {
    expect(() => teamShareMoments(6, 0, 10)).toThrow(RangeError);
    expect(() => extraShareMoments(-1, 6, 3, 5)).toThrow(RangeError);
    expect(exactChance({ team: { quantity: 'months_to_finish', D: 6, low: 6, high: 6 } }, 1)).toBe(1);
  });
});

describe('recognition and persisted carrier survival', () => {
  it('P1-a: fixed team time rejects a stored spread by team_share identity', () => {
    const g = graph(), os = team(g).observed_state;
    os.stated_time.low = 8; os.stated_time.high = 8; os.value = 0.75; os.std = 0.5;
    goal(g).goal_threshold_raw = 75; goal(g).goal_threshold = 0.75;
    expect(shareByDateGoalOf(g)).toBeNull();
  });
  it.each([undefined, 0, 0.0005])('P1-a control: fixed team time accepts stored sd %s', sd => {
    const g = graph(), os = team(g).observed_state;
    os.stated_time.low = 8; os.stated_time.high = 8; os.value = 0.75;
    if (sd === undefined) delete os.std; else os.std = sd;
    expect(shareByDateGoalOf(g)?.team_part_id).toBe('team_share');
  });
  it('P1-b: extra share attests the final held wire spread by two_devs -> launch_share', () => {
    const g = graph(), edge = g.edges.find((e: Rec) => e.from === 'two_devs' && e.to === 'launch_share');
    edge.provenance.magnitude = 'user_stated';
    edge.provenance.natural_effect.stated_range = { low: 1, high: 100 };
    const before = structuredClone(g), wire = withHeldUserLinks(g);
    expect(wire.edges.find((e: Rec) => e.from === 'team_share' && e.to === 'launch_share'))
      .toMatchObject({ exists_probability: 1, strength: { mean: 1, std: 0.01 } });
    expect(edge.strength.std).toBeCloseTo(0.0577, 4);
    expect(wire.edges.find((e: Rec) => e.from === 'two_devs' && e.to === 'launch_share').strength.std).toBeCloseTo(0.3009, 4);
    expect(g).toEqual(before);
    expect(shareByDateGoalOf(g)).toBeNull();
  });
  it('P1-b control: matching held extra spread and team +1 at 0.01 stay recognised', () => {
    const g = graph(), edge = g.edges.find((e: Rec) => e.from === 'two_devs' && e.to === 'launch_share');
    edge.provenance.magnitude = 'user_stated';
    edge.provenance.natural_effect.stated_range = { low: 10, high: 10 + EXTRA.sd * 3.29 * 20 / EXTRA.mean };
    const wire = withHeldUserLinks(g);
    expect(wire.edges.find((e: Rec) => e.from === 'two_devs' && e.to === 'launch_share').strength.std).toBeCloseTo(EXTRA.sd, 12);
    expect(wire.edges.find((e: Rec) => e.from === 'team_share' && e.to === 'launch_share'))
      .toMatchObject({ exists_probability: 1, strength: { mean: 1, std: 0.01 } });
    expect(shareByDateGoalOf(g)?.team_part_id).toBe('team_share');
  });
  it('Science harness identities, sum-only forecast, recognised with graph context', () => {
    const g = graph();
    expect(shareByDateGoalOf(g)).toEqual({ goal: goal(g), deadline: DEADLINE, threshold_raw: 100, cap: 100,
      team_part_id: 'team_share', parts: [{ from: 'team_share', to: 'launch_share' }, { from: 'two_devs', to: 'launch_share' }] });
    expect(goalKindOf(g)).toBe('share_by_date');
    expect(goalKindOf(goal(g), g)).toBe('share_by_date');
    expect(goalKindOf(goal(g))).toBe('level'); // a node cannot attest its incoming links
    expect(targetTestabilityOf(g).kind).not.toBe('not_testable');
    expect(untestedHorizonLine(g)).toBeNull();
  });
  it('recognises the harness’s scalar switch interventions as well as persisted value objects', () => {
    const g = graph();
    for (const n of g.nodes.filter((n: Rec) => n.kind === 'option')) n.interventions.two_devs = n.interventions.two_devs.value;
    expect(shareByDateGoalOf(g)?.team_part_id).toBe('team_share');
    expect(sharePartsForOption(g, 'hire')?.extra?.monthlyShare).toBe(0.1);
  });
  it('part carrier survives CEE V3, shared V3, ingress, legacy Graph and persistence', () => {
    const g = graph(), original = structuredClone(team(g).observed_state.stated_time);
    for (const parse of [GraphV3.parse.bind(GraphV3), GraphV3Schema.parse.bind(GraphV3Schema),
      GraphStateIngressSchema.parse.bind(GraphStateIngressSchema), Graph.parse.bind(Graph)]) {
      const after = parse(g) as Rec;
      expect(team(after).observed_state.stated_time).toEqual(original);
    }
    const after = projectGraphForPersistence(GraphV3.parse(g));
    expect(team(after).observed_state.stated_time).toEqual(original);
    expect(shareByDateGoalOf(after)?.team_part_id).toBe('team_share');
  });
  it('the real snapshot loader keeps the team carrier through both GraphV3 parses', async () => {
    const g = graph(), original = structuredClone(team(g).observed_state.stated_time);
    const store = { readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph: structuredClone(g), briefText: null }),
      loadGraph: async () => structuredClone(g) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-s2a-load', store as never);
    expect(team(snapshot.graph).observed_state.stated_time).toEqual(original);
    expect(shareByDateGoalOf(snapshot.rawPersistedGraph)?.team_part_id).toBe('team_share');
  });
  const refusals: [string, (g: Rec) => void][] = [
    ['no deadline', g => { delete goal(g).goal_horizon; }],
    ['chance unit', g => { goal(g).goal_threshold_unit = '% likelihood of launch'; }],
    ['observed level today', g => { goal(g).observed_state = { value: 0.766 }; }],
    ['raw level today', g => { goal(g).observed_state = { raw_value: 76.6 }; }],
    ['goal spread', g => { goal(g).observed_state = { std: 0.114 }; }],
    ['non-held inbound link', g => { delete g.edges[0].provenance.definitional; }],
    ['non +1 part', g => { g.edges[0].strength.mean = 0.9; }],
    ['two team parts', g => { const second = structuredClone(team(g)); second.id = 'team_other'; g.nodes.push(second);
      g.edges.push({ ...structuredClone(g.edges[0]), from: second.id }); }],
    ['cap is not 100', g => { goal(g).goal_threshold_cap = 125; }],
    ['invalid calendar deadline', g => { goal(g).goal_horizon.deadline = '2027-02-30'; }],
    ['two goals', g => { g.nodes.push({ ...goal(g), id: 'other_goal' }); }],
    ['zero threshold', g => { goal(g).goal_threshold_raw = 0; }],
    ['threshold over 100', g => { goal(g).goal_threshold_raw = 101; }],
    ['ceiling comparator', g => { goal(g).goal_direction = '<='; }],
    ['change frame', g => { goal(g).goal_threshold_frame = 'change_rel'; }],
    ['intercept', g => { goal(g).intercept = 0.1; }],
    ['part unit differs', g => { team(g).observed_state.unit = '% of customers'; }],
    ['carrier computed against another deadline', g => { team(g).observed_state.stated_time.deadline = '2027-05-07'; }],
    ['stale stored moments', g => { team(g).observed_state.value = 0.8; }],
    ['extra effect in another unit', g => { g.edges[1].provenance.natural_effect.amount_unit = 'developers'; }],
    ['factor inbound to switch', g => { g.edges.push({ ...g.edges[3], from: 'team_share' }); }],
    ['decision inbound to switch', g => { g.edges.push({ ...g.edges[3], from: 'launch_decision' }); }],
    ['non-structural option inbound to switch', g => { g.edges[3].strength.mean = 0.9; }],
    ['bidirected option inbound to switch', g => { g.edges[3].edge_type = 'bidirected'; }],
    ['option inbound to team still rejects', g => { g.edges.push({ ...g.edges[3], to: 'team_share' }); }],
  ];
  it.each(refusals)('fail closed: %s', (_name, change) => {
    const g = graph(); change(g); expect(shareByDateGoalOf(g)).toBeNull();
  });
  it('pure sum: carry-on mean is Σ parts = 0.766; no goal intercept or level', () => {
    const g = graph(), parts = sharePartsForOption(g, 'status_quo')!;
    expect(parts.extra).toBeUndefined(); expect(team(g).observed_state.value).toBeCloseTo(0.766, 3);
    expect(goal(g).observed_state).toBeUndefined(); expect(goal(g).intercept).toBeUndefined();
    expect(g.edges.filter((e: Rec) => e.to === 'launch_share').reduce((sum: number, e: Rec) =>
      sum + g.nodes.find((n: Rec) => n.id === e.from).observed_state.value * e.strength.mean, 0))
      .toBeCloseTo(0.766, 3);
  });
  it('new regex: whitespace 5k then 20k, less than 8x growth', () => {
    for (const n of [5000, 20000]) for (let i = 0; i < 10000; i++) SHARE_BY_DATE_UNIT.test(' '.repeat(n));
    const elapsed = (n: number): number => { const input = ' '.repeat(n), start = performance.now();
      for (let i = 0; i < 100000; i++) SHARE_BY_DATE_UNIT.test(input); return performance.now() - start; };
    const small = elapsed(5000), large = elapsed(20000);
    process.stdout.write(`SHARE_BY_DATE_UNIT whitespace ms ${JSON.stringify({ small, large, growth: large / small })}\n`);
    expect(large / small).toBeLessThan(8);
  });
});

describe('Run frame and licence by identity', () => {
  it('P1-d: pace carry-on range keeps its scope and hire licensed at 50%', () => {
    const g = paceGraph(), raw = result(); raw.option_comparison[1].probability_of_goal = 0.5;
    const out = withShareByDateChanceGate(raw, g, 'launch_share');
    const stored = { enrichment: withGoalChanceLicence(out, g, 'launch_share') };
    const facts = goalChanceFactsForAgent(stored, g, true), withheld = goalChanceWithheldForAgent(stored, g)!;
    expect(facts.goal_chance_display).toEqual({ hire: 'about 50%' });
    expect(facts.goal_chance_range_display?.status_quo).toBeDefined();
    expect(withheld.option_ids).toEqual(['status_quo']);
    expect(withheld.say).toContain(out.inference_warnings.find((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION).message);
    expect(withheld.note).toContain('Other options');
    expect(withheld.note).toContain('licensed points and ranges');
    expect(withheld.note).not.toContain('EVERY option');
  });
  it('P2-e: equal displayed stated-time endpoints withhold status_quo without a range', () => {
    const g = paceGraph(), original = shareRun.shareGateForOption;
    const spy = vi.spyOn(shareRun, 'shareGateForOption').mockImplementation((graph, id) => id === 'status_quo'
      ? { form: 'range', low: 0.249, high: 0.251, error_points: 3 } : original(graph, id));
    try {
      const out = withShareByDateChanceGate(result(), g, 'launch_share');
      const stored = { enrichment: withGoalChanceLicence(out, g, 'launch_share') };
      expect(out.option_comparison.find((r: Rec) => r.option_id === 'status_quo').probability_of_goal).toBeUndefined();
      expect(out.inference_warnings.some((w: Rec) => w.code === GOAL_CHANCE_RANGE)).toBe(false);
      expect(out.inference_warnings.find((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION).message).not.toContain('shown as a range');
      expect(goalChanceRangeDisplayForAgent(stored, g)).toBeUndefined();
      expect(goalChanceSideOf(stored, 'status_quo')).toEqual({ kind: 'withheld' });
      expect(goalChanceWithheldForAgent(stored, g)?.say).not.toContain('shown as a range');
    } finally { spy.mockRestore(); }
  });
  it('actual PLoT call carries delta 1.0 and the persisted forecast remains unchanged', async () => {
    const g = graph(), before = structuredClone(g), ran = await runGraph(g);
    expect(goal(ran.payload.graph)).toMatchObject({ goal_threshold_frame: 'delta', goal_threshold: 1.0 });
    expect(g).toEqual(before);
    const warnings = ran.result.enrichment.inference_warnings as Rec[];
    expect(warnings.some(w => w.code === GOAL_FIGURES_SHARE_APPROXIMATION)).toBe(false);
    expect(warnings.find(w => w.code === GOAL_CHANCE_LICENSED)?.pct_by_option).toEqual({ status_quo: 0, hire: 39 });
    expect(warnings.some(w => w.code === GOAL_CHANCE_RANGE)).toBe(false);
  });
  it('TIME licence: raw Run points survive while carry-on uses its exact extreme class', () => {
    const g = graph(), before = result();
    const out = withShareByDateChanceGate(before, g, 'launch_share');
    expect(out).toBe(before);
    expect(out.option_comparison.map((r: Rec) => r.probability_of_goal)).toEqual([0.019, 0.390]);
    const saved = withGoalChanceLicence(out, g, 'launch_share');
    const licence = goalChanceLicenceOf(out, g, 'launch_share')!;
    expect(licence.pct_by_option).toEqual({ status_quo: 0, hire: 39 });
    expect(licence.target).toEqual({ comparator: 'at_least', value: 100, unit: UNIT, by_date: DEADLINE });
    expect(licence.withheld_option_ids).toBeUndefined();
    expect(goalChanceRangeDisplayForAgent({ enrichment: saved }, g)).toBeUndefined();
    expect(goalChanceFactsForAgent({ enrichment: JSON.parse(JSON.stringify(saved)) }, g, true).goal_chance_display)
      .toEqual({ status_quo: 'less than 1%', hire: 'about 39%' });
  });
  it.each(['level', 'change_abs', 'chance_of_event'])('actual full request twin with branch disabled: %s', async kind => {
    const g = graph(); goal(g).goal_threshold_unit = kind === 'chance_of_event' ? '% likelihood of launch' : 'GBP';
    if (kind === 'change_abs') goal(g).goal_threshold_frame = kind;
    const before = await runGraph(g);
    const bypass = vi.spyOn(shareRun, 'withShareByDateFrame').mockImplementation(wire => wire);
    try { expect(JSON.stringify((await runGraph(g)).payload)).toBe(JSON.stringify(before.payload)); }
    finally { bypass.mockRestore(); }
  });
  it('wire-only delta 1.0, held +1, persisted deep-equal', () => {
    const g = graph(), before = structuredClone(g);
    const wire = withShareByDateFrame(withHeldUserLinks(g), g) as Rec;
    expect(goal(wire).goal_threshold_frame).toBe('delta'); expect(goal(wire).goal_threshold).toBe(1);
    expect(wire.edges[0]).toMatchObject({ exists_probability: 1, strength: { mean: 1, std: 0.01 } });
    expect(g).toEqual(before);
  });
  it.each(['level', 'change_abs', 'chance_of_event'])('twin request byte-identical: %s', kind => {
    const g = graph(); goal(g).goal_threshold_unit = kind === 'chance_of_event' ? '% likelihood of launch' : 'GBP';
    if (kind === 'change_abs') goal(g).goal_threshold_frame = kind;
    const base = withHeldUserLinks(g);
    const request = { graph: base, options: [{ id: 'status_quo' }, { id: 'hire' }], goal_node_id: 'launch_share', request_id: 'fixed' };
    expect(JSON.stringify({ ...request, graph: withShareByDateFrame(base, g) })).toBe(JSON.stringify(request));
    expect(withShareByDateFrame(base, g)).toBe(base);
  });
  it('PACE range withholds carry-on only; point gate keeps ISL’s 0.500 and original rounding', () => {
    const g = paceGraph(), before = result();
    before.option_comparison[0].probability_of_goal = 0.0416;
    before.option_comparison[1].probability_of_goal = 0.500;
    const out = withShareByDateChanceGate(before, g, 'launch_share');
    expect(out.option_comparison[0].probability_of_goal).toBeUndefined();
    expect(out.option_comparison[0].probability_of_goal_precision).toBeUndefined();
    expect(out.option_comparison[1].probability_of_goal).toBe(0.500);
    expect(before.option_comparison[0].probability_of_goal).toBe(0.0416);
    const range = out.inference_warnings.find((w: Rec) => w.code === GOAL_CHANCE_RANGE);
    expect(range.range_by_option.status_quo).toMatchObject({ basis: 'stated_time', low: 0, high: 1, low_pct: 0, high_pct: 100 });
    expect(range.target.by_date).toBe(DEADLINE);
    expect(out.inference_warnings.find((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION).option_ids).toEqual(['status_quo']);
    const licence = goalChanceLicenceOf(out, g, 'launch_share')!;
    expect(licence.target.by_date).toBe(DEADLINE); expect(licence.pct_by_option).toEqual({ hire: 50 });
    expect(licence.withheld_option_ids).toEqual(['status_quo']);
    const saved = withGoalChanceLicence(out, g, 'launch_share');
    expect(goalChanceRangeDisplayForAgent({ enrichment: saved }, g)?.status_quo.depends_on.kind).toBe('stated_time');
    expect(goalChanceFactsForAgent({ enrichment: saved }, g, true).goal_chance_display).toEqual({ hire: 'about 50%' });
    expect(goalChanceLicenceOf(before, g, 'launch_share')?.pct_by_option).toEqual({ hire: 50 }); // cannot bypass gate
  });
  it('by_date absent on a conventional level target; existing points unchanged', () => {
    const g = graph(); goal(g).goal_threshold_unit = 'GBP';
    const licence = goalChanceLicenceOf(result(), g, 'launch_share')!;
    expect(licence.target).toEqual({ comparator: 'at_least', value: 100, unit: 'GBP' });
    expect(licence.pct_by_option).toEqual({ status_quo: 2, hire: 39 });
    expect(withShareByDateChanceGate(result(), g, 'launch_share')).toEqual(result());
  });
});
