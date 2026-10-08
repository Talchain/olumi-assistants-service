/**
 * ⭐ A2 FOLLOW-UP (DL verdict on #2180): AN OPTION THAT SETS THE LIMITED QUANTITY AT EXACTLY A STRICT LIMIT'S THRESHOLD
 * DOES NOT MEET IT, AND IS NEVER SAID TO.
 *
 * "Keep churn under 10%" is stored `operator: "<="` + `operator_as_stated: "<"`; PLoT/ISL get "<=" only. Over continuous
 * draws P(X < 10) = P(X <= 10), so the engine's score is the stated limit's — except for an option that PINS churn at
 * exactly 10%, which the engine counts as meeting "<= 10" and the user's words do not. The one owner of "does option X
 * meet limit L" (`deriveConstraintVerdict`) withholds that option's result for that limit, so the leader is not named on
 * it and the limit's per-limit row is not `scored`.
 *
 * The original 10% rows use the VERBATIM C50 U2 capture (`gc_u2` "<= 10 %", certified `decision_grade: true`, P 0.9985 on both
 * options, `opt_raise` leads), run through the REAL `run_analysis` handler. The only thing that differs between the rows
 * is the stored row's `operator_as_stated` and the level an option sets on churn. Rows bind by `constraint_id` and
 * option id.
 * Paul's 4% rows reuse that response shape to exercise CEE's real handler and guard. The outside control explicitly
 * supplies a synthetic producer score of zero; it proves CEE preserves the producer's refusal, not a new engine run.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { carryLevelLimitBaselines, strictLimitsPinnedAtThreshold } from '../level-limit-baseline.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const U2 = readFileSync('tests/fixtures/cross-service/c50-level-demo/U2.plot-response.json', 'utf8');
const SCENARIO_ID = 'a2f0a2f0-a2f0-4a2f-8a2f-a2f0a2f0a2f0';
const REQUEST_ID = 'req-strict-limit-pinned';
const LIMIT_ID = 'gc_u2';
/** The captured limit ("<= 10 %"), as the user said it: UNDER 10%. */
const strictRow: Rec = {
  constraint_id: LIMIT_ID, node_id: 'fac_churn', operator: '<=', operator_as_stated: '<', value: 10, unit: '%',
  value_frame: 'level', label: 'Monthly churn', provenance: 'explicit',
};
const { operator_as_stated: _strict, ...atMostRow } = strictRow;

type Pin = { readonly option: 'opt_raise' | 'opt_hold'; readonly level: number };

function graphWith(row: Rec, pin: Pin | undefined, today = 0.04): Rec {
  // The pin is the USER's figure (`user_specified`), so rule (d) — a leader setting the target at Olumi's estimate —
  // never fires here: the only question left is the threshold.
  const churnOn = (option: Pin['option']) =>
    pin?.option === option ? { fac_churn: { value: pin.level, raw_value: pin.level * 100, source: 'user_specified' } } : {};
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      // The user's own current churn (4%), framed on 100: PLoT reads "10 %" on this node's level (0.10).
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: today, raw_value: today * 100, cap: 100, unit: '%', source: 'brief_extraction' } },
      { id: 'opt_hold', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.49, source: 'user_specified' }, ...churnOn('opt_hold') } },
      { id: 'opt_raise', kind: 'option', label: '£59 with win-back', interventions: { fac_price: { value: 0.59, source: 'user_specified' }, ...churnOn('opt_raise') } },
    ],
    edges: [
      { from: 'fac_price', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      // Sized in churn's unit BY THE USER, so neither R-c (AI Quality 5882087383) nor B6 (AIQ 5916187873: an Olumi size is
      // its guess) touches this row's subject, the strict pin.
      { from: 'fac_price', to: 'fac_churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive', provenance: { source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 1, amount_unit: 'percentage points', per_source_change: 10, per_source_change_unit: 'GBP per month', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } },
      { from: 'fac_churn', to: 'goal', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
    goal_constraints: [row],
  };
}

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID, signal: new AbortController().signal, orientationText: '',
  } as HandlerInvocation;
}

interface Outcome {
  readonly state: unknown;
  readonly mayName: unknown;
  readonly perLimit: unknown;
  readonly joint: unknown;
  readonly summary: string;
  readonly wireLimit: Rec | undefined;
  readonly wireChurn: Record<string, unknown>;
  readonly wireBaseline: unknown;
  readonly wireEdges: ReadonlyArray<Rec>;
  readonly todayWithinLimit: unknown;
  readonly replyFacts: ReadonlyArray<Rec>;
}

