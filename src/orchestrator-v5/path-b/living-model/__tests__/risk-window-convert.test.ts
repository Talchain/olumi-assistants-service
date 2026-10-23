import { assertTargetHeld } from './assert-target-held.js';
import { describe, expect, it } from 'vitest';
import { EventRiskV1, type EventRiskV1T } from '../../../../schemas/event-risk.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { LivingModel, type LivingModelT } from '../../../../schemas/living-model.js';
import { assessCanonicalAnalysisReadiness } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import { projectCorePostimageForPersistence } from '../../../persisted-graph-projection.js';
import { riskOccurrenceWindowMonths } from '../../../agent-lane/risk-occurrence.js';
import { mapLivingModel } from '../mapper.js';
import { goalTargetBasisOf, periodWords, periodEndWords } from '../../../goal-target/goal-target-basis.js';
import { timingAskOf } from '../../../statement-door/fields/goal-timing.js';
import { applyGoalHorizonEdit } from '../../../goal-target/goal-horizon-write.js';
import { KNOWN_ANSWER } from './fixtures.js';
import { OLUMI_CHANCE } from './track2-f2-event-risk.fixtures.js';

const withWindow = (m: LivingModelT, months: number | null): LivingModelT => ({ ...m,
  aims: m.aims.map((a) => ({ ...a, target: { ...a.target!, period_months: months, by_when: 'within 3 weeks' } })) });
const supplier = (months: number | null, mitigated = false): LivingModelT => ({ ...withWindow(OLUMI_CHANCE, months),
  risks: OLUMI_CHANCE.risks.map((r) => ({ ...r, mitigations: mitigated ? r.mitigations : [], horizon_months: 1, occurrence: { estimate_by: null, low: 0.1, high: 0.9 } })) });
const blockOf = (mapped: ReturnType<typeof mapLivingModel>, id = 'supplier_fails') =>
  mapped.graph.nodes.find((n) => n.id === id)?.event_risk as EventRiskV1T | undefined;
const note = { id: 'supplier_fails', text: "converted from Olumi's 1-month estimate, assuming an even rate" };
// Captured from the base mapper by the initial RED run: exact serialised event_risk, including key order.
const SAME_WINDOW_BASE = '{"version":1,"occurrence":{"p_low":0.1,"p_high":0.9,"basis":"olumi"},"horizon":{"months":1},"mitigations":[{"factor_id":"dual_sourcing","occurrence_reduction":0.7}]}';

// Second synthetic brief: reach 100 units; a delivery interruption could cost 10 units.
const delivery: LivingModelT = { ...withWindow(KNOWN_ANSWER, 0.69), risks: [{ ...supplier(0.69).risks[0]!,
  id: 'delivery_delay', label: 'Delivery interruption', mitigations: [] }], links: [...KNOWN_ANSWER.links,
  { ...KNOWN_ANSWER.links[0]!, id: 'delay_g', from: 'delivery_delay', effect: { ...KNOWN_ANSWER.links[0]!.effect, value: 10, sign: '-' } }] };

