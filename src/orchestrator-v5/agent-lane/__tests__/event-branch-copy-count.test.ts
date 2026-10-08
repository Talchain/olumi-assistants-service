import { describe, expect, it } from 'vitest';
import { eventRiskCardLine } from '../stated-event-risk-draft.js';
import { goalChanceLicenceOf, goalChanceLicenceForAgent } from '../../goal-target/goal-chance-licence.js';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { withEstimateGoalPointsAtEgress } from '../goal-chance-estimate-egress.js';
import { narratorCountGuard } from '../olumi-estimates-feeding-result.js';
import { goalChanceEstimateLikelihoodCount } from '../goal-chance-estimate-attribution.js';
import { actionFactsOf } from '../actions/state.js';
import { actionBarOf } from '../actions/rank.js';
import { decidePress } from '../actions/handlers.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { EventRiskV1T } from '../../../schemas/event-risk.js';

const basis = 'typical annual key-staff turnover in small software teams';
const occurrence = (owner: 'user' | 'olumi' = 'olumi'): EventRiskV1T => ({
  version: 1,
  occurrence: { p_low: 1 / 19, p_high: 2 / 11, basis: owner, meaning: 'at_least_once_within_horizon' },
  horizon: { months: 12 },
});
const graph = (owner: 'user' | 'olumi' = 'olumi', estimatedLinks = true) => ({
  nodes: [
    { id: 'raise', kind: 'option', label: 'Raise price', interventions: { price: 59 } },
    { id: 'keep', kind: 'option', label: 'Keep price', interventions: { price: 49 } },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 49, unit: '£' } },
    { id: 'sales', kind: 'factor', label: 'Sales', observed_state: { value: 400, unit: 'customers' } },
    { id: 'dev', kind: 'risk', label: 'Key developer departure', event_risk: occurrence(owner), event_risk_basis_text: basis },
    { id: 'elsewhere', kind: 'risk', label: 'An unrelated event', event_risk: occurrence(), event_risk_basis_text: 'a different reference class' },
    { id: 'goal', kind: 'goal', label: 'MRR', goal_threshold: 20000, goal_threshold_raw: 20000,
      goal_threshold_frame: 'level', goal_threshold_unit: '£/month', goal_direction: '>=' },
  ],
  edges: [
    { from: 'price', to: 'sales', strength: { mean: -1, std: 0.5 }, exists_probability: 1,
      provenance: { magnitude: estimatedLinks ? 'olumi_estimate' : 'user_stated' } },
    { from: 'sales', to: 'goal', strength: { mean: 49, std: 24.5 }, exists_probability: 1,
      provenance: { magnitude: estimatedLinks ? 'olumi_estimate' : 'user_stated' } },
    { from: 'dev', to: 'sales', strength: { mean: -100, std: 50 }, exists_probability: 1,
      provenance: { magnitude: 'user_stated' } },
  ],
});
const envelope = { option_comparison: [{ option_id: 'raise', probability_of_goal: 0.67 }, { option_id: 'keep' }], inference_warnings: [] };
const licensed = (model = graph()) => ({ ...envelope, inference_warnings: [goalChanceLicenceOf(envelope, model, 'goal')!] });
const firstLine = (model = graph()) => goalChanceScreenLinesForAgent(licensed(model), model, true)[0]!;
const labelledChance = "‘Raise price’: about 67% chance of meeting your goal, in this model, on Olumi's estimates (2 relationships, 1 likelihood) (see Check estimates).";

