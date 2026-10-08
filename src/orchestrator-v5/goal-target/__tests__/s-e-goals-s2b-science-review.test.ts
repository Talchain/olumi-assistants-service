/** REVIEW-2762 Science §d and lens 1: deterministic rows; no LLM or network. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as maths from '../event-by-date-share.js';
import { teamShareMoments, extraShareMoments, exactChance, normalChance, gate, type ShareParts } from '../event-by-date-share.js';
import { GOAL_CHANCE_LICENSED, goalChanceLicenceOf, withGoalChanceLicence } from '../goal-chance-licence.js';
import { GOAL_CHANCE_RANGE, withShareByDateChanceGate } from '../goal-chance-range.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import { shareGoalChanceWords } from '../share-goal-chance-words.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GOAL_FIGURES_SHARE_APPROXIMATION } from '../../../orchestrator/context/option-result-source.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';

type Rec = Record<string, any>;
const UNIT = '% of the feature launch';
const DEADLINE = '2027-04-07';
const CARRY: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6, high: 10 } };
const HIRE: ShareParts = { ...CARRY, extra: { monthlyShare: 0.1, D: 6, leadLow: 3, leadHigh: 5 } };
function graph(low = 6, high = 10): Rec {
  const team = teamShareMoments(6, low, high), extra = extraShareMoments(0.1, 6, 3, 5);
  return { nodes: [
    { id: 'goal', kind: 'goal', label: 'Feature launch', threshold_source: 'definitional', goal_horizon: { deadline: DEADLINE },
      goal_threshold_frame: 'level', goal_threshold: 1, goal_threshold_raw: 100, goal_threshold_cap: 100,
      goal_threshold_unit: UNIT, goal_direction: '>=' },
    { id: 'team', kind: 'factor', category: 'observable', label: 'Current team share', observed_state: {
      value: team.mean, std: team.sd, unit: UNIT, cap: 100, source: 'cee_inference',
      stated_time: { quantity: 'months_to_finish', low, high, unit: 'months', deadline: DEADLINE, reference_date: '2026-10-07' } } },
    { id: 'capacity', kind: 'factor', category: 'controllable', label: 'Added team', observed_state: { value: 0,
      source: 'cee_inference', extra_share_by_date: { monthly_share: 10, lead_low: 3, lead_high: 5,
        unit: `${UNIT} per month`, deadline: DEADLINE, reference_date: '2026-10-07' } } },
    { id: 'decision', kind: 'decision', label: 'Launch work' },
    { id: 'carry', kind: 'option', label: 'Carry on', is_baseline: true, interventions: { capacity: { value: 0 } } },
    { id: 'hire', kind: 'option', label: 'Hire two developers', interventions: { capacity: { value: 1 } } },
  ], edges: [
    { from: 'team', to: 'goal', exists_probability: 1, strength: { mean: 1, std: 0.01 }, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', definitional: true,
        share_by_date: { role: 'team', team_id: 'team', goal_id: 'goal', deliverable: 'the feature launch', unresolved_option_ids: [] },
        natural_effect: { amount: 1, amount_unit: UNIT, per_source_change: 1, per_source_change_unit: UNIT,
          strength_mean: 1, strength_mean_frame: 'edge_strength' } } },
    { from: 'capacity', to: 'goal', exists_probability: 1, strength: { mean: extra.mean, std: extra.sd }, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 20, amount_unit: UNIT,
        per_source_change: 1, per_source_change_unit: 'switch', strength_mean: extra.mean, strength_mean_frame: 'edge_strength' } } },
    ...['carry', 'hire'].flatMap(id => [
      { from: 'decision', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: id, to: 'capacity', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ]),
  ] };
}
const result = (): Rec => ({ option_comparison: [
  { option_id: 'carry', option_label: 'Carry on', probability_of_goal: 0.0199 },
  { option_id: 'hire', option_label: 'Hire two developers', probability_of_goal: 0.390 },
] });
const warning = (out: Rec): Rec | undefined => out.inference_warnings?.find((w: Rec) => w.code === GOAL_FIGURES_SHARE_APPROXIMATION);
const saved = (g: Rec, before = result()): Rec => ({ enrichment: withGoalChanceLicence(withShareByDateChanceGate(before, g, 'goal'), g, 'goal') });
/** Both production Agent doors, with a deterministic dispatch in place of external I/O. */
async function agentDoor(g: Rec, block: Rec, door: 'Run' | 'saved-read'): Promise<Rec> {
  const state = { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'near_tie' } };
  const read = { graph: g, analysis_result: block, analysis_state: state, analysis_goal_certainty: [] };
  const dispatch: InternalDispatch = async path => path.endsWith('/graph') ? { status: 200, json: read }
    : path === '/orchestrate/v2/turn' ? { status: 200, json: { blocks: [{ type: 'analysis_result', ...block }], analysis_state: state } }
      : { status: 500, json: {} };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', authenticated_user_id: null, request_id: 'r4-p40' };
  return door === 'Run' ? (await caps.runAnalysis(ctx, { reason: 'Run analysis.' }) as Rec).result
    : (await caps.getCanonicalState(ctx) as Rec).analysis;
}
const agentRows = (view: Rec): Rec[] => view.saved_run_options ?? view.enrichment.option_comparison;
/** Retained r3 licence is authoritative; both doors must replace its raw normal point. */
const retainedR3Point = (): Rec => ({ enrichment: { ...result(), inference_warnings: [{
  code: GOAL_CHANCE_LICENSED, severity: 'info', message: 'Licensed.', form: 'each', option_ids: ['carry', 'hire'],
  pct_by_option: { carry: 0, hire: 39 },
  target: { comparator: 'at_least', value: 100, unit: UNIT, by_date: DEADLINE },
}] } });