describe('Olumi occurrence is converted to the declared LM goal window', () => {

  it.each([
    ['supplier failure', supplier(0.69), 'supplier_fails'],
    ['delivery interruption', delivery, 'delivery_delay'],
  ] as const)('row 1: %s reaches the engine over 0.69 months with both converted bounds', (_brief, model, id) => {
    expect(LivingModel.safeParse(model).success).toBe(true);
    const before = structuredClone(model);
    const mapped = mapLivingModel(model);
    const block = blockOf(mapped, id);
    expect(block).toBeDefined();
    expect(block!.horizon).toEqual({ months: 0.69 });
    expect(block!.occurrence.basis).toBe('olumi');
    expect(Math.abs(block!.occurrence.p_low - (1 - 0.9 ** 0.69))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(block!.occurrence.p_high - (1 - 0.1 ** 0.69))).toBeLessThanOrEqual(1e-9);
    expect(mapped.graph.edges.some((e) => e.from === id)).toBe(true);
    expect(mapped.withheld.filter((w) => w.id === id)).toEqual([]);
    expect(mapped.assumed.filter((a) => a.id === id)).toEqual([{ ...note, id }]);
    expect(model).toEqual(before);
  });

  it.each([
    ['supplier failure', supplier(0.69), 'supplier_fails'],
    ['delivery interruption', delivery, 'delivery_delay'],
  ] as const)('round 2: %s is admitted by canonical Run readiness over 0.69 months', (_brief, model, id) => {
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.safeToAnalyse).toBe(true);
    // A ready graph that silently lost the risk does not prove admission of its converted chance.
    expect(graph.nodes.find((n) => n.id === id)?.event_risk).toEqual(blockOf(mapped, id));
    expect(blockOf(mapped, id)?.horizon).toEqual({ months: 0.69 });
    expect(riskOccurrenceWindowMonths(graph)).toBe(0.69);
  });

  it('round 2: one period only; conflicting periods and a second goal never license a window', () => {
    const graph = mapLivingModel(supplier(1, true)).graph;
    expect(riskOccurrenceWindowMonths(graph)).toBe(1);
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    expect(riskOccurrenceWindowMonths({ ...graph, nodes: [...graph.nodes, { ...goal, id: 'another_goal' }] })).toBeUndefined();
    expect(riskOccurrenceWindowMonths({ ...graph, nodes: graph.nodes.map((n) => n === goal
      ? { ...n, goal_horizon_months: 2, goal_horizon_stated_months: 2 } : n) })).toBeUndefined();
  });

  it.each(['user', 'party'] as const)('row 2: %s keeps the original chance and its own window, beside an Olumi conversion', (source) => {
    const model = supplier(0.69);
    model.risks.push({ ...model.risks[0]!, id: 'stated_risk', source, party: source === 'party' ? 'Sam' : null,
      quote: 'Revenue was 2m; Sam puts this separate risk at 10–90% within a month.', mitigations: [] });
    const before = structuredClone(model);
    const mapped = mapLivingModel(model);
    expect(JSON.stringify(blockOf(mapped, 'stated_risk'))).toBe('{"version":1,"occurrence":{"p_low":0.1,"p_high":0.9,"basis":"user"},"horizon":{"months":1}}');
    expect(mapped.assumed.filter((a) => a.id === 'stated_risk')).toEqual([]);
    expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([note]);
    expect(model).toEqual(before);
  });

  it('row 3: by_when alone never supplies T, so the Olumi risk remains held', () => {
    const mapped = mapLivingModel(supplier(null));
    expect(blockOf(mapped)).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
    expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
  });

  it('row 4: the same window keeps the byte-identical base block, with no conversion note', () => {
    const mapped = mapLivingModel(supplier(1, true));
    expect(JSON.stringify(blockOf(mapped))).toBe(SAME_WINDOW_BASE);
    expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: supplier(1, true) }));
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.safeToAnalyse).toBe(true);
    expect(JSON.stringify(graph.nodes.find((n) => n.id === 'supplier_fails')?.event_risk)).toBe(SAME_WINDOW_BASE);
    expect(riskOccurrenceWindowMonths(graph)).toBe(1);
  });

  it('class: shorter and longer windows preserve ordered probabilities in [0,1], including 0 and 1', () => {
    for (const months of [0.01, 0.69, 6, 120]) for (const [low, high] of [[0, 1], [1, 1], [0.1, 0.9], [0.3, 0.3]]) {
      const model = supplier(months);
      model.risks[0]!.occurrence = { estimate_by: null, low: low!, high: high! };
      const mapped = mapLivingModel(model);
      const block = blockOf(mapped);
      if (high === 1 && months < 1) {
        expect(block).toBeUndefined();
        expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
        continue;
      }
      expect(block).toBeDefined();
      expect(EventRiskV1.safeParse(block).success).toBe(true);
      expect(block!.horizon.months).toBe(months);
      expect(Math.abs(block!.occurrence.p_low - (1 - (1 - low!) ** months))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(block!.occurrence.p_high - (1 - (1 - high!) ** months))).toBeLessThanOrEqual(1e-9);
    }
  });

  it('an unverified adjacent risk never gains Olumi authorship or a conversion note', () => {
    const model = supplier(0.69);
    model.risks.push({ ...model.risks[0]!, id: 'unknown_author', source: 'unverified', mitigations: [] });
    const mapped = mapLivingModel(model);
    expect(blockOf(mapped, 'unknown_author')).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'unknown_author', reason: 'risk_unattributed' });
    expect(mapped.assumed.filter((a) => a.id === 'unknown_author')).toEqual([]);
  });

  it('round 3: invalid goal periods never license an adjacent valid risk window', () => {
    const base = mapLivingModel(supplier(1, true)).graph;
    for (const months of [0, -1, 120.01, NaN, Infinity, -Infinity]) {
      const graph = { ...base, nodes: base.nodes.map((n) => n.kind === 'goal'
        ? { ...n, goal_target_basis: { ...(n.goal_target_basis as object), period_months: months } } : n) };
      expect(riskOccurrenceWindowMonths(graph)).toBeUndefined();
      const parsed = GraphV3.parse(graph);
      expect(parsed.nodes.find((n) => n.kind === 'goal')?.goal_target_basis).toBeUndefined();
      expect(riskOccurrenceWindowMonths(parsed)).toBeUndefined();
    }
  });

  it('round 4 row 1: a person’s 30% over Olumi’s 12-month window is held unchanged beside Olumi’s own 30%', () => {
    const model = supplier(6);
    model.risks[0]!.horizon_months = 12;
    model.risks[0]!.occurrence = { estimate_by: 'olumi', low: 0.3, high: 0.3 };
    model.risks.push({ ...model.risks[0]!, id: 'person_risk', source: 'user', horizon_by: 'olumi',
      quote: 'Revenue was 2m; this risk feels more like 30%.', occurrence: { estimate_by: null, low: 0.3, high: 0.3 } });
    const before = structuredClone(model);
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    expect(blockOf(mapped, 'person_risk')).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'person_risk', reason: 'risk_window_not_goal_window' });
    expect(mapped.assumed.filter((a) => a.id === 'person_risk')).toEqual([]);
    expect(LivingModel.parse(graph.living_model).risks.find((r) => r.id === 'person_risk')!.occurrence).toEqual({ estimate_by: null, low: 0.3, high: 0.3 });
    expect(blockOf(mapped)!.occurrence.p_low).toBeCloseTo(1 - 0.7 ** 0.5, 12);
    expect(blockOf(mapped)!.occurrence.p_high).toBeCloseTo(1 - 0.7 ** 0.5, 12);
    expect(blockOf(mapped)!.horizon.months).toBe(6);
    expect(graph.nodes.find((n) => n.id === 'supplier_fails')!.event_risk).toEqual(blockOf(mapped));
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
    expect(model).toEqual(before);
  });

  it('round 4 row 2: scalar mitigation contract holds the 0.9 / 70% / 12→6 risk and its switch', () => {
    const model = supplier(6, true);
    model.risks[0]!.horizon_months = 12;
    model.risks[0]!.occurrence = { estimate_by: 'olumi', low: 0.9, high: 0.9 };
    const before = structuredClone(model);
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    expect(blockOf(mapped)).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
    expect(mapped.withheld).toContainEqual({ id: 'dual_sourcing', reason: 'risk_window_not_goal_window' });
    expect(graph.nodes.some((n) => n.id === 'supplier_fails' || n.id === 'dual_sourcing')).toBe(false);
    expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
    expect(model).toEqual(before);
  });

  it('round 4 row 3: certainty over 24 months cannot be converted to a 3-month certainty', () => {
    const model = supplier(3);
    model.risks[0]!.horizon_months = 24;
    model.risks[0]!.occurrence = { estimate_by: 'olumi', low: 1, high: 1 };
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    expect(blockOf(mapped)).toBeUndefined();
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
    expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
    expect(graph.nodes.some((n) => n.id === 'supplier_fails')).toBe(false);
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
  });

  it('round 4 row 4: a 0.69-month goal names exact decimal months in all three strings', () => {
    const model = supplier(0.69);
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    const basis = goalTargetBasisOf(goal)!;
    expect(periodWords(basis)).toBe('at 0.69 months');
    expect(periodEndWords(basis)).toBe('month 0.69');
    const ask = timingAskOf(graph, goal.id)!.words;
    expect(ask).toContain('fully in place by month 0.69 from today');
    for (const words of [periodWords(basis), periodEndWords(basis), ask]) expect(words).not.toContain('undefined');
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
  });

  it('round 4 row 5: a held 158-month deadline admits the saved Olumi risk over 158 months', () => {
    const model = supplier(1, true);
    const mapped = mapLivingModel(model);
    // Existing saved risk and the approved deadline use the held horizon carrier, not the capped target-reading period.
    const goal = mapped.graph.nodes.find((n) => n.kind === 'goal')!;
    delete goal.goal_target_basis;
    blockOf(mapped)!.horizon.months = 158;
    const out = applyGoalHorizonEdit(mapped.graph, { goal_id: model.aims[0]!.id, expected_deadline: null,
      reference_date: '2026-10-22', deadline: '2040-01-01' });
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error(out.kind);
    const graph = projectCorePostimageForPersistence(GraphV3.parse(out.mutatedGraph));
    expect(riskOccurrenceWindowMonths(graph)).toBe(158);
    expect(graph.nodes.find((n) => n.id === 'supplier_fails')!.event_risk).toEqual(blockOf(mapped));
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.safeToAnalyse).toBe(true);
  });

  it.each([12, 6])('round 5: a held mitigated risk leaves the goal period readable for a port risk over %s months', (months) => {
    const model = structuredClone(withWindow(OLUMI_CHANCE, 6));
    model.risks.push({ ...model.risks[0]!, id: 'port', label: 'Port disruption', horizon_months: months, mitigations: [] });
    model.links.push({ ...model.links[0]!, id: 'port_gp', from: 'port' });
    const before = structuredClone(model);
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    const goal = graph.nodes.find((n) => n.kind === 'goal')!;
    assertTargetHeld(graph, 'gp', model.aims[0]!.target!.value!);
    expect(goalTargetBasisOf(goal)).toMatchObject({ period_months: 6 });
    expect(goal.goal_target_basis?.period_months).toBe(6);
    expect(riskOccurrenceWindowMonths(graph)).toBe(6);
    expect(mapped.withheld).toContainEqual({ id: 'gp', reason: 'chance_rests_on_withheld' });
    expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
    expect(graph.nodes.some((n) => n.id === 'supplier_fails' || n.id === 'dual_sourcing')).toBe(false);
    const block = graph.nodes.find((n) => n.id === 'port')!.event_risk!;
    expect(block.horizon.months).toBe(6);
    expect(block.occurrence.p_low).toBeCloseTo(1 - 0.95 ** (6 / months), 12);
    expect(block.occurrence.p_high).toBeCloseTo(1 - 0.85 ** (6 / months), 12);
    expect(mapped.assumed.filter((a) => a.id === 'port')).toEqual(months === 6 ? []
      : [{ id: 'port', text: "converted from Olumi's 12-month estimate, assuming an even rate" }]);
    const readiness = assessCanonicalAnalysisReadiness(graph);
    expect(readiness.blockingIssues).toEqual([]);
    expect(readiness.safeToAnalyse).toBe(true);
    expect(model).toEqual(before);
  });

  it('round 5 contrast: an adjacent risk window never supplies a missing goal period', () => {
    const model = structuredClone(withWindow(OLUMI_CHANCE, null));
    model.risks.push({ ...model.risks[0]!, id: 'port', label: 'Port disruption', horizon_months: 6, mitigations: [] });
    model.links.push({ ...model.links[0]!, id: 'port_gp', from: 'port' });
    const mapped = mapLivingModel(model);
    const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: model }));
    expect(riskOccurrenceWindowMonths(graph)).toBeUndefined();
    for (const id of ['supplier_fails', 'port']) {
      expect(graph.nodes.some((n) => n.id === id)).toBe(false);
      expect(mapped.withheld).toContainEqual({ id, reason: 'risk_window_not_goal_window' });
    }
    expect(mapped.assumed.filter((a) => ['supplier_fails', 'port'].includes(a.id))).toEqual([]);
    expect(assessCanonicalAnalysisReadiness(graph).safeToAnalyse).toBe(true);
  });

  it('round 5: zero over one month cannot imply impossibility over twelve; a zero lower bound still converts', () => {
    for (const high of [0, 0.15]) {
      const model = supplier(12);
      model.risks[0]!.occurrence = { estimate_by: 'olumi', low: 0, high };
      const mapped = mapLivingModel(model);
      if (high === 0) {
        expect(blockOf(mapped)).toBeUndefined();
        expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_window_not_goal_window' });
        expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
      } else {
        expect(blockOf(mapped)!.occurrence.p_low).toBe(0);
        expect(blockOf(mapped)!.occurrence.p_high).toBeCloseTo(1 - 0.85 ** 12, 12);
        expect(blockOf(mapped)!.horizon.months).toBe(12);
      }
    }
  });

  it('round 5: fractional period words have at most two decimal places without trailing zeros', () => {
    for (const [months, printed] of [[1 / 3, '0.33'], [0.69, '0.69'], [1.5, '1.5']] as const) {
      const mapped = mapLivingModel(supplier(months));
      const graph = projectCorePostimageForPersistence(GraphV3.parse({ ...mapped.graph, living_model: supplier(months) }));
      const goal = graph.nodes.find((n) => n.kind === 'goal')!;
      const basis = goalTargetBasisOf(goal)!;
      expect(periodWords(basis)).toBe(`at ${printed} months`);
      expect(periodEndWords(basis)).toBe(`month ${printed}`);
      expect(timingAskOf(graph, goal.id)!.words).toContain(`fully in place by month ${printed} from today`);
    }
  });

  it('invalid source probabilities and horizons are refused, never repaired by conversion', () => {
    for (const patch of [
      { occurrence: { estimate_by: null, low: -0.1, high: 0.9 } },
      { occurrence: { estimate_by: null, low: 0.9, high: 0.1 } },
      { occurrence: { estimate_by: null, low: 0.1, high: 1.1 } },
      { horizon_months: 0 }, { horizon_months: -1 }, { horizon_months: 601 },
    ]) {
      const model = supplier(0.69);
      Object.assign(model.risks[0]!, patch);
      const mapped = mapLivingModel(model);
      expect(blockOf(mapped)).toBeUndefined();
      expect(mapped.withheld).toContainEqual({ id: 'supplier_fails', reason: 'risk_not_in_slice' });
      expect(mapped.assumed.filter((a) => a.id === 'supplier_fails')).toEqual([]);
    }
  });
});