interface CurrentFrame {
  readonly priceMovesChurn?: boolean;
  readonly baseline?: number;
  readonly decoyToday?: number;
  readonly unchangedParent?: boolean;
  readonly priceChurnExistence?: number;
  readonly priceChurnRange?: boolean;
  readonly churnUnit?: string;
}

/** The PLoT request `run_analysis` sends for `rows` (one option may pin churn), and the verdict it persists. */
async function plotLimit(rows: Rec[], pin?: Pin, today = 0.04, producerProbability?: number, frame: CurrentFrame = {}): Promise<Outcome> {
  const goal_constraints = rows.map((r) => JSON.parse(JSON.stringify(r)) as Rec);
  const graph: Rec = { ...graphWith(rows[0]!, pin, today), goal_constraints };
  if (frame.priceMovesChurn === false) graph.edges = (graph.edges as Rec[]).filter((e) => !(e.from === 'fac_price' && e.to === 'fac_churn'));
  if (frame.priceChurnExistence !== undefined) {
    graph.edges = (graph.edges as Rec[]).map((e) => e.from === 'fac_price' && e.to === 'fac_churn'
      ? { ...e, exists_probability: frame.priceChurnExistence } : e);
  }
  if (frame.priceChurnRange === true) {
    graph.edges = (graph.edges as Rec[]).map((e) => {
      if (e.from !== 'fac_price' || e.to !== 'fac_churn') return e;
      const provenance = e.provenance as Rec;
      return { ...e, provenance: { ...provenance, natural_effect: {
        ...(provenance.natural_effect as Rec), stated_range: { low: 0.5, high: 1.5, text: '0.5 to 1.5', end: 'centre' },
      } } };
    });
  }
  if (frame.unchangedParent === true) {
    (graph.nodes as Rec[]).push({ id: 'fac_experience', kind: 'factor', label: 'Customer experience' });
    (graph.edges as Rec[]).push({ from: 'fac_experience', to: 'fac_churn', strength: { mean: -0.2, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' });
  }
  if (frame.churnUnit !== undefined) {
    const node = (graph.nodes as Rec[]).find((n) => n.id === 'fac_churn')!;
    node.observed_state = { ...(node.observed_state as Rec), unit: frame.churnUnit };
  }
  if (frame.baseline !== undefined) {
    const node = (graph.nodes as Rec[]).find((n) => n.id === 'fac_churn')!;
    node.observed_state = { ...(node.observed_state as Rec), baseline: frame.baseline };
  }
  if (frame.decoyToday !== undefined) {
    (graph.nodes as Rec[]).push({
      id: 'fac_churn_decoy', kind: 'factor', label: 'Monthly churn',
      observed_state: { value: frame.decoyToday, raw_value: frame.decoyToday * 100, cap: 100, unit: '%', source: 'brief_extraction' },
    });
  }
  const before = JSON.stringify(goal_constraints);
  // The reply and analysis read this exact graph and these same stored rows, before any wire projection.
  const dispatch: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'strict-limit-parity' } });
  const modelView = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
    scenario_id: SCENARIO_ID, authenticated_user_id: null, request_id: REQUEST_ID,
  });
  if (!Array.isArray(modelView.limits)) throw new Error('the Agent model view did not carry limits');
  const replyLimits = modelView.limits.filter((limit): limit is Rec => typeof limit === 'object' && limit !== null && !Array.isArray(limit));
  const limitedNode = (graph.nodes as Rec[]).find((node) => node.id === rows[0]?.node_id);
  expect(limitedNode).toMatchObject({ id: 'fac_churn', label: 'Monthly churn' });
  const replyLimit = replyLimits.find((limit) => limit.node_id === rows[0]?.node_id && limit.constraint_id === rows[0]?.constraint_id);
  expect(replyLimit, `reply row for ${String(rows[0]?.constraint_id)} on ${String(rows[0]?.node_id)}`).toBeDefined();
  const replyFacts = rows.map((row) => {
    const fact = replyLimits.find((limit) => limit.node_id === row.node_id && limit.constraint_id === row.constraint_id);
    expect(fact, `reply row for ${String(row.constraint_id)} on ${String(row.node_id)}`).toBeDefined();
    return fact!;
  });
  const wireLevels = (option: Pin['option']) => (pin?.option === option ? { fac_churn: pin.level } : {});
  const snapshot = {
    graph,
    options: [
      { id: 'opt_hold', option_id: 'opt_hold', label: 'Keep £49', interventions: { fac_price: 0.49, ...wireLevels('opt_hold') } },
      { id: 'opt_raise', option_id: 'opt_raise', label: '£59 with win-back', interventions: { fac_price: 0.59, ...wireLevels('opt_raise') } },
    ],
    goal_node_id: 'goal',
    goal_constraints,
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let sent: Rec | undefined;
  const run = vi.fn((payload: Rec) => {
    sent = payload;
    const response = JSON.parse(U2) as Rec;
    if (producerProbability !== undefined) {
      response.option_comparison = (response.option_comparison as Rec[]).map((o) => ({
        ...o, constraint_probabilities: { [LIMIT_ID]: producerProbability }, probability_of_joint_goal: producerProbability,
      }));
      response.constraint_results = (response.constraint_results as Rec[]).map((c) => ({
        ...c, probability: producerProbability, value: rows[0]?.value,
      }));
    }
    return Promise.resolve(response as unknown as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation());
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.stringify(goal_constraints), 'the stored rows are never touched').toBe(before);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const v = fact.result.constraint_verdict as Rec | undefined;
  if (v === undefined) throw new Error('no constraint_verdict on the fact');
  const wireOptions = (sent?.options as Rec[] | undefined) ?? [];
  const wireChurn = Object.fromEntries(wireOptions.map((o) => [String(o.option_id ?? o.id), ((o.interventions ?? {}) as Rec).fac_churn]));
  const wireNodes = ((sent?.graph as Rec | undefined)?.nodes as Rec[] | undefined) ?? [];
  const wireBaseline = (wireNodes.find((n) => n.id === 'fac_churn')?.observed_state as Rec | undefined)?.baseline;
  return {
    state: v.constraint_verdict_state,
    mayName: v.may_name_leading_option,
    perLimit: v.per_limit,
    joint: v.joint,
    summary: String(fact.result.summary ?? ''),
    wireLimit: ((sent?.goal_constraints as Rec[] | undefined) ?? []).find((c) => c.constraint_id === LIMIT_ID),
    wireChurn,
    wireBaseline,
    wireEdges: ((sent?.graph as Rec | undefined)?.edges as Rec[] | undefined) ?? [],
    todayWithinLimit: replyLimit?.today_within_limit,
    replyFacts,
  };
}

const SCORED = [{ constraint_id: LIMIT_ID, state: 'scored' }];
const WITHHELD_FOR_THE_PIN = [{ constraint_id: LIMIT_ID, state: 'unscored', reason: 'level_set_at_strict_threshold' }];

describe('Paul\'s exact limit: keeping monthly churn UNDER 4%', () => {
  const underFour = { ...strictRow, value: 4, label: 'keeping monthly churn UNDER 4%' };
  const atMostFour = { ...atMostRow, value: 4, label: 'at most 4%' };

  it('R3 NO-PATH: carry-on and a price option with no directed path to churn inherit today\'s 4% strict tie', async () => {
    const r = await plotLimit([underFour], undefined, 0.04, undefined, { priceMovesChurn: false });
    expect(r.todayWithinLimit, 'R2: the reply uses the same graph as this R3 analysis').toBe('at_threshold');
    expect(r.wireLimit).toMatchObject({ constraint_id: LIMIT_ID, operator: '<=', value: 4, unit: '%' });
    expect(r.wireLimit).not.toHaveProperty('operator_as_stated');
    expect(r.wireChurn).toEqual({ opt_hold: undefined, opt_raise: undefined });
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'unevaluated', mayName: false });
    expect(r.perLimit).toEqual(WITHHELD_FOR_THE_PIN);
    expect(r.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [LIMIT_ID] });
    expect(r.summary).not.toMatch(/Raise to 59 was supported by/);
  });

  it('R3 CAUSAL-PATH RED: price-only options with a directed price→churn path preserve the producer\'s scored verdict', async () => {
    const r = await plotLimit([underFour]);
    expect(r.todayWithinLimit, 'the reply fact describes today, not the options').toBe('at_threshold');
    expect(r.wireChurn).toEqual({ opt_hold: undefined, opt_raise: undefined });
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
    expect(r.joint).toMatchObject({ state: 'scored' });
  });

  it('BASELINE RED: value 3.9%, preserved baseline 4% — reply and untouched-option analysis read the same strict tie', async () => {
    const r = await plotLimit([underFour], undefined, 0.039, undefined, { priceMovesChurn: false, unchangedParent: true, baseline: 0.04 });
    expect(r.wireBaseline, 'analysis preserves the existing fac_churn baseline').toBe(0.04);
    expect(r.todayWithinLimit, 'gc_u2 on fac_churn uses the effective analysis level').toBe('at_threshold');
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'unevaluated', mayName: false });
    expect(r.perLimit).toEqual(WITHHELD_FOR_THE_PIN);
  });

  it('BASELINE RED: value 4%, preserved baseline 3.9% — reply and untouched-option analysis keep the producer result', async () => {
    const r = await plotLimit([underFour], undefined, 0.04, undefined, { priceMovesChurn: false, unchangedParent: true, baseline: 0.039 });
    expect(r.wireBaseline, 'analysis preserves the existing fac_churn baseline').toBe(0.039);
    expect(r.todayWithinLimit, 'gc_u2 on fac_churn uses the effective analysis level').toBe(true);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });

  it.each([
    [underFour, 0.041, 0.04, false, 'evaluated_infeasible', false, SCORED, 0],
    [atMostFour, 0.041, 0.04, false, 'evaluated_infeasible', false, SCORED, 0],
    [underFour, 0.04, 0.041, 'at_threshold', 'unevaluated', false, WITHHELD_FOR_THE_PIN, undefined],
    [atMostFour, 0.04, 0.041, true, 'evaluated_feasible', true, SCORED, undefined],
  ] as const)('ROOT RED: %s at current %s with stale baseline %s reads the root value', async (row, today, baseline, replyFact, state, mayName, perLimit, probability) => {
    const r = await plotLimit([row], undefined, today, probability, { priceMovesChurn: false, baseline });
    expect(r.wireBaseline, 'the stored baseline is preserved on the wire, but ISL reads this root at value').toBe(baseline);
    expect(r.replyFacts.find((fact) => fact.constraint_id === LIMIT_ID && fact.node_id === 'fac_churn'), 'identity-bound root reply fact').toMatchObject({ today_within_limit: replyFact });
    expect({ state: r.state, mayName: r.mayName }, 'root reply and untouched-option verdict use the engine-read current value').toEqual({ state, mayName });
    expect(r.perLimit).toEqual(perLimit);
  });

  it('EXISTENCE ZERO RED: an absent price→churn link does not exempt the price option from its unchanged strict tie', async () => {
    const r = await plotLimit([underFour], undefined, 0.04, undefined, { priceChurnExistence: 0, unchangedParent: true });
    expect(r.wireEdges.find((edge) => edge.from === 'fac_price' && edge.to === 'fac_churn'), 'the ordinary user-sized link is absent on the engine wire').toMatchObject({ exists_probability: 0 });
    expect(r.wireEdges.find((edge) => edge.from === 'fac_experience' && edge.to === 'fac_churn'), 'another unchanged parent keeps the limited node non-root').toMatchObject({ exists_probability: 1 });
    expect(r.wireBaseline).toBe(0.04);
    expect(r.todayWithinLimit).toBe('at_threshold');
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'unevaluated', mayName: false });
    expect(r.perLimit).toEqual(WITHHELD_FOR_THE_PIN);
  });

  it('EFFECTIVE EXISTENCE CONTROL: stored zero on a user-range-held price→churn link remains a path on the engine wire', async () => {
    const r = await plotLimit([underFour], undefined, 0.04, undefined, {
      priceChurnExistence: 0, priceChurnRange: true, unchangedParent: true,
    });
    expect(r.wireEdges.find((edge) => edge.from === 'fac_price' && edge.to === 'fac_churn'), 'the analysis hold takes effective existence to one').toMatchObject({ exists_probability: 1 });
    expect(r.todayWithinLimit).toBe('at_threshold');
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });

  it.each([strictRow, atMostRow])('PERIOD RED: relabelled annual limit %s has no monthly reply fact and restores the annual wire unit', async (base) => {
    const annual = { ...base, provenance_unit_relabelled: {
      rule: 'rule1-limit-period', pre_normalisation_value: 10, pre_normalisation_unit: '% per year',
    } };
    const r = await plotLimit([annual], undefined, 0.03, undefined, { priceMovesChurn: false, unchangedParent: true, churnUnit: '% per month' });
    expect(r.replyFacts.find((fact) => fact.constraint_id === LIMIT_ID && fact.node_id === 'fac_churn'), 'annual limit cannot establish a monthly today fact').not.toHaveProperty('today_within_limit');
    expect(r.wireLimit).toMatchObject({ constraint_id: LIMIT_ID, node_id: 'fac_churn', unit: '% per year' });
    expect(r.wireBaseline, 'annual-vs-monthly veto prevents carrying a monthly baseline').toBeUndefined();
  });

  it('IDENTITY DECOY: duplicate Monthly churn labels at <=4 each receive their own current-level fact', async () => {
    const decoy = { ...underFour, constraint_id: 'gc_decoy', node_id: 'fac_churn_decoy' };
    const r = await plotLimit([underFour, decoy], undefined, 0.04, undefined, { priceMovesChurn: false, decoyToday: 0.039 });
    expect(r.replyFacts.map((fact) => ({
      constraint_id: fact.constraint_id, node_id: fact.node_id, on: fact.on,
      operator: fact.operator, value: fact.value, today_within_limit: fact.today_within_limit,
    }))).toEqual([
      { constraint_id: LIMIT_ID, node_id: 'fac_churn', on: 'Monthly churn', operator: '<=', value: 4, today_within_limit: 'at_threshold' },
      { constraint_id: 'gc_decoy', node_id: 'fac_churn_decoy', on: 'Monthly churn', operator: '<=', value: 4, today_within_limit: true },
    ]);
  });

  it('R4 CONTROL: at most 4% at today\'s 4% remains met and scored', async () => {
    const r = await plotLimit([atMostFour]);
    expect(r.todayWithinLimit).toBe(true);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });

  it('R5 inside CONTROL: under 4% at today\'s 3.9% remains scored', async () => {
    const r = await plotLimit([underFour], undefined, 0.039);
    expect(r.todayWithinLimit).toBe(true);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });

  it('R5 outside CONTROL: under 4% at today\'s 4.1% preserves the producer\'s zero score as not met', async () => {
    const r = await plotLimit([underFour], undefined, 0.041, 0);
    expect(r.todayWithinLimit).toBe(false);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_infeasible', mayName: false });
    expect(r.perLimit).toEqual(SCORED);
  });
});

