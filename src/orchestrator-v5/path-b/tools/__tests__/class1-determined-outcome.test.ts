import { describe, expect, it } from 'vitest';
import { withGoalChanceLicence, goalChanceLicenceForAgent, type SentGoalThreshold } from '../../../goal-target/goal-chance-licence.js';
import { readCanonicalContext } from '../context-tool.js';
import { recordedRun } from '../run-tool.js';
import { coreTurnContract } from '../../../core-route/contract.js';
import { analysisResultForAgent } from '../../../agent-lane/decision-sensitivity.js';

type Rec = Record<string, any>;
const AT = '2026-10-22T19:59:57.539Z';
const ctx = { scenario_id: 'synthetic' };

// Same class as the capture: an anchored level, switched options, same-draw reference.
function scenario(unit = 'customers a week', today = 400, target = 480, operator = '>=') {
  const graph: Rec = { nodes: [
    { id: 'g', kind: 'goal', label: 'Weekly output', goal_direction: operator,
      goal_threshold: target / 600, goal_threshold_raw: target, goal_threshold_unit: unit,
      goal_threshold_cap: 600, goal_threshold_frame: 'level',
      observed_state: { value: today / 600, raw_value: today, cap: 600, unit, source: 'brief_extraction' } },
    { id: 'f', kind: 'factor', label: 'Activity', observed_state: { value: 0, raw_value: 0 } },
    { id: 'a', kind: 'option', label: 'Add activity', interventions: { f: { value: 1 } } },
    { id: 'b', kind: 'option', label: 'Other activity' },
    { id: 'sq', kind: 'option', label: 'Keep things as they are', is_baseline: true, interventions: { f: { value: 0 } } },
  ], edges: [{ from: 'f', to: 'g', strength: { mean: 0.1, std: 0.05 }, exists_probability: 1 }] };
  const envelope: Rec = { option_comparison: [
    { option_id: 'a', probability_of_goal: 0.3848 }, { option_id: 'b', probability_of_goal: 0.1114 },
    // The captured read has no probability_of_goal here, and has this float residue.
    { option_id: 'sq', outcome: { p50: today / 600, mean: today / 600 - Number.EPSILON / 2 } },
  ] };
  const sent: SentGoalThreshold = { field: 'goal_threshold', frame: 'level', value: target / 600,
    baseline: today / 600, status_quo_option_id: 'sq' };
  return { graph, envelope, sent };
}

function resultOf(s: ReturnType<typeof scenario>): Rec {
  const result = { type: 'analysis_result', enrichment: withGoalChanceLicence(s.envelope, s.graph, 'g', () => false, s.sent) };
  return analysisResultForAgent(result, s.graph) as Rec;
}

async function aiViews(s: ReturnType<typeof scenario>) {
  const result = resultOf(s);
  const dispatch = async () => ({ status: 200, json: { graph: s.graph, graph_hash: 'h', analysis_result: result,
    canonical_analysis_view: { run: { run_id: 'run', graph_hash_at_run: 'h' }, staleness: { stale: false } },
    analysis_state: { run_state: { kind: 'complete_current', computed_at: AT }, leader_claim: { permitted: false } } } });
  const context = await readCanonicalContext({ dispatch }, ctx);
  const tool = await recordedRun({ dispatch }, ctx, { ran: true, result,
    run_identity: { graph_hash_at_run: 'h', computed_at: AT } });
  if (context.status !== 'ok' || tool.status !== 'ok') throw new Error('synthetic Run was not confirmed');
  return { result, licence: goalChanceLicenceForAgent(result)!, context: context.data as Rec, tool: tool.data as Rec };
}