afterEach(() => vi.useRealTimers());
describe('SCIENCE review rows and controls', () => {
  it('S1-RANGE-REQUIRED: most likely alone withholds and names the missing range', () => {
    const g = graph();
    delete g.nodes[1].observed_state;
    g.edges[0].provenance.share_by_date.stated_time = { quantity: 'months_to_finish', most_likely: 6, unit: 'months', deadline: DEADLINE, reference_date: '2026-10-07' };
    const out = withShareByDateChanceGate(result(), g, 'goal');
    expect(out.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
    expect(warning(out)?.message).toContain('soonest and latest');
    expect(warning(out)?.message).toContain('range');
  });
  it('S1-NO-CHANCE-RUN: a most likely time never reaches PLoT', async () => {
    const g = graph(); delete g.nodes[1].observed_state;
    g.edges[0].provenance.share_by_date.stated_time = { quantity: 'months_to_finish', most_likely: 6, unit: 'months', deadline: DEADLINE, reference_date: '2026-10-07' };
    const run = vi.fn();
    const handler = createRunAnalysisHandler({ plotClient: { run } as never,
      scenarioReader: vi.fn(async () => ({ graph: g, rawPersistedGraph: g, options: [], goal_node_id: 'goal' })) as never });
    await expect(handler({ context: { session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      payload: makeMessagePayload({ scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-single', signal: new AbortController().signal } as never))
      .rejects.toMatchObject({ cause_kind: 'analysis_not_ready', details: { reason_code: 'team_time_range_required' } });
    expect(run).not.toHaveBeenCalled();
  });
  it('S1-RANGE-REQUIRED control: a range keeps the added-capacity Run chance', () => {
    expect(withShareByDateChanceGate(result(), graph(), 'goal').option_comparison[1].probability_of_goal).toBe(0.390);
  });
  it('S1-RANGE-ARRIVES control: the held range supersedes a retained most likely note', () => {
    const g = graph();
    g.edges[0].provenance.share_by_date.stated_time = { quantity: 'months_to_finish', most_likely: 8,
      unit: 'months', deadline: DEADLINE, reference_date: '2026-10-07' };
    expect(withShareByDateChanceGate(result(), g, 'goal').option_comparison[1].probability_of_goal).toBe(0.390);
  });
  it('S1-ISL-TOTAL-VARIANCE: normal gate includes held coefficient spread and matches ISL', () => {
    const t = teamShareMoments(6, 6, 10), x = extraShareMoments(0.1, 6, 3, 5);
    const totalSd = Math.sqrt(t.sd ** 2 + x.sd ** 2 + 0.01 ** 2 * (t.mean ** 2 + t.sd ** 2));
    const z = (1 - t.mean - x.mean) / totalSd;
    // Independent Simpson integration of the standard normal density; not the production erf approximation.
    const steps = 1000, h = z / steps;
    let area = 1 + Math.exp(-z * z / 2);
    for (let i = 1; i < steps; i++) area += (i % 2 === 0 ? 2 : 4) * Math.exp(-((i * h) ** 2) / 2);
    const expected = 0.5 - h * area / (3 * Math.sqrt(2 * Math.PI));
    expect(normalChance(HIRE, 1)).toBeCloseTo(expected, 6);
    expect(normalChance(HIRE, 1)).toBeCloseTo(0.3954, 3);
    expect(Math.abs(normalChance(HIRE, 1) - 0.390)).toBeLessThan(0.0095);
    expect(exactChance(HIRE, 1)).toBeCloseTo(0.3849, 4);
  });
  it('S1-ISL-TOTAL-VARIANCE control: exact user-time harness is unchanged', () => {
    expect(exactChance(CARRY, 1)).toBe(0);
    expect(exactChance(HIRE, 1)).toBeCloseTo(0.38485, 4);
  });
  it('S2-OLumi-ESTIMATES: each added-capacity line names its Olumi estimates', () => {
    const lines = goalChanceScreenLinesForAgent(saved(graph()), graph(), true);
    expect(lines.find(l => l.option_id === 'hire')?.chance).toContain("using Olumi's estimates of hiring time (3–5 months) and the new team's pace (10% of the feature launch a month)");
  });
  it('S2-OLumi-ESTIMATES control: carry-on line names no Olumi capacity estimates', () => {
    const carry = goalChanceScreenLinesForAgent(saved(graph()), graph(), true).find(l => l.option_id === 'carry')?.chance;
    expect(carry).not.toContain('hiring time');
    expect(carry).not.toContain("new team's pace");
    expect(carry).toContain(", using Olumi's estimates for 1 link (see Check estimates).");
  });
  it('S2-FAILING-INPUT: invalid Olumi lead names hiring time, not user team time', () => {
    const g = graph(); g.nodes[2].observed_state.extra_share_by_date.lead_high = 1;
    const out = withShareByDateChanceGate(result(), g, 'goal');
    expect(warning(out)?.message).toContain("Olumi's hiring-time");
    expect(warning(out)?.message).not.toContain('today’s team is too uncertain');
  });
  it('S2-FAILING-INPUT-SCOPE control: bad hiring time does not withhold carry-on', () => {
    // A supported same-class carry-on control separates input scope from P40's independent class gate.
    const g = graph(6.4, 10); g.nodes[2].observed_state.extra_share_by_date.lead_high = 1;
    const before = result(); before.option_comparison[0].probability_of_goal = 0.0039;
    const out = withShareByDateChanceGate(before, g, 'goal');
    expect(out.option_comparison.find((r: Rec) => r.option_id === 'carry').probability_of_goal).toBe(0.0039);
    expect(out.option_comparison.find((r: Rec) => r.option_id === 'hire').probability_of_goal).toBeUndefined();
    expect(warning(out)?.option_ids).toEqual(['hire']);
    expect(goalChanceLicenceOf(out, g, 'goal')?.pct_by_option).toEqual({ carry: 0 });
  });
  it('S2-FAILING-INPUT control: valid hiring range stays supported', () => {
    expect(goalChanceLicenceOf(result(), graph(), 'goal')?.pct_by_option.hire).toBe(39);
  });
  // Authority: science-393023-goals-rulings-20261007.md §(d)4:78–84, including its exact-extreme exception.
  it('S4-P40-CLASS: carry-on U(6,10), D=6 shows the exact extreme, never about 2% or a range', () => {
    const g = graph(), before = result(), out = withShareByDateChanceGate(before, g, 'goal');
    const licence = goalChanceLicenceOf(out, g, 'goal')!;
    const carryLine = goalChanceScreenLinesForAgent({ enrichment: withGoalChanceLicence(out, g, 'goal') }, g, true)
      .find(l => l.option_id === 'carry');
    expect(carryLine?.chance).toBe("‘Carry on’: less than 1% chance of launching by 7 April 2027, in this model, using Olumi's estimates for 1 link (see Check estimates).");
    expect(carryLine?.figure).toBe('less than 1%');
    expect(licence.pct_by_option.carry).toBe(0);
    expect(licence.withheld_option_ids).toBeUndefined();
    expect(out.option_comparison[0].probability_of_goal).toBe(0.0199); // producer evidence is retained
    expect(warning(out)).toBeUndefined();
    expect(out.inference_warnings?.some((w: Rec) => w.code === GOAL_CHANCE_RANGE) ?? false).toBe(false);
    expect(exactChance(CARRY, 1)).toBe(0);
    expect(normalChance(CARRY, 1)).toBeCloseTo(0.0199356, 6);
    expect(gate(CARRY, 1)).toMatchObject({ form: 'point', exact_extreme: 0 });
  });
  it.each([6.2, 6.3])('S4-P40-CLASS rounded boundary: low=%s shows less than 1%, never about 1% or a range', low => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low, high: 10 } };
    const p = normalChance(parts, 1);
    expect(p).toBeGreaterThanOrEqual(0.005);
    expect(p).toBeLessThan(0.01);
    expect(Math.round(p * 100)).toBe(1); // the card says "about 1%", not "less than 1%"
    expect(exactChance(parts, 1)).toBe(0);
    expect(gate(parts, 1)).toMatchObject({ form: 'point', exact_extreme: 0 });
    const before = result(); before.option_comparison[0].probability_of_goal = p;
    const g = graph(low, 10), block = saved(g, before);
    expect(block.enrichment.inference_warnings.find((w: Rec) => w.code === GOAL_CHANCE_LICENSED).pct_by_option.carry).toBe(0);
    expect(goalChanceScreenLinesForAgent(block, g, true).find(l => l.option_id === 'carry')?.chance)
      .toBe("‘Carry on’: less than 1% chance of launching by 7 April 2027, in this model, using Olumi's estimates for 1 link (see Check estimates).");
    expect(warning(block.enrichment)).toBeUndefined();
  });
  it.each(['Run', 'saved-read'] as const)('S4-P40-CLASS %s door: fresh carry-on carries the licence extreme and no raw point', async door => {
    const g = graph(), view = await agentDoor(g, saved(g), door);
    expect(agentRows(view).find(r => r.option_id === 'carry')?.probability_of_goal).toBe(0);
    expect(JSON.stringify(view)).not.toContain('0.0199');
    expect(view.goal_chance_display.carry).toBe('less than 1%');
    expect(agentRows(view).find(r => r.option_id === 'hire')?.probability_of_goal).toBe(0.390);
  });
  it.each(['Run', 'saved-read'] as const)('S4-P40-CLASS %s door: retained r3 raw 0.0199 is replaced by the licence extreme', async door => {
    const block = retainedR3Point(), view = await agentDoor(graph(), block, door);
    expect(block.enrichment.option_comparison[0].probability_of_goal).toBe(0.0199); // control on the actual ingress
    expect(agentRows(view).find(r => r.option_id === 'carry')?.probability_of_goal).toBe(0);
    expect(view.goal_chance_display.carry).toBe('less than 1%');
    expect(JSON.stringify(view)).not.toContain('0.0199');
    expect(agentRows(view).find(r => r.option_id === 'hire')?.probability_of_goal).toBe(0.390);
  });
  it('S4-P40-CLASS control: interior producer chance remains 39%', () => {
    expect(goalChanceLicenceOf(result(), graph(), 'goal')?.pct_by_option.hire).toBe(39);
    expect(gate(HIRE, 1).form).toBe('point');
    expect(goalChanceScreenLinesForAgent(saved(graph()), graph(), true).find(l => l.option_id === 'hire')?.chance)
      .toBe("‘Hire two developers’: about 39% chance of launching by 7 April 2027, in this model, using Olumi's estimates of hiring time (3–5 months) and the new team's pace (10% of the feature launch a month), using Olumi's estimates for 1 link (see Check estimates).");
  });
  it.each([6.2, 6.3, 6.4].flatMap(low => (['Run', 'saved-read'] as const).map(door => ({ low, door }))))('S4-P40-CLASS $door door: low=$low projects the licensed extreme, including the 20/4000 producer', async ({ low, door }) => {
      const g = graph(low, 10), parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low, high: 10 } };
      const p = low === 6.4 ? 20 / 4000 : normalChance(parts, 1), before = result();
      before.option_comparison[0].probability_of_goal = p;
      if (low === 6.4) {
        expect(normalChance(parts, 1)).toBeLessThan(0.005);
        expect(Math.round(p * 100)).toBe(1); // producer would show about 1%, analytic normal would not
      }
      const licence = goalChanceLicenceOf(before, g, 'goal')!;
      expect(licence.pct_by_option.carry).toBe(0);
      const block = saved(g, before), view = await agentDoor(g, block, door);
      expect(agentRows(view).find(r => r.option_id === 'carry')?.probability_of_goal).toBe(0);
      expect(view.goal_chance_display.carry).toBe('less than 1%');
      expect(JSON.stringify(view)).not.toContain(String(p));
      expect(goalChanceScreenLinesForAgent(block, g, true).find(l => l.option_id === 'carry')?.chance)
        .toBe("‘Carry on’: less than 1% chance of launching by 7 April 2027, in this model, using Olumi's estimates for 1 link (see Check estimates).");
    });
  it('S4-P40-CLASS same-class control: producer 0.0039 licenses a point without an override', () => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6.4, high: 10 } };
    expect(gate(parts, 1, 0.0039)).toMatchObject({ form: 'point' });
    expect(gate(parts, 1, 0.0039)).not.toHaveProperty('exact_extreme');
  });
  it('S4-P40-CLASS displayed-point control: analytic less than 1% cannot license producer about 1%', () => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6.4, high: 10 } };
    expect(exactChance(parts, 1)).toBe(0);
    expect(normalChance(parts, 1)).toBeCloseTo(0.0039476, 6);
    expect(gate(parts, 1, 20 / 4000)).toMatchObject({ form: 'point', exact_extreme: 0 });
  });
  it('S4-P40-CLASS precision control compares the actual nearest-five point', () => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 6.4, high: 10 } };
    expect(gate(parts, 1, 0.0039, 'nearest_5')).toMatchObject({ form: 'point', exact_extreme: 0 });
  });
  it.each(['Run', 'saved-read'] as const)('S4-P40-CLASS $0 door: upper exact extreme carries more than 99%', async door => {
    const g = graph(3, 5), before = result(), parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 3, high: 5 } };
    before.option_comparison[0].probability_of_goal = normalChance(parts, 1);
    expect(gate(parts, 1)).toMatchObject({ form: 'point', exact_extreme: 1 });
    expect(goalChanceLicenceOf(before, g, 'goal')?.pct_by_option.carry).toBe(100);
    const block = saved(g, before), view = await agentDoor(g, block, door);
    expect(agentRows(view).find(r => r.option_id === 'carry')?.probability_of_goal).toBe(1);
    expect(view.goal_chance_display.carry).toBe('more than 99%');
    expect(goalChanceScreenLinesForAgent(block, g, true).find(l => l.option_id === 'carry')?.chance)
      .toBe("‘Carry on’: more than 99% chance of launching by 7 April 2027, in this model, using Olumi's estimates for 1 link (see Check estimates).");
  });
  it('S4-P40-CLASS exact-extreme drivers are moot on the licence', () => {
    const before = result(); before.option_comparison[0].probability_of_goal_drivers = { invalid_rows_dropped: 1 };
    const licence = goalChanceLicenceOf(before, graph(), 'goal')!;
    expect(licence.no_driver_by_option?.carry).toBe('none');
    expect(licence.driver_by_option ?? {}).not.toHaveProperty('carry');
  });
  it('S4-P40-CLASS interior exact against extreme normal stays a range even within two points', () => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 1.6, high: 21.6 } };
    const exact = exactChance(parts, 2.99), normal = normalChance(parts, 2.99);
    expect(Math.round(exact * 100)).toBe(2);
    expect(Math.round(normal * 100)).toBe(0);
    expect(gate(parts, 2.99)).toMatchObject({ form: 'range' });
    expect(gate(parts, 2.99).error_points).toBeLessThanOrEqual(2);
  });
  it('S4-P40-CLASS more-than-two-points control keeps the range and exact endpoints', () => {
    const parts: ShareParts = { team: { quantity: 'months_to_finish', D: 6, low: 4, high: 8 } };
    expect(gate(parts, 1)).toMatchObject({ form: 'range', low: 0, high: 1 });
    expect(gate(parts, 1).error_points).toBeGreaterThan(2);
  });
  it('L1-PAST-DEADLINE-RERUN: a passed date withholds with recovery words', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-04-08T12:00:00Z'));
    const out = withShareByDateChanceGate(result(), graph(), 'goal');
    expect(out.option_comparison.every((r: Rec) => r.probability_of_goal === undefined)).toBe(true);
    expect(warning(out)?.message).toContain('deadline has passed');
    expect(warning(out)?.message).toContain('future deadline');
    expect(goalChanceLicenceOf(result(), graph(), 'goal')).toBeNull();
  });
  it('L1-PAST-DEADLINE-NO-RUN: a passed date never reaches PLoT', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2027-04-08T12:00:00Z'));
    const g = graph(), run = vi.fn();
    const handler = createRunAnalysisHandler({ plotClient: { run } as never,
      scenarioReader: vi.fn(async () => ({ graph: g, rawPersistedGraph: g, options: [], goal_node_id: 'goal' })) as never });
    await expect(handler({ context: { session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      payload: makeMessagePayload({ scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-past', signal: new AbortController().signal } as never))
      .rejects.toMatchObject({ cause_kind: 'analysis_not_ready', details: { reason_code: 'goal_deadline_passed' } });
    expect(run).not.toHaveBeenCalled();
  });
  it('L1-PAST-DEADLINE-RERUN control: future date keeps Run chance', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    expect(withShareByDateChanceGate(result(), graph(), 'goal').option_comparison[1].probability_of_goal).toBe(0.390);
  });
  it('L1-CURRENT-UNIT-PREFIX: percent-of spelling uses the full deliverable', () => {
    const g = graph();
    for (const n of g.nodes) {
      if (n.goal_threshold_unit === UNIT) n.goal_threshold_unit = 'percent of the feature launch';
      if (n.observed_state?.unit === UNIT) n.observed_state.unit = 'percent of the feature launch';
      if (n.observed_state?.extra_share_by_date) n.observed_state.extra_share_by_date.unit = 'percent of the feature launch per month';
    }
    for (const e of g.edges) if (e.provenance?.natural_effect?.amount_unit === UNIT) {
      e.provenance.natural_effect.amount_unit = 'percent of the feature launch';
      if (e.provenance.natural_effect.per_source_change_unit === UNIT) e.provenance.natural_effect.per_source_change_unit = 'percent of the feature launch';
    }
    const raw = { inference_warnings: [{ code: GOAL_CHANCE_LICENSED, severity: 'info', message: 'Licensed.', form: 'each',
      option_ids: ['carry', 'hire'], pct_by_option: { carry: 0, hire: 39 },
      target: { comparator: 'at_least', value: 100, unit: 'percent of the feature launch', by_date: DEADLINE } }] };
    expect(goalChanceScreenLinesForAgent(raw, g, true).find(l => l.option_id === 'hire')?.chance).toContain('chance of launching by 7 April 2027');
    expect(goalChanceScreenLinesForAgent(raw, g, true).find(l => l.option_id === 'hire')?.chance).not.toContain('nt of');
  });
  it('L1-LAUNCHING-WORDS: launch deliverable uses ruled launching by', () => {
    expect(shareGoalChanceWords('the feature launch', DEADLINE)).toBe('chance of launching by 7 April 2027');
  });
  it('L1-LAUNCHING-WORDS control: other deliverable remains named', () => {
    expect(shareGoalChanceWords('the migration', DEADLINE)).toBe('chance of finishing the migration by 7 April 2027');
  });
  it('L1-STRADDLING-ENDPOINTS: extreme range explains the stated slow and fast times', () => {
    const g = graph(4, 8), lines = goalChanceScreenLinesForAgent(saved(g), g, true), carry = lines.find(l => l.option_id === 'carry')!;
    expect(carry.chance).toContain('if it takes 8 months');
    expect(carry.chance).toContain('if it takes 4 months');
  });
  it('L1-STRADDLING-ENDPOINTS control: range carrier retains ruled exact endpoints', () => {
    const out = withShareByDateChanceGate(result(), graph(4, 8), 'goal');
    expect(out.inference_warnings.find((w: Rec) => w.code === GOAL_CHANCE_RANGE)?.range_by_option.carry).toMatchObject({ low: 0, high: 1 });
  });
  it('L1-LAUNCH-WORDS-SCALING: 20k to 160k whitespace scales below 22x', () => {
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793/#2800.
    const inputs = [20000, 160000].map(n => ' '.repeat(n));
    const m = scalingRatio(() => shareGoalChanceWords(inputs[0]!, DEADLINE), () => shareGoalChanceWords(inputs[1]!, DEADLINE));
    expect(m.ratio, m.detail).toBeLessThan(22);
  });
  it('S3-CAPPED-HELPER: display means use capped expectation, uncapped moments remain', () => {
    const capped = (maths as unknown as { cappedTeamShareMean: (D: number, a: number, b: number) => number }).cappedTeamShareMean;
    expect(capped(6, 4, 8)).toBeCloseTo(0.9315231, 6);
    expect(capped(6, 3, 9)).toBeCloseTo(0.9054651, 6);
    expect(teamShareMoments(6, 4, 8).mean).toBeGreaterThan(1);
  });
});