describe('the DL row — the leading option pins churn at EXACTLY a strict limit ("under 10%")', () => {
  it('PREMISE: PLoT receives the pin at 0.10 on the leader and "<=" only (the wire is unchanged: nothing is modelled)', async () => {
    const r = await plotLimit([strictRow], { option: 'opt_raise', level: 0.1 });
    expect(r.wireChurn).toEqual({ opt_hold: undefined, opt_raise: 0.1 });
    expect(r.wireLimit).toMatchObject({ operator: '<=', value: 10, unit: '%' });
    expect(r.wireLimit).not.toHaveProperty('operator_as_stated');
  });

  it('RED: the verdict does not claim the limit is met — the leader is withheld on it and the limit is not scored', async () => {
    const r = await plotLimit([strictRow], { option: 'opt_raise', level: 0.1 });
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'unevaluated', mayName: false });
    expect(r.perLimit).toEqual(WITHHELD_FOR_THE_PIN);
    expect(r.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [LIMIT_ID] });
  });

  it('RED: the narration does not name the pinned option as the leader', async () => {
    const r = await plotLimit([strictRow], { option: 'opt_raise', level: 0.1 });
    // The capture labels the leader "Raise to 59"; the headline names a leader as "<label> scored highest".
    expect(r.summary.length, 'control: a summary was written').toBeGreaterThan(0);
    expect(r.summary).not.toMatch(/Raise to 59/);
  });
});

