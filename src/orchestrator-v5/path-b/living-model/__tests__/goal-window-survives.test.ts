import { assertTargetHeld } from './assert-target-held.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { riskOccurrenceWindowMonths } from '../../../agent-lane/risk-occurrence.js';
import { readGoalRecord } from '../../../goal-target/goal-record.js';
import { mapLivingModel } from '../mapper.js';
import { OLUMI_CHANCE } from './track2-f2-event-risk.fixtures.js';
import { KNOWN_ANSWER } from './fixtures.js';

const model = (months: number | null, deadline: string | null = null): LivingModelT => {
  const m = structuredClone(OLUMI_CHANCE);
  Object.assign(m.aims[0]!.target!, { period_months: months, by_when: deadline });
  m.risks[0]!.mitigations = [];
  m.risks[0]!.horizon_months = 18;
  return m;
};
const run = (m: LivingModelT) => {
  expect(LivingModel.safeParse(m).success).toBe(true);
  const mapped = mapLivingModel(m);
  const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: m }));
  return { mapped, graph, goal: graph.nodes.find(n => n.kind === 'goal')!, readiness: assessCanonicalAnalysisReadiness(graph) };
};
const risk = (g: ReturnType<typeof run>['graph'], id = 'supplier_fails') => g.nodes.find(n => n.id === id)?.event_risk;

