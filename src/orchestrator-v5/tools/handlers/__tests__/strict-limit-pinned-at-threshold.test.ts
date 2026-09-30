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
 * The engine body is the VERBATIM C50 U2 capture (`gc_u2` "<= 10 %", certified `decision_grade: true`, P 0.9985 on both
 * options, `opt_raise` leads), run through the REAL `run_analysis` handler. The only thing that differs between the rows
 * is the stored row's `operator_as_stated` and the level an option sets on churn. Rows bind by `constraint_id` and
 * option id.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { strictLimitsPinnedAtThreshold } from '../level-limit-baseline.js';
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

function graphWith(row: Rec, pin: Pin | undefined): Rec {
  // The pin is the USER's figure (`user_specified`), so rule (d) — a leader setting the target at Olumi's estimate —
  // never fires here: the only question left is the threshold.
  const churnOn = (option: Pin['option']) =>
    pin?.option === option ? { fac_churn: { value: pin.level, raw_value: pin.level * 100, source: 'user_specified' } } : {};
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      // The user's own current churn (4%), framed on 100: PLoT reads "10 %" on this node's level (0.10).
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%', source: 'brief_extraction' } },
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
}

/** The PLoT request `run_analysis` sends for `rows` (one option may pin churn), and the verdict it persists. */
async function plotLimit(rows: Rec[], pin?: Pin): Promise<Outcome> {
  const graph = graphWith(rows[0]!, pin);
  const goal_constraints = rows.map((r) => JSON.parse(JSON.stringify(r)) as Rec);
  const before = JSON.stringify(goal_constraints);
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
  const run = vi.fn((payload: Rec) => { sent = payload; return Promise.resolve(JSON.parse(U2) as V2RunResponseEnvelope); });
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
  return {
    state: v.constraint_verdict_state,
    mayName: v.may_name_leading_option,
    perLimit: v.per_limit,
    joint: v.joint,
    summary: String(fact.result.summary ?? ''),
    wireLimit: ((sent?.goal_constraints as Rec[] | undefined) ?? []).find((c) => c.constraint_id === LIMIT_ID),
    wireChurn,
  };
}

const SCORED = [{ constraint_id: LIMIT_ID, state: 'scored' }];
const WITHHELD_FOR_THE_PIN = [{ constraint_id: LIMIT_ID, state: 'unscored', reason: 'level_set_at_strict_threshold' }];

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
    expect(r.summary).toMatch(/Raise to 59 scored highest/);
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
  const pctNode = { id: 'n', kind: 'factor', label: 'Churn', observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%' } };
  const pctRow = (extra: Rec = {}): Rec => ({ constraint_id: 'c', node_id: 'n', operator: '<=', operator_as_stated: '<', value: 10, unit: '%', value_frame: 'level', ...extra });
  const opts = (level: number) => [{ option_id: 'o1', interventions: { n: level } }, { option_id: 'o2', interventions: {} }];
  const pinned = (graph: Rec, rows: Rec[], options: Rec[]) =>
    Object.fromEntries([...strictLimitsPinnedAtThreshold(graph, rows, options)].map(([o, ids]) => [o, [...ids]]));

  it('a "%" limit on a node framed on 100: 0.10 is "10 %" → pinned; 0.099 is not', () => {
    expect(pinned({ nodes: [pctNode] }, [pctRow()], opts(0.1))).toEqual({ o1: ['c'] });
    expect(pinned({ nodes: [pctNode] }, [pctRow()], opts(0.099))).toEqual({});
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