describe('contrasts — unchanged', () => {
  it('CONTROL: the same pin under a NON-strict limit ("at most 10%") → met, as today (evaluated_feasible, scored, leader named)', async () => {
    const r = await plotLimit([atMostRow], { option: 'opt_raise', level: 0.1 });
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
    expect(r.summary).toMatch(/Raise to 59 was supported by/);
  });

  it('CONTROL: a strict limit with the option at 9.9% → unchanged (evaluated_feasible, scored)', async () => {
    const r = await plotLimit([strictRow], { option: 'opt_raise', level: 0.099 });
    expect(r.wireChurn.opt_raise, 'control: the 9.9% level reaches PLoT').toBe(0.099);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });

  it('CONTROL: a strict limit and no option sets churn → unchanged (evaluated_feasible, scored)', async () => {
    const r = await plotLimit([strictRow]);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
    expect(r.perLimit).toEqual(SCORED);
  });
});

describe('a NON-leading option pins it', () => {
  it('RED: the limit\'s row is not scored (it speaks for every option); the leader, which does not pin it, is still named', async () => {
    const r = await plotLimit([strictRow], { option: 'opt_hold', level: 0.1 });
    expect(r.perLimit).toEqual(WITHHELD_FOR_THE_PIN);
    expect({ state: r.state, mayName: r.mayName }).toEqual({ state: 'evaluated_feasible', mayName: true });
  });
});