describe('the aim window survives the real mapper and readiness path', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T12:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('a: 18-month goal keeps both Olumi risks and a goal threshold; Run is reachable', () => {
    const m = model(18);
    m.risks.push({ ...m.risks[0]!, id: 'strike', label: 'Port strike' });
    m.links.push({ ...m.links[0]!, id: 'strike_gp', from: 'strike' });
    const { mapped, graph, goal, readiness } = run(m);
    expect(riskOccurrenceWindowMonths(graph)).toBe(18);
    expect(risk(graph)?.horizon.months).toBe(18);
    expect(risk(graph, 'strike')?.horizon.months).toBe(18);
    expect(goal.goal_threshold).toBeDefined();
    expect(mapped.withheld).toEqual([]);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.safeToAnalyse).toBe(true);
  });

  it('Q3 declared shape: a change target with no current baseline still carries its 18-month window to both Olumi estimates', () => {
    const m = model(18, 'within 18 months');
    Object.assign(m.aims[0]!.target!, { comparator: 'increase', value: 40000, current: null, unit: '£ per year', change_kind: 'absolute' });
    m.risks[0] = { ...m.risks[0]!, source: 'user', horizon_by: 'olumi', occurrence: { estimate_by: 'olumi', low: 0.1, high: 0.9 } };
    m.risks.push({ ...m.risks[0]!, id: 'roof', label: 'Roof repairs needed' });
    m.links.push({ ...m.links[0]!, id: 'roof_gp', from: 'roof' });
    const { mapped, graph, goal } = run(m);
    expect(goal.goal_target_basis).toBeUndefined();
    expect(goal.goal_horizon_months).toBe(18);
    expect(riskOccurrenceWindowMonths(graph)).toBe(18);
    expect(risk(graph)?.horizon.months).toBe(18);
    expect(risk(graph, 'roof')?.horizon.months).toBe(18);
    expect(mapped.withheld.filter(w => w.reason === 'risk_window_not_goal_window' || w.reason === 'chance_rests_on_withheld')).toEqual([]);
    // Missing current level remains core-route's separate blocker; never fabricate a threshold to make this row pass.
    expect(goal.goal_threshold).toBeUndefined();
  });

  it.each([18, 0.69, 120])('a: window %s survives without a target reading or a chance', months => {
    const m = model(months);
    m.aims[0]!.target!.unit = null;
    m.aims[0]!.target!.value = null;
    const { graph, goal } = run(m);
    expect(goal.goal_target_basis).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_horizon_months).toBe(months);
    expect(readGoalRecord(graph, goal.id)?.horizon?.months).toBe(months);
    expect(riskOccurrenceWindowMonths(graph)).toBe(months);
    expect(risk(graph)?.horizon.months).toBe(months);
  });

  it('a: withholding a dependent chance retains its target, date and window, and keeps risks current', () => {
    const m = model(18, 'by 30 April 2028');
    m.conditions.push({ text: 'Board approval remains open', role: 'prerequisite', applies_to: ['gp'], source: 'user', party: null, quote: 'Board approval remains open' });
    const { mapped, graph, goal } = run(m);
    expect(mapped.withheld).toContainEqual({ id: 'gp', reason: 'chance_rests_on_withheld' });
    assertTargetHeld(graph, 'gp', m.aims[0]!.target!.value!);
    expect(goal.goal_horizon).toEqual({ deadline: '2028-04-30' });
    expect(goal.goal_deadline_as_stated).toBe('by 30 April 2028');
    expect(riskOccurrenceWindowMonths(graph)).toBe(18);
    expect(risk(graph)?.horizon.months).toBe(18);
  });

  it('ii: 150 months supplies no held window and holds Olumi risks as on base', () => {
    const m = model(150, 'within 150 months');
    Object.assign(m.aims[0]!.target!, { value: null, unit: null });
    const { mapped, graph, goal } = run(m);
    expect(goal.goal_target_basis).toBeUndefined();
    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_horizon_months).toBeUndefined();
    expect(readGoalRecord(graph, goal.id)?.horizon).toEqual({ as_stated: 'within 150 months' });
    expect(riskOccurrenceWindowMonths(graph)).toBeUndefined();
    expect(risk(graph)).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
    const base = structuredClone(m);
    base.aims[0]!.target!.period_months = null;
    expect(mapped.withheld).toEqual(run(base).mapped.withheld);
  });

  it('PURITY: the same saved models map to byte-identical output on different system days', () => {
    const models = [model(null, 'by the end of March'), model(5.29, 'by the end of March'), model(18, 'by 30 April 2028'), structuredClone(KNOWN_ANSWER)];
    const bytes = (m: LivingModelT) => JSON.stringify(mapLivingModel(m), (_key, value) => value instanceof Map ? [...value] : value);
    for (const m of models) {
      const before = structuredClone(m);
      vi.setSystemTime(new Date('2026-10-22T12:00:00Z'));
      const first = bytes(m);
      vi.setSystemTime(new Date('2027-04-01T12:00:00Z'));
      expect(bytes(m)).toBe(first);
      expect(m).toEqual(before);
    }
  });

  it.each([null, 'when the market settles', 'by 12 January 2026', 'Revenue was 2m as of 2026-09-01, and our deadline is unclear'])('d: %s never supplies a guessed window', deadline => {
    const { mapped, graph } = run(model(null, deadline));
    expect(riskOccurrenceWindowMonths(graph)).toBeUndefined();
    expect(risk(graph)).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
  });

  it('d: a person’s own chance is byte equal and never converted beside an Olumi chance', () => {
    const m = model(5.29, 'by the end of March');
    m.risks.push({ ...m.risks[0]!, id: 'theirs', source: 'user', quote: 'Sam says 5–15% over 18 months', horizon_by: null });
    m.links.push({ ...m.links[0]!, id: 'theirs_gp', from: 'theirs' });
    const { mapped, graph } = run(m);
    expect(risk(graph, 'theirs')).toEqual({ version: 1, occurrence: { p_low: 0.05, p_high: 0.15, basis: 'user' }, horizon: { months: 18 } });
    expect(mapped.assumed.filter(n => n.id === 'theirs')).toEqual([]);
    expect(risk(graph)?.horizon.months).toBe(5.29);
  });

  it('second brief: production goal has no target reading, but its stored window reaches a separate delivery risk', () => {
    const m = structuredClone(KNOWN_ANSWER);
    m.aims[0]!.target!.by_when = 'by the end of March';
    m.aims[0]!.target!.period_months = 5.29;
    m.aims[0]!.target!.value = null;
    m.risks = [{ ...model(null).risks[0]!, id: 'delay', label: 'Delivery delay' }];
    m.links.push({ ...m.links[0]!, id: 'delay_g', from: 'delay', effect: { ...m.links[0]!.effect, sign: '-' } });
    const { graph, goal } = run(m);
    expect(goal.goal_target_basis).toBeUndefined();
    expect(riskOccurrenceWindowMonths(graph)).toBe(5.29);
    expect(risk(graph, 'delay')?.horizon.months).toBe(5.29);
  });
});