describe('Class 1: a determined miss is said as determined in the existing AI carriers', () => {
  it.each([
    ['customers a week', undefined], ['parcels a week', undefined],
    ['customers a week', 0], ['parcels a week', 0],
  ] as const)('%s (recorded chance %s): source → context and Run tool, with no probability or leader for carrying on', async (unit, p) => {
    const s = scenario(unit);
    if (p !== undefined) s.envelope.option_comparison[2].probability_of_goal = p;
    const { result, licence, context, tool } = await aiViews(s);
    const expected = { option_id: 'sq', line: `No change, by assumption: stays at today’s 400 ${unit}, which does not meet your target of at least 480 ${unit}, in this model.` };
    expect(licence.status_quo).toEqual(expected);
    expect(context.selected_run.facts.chances.goal_chance_status_quo).toEqual(expected);
    expect(goalChanceLicenceForAgent(tool.result)?.status_quo).toEqual(expected);
    expect(licence.withheld_option_ids).toEqual(['sq']);
    expect(licence.leader_option_id).not.toBe('sq');
    expect(licence.form).toBe(p === 0 ? 'highest_all_likely_to_miss' : 'each');
    expect(context.selected_run.facts.leader.goal_chance_leader).not.toBe('sq');
    expect((result.enrichment.option_comparison as Rec[]).find(r => r.option_id === 'sq')).not.toHaveProperty('probability_of_goal');
    expect(context.selected_run.facts.chances.goal_chance_display).not.toHaveProperty('sq');
    expect(expected.line).not.toMatch(/0%|no chance|can.t give a chance/);
    // The core contract carries the AI's output verbatim; there is no host narrator.
    const said = `Keep things as they are: ${expected.line}`;
    expect(coreTurnContract({ turnId: 't', durability: 'recorded', assistantText: said, analysisResult: result }).assistant_text).toBe(said);
  });

  it('an inconsistent recorded meets probability cannot become a determined miss', async () => {
    const s = scenario('customers a week', 400, 480);
    // The Run scores the normalised target below today, contradicting the raw target.
    s.graph.nodes[0].goal_threshold = 0.5;
    s.sent = { ...s.sent, value: 0.5 };
    s.envelope.option_comparison[2].probability_of_goal = 1;
    const { result, licence, context, tool } = await aiViews(s);
    const expected = { option_id: 'sq', line: 'This Run can’t give a chance for carrying on as now, because it treats ‘Weekly output’ as unchanged from '
      + 'today’s 400 customers a week (your target is at least 480 customers a week).' };
    expect(licence.status_quo).toEqual(expected);
    expect(context.selected_run.facts.chances.goal_chance_status_quo).toEqual(expected);
    expect(goalChanceLicenceForAgent(tool.result)?.status_quo).toEqual(expected);
    expect(result.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED').pct_by_option).not.toHaveProperty('sq');
    expect(licence.status_quo?.line).not.toMatch(/stays at|does not meet|%/);
    expect(licence.form).toBe('each');
    expect(context.selected_run.facts.leader.goal_chance_leader).toBeNull();
  });

  it('a status quo with an uncertain event driver retains its own chance', async () => {
    const s = scenario();
    s.graph.nodes.push({ id: 'risk', kind: 'risk', event_risk: { occurrence: { p_low: 0.2, p_high: 0.4 } } });
    s.graph.edges.push({ from: 'risk', to: 'g', strength: { mean: -0.2, std: 0.1 } });
    s.envelope.option_comparison[2] = { option_id: 'sq', probability_of_goal: 0.25,
      outcome: { p10: 0.5, p50: 0.7, p90: 0.9, mean: 0.7, std: 0.1 } };
    const { licence, context, tool } = await aiViews(s);
    expect(licence.status_quo).toBeUndefined();
    expect(context.selected_run.facts.chances.goal_chance_display.sq).toBe('about 25%');
    expect(tool.result.enrichment.option_comparison[2].probability_of_goal).toBe(0.25);
  });

  it.each([480, 500])('today %s meets the target: the 14 Oct status-quo ruling still blocks meets wording and a leader', async today => {
    const { licence, context } = await aiViews(scenario('customers a week', today));
    expect(licence.status_quo).toEqual({ option_id: 'sq', line: 'This Run can’t give a chance for carrying on as now, because it treats ‘Weekly output’ as unchanged from '
      + `today’s ${today} customers a week (your target is at least 480 customers a week).` });
    expect(licence.form).toBe('each');
    expect(context.selected_run.facts.leader.goal_chance_leader).toBeNull();
  });

  it('an unrelated level cannot supply the goal’s missing reference or units', async () => {
    const s = scenario();
    s.graph.nodes[0].observed_state.unit = 'hours';
    s.graph.nodes.push({ id: 'unrelated', kind: 'factor', observed_state: { raw_value: 400, unit: 'customers a week' } });
    const { licence } = await aiViews(s);
    expect(licence.status_quo?.line).not.toMatch(/stays at|does not meet/);
  });

  it.each(['>', '<=', '<'])('the held %s comparator determines the miss, rather than a higher-is-better default', async operator => {
    const today = operator === '>' ? 480 : 500;
    const { licence } = await aiViews(scenario('parcels a week', today, 480, operator));
    expect(licence.status_quo?.line).toMatch(/^No change, by assumption: stays at today’s/);
    expect(licence.status_quo?.line).toContain('does not meet your target');
    expect(licence.status_quo?.line).not.toContain('chance');
  });
});