describe('strictLimitsPinnedAtThreshold — the same frame, from the two proofs `level-limit-baseline.ts` owns', () => {
  const pctNode = { id: 'n', kind: 'factor', label: 'Churn', observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%', source: 'brief_extraction' } };
  const pctRow = (extra: Rec = {}): Rec => ({ constraint_id: 'c', node_id: 'n', operator: '<=', operator_as_stated: '<', value: 10, unit: '%', value_frame: 'level', ...extra });
  const opts = (level: number) => [{ option_id: 'o1', interventions: { n: level } }, { option_id: 'o2', interventions: {} }];
  const pinned = (graph: Rec, rows: Rec[], options: Rec[], goalNodeId?: string) =>
    Object.fromEntries([...strictLimitsPinnedAtThreshold(graph, rows, options, goalNodeId)].map(([o, ids]) => [o, [...ids]]));

  it('a "%" limit on a node framed on 100: 0.10 is "10 %" → pinned; 0.099 is not', () => {
    expect(pinned({ nodes: [pctNode] }, [pctRow()], opts(0.1))).toEqual({ o1: ['c'] });
    expect(pinned({ nodes: [pctNode] }, [pctRow()], opts(0.099))).toEqual({});
  });

  it('R3 TODAY RED: the same current value carried as the baseline is at under 4%\'s strict threshold', () => {
    const row = pctRow({ value: 4 });
    const current = { ...pctNode, observed_state: { ...pctNode.observed_state, source: 'brief_extraction' } };
    const graph = { nodes: [{ id: 'upstream', kind: 'factor' }, current], edges: [{ from: 'upstream', to: 'n' }] };
    const wire = carryLevelLimitBaselines(graph, [row]);
    expect(wire.nodes[1]).toMatchObject({ id: 'n', observed_state: { value: 0.04, raw_value: 4, baseline: 0.04 } });
    expect(pinned(graph, [row], [{ option_id: 'carry_on', interventions: {} }])).toEqual({ carry_on: ['c'] });
  });

  it.each([
    { name: 'constraint role', observed_state: { ...pctNode.observed_state, stated_role: 'constraint' } },
    { name: 'retained-excluded node', analysis_participation: 'retained_excluded' },
  ])('READER ONLY: $name keeps its carrier but supplies no inherited today tie', (extra) => {
    const node = { ...pctNode, ...extra };
    const row = pctRow({ value: 4 });
    const graph = { nodes: [{ id: 'upstream', kind: 'factor' }, node], edges: [{ from: 'upstream', to: 'n' }] };
    expect(carryLevelLimitBaselines(graph, [row]).nodes[1]).toMatchObject({ observed_state: { baseline: 0.04 } });
    expect(pinned(graph, [row], [{ option_id: 'carry_on', interventions: {} }])).toEqual({});
  });

  it.each(['bidirected', 'retained-excluded'] as const)('CARRIER ROOT TEST: a %s parent preserves the non-root baseline read', (parentType) => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: 0.039, raw_value: 3.9, baseline: 0.04 } };
    const graph = { nodes: [{ id: 'upstream', kind: 'factor',
      ...(parentType === 'retained-excluded' ? { analysis_participation: 'retained_excluded' } : {}) }, node],
    edges: [{ from: 'upstream', to: 'n', ...(parentType === 'bidirected' ? { edge_type: 'bidirected' } : {}) }] };
    expect(pinned(graph, [pctRow({ value: 4 })], [{ option_id: 'upstream_option', interventions: { upstream: 0.59 } }])).toEqual({ upstream_option: ['c'] });
  });

  it('GOAL ID RED: a non-root limited factor selected as the goal has no carried baseline or inherited tie', () => {
    const row = pctRow({ value: 4 });
    const graph = { nodes: [{ id: 'upstream', kind: 'factor' }, pctNode], edges: [{ from: 'upstream', to: 'n' }] };
    const wire = carryLevelLimitBaselines(graph, [row], 'n');
    expect(wire.nodes.find((node) => node.id === 'n')).toMatchObject({ observed_state: { value: 0.04 } });
    expect((wire.nodes.find((node) => node.id === 'n') as Rec).observed_state).not.toHaveProperty('baseline');
    expect(pinned(graph, [row], [{ option_id: 'carry_on', interventions: {} }], 'n'), 'the strict reader must use the carrier\'s explicit goal identity').toEqual({});
  });

  it('R3 UNTOUCHED RED: every option without a churn set inherits today\'s strict threshold, preserving option ids', () => {
    expect(pinned({ nodes: [pctNode] }, [pctRow({ value: 4 })], [
      { option_id: 'carry_on', interventions: {} },
      { option_id: 'price_only', interventions: { price: 0.59 } },
      { option_id: 'below_limit', interventions: { n: 0.039 } },
    ])).toEqual({ carry_on: ['c'], price_only: ['c'] });
  });

  it('BASELINE-GUARD RED: value 3.9%, baseline 4% inherits the analysis baseline tie by option and constraint identities', () => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: 0.039, raw_value: 3.9, baseline: 0.04 } };
    const graph = { nodes: [{ id: 'unchanged', kind: 'factor' }, node], edges: [{ from: 'unchanged', to: 'n', exists_probability: 1 }] };
    expect(pinned(graph, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({ untouched: ['c'] });
  });

  it('BASELINE-GUARD RED: value 4%, baseline 3.9% preserves the producer result by option and constraint identities', () => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, baseline: 0.039 } };
    const graph = { nodes: [{ id: 'unchanged', kind: 'factor' }, node], edges: [{ from: 'unchanged', to: 'n', exists_probability: 1 }] };
    expect(pinned(graph, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({});
  });

  it.each([[0.041, 0.04, {}], [0.04, 0.041, { untouched: ['c'] }]] as const)('ROOT-GUARD RED: current %s, stale baseline %s uses the root value', (value, baseline, expected) => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value, raw_value: value * 100, baseline } };
    expect(pinned({ nodes: [node], edges: [] }, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual(expected);
  });

  it.each(['<', undefined] as const)('PERIOD-GUARD RED: monthly 3%% with annual 10%% limit has no inherited tie (%s)', (operator) => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: 0.03, raw_value: 3, baseline: 0.10, unit: '% per month' } };
    const row = pctRow({ operator_as_stated: operator, provenance_unit_relabelled: {
      rule: 'rule1-limit-period', pre_normalisation_value: 10, pre_normalisation_unit: '% per year',
    } });
    const graph = { nodes: [{ id: 'unchanged', kind: 'factor' }, node], edges: [{ from: 'unchanged', to: 'n', exists_probability: 1 }] };
    expect(pinned(graph, [row], [{ option_id: 'untouched', interventions: {} }]), 'an annual threshold baseline cannot create a monthly strict tie').toEqual({});
  });

  it('EXISTENCE-GUARD RED: a zero-existence price path with another unchanged parent leaves the limited level tied', () => {
    const graph = { nodes: [{ id: 'price', kind: 'factor' }, { id: 'unchanged', kind: 'factor' }, pctNode], edges: [
      { from: 'price', to: 'n', exists_probability: 0 },
      { from: 'unchanged', to: 'n', exists_probability: 1 },
    ] };
    const wire = carryLevelLimitBaselines(graph, [pctRow({ value: 4 })]);
    expect(wire.nodes.find((node) => node.id === 'n')).toMatchObject({ observed_state: { baseline: 0.04 } });
    expect(pinned(graph, [pctRow({ value: 4 })], [{ option_id: 'price_option', interventions: { price: 0.59 } }])).toEqual({ price_option: ['c'] });
  });

  it('EXISTENCE STRUCTURE CONTROL: a zero-only parent remains non-root and retains its preserved baseline', () => {
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: 0.039, raw_value: 3.9, baseline: 0.04 } };
    const graph = { nodes: [{ id: 'unchanged', kind: 'factor' }, node], edges: [{ from: 'unchanged', to: 'n', exists_probability: 0 }] };
    expect(pinned(graph, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({ untouched: ['c'] });
  });

  it('CAUSAL-PATH RED: direct and multi-hop intervened ancestors keep their producer results by option identity', () => {
    const graph = { nodes: [{ id: 'price', kind: 'factor' }, { id: 'campaign', kind: 'factor' }, pctNode], edges: [{ from: 'price', to: 'n' }, { from: 'campaign', to: 'price' }] };
    expect(pinned(graph, [pctRow({ value: 4 })], [
      { option_id: 'direct_price', interventions: { price: 0.59 } },
      { option_id: 'upstream_campaign', interventions: { campaign: 0.7 } },
      { option_id: 'carry_on', interventions: {} },
      { option_id: 'unrelated_cost', interventions: { cost: 0.6 } },
    ])).toEqual({ carry_on: ['c'], unrelated_cost: ['c'] });
  });

  it('CAUSAL-PATH controls: reverse and bidirected edges do not move the limited node', () => {
    const graph = { nodes: [{ id: 'price', kind: 'factor' }, { id: 'campaign', kind: 'factor' }, pctNode], edges: [
      { from: 'n', to: 'price' },
      { from: 'campaign', to: 'n', edge_type: 'bidirected' },
    ] };
    expect(pinned(graph, [pctRow({ value: 4 })], [
      { option_id: 'reverse_price', interventions: { price: 0.59 } },
      { option_id: 'bidirected_campaign', interventions: { campaign: 0.7 } },
    ])).toEqual({ reverse_price: ['c'], bidirected_campaign: ['c'] });
  });

  it('R5: today at 3.9% or 4.1% is not a strict threshold; upstream scores keep their meaning', () => {
    for (const today of [0.039, 0.041]) {
      const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: today, raw_value: today * 100 } };
      expect(pinned({ nodes: [node] }, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({});
    }
  });

  it('TODAY tolerance: normalized round-trip noise remains at the strict threshold', () => {
    const today = 0.04 + 5e-10;
    const node = { ...pctNode, observed_state: { ...pctNode.observed_state, value: today, raw_value: today * 100 } };
    expect(pinned({ nodes: [node] }, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({ untouched: ['c'] });
  });

  it('TODAY floor: an untouched option at more than 4%\'s threshold is withheld too', () => {
    expect(pinned({ nodes: [pctNode] }, [pctRow({ value: 4, operator: '>=', operator_as_stated: '>' })], [
      { option_id: 'untouched', interventions: {} },
    ])).toEqual({ untouched: ['c'] });
  });

  it('TODAY frame CONTROL: a raw level on another cap cannot be compared as a percent; an explicit set supersedes today', () => {
    const otherCap = { ...pctNode, observed_state: { value: 0.2, raw_value: 4, cap: 20, unit: '%' } };
    expect(pinned({ nodes: [otherCap] }, [pctRow({ value: 4 })], [{ option_id: 'untouched', interventions: {} }])).toEqual({});
    expect(pinned({ nodes: [pctNode] }, [pctRow({ value: 4 })], [{ option_id: 'moved', interventions: { n: 0.039 } }])).toEqual({});
  });

  it('a strict FLOOR (">" beside ">=") pinned at its threshold is pinned too', () => {
    expect(pinned({ nodes: [pctNode] }, [pctRow({ operator: '>=', operator_as_stated: '>' })], opts(0.1))).toEqual({ o1: ['c'] });
  });

  it('a limit in the factor\'s own unit, read on its own cap ("under £55" on a cap of 100): 0.55 → pinned; 0.59 is not', () => {
    const price = { id: 'n', kind: 'factor', label: 'Price', scale_frame: 100, observed_state: { value: 0.49, raw_value: 49, unit: 'GBP' } };
    const row = pctRow({ value: 55, unit: 'GBP' });
    expect(pinned({ nodes: [price] }, [row], opts(0.55))).toEqual({ o1: ['c'] });
    expect(pinned({ nodes: [price] }, [row], opts(0.59))).toEqual({});
  });

  it('NOT PINNED: non-strict, a contradicting stamp, a delta frame, or a frame this module cannot prove', () => {
    const { operator_as_stated: _s, ...nonStrict } = pctRow();
    expect(pinned({ nodes: [pctNode] }, [nonStrict], opts(0.1))).toEqual({});
    expect(pinned({ nodes: [pctNode] }, [pctRow({ operator_as_stated: '>' })], opts(0.1)), 'a ">" stamp on "<=" is not strict').toEqual({});
    expect(pinned({ nodes: [pctNode] }, [pctRow({ value_frame: 'delta' })], opts(0.1))).toEqual({});
    const framedOn20 = { ...pctNode, observed_state: { value: 0.2, raw_value: 4, cap: 20, unit: '%' } };
    expect(pinned({ nodes: [framedOn20] }, [pctRow()], opts(0.1)), 'a "%" limit on a node framed on 20 proves no frame').toEqual({});
  });
});