describe('EVENT-BRANCH Science occurrence words and separate RC4 kinds', () => {
  it('card shows the Science 10% log-odds range, horizon and readable estimate basis', () => {
    const cardLine = eventRiskCardLine as (block: EventRiskV1T, basisText?: string) => string;
    expect(cardLine(occurrence(), basis)).toBe(`May happen: about 5–18% within 12 months (Olumi's estimate, based on ${basis}).`);
    expect(cardLine(occurrence('user'))).toContain('as you said');
  });

  it.each([[0.001, 0.004], [0.996, 0.999]])('card never turns an interior Olumi range %s–%s into certainty', (low, high) => {
    const block = occurrence();
    block.occurrence.p_low = low;
    block.occurrence.p_high = high;
    const cardLine = eventRiskCardLine as (block: EventRiskV1T, basisText?: string) => string;
    expect(cardLine(block, basis)).not.toMatch(/(?<![\d.])(?:0|100)%/);
  });

  it('k stays 2 relationships; the root event reaching this goal adds 1 likelihood', () => {
    const model = graph();
    const licence = goalChanceLicenceOf(envelope, model, 'goal');
    expect(licence).toMatchObject({ olumi_estimate_link_count: 2, olumi_estimate_likelihood_count: 1 });
    expect(goalChanceLicenceForAgent(licensed(model))).toMatchObject({ olumi_estimate_link_count: 2, olumi_estimate_likelihood_count: 1 });
    expect(firstLine(model).chance).toBe(labelledChance);
  });

  it('likelihood-only licence omits the zero relationship kind and still owes the labelled point', () => {
    const model = graph('olumi', false);
    const licence = goalChanceLicenceOf(envelope, model, 'goal');
    expect(licence).not.toHaveProperty('olumi_estimate_link_count');
    expect(licence).toHaveProperty('olumi_estimate_likelihood_count', 1);
    const lines = goalChanceScreenLinesForAgent(licensed(model), model, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.chance).toContain("on Olumi's estimates (1 likelihood)");
    expect(lines[0]!.chance).not.toMatch(/0 relationships/);
    expect(withScreenLinesOwed('Raise price: about 67%.', lines).text).toContain(lines[0]!.chance);
    expect(withEstimateGoalPointsAtEgress({ assistant_text: 'Raise price: about 67%.' }, {
      analysisResult: licensed(model), graph: model, current: true,
    }).assistant_text).toBe(lines[0]!.chance);
  });

  it('user occurrence and an off-goal Olumi occurrence grant no likelihood count', () => {
    const model = graph('user');
    expect(goalChanceLicenceOf(envelope, model, 'goal')).not.toHaveProperty('olumi_estimate_likelihood_count');
  });

  it('counts an event once even when two impacts reach the scored goal', () => {
    const model = graph();
    model.edges.push({ ...model.edges[2]!, to: 'goal' });
    expect(goalChanceEstimateLikelihoodCount(model, 'goal')).toBe(1);
  });

  it('a declared root preventer preserves the count; an incoming driver does not', () => {
    const model = graph();
    model.edges.push({ ...model.edges[2]!, from: 'price', to: 'dev' });
    expect(goalChanceEstimateLikelihoodCount(model, 'goal')).toBe(0);
    model.nodes.find(n => n.id === 'dev')!.event_risk!.mitigations = [{ factor_id: 'price', occurrence_reduction: 0.5 }];
    expect(goalChanceEstimateLikelihoodCount(model, 'goal')).toBe(1);
    model.edges.push({ ...model.edges[2]!, from: 'raise', to: 'price' });
    expect(goalChanceEstimateLikelihoodCount(model, 'goal')).toBe(1);
    model.edges.push({ ...model.edges[2]!, from: 'sales', to: 'price' });
    expect(goalChanceEstimateLikelihoodCount(model, 'goal')).toBe(0);
  });

  it('kept-out event, malformed occurrence and a different scored goal earn no count', () => {
    const keptOut = graph();
    Object.assign(keptOut.nodes.find(n => n.id === 'dev')!, { analysis_participation: 'retained_excluded' });
    expect(goalChanceEstimateLikelihoodCount(keptOut, 'goal')).toBe(0);
    const invalid = graph();
    invalid.nodes.find(n => n.id === 'dev')!.event_risk!.occurrence.p_low = 0.9;
    expect(goalChanceEstimateLikelihoodCount(invalid, 'goal')).toBe(0);
    expect(goalChanceEstimateLikelihoodCount(graph(), 'different_goal')).toBe(0);
    expect(goalChanceEstimateLikelihoodCount({ nodes: [{ kind: 'risk' }] }, 'goal')).toBe(0);
  });

  it('a likelihood attribution owes each option point even on a highest-summary licence', () => {
    const model = graph('olumi', false);
    const two = { ...envelope, option_comparison: [
      { option_id: 'raise', probability_of_goal: 0.67 }, { option_id: 'keep', probability_of_goal: 0.4 },
    ] };
    const licence = goalChanceLicenceOf(two, model, 'goal')!;
    expect(licence.form).toBe('highest');
    const lines = goalChanceScreenLinesForAgent({ ...two, inference_warnings: [licence] }, model, true);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.chance).toContain("on Olumi's estimates (1 likelihood)");
  });

  it('the stored Run counts survive graph changes for reply/reload attribution', () => {
    const model = graph();
    const run = licensed(model);
    const changed = graph('user', false);
    expect(goalChanceScreenLinesForAgent(run, changed, true)[0]!.chance).toBe(labelledChance);
  });

  it('the narrator cannot supply its own likelihood count', () => {
    expect(narratorCountGuard('Olumi supplied 9 likelihoods. Keep the basis visible.', null)).toEqual({
      text: 'Keep the basis visible.', removed: ['Olumi supplied 9 likelihoods.'],
    });
  });

  it('only the canonical mixed-kind sentence pays the owed attribution', () => {
    const line = firstLine();
    expect(withScreenLinesOwed(labelledChance, [line])).toEqual({ text: labelledChance, added: 0 });
    const guessed = labelledChance.replace('1 likelihood', '9 likelihoods');
    const out = withScreenLinesOwed(guessed, [line]);
    expect(out.text).not.toContain(guessed);
    expect(out.text).toBe(labelledChance);
  });

  it('Check estimates shows the same likelihood count and its card basis', () => {
    const model = graph('olumi', false);
    const hash = computeAnalysisAffectingGraphHash(model as never)!;
    const facts = actionFactsOf({
      scenarioId: '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5f6', graph: model, graphHash: hash,
      analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-08T14:00:00.000Z' },
        usable_for_chips: true, leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
      analysisReady: { status: 'ready', may_run: true },
      analysisResult: { type: 'analysis_result', computed_against_hash: hash, data: {}, ...licensed(model) },
    });
    expect(facts.runBound).toBe(true);
    expect(facts.olumiEstimates).toHaveProperty('count', 1);
    const bar = actionBarOf(facts);
    expect([...bar.priority, ...bar.standard, ...bar.more]).toContainEqual(expect.objectContaining({ action_id: 'check_estimates', enabled: true }));
    const pressed = decidePress({ id: 'act:check_estimates' }, facts, bar);
    expect(pressed.kind).toBe('reply');
    if (pressed.kind !== 'reply') throw new Error('Expected Check estimates reply');
    expect(pressed.reply.text).toContain('1 likelihood');
    expect(pressed.reply.text).toContain(`May happen: about 5–18% within 12 months (Olumi's estimate, based on ${basis}).`);
    expect(pressed.reply.text).not.toContain('None of the figures');
  });
});
