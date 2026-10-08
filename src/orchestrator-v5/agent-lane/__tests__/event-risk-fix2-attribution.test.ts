import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { goalChanceLicenceOf } from '../../goal-target/goal-chance-licence.js';
import type { EventRiskV1T } from '../../../schemas/event-risk.js';
import { actionBarOf } from '../actions/rank.js';
import { actionFactsOf } from '../actions/state.js';
import { decidePress } from '../actions/handlers.js';
import { goalChanceEstimateLikelihoodCount, goalChanceEstimateLikelihoods, goalChanceEstimateLinkCount } from '../goal-chance-estimate-attribution.js';
import { goalChanceScreenLinesForAgent } from '../goal-chance-screen-lines.js';
import { eventRiskCardLine } from '../stated-event-risk-draft.js';

const basis = 'typical annual key-staff turnover in small software teams';
const event: EventRiskV1T = {
  version: 1,
  occurrence: { p_low: 1 / 19, p_high: 2 / 11, basis: 'olumi', meaning: 'at_least_once_within_horizon' },
  horizon: { months: 12 },
};
const model = (): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } => ({
  nodes: [
    { id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: 59 } },
    { id: 'keep', kind: 'option', label: 'Keep price', interventions: { price: 49 } },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 49, unit: '£' } },
    { id: 'dev', kind: 'risk', label: 'Key developer departure', event_risk: event, event_risk_basis_text: basis },
    { id: 'goal', kind: 'goal', label: 'MRR', goal_threshold: 20000, goal_threshold_raw: 20000,
      goal_threshold_frame: 'level', goal_threshold_unit: '£/month', goal_direction: '>=' },
  ],
  edges: [
    { from: 'price', to: 'goal', strength: { mean: 400, std: 200 }, exists_probability: 1,
      provenance: { magnitude: 'olumi_estimate' } },
    { from: 'dev', to: 'goal', strength: { mean: -5000, std: 2500 }, exists_probability: 1,
      provenance: { magnitude: 'olumi_estimate' } },
  ],
});
const envelope = { option_comparison: [{ option_id: 'raise', probability_of_goal: 0.67 }, { option_id: 'keep' }], inference_warnings: [] };
const run = (graph: ReturnType<typeof model>) => ({ ...envelope, inference_warnings: [goalChanceLicenceOf(envelope, graph, 'goal')!] });
const factsFor = (graph: ReturnType<typeof model>) => {
  const hash = computeAnalysisAffectingGraphHash(graph as never)!;
  return actionFactsOf({
    scenarioId: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', graph, graphHash: hash,
    analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-08T14:00:00.000Z' },
      usable_for_chips: true, leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
    analysisReady: { status: 'ready', may_run: true },
    analysisResult: { type: 'analysis_result', computed_against_hash: hash, data: {}, ...run(graph) },
  });
};

describe('FIX2 E/F: warranted occurrences and their impact relationship census', () => {
  it.each([undefined, '', '   '])('E r1 #7: root Olumi occurrence with basis %j earns no likelihood or attribution', text => {
    const graph = model();
    graph.nodes.find(n => n.id === 'dev')!.event_risk_basis_text = text;
    expect(goalChanceEstimateLikelihoodCount(graph, 'goal')).toBe(0);
    expect(goalChanceEstimateLikelihoods(graph, 'goal')).toEqual([]);
    expect(goalChanceLicenceOf(envelope, graph, 'goal')).not.toHaveProperty('olumi_estimate_likelihood_count');
    expect(factsFor(graph).olumiEstimates?.likelihoods).toBeUndefined();
  });

  it.each([undefined, '', '   '])('E basis-less occurrence card %j is a placeholder without Olumi attribution', text => {
    const line = eventRiskCardLine(event, text);
    expect(line).not.toContain("Olumi's estimate");
    expect(line).not.toContain('5–18%');
    expect(line).toContain('basis');
  });

  it('E readable basis control retains the warranted likelihood and card attribution', () => {
    const graph = model();
    expect(goalChanceEstimateLikelihoodCount(graph, 'goal')).toBe(1);
    expect(goalChanceEstimateLikelihoods(graph, 'goal')[0]!.words).toContain(`Olumi's estimate, based on ${basis}`);
  });

  it('F r1 #6: price → MRR and independent developer departure → MRR are 2 relationships, 1 likelihood', () => {
    const graph = model();
    expect(goalChanceEstimateLinkCount(graph, ['raise', 'keep'], 'goal')).toBe(2);
    expect(goalChanceLicenceOf(envelope, graph, 'goal')).toMatchObject({
      olumi_estimate_link_count: 2, olumi_estimate_likelihood_count: 1,
    });
    expect(goalChanceScreenLinesForAgent(run(graph), graph, true)[0]!.chance)
      .toContain("on Olumi's estimates (2 relationships, 1 likelihood)");
  });

  it('F Check estimates lists the independent event impact from the same census', () => {
    const facts = factsFor(model());
    expect(facts.runBound).toBe(true);
    expect(facts.olumiEstimates?.links.map(item => item.id)).toEqual(['price->goal', 'dev->goal']);
    expect(facts.olumiEstimates).toMatchObject({ count: 3 });
    const bar = actionBarOf(facts);
    const pressed = decidePress({ id: 'act:check_estimates' }, facts, bar);
    if (pressed.kind !== 'reply') throw new Error('Expected Check estimates reply');
    expect(pressed.reply.text).toContain('2 link sizes and 1 likelihood');
    expect(pressed.reply.text).toContain('Key developer departure → MRR (link size)');
  });

  it('F roots are counted occurrences only: basis-less, excluded and off-goal event impacts do not enter the census', () => {
    const withoutBasis = model();
    delete withoutBasis.nodes.find(n => n.id === 'dev')!.event_risk_basis_text;
    expect(goalChanceEstimateLinkCount(withoutBasis, ['raise', 'keep'], 'goal')).toBe(1);
    expect(factsFor(withoutBasis).olumiEstimates?.links).toHaveLength(1);
    const excluded = model();
    excluded.nodes.find(n => n.id === 'dev')!.analysis_participation = 'retained_excluded';
    expect(goalChanceEstimateLinkCount(excluded, ['raise', 'keep'], 'goal')).toBe(1);
    expect(factsFor(excluded).olumiEstimates?.links).toHaveLength(1);
    const offGoal = model();
    offGoal.edges = offGoal.edges.filter(e => e.from !== 'dev');
    expect(goalChanceEstimateLinkCount(offGoal, ['raise', 'keep'], 'goal')).toBe(1);
    expect(factsFor(offGoal).olumiEstimates?.links).toHaveLength(1);
  });

  it('F event and lever paths share links without counting a shared downstream relationship twice', () => {
    const graph = model();
    graph.edges[1] = { ...graph.edges[1], to: 'price' };
    expect(goalChanceEstimateLinkCount(graph, ['raise', 'keep'], 'goal')).toBe(2);
    expect(factsFor(graph).olumiEstimates?.links.map(item => item.id)).toEqual(['price->goal', 'dev->price']);
  });
});
