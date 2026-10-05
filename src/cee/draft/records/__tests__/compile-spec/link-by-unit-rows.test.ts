/**
 * FIX (b) ROWS: the deterministic linking pass by unit (`link-by-unit.ts`), through the real compile.
 * EXTRACTION-UNPROVEN: authored records prove compilation only (the delivery-vans evidence of `vnext-rows.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromRecords } from '../../../../../orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { projectDraftRecords } from '../../seam.js';
import { linkByUnit, unitIsDimensioned } from '../../link-by-unit.js';
import { targetTestabilityOf } from '../../../../../orchestrator-v5/admission/target-testability.js';
import { resolveAnalysisAdmission } from '../../../../../orchestrator-v5/admission/analysis-admission.js';
import { projectGraphForPersistence } from '../../../../../orchestrator-v5/persisted-graph-projection.js';
import { sealedRecordsVNext, BRIEF } from './sealed-fixture-vnext.js';
import type { DraftRecordSet } from '../../grammar.js';

const VANS = 'We have 8 vans. We make 640 deliveries every month. Lease 5 vans. Adding 5 vans changes deliveries by 18 to 36 every month. Repainting 5 vans will not change deliveries. Goal: at least 900 deliveries every month within 7 months. Last year we made 600 deliveries every month.';
const GOAL = 3;
function vans(): DraftRecordSet { return { stated_items: [
  {kind:'figure',source_quote:'We have 8 vans.',quantity:0,value:8,value_literal:'8',unit:'vans',unit_literals:['vans'],role:'baseline'},
  {kind:'figure',source_quote:'We make 640 deliveries every month.',quantity:1,value:640,value_literal:'640',unit:'deliveries/month',unit_literals:['deliveries','every month'],role:'baseline'},
  {kind:'option',source_quote:'Lease 5 vans.',quantity:0,value:5,value_literal:'5',is_baseline:false},
  {kind:'goal',source_quote:'Goal: at least 900 deliveries every month within 7 months.',quantity:1,role:'target',value:900,value_literal:'900',direction:'floor',direction_literal:'at least',baseline_ref:1,horizon_ref:4,horizon_months:7},
  {kind:'figure',source_quote:'within 7 months',value:7,value_literal:'7',unit:'months',unit_literals:['months']},
  {kind:'cause',source_quote:'Adding 5 vans changes deliveries by 18 to 36 every month.',relationship:{from_quantity:0,to_quantity:1,per_source_change:5,per_source_literal:'5',range:{low:18,high:36,low_literal:'18',high_literal:'36'}}},
 ], claims:[{claim_kind:'factor',label:'Vans',quantity:0,value:8},{claim_kind:'causal_link',label:'lease setting',from_stated:2,to_claim:0,effect:'positive'}] }; }
const LAST_YEAR = {kind:'figure' as const,source_quote:'Last year we made 600 deliveries every month.',value:600,value_literal:'600',unit:'deliveries/month',unit_literals:['deliveries','every month'],role:'baseline' as const};

async function build(records: DraftRecordSet, brief = VANS) {
  let body: any;
  const result: any = await buildModelFromRecords('11111111-1111-4111-8111-111111111111', brief,
    async (path, b) => { if (path.endsWith('/register')) { body = b; return { status: 200, json: { model_version: 1 } }; } return { status: 200, json: { graph: { nodes: [], edges: [] } } }; },
    async () => ({ text: JSON.stringify(records), status: 'completed' }));
  expect(result.ok).toBe(true);
  const goal = body.graph.nodes.find((n: any) => n.kind === 'goal');
  const receipt = (i: number) => body.stated_dispositions.find((d: any) => d.stated_index === i);
  return { result, body, goal, receipt, questions: (result.open_questions ?? []) as string[] };
}
const asks = (records: DraftRecordSet, brief = VANS) => {
  const r = projectDraftRecords(records, brief); if (!r.ok) throw new Error(r.detail);
  return r.projection.dropped.filter(d => d.claim_kind === 'stated_item').map(d => `${d.stated_index}:${d.reason}`);
};

describe('FIX (b) the linking pass by unit: one dimensioned same-unit candidate binds', () => {
  it('B1 goal.baseline_ref null binds the ONE baseline figure sameUnit with the goal; the figure is carried as its baseline', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.baseline_ref;
    const { goal, receipt } = await build(r);
    expect(goal.observed_state).toMatchObject({ raw_value: 640, unit: 'deliveries/month' });
    expect(receipt(1)).toMatchObject({ disposition: 'carried', location: { node_id: goal.id, path: ['observed_state', 'raw_value'] } });
    expect(linkByUnit(r).bindings).toEqual([{ stated_index: GOAL, field: 'baseline_ref', bound_to: 1, bound_by: 'unit_unique' }]);
  });
  it('B2 goal.unit null with a resolved baseline_ref inherits the baseline figure unit (a typed reference), so the target binds', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.quantity;
    const { goal, receipt } = await build(r);
    expect(goal.goal_threshold_raw).toBe(900);
    expect(goal.goal_threshold_unit).toBe('deliveries/month');
    expect(goal.observed_state).toMatchObject({ raw_value: 640 });
    expect(receipt(GOAL)).toMatchObject({ disposition: 'carried', location: { path: ['goal_threshold_raw'] } });
  });
  it('B3 goal unit AND quantity null: the goal own value_literal currency reading selects the ONE same-unit baseline, then the unit is inherited', () => {
    const brief = 'Revenue is £120,000 today. Goal: reach £150,000 within 9 months.';
    const r: DraftRecordSet = { stated_items: [
      { kind: 'figure', source_quote: 'Revenue is £120,000 today.', value: 120000, value_literal: '£120,000', unit: 'GBP', role: 'baseline' },
      { kind: 'goal', source_quote: 'Goal: reach £150,000 within 9 months.', value: 150000, value_literal: '£150,000', role: 'target', direction: 'floor' },
    ], claims: [] };
    const linked = linkByUnit(r);
    expect(linked.bindings).toEqual([
      { stated_index: 1, field: 'baseline_ref', bound_to: 0, bound_by: 'unit_unique' },
      { stated_index: 1, field: 'unit', bound_to: 'GBP', bound_by: 'unit_unique' }]);
    const p = projectDraftRecords(r, brief); if (!p.ok) throw new Error(p.detail);
    const goal = p.projection.graph.nodes.find(n => n.kind === 'goal')!;
    expect(goal.goal_threshold_raw).toBe(150000);
    expect(goal.goal_baseline_raw).toBe(120000);
  });
  it('B4 figure.quantity null on a role-baseline figure binds to the ONE declared quantity sameUnit with it (no goal shares its unit)', () => {
    const r = vans(); r.stated_items.push({ kind: 'figure', source_quote: 'Last year we made 600 deliveries every month.', value: 8, value_literal: '8', unit: 'vans', role: 'baseline' });
    const linked = linkByUnit(r);
    expect(linked.bindings).toEqual([{ stated_index: 6, field: 'quantity', bound_to: 0, bound_by: 'unit_unique' }]);
    expect(linked.records.stated_items[6]!.quantity).toBe(0);
    expect(linked.asks.filter(a => a.stated_index === 6)).toEqual([]);
  });
});

describe('FIX (b) zero or several candidates is a TYPED ASK (receipt row + open question), never a guess', () => {
  it('A1 two same-unit baseline figures: no bind; the goal and both candidates are asked', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.baseline_ref; r.stated_items.push(LAST_YEAR);
    const { goal, receipt, questions } = await build(r);
    expect(goal.observed_state?.raw_value).toBeUndefined();
    expect(receipt(6)).toMatchObject({ disposition: 'asked' });
    expect(questions.filter(q => q.includes(r.stated_items[6]!.source_quote) && q.includes("today's level of the goal"))).toHaveLength(1);
    expect(questions.filter(q => q.includes(r.stated_items[GOAL]!.source_quote) && q.includes("today's level of this goal"))).toHaveLength(1);
    expect(asks(r)).toEqual(expect.arrayContaining([`${GOAL}:goal_baseline_unlinked`, '1:goal_baseline_candidate_ambiguous', '6:goal_baseline_candidate_ambiguous']));
  });
  it('A2 zero candidates (no role-baseline figure in the goal unit): no bind; the goal is asked', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.baseline_ref; r.stated_items[1]!.role = 'context';
    const { goal, questions } = await build(r);
    expect(goal.observed_state?.raw_value).toBeUndefined();
    expect(questions.filter(q => q.includes(r.stated_items[GOAL]!.source_quote) && q.includes("today's level of this goal"))).toHaveLength(1);
    expect(linkByUnit(r).bindings).toEqual([]);
  });
  it('A3 a DIFFERENT-unit candidate never binds (deliveries/week vs the goal deliveries/month)', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.baseline_ref; delete r.stated_items[GOAL]!.quantity;
    r.stated_items[GOAL]!.unit = 'deliveries/week';
    const { goal, questions } = await build(r);
    expect(goal.observed_state?.raw_value).toBeUndefined();
    expect(questions.some(q => q.includes(r.stated_items[GOAL]!.source_quote) && q.includes("today's level of this goal"))).toBe(true);
    expect(linkByUnit(r).bindings).toEqual([]);
  });
  it('A4 a role-baseline figure with no quantity identity and no same-unit quantity is asked, never bound', async () => {
    const r = vans(); r.stated_items.push({ ...LAST_YEAR, unit: 'drivers', unit_literals: undefined, value_literal: '600' });
    const { receipt, questions } = await build(r);
    expect(receipt(6)).toMatchObject({ disposition: 'asked' });
    expect(questions.some(q => q.includes(LAST_YEAR.source_quote) && q.includes('which quantity'))).toBe(true);
  });
});

describe('FIX (b) SCIENCE GUARD 1: never bind on a generic unit', () => {
  const brief = 'Churn is 5% today. Margin is 20% today. Goal: churn at most 3% within 6 months.';
  const churn = (withMargin: boolean): DraftRecordSet => ({ stated_items: [
    { kind: 'figure', source_quote: 'Churn is 5% today.', value: 5, value_literal: '5%', unit: '%', role: 'baseline' },
    ...(withMargin ? [{ kind: 'figure' as const, source_quote: 'Margin is 20% today.', value: 20, value_literal: '20%', unit: '%', role: 'baseline' as const }] : []),
    { kind: 'goal', source_quote: 'Goal: churn at most 3% within 6 months.', value: 3, value_literal: '3%', unit: '%', role: 'target', direction: 'ceiling' },
  ], claims: [] });
  it('G1a ONE % candidate (exactly one!) is still an ask: a % is shared by unrelated quantities', () => {
    const r = churn(false); const linked = linkByUnit(r);
    expect(linked.bindings).toEqual([]);
    // Two refused binds: the goal's baseline_ref (one % figure) and that figure's quantity (one % goal).
    expect(linked.generic_unit_refusals).toBe(2);
    expect(asks(r, brief)).toEqual(expect.arrayContaining(['1:goal_baseline_unlinked', '0:figure_quantity_unlinked']));
  });
  it('G1b one % quantity plus an unmodelled % figure: an ask, never a bind', () => {
    const r = churn(true); const linked = linkByUnit(r);
    expect(linked.bindings).toEqual([]);
    expect(asks(r, brief)).toEqual(expect.arrayContaining(['2:goal_baseline_unlinked', '0:goal_baseline_candidate_ambiguous', '1:goal_baseline_candidate_ambiguous']));
  });
  it('G1c the dimension rule: currency, time, mass and named count nouns bind; %, ratio, bare count and "units" never', () => {
    expect(['£/month', 'GBP', 'months', 'kg', 'developers', 'deliveries/month'].map(unitIsDimensioned)).toEqual([true, true, true, true, true, true]);
    expect(['%', 'percent', 'percentage points', 'ratio', 'count', 'units', 'x', '', undefined].map(unitIsDimensioned)).toEqual([false, false, false, false, false, false, false, false, false]);
  });
});

describe('FIX (b) SCIENCE GUARD 2 and the cause rule: never derived, always asked', () => {
  it('D1 goal.direction null is NEVER derived: no goal_direction is stored, and the goal is asked', async () => {
    const r = vans(); delete r.stated_items[GOAL]!.direction; delete r.stated_items[GOAL]!.direction_literal;
    const { goal, receipt, questions } = await build(r);
    expect(goal.goal_direction).toBeUndefined();
    expect(receipt(GOAL)).toMatchObject({ disposition: 'carried' });
    expect(questions.some(q => q.includes(r.stated_items[GOAL]!.source_quote) && q.includes('reach or exceed'))).toBe(true);
  });
  it('D2 MEASURE: a null direction does not move testability or admission on the sealed ideal fixture (so it is an ask, not a blocker)', async () => {
    const verdict = (g: any) => JSON.stringify([targetTestabilityOf(g), resolveAnalysisAdmission(g).permitted_analysis_mode]);
    const stored = async (rec: DraftRecordSet) => { const { body } = await build(rec, BRIEF);
      return projectGraphForPersistence(body.graph, { scenarioId: '11111111-1111-4111-8111-111111111111', turnClass: 'direct_answer', source: 'graph_registration' }); };
    const ideal = sealedRecordsVNext(); const bare = sealedRecordsVNext();
    const goalIndex = bare.stated_items.findIndex(i => i.kind === 'goal');
    delete bare.stated_items[goalIndex]!.direction; delete bare.stated_items[goalIndex]!.direction_literal;
    const a = await stored(ideal); const b = await stored(bare);
    expect((b as any).nodes.find((n: any) => n.kind === 'goal').goal_direction).toBeUndefined();
    expect(verdict(b)).toBe(verdict(a));
  });
  it('C1 cause.relationship null stays UNSIZED and is asked by its own quote; no size is invented', async () => {
    const r = vans(); r.stated_items.push({ kind: 'cause', source_quote: 'Repainting 5 vans will not change deliveries.' });
    const { body, questions } = await build(r);
    expect(questions.some(q => q.includes('Repainting 5 vans will not change deliveries.') && q.includes('how large'))).toBe(true);
    expect(body.graph.edges.filter((e: any) => e.provenance?.source_quote === 'Repainting 5 vans will not change deliveries.')).toEqual([]);
    expect(asks(r)).toContain('6:cause_relationship_unstated');
  });
});

describe('FIX (b) the sealed ideal fixture is unchanged', () => {
  it('I1 every link present: no binding, no ask, and the record set is returned as the same object', () => {
    const ideal = sealedRecordsVNext(); const linked = linkByUnit(ideal);
    expect(linked.bindings).toEqual([]); expect(linked.asks).toEqual([]); expect(linked.records).toBe(ideal);
  });
});
