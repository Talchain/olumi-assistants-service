/**
 * A STATED LIMIT REACHES PLoT IN A UNIT PLoT CAN READ — the (C)(a) canonical-units increment.
 *
 * ⚠ WHY THIS FILE EXISTS (WIRE, engine-direct, #69 5840961137; captures in the AI Quality lane's
 * `quality-evidence/c50-level-demo-20260925/U1.json` + `U2.json`, PLoT b09c0f2 / ISL 3c4ab84d):
 * the drafter wrote Paul's churn limit as `10 "percent per month"`. Admission copied that unit verbatim
 * (`admit-constraint.ts:128`), PLoT's percent check is an EXACT token match (`isPercentUnit`,
 * `constraint-units.ts:88`), so the threshold fell through to `deriveRange` and was CLAMPED to 1.0. On a
 * root target with a level frame the engine then DELIVERED P=1 for both options — "churn ≤ 100%" — flagged
 * only by `decision_grade:false`. The same limit as `10 "%"` normalised to 0.10 and scored 0.9985.
 *
 * The classifier that reads "percent per month" correctly already exists (`classifyUnitScaleClass`); admission
 * never consulted it. These rows bind the fix at admission AND on the payload PLoT receives, and every RED row
 * has a CONTROL that must stay green so a broader rewrite cannot pass (see the mutants in the PR body).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { admitCandidateConstraints, type AdmittedConstraint, type LimitTargetScale } from '../admit-constraint.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const LEVER = 'agent-lane:fac_lever:<=';

/**
 * The target node's scale decides whether a rewrite is safe (review 5841434798), so every row names it. The default is
 * the served churn shape (restart-bank wbceskm32): a capless PROPORTION (0.07) with no unit — the one shape on which
 * PLoT's `"%"` rung ([0,100], cap ignored) lands on the same scale as the node's level.
 */
const PROPORTION: LimitTargetScale = { value: 0.07 };
const POUNDS: LimitTargetScale = { unit: '£', cap: 1_000_000, value: 0.4, raw_value: 400_000 };

/** Admit ONE stated upper bound on "Lever" and return it BY IDENTITY (constraint_id), never by value. */
// A REST parameter, not a default: an explicit `undefined` ("no node scale supplied") must reach admission as undefined.
function admit1(value: number, unit: string | undefined, ...node: [] | [LimitTargetScale | undefined]): AdmittedConstraint {
  const target = node.length === 0 ? PROPORTION : node[0];
  const { constraints } = admitCandidateConstraints(
    [{ metric: 'Lever', operator: '<=', value, ...(unit !== undefined ? { unit } : {}), provenance: 'explicit' }],
    (m) => (m === 'Lever' ? 'fac_lever' : undefined),
    (id) => (id === 'fac_lever' ? target : undefined),
  );
  const hit = constraints.find((c) => c.constraint_id === LEVER);
  expect(hit, 'the admitted constraint is found by its id').toBeDefined();
  return hit as AdmittedConstraint;
}

const STAMP_KEYS = ['provenance_unit_relabelled', 'provenance_unit_normalised'] as const;
function stampKeys(c: AdmittedConstraint): string[] {
  return STAMP_KEYS.filter((k) => k in (c as unknown as Record<string, unknown>));
}

describe('admission canonicalises a limit unit PLoT would otherwise misread', () => {
  // ── RED on bdd43f4a (and on #1919's 9aba9c93): the unit passes through verbatim ──
  it('"percent per month" 10 is admitted as "%" 10 — the value is untouched, the relabel is recorded', () => {
    expect(admit1(10, 'percent per month')).toMatchObject({
      unit: '%',
      value: 10,
      provenance_unit_relabelled: { pre_normalisation_value: 10, pre_normalisation_unit: 'percent per month' },
    });
  });

  for (const spelling of ['% per month', 'per cent per month', 'percent a month', '% monthly', 'percent per annum', '% p.a.']) {
    it(`a percent with a period tail is "%" too: "${spelling}"`, () => {
      expect(admit1(10, spelling)).toMatchObject({ unit: '%', value: 10 });
    });
  }

  it('"£k" 250 is admitted as "£" 250000, and the stated figure is kept for the reader', () => {
    expect(admit1(250, '£k', POUNDS)).toMatchObject({
      unit: '£',
      value: 250000,
      provenance_unit_normalised: { original_value: 250, original_unit: '£k' },
    });
  });

  it('"£m" 4.1 is exactly 4100000 (no float drift from multiplying)', () => {
    expect(admit1(4.1, '£m', POUNDS).value).toBe(4100000);
  });

  it('"GBPk" 900 on a "GBP" node is "GBP" 900000', () => {
    expect(admit1(900, 'GBPk', { unit: 'GBP', cap: 1_000_000 })).toMatchObject({ unit: 'GBP', value: 900000 });
  });

  // ── CONTROLS: green on every base, and each must STAY green ──
  it('CONTROL: "%" 4 is untouched and carries no stamp', () => {
    const c = admit1(4, '%');
    expect(c).toMatchObject({ unit: '%', value: 4 });
    expect(stampKeys(c)).toEqual([]);
  });

  for (const [value, unit] of [
    [900000, 'GBP'],
    [49, '£'],
    [-10, "% change vs this year's operating costs"], // a percent OF SOMETHING ELSE, not a rate: never "%"
    [0.5, 'percent per month'], // below 1: PLoT would read "%" 0.5 as a FRACTION (50%) — abstain
    [150, 'percent per month'], // above 100: not a plain percentage — abstain
    [2, 'percentage points'], // the rowed one-way door is not decided here
    [2, 'pp'],
    [40000, 'GBP/year'],
    [0.3, 'proportion of revenue'],
    [3, 'quarter (Q1=1)'],
    [4, '% churn'],
    [250, 'k'], // a bare magnitude names no currency
  ] as const) {
    it(`CONTROL: ${value} "${unit}" is admitted verbatim with no stamp`, () => {
      const c = admit1(value, unit);
      expect(c).toMatchObject({ unit, value });
      expect(stampKeys(c)).toEqual([]);
    });
  }

  it('CONTROL: an absent unit stays absent', () => {
    const c = admit1(12, undefined);
    expect('unit' in c).toBe(false);
    expect(stampKeys(c)).toEqual([]);
  });

  it('the two-way check compares CANONICAL values: "at least 900 £k" and "at most 900000 GBP" is not a contradiction of 900 vs 900000', () => {
    const { constraints, loss } = admitCandidateConstraints(
      [
        { metric: 'Budget', operator: '>=', value: 800, unit: '£k', provenance: 'explicit' },
        { metric: 'Budget', operator: '<=', value: 900, unit: '£k', provenance: 'explicit' },
      ],
      (m) => (m === 'Budget' ? 'fac_budget' : undefined),
      () => POUNDS,
    );
    expect(loss.filter((l) => l.field_path.endsWith('.bound_direction'))).toEqual([]);
    expect(constraints.map((c) => [c.operator, c.value, c.unit])).toEqual([
      ['>=', 800000, '£'],
      ['<=', 900000, '£'],
    ]);
  });
});

/**
 * ⛔⛔ THE REWRITE READS THE TARGET NODE (#1934 review 5841434798, CHANGES_REQUIRED on 647caa61).
 *
 * PLoT's ladder (`intervention-normaliser.ts` at b09c0f2, :1564-1580): a `"%"` limit takes the unit_percent rung
 * `[0,100]` BEFORE `deriveRange`, so it IGNORES the node's `observed_state.cap`; any other unit reaches `deriveRange`
 * → `explicit_cap [0,cap]`, then `classifyUnitCompatibility` (`constraint-units.ts:248`) marks two DIFFERENT
 * non-token spellings `mismatched`. So on a node framed `{unit "percent per month", cap 20}` the verbatim limit
 * `10 "percent per month"` is 10/20 = 0.5 — correct — and 647caa61's `"%"` made it 0.1, five times stricter, silently.
 * On `{unit "£k", cap 1000}` the verbatim `250 "£k"` is 0.25 and 647caa61's `"£" 250000` became a unit mismatch.
 * Every row below names the node, and the verbatim rows are the ones 647caa61 broke.
 */
describe('the rewrite is decided by the TARGET NODE\'s scale, never by the limit\'s unit alone', () => {
  const PPM_CAP20: LimitTargetScale = { unit: 'percent per month', cap: 20, value: 0.35, raw_value: 7 };

  // ── RED on 647caa61: a rewrite that changes the number PLoT computes ──
  it('BLOCKING 1: "percent per month" 10 on a {percent per month, cap 20} node stays verbatim (PLoT: explicit_cap → 0.5)', () => {
    const c = admit1(10, 'percent per month', PPM_CAP20);
    expect(c).toMatchObject({ unit: 'percent per month', value: 10 });
    expect(stampKeys(c)).toEqual([]);
  });

  it('BLOCKING 2: "£k" 250 on a {£k, cap 1000} node stays verbatim (PLoT: explicit_cap → 0.25, reconciled)', () => {
    const c = admit1(250, '£k', { unit: '£k', cap: 1000, value: 0.4, raw_value: 400 });
    expect(c).toMatchObject({ unit: '£k', value: 250 });
    expect(stampKeys(c)).toEqual([]);
  });

  it('a different percent spelling on a capped node takes THE NODE\'s spelling, so PLoT reconciles it against the cap', () => {
    expect(admit1(10, '% per month', PPM_CAP20)).toMatchObject({
      unit: 'percent per month',
      value: 10,
      provenance_unit_relabelled: { pre_normalisation_value: 10, pre_normalisation_unit: '% per month' },
    });
  });

  it('"%" 10 on a {percent per month, cap 20} node takes the node\'s spelling (as "%" PLoT ignores the cap: 0.1, not 0.5)', () => {
    expect(admit1(10, '%', PPM_CAP20)).toMatchObject({ unit: 'percent per month', value: 10, provenance_unit_relabelled: { pre_normalisation_unit: '%' } });
  });

  for (const [why, target] of [
    ['a "%" node capped at 20 (as "%" the cap is ignored; no spelling reconciles, so PLoT must refuse it)', { unit: '%', cap: 20, value: 0.35, raw_value: 7 }],
    ['a capless node whose level is a RAW 7 (not a proportion)', { unit: 'percent per month', value: 7 }],
    ['a capless, UNITLESS node whose level is a raw 7 (not a proportion)', { value: 7 }],
    ['a capless 0.07 in a PERCENT spelling (0.07% or 7%? not provable — review 5841746528)', { unit: 'percent per month', value: 0.07 }],
    ['an estimate framed on 20 (level = raw/20)', { unit: '%', value: 0.35, raw_value: 7, scale_frame: 20 }],
    ['a level carrying a separate raw figure but no frame (not provably a proportion)', { unit: '%', value: 0.35, raw_value: 7 }],
    ['a node that is not a percent at all', { unit: 'customers', cap: 1000, value: 0.2, raw_value: 200 }],
    ['a node with no scale at all', {}],
    ['no node scale supplied', undefined],
  ] as const) {
    it(`"percent per month" 10 stays verbatim on ${why}`, () => {
      const c = admit1(10, 'percent per month', target as LimitTargetScale | undefined);
      expect(c).toMatchObject({ unit: 'percent per month', value: 10 });
      expect(stampKeys(c)).toEqual([]);
    });
  }

  for (const [why, target] of [
    ['a node with no unit', { cap: 1_000_000, value: 0.4 }],
    ['a "$" node', { unit: '$', cap: 1_000_000 }],
    ['a "GBP/year" node', { unit: 'GBP/year', cap: 1_000_000 }],
    ['no node scale supplied', undefined],
  ] as const) {
    it(`"£k" 250 stays verbatim on ${why}`, () => {
      const c = admit1(250, '£k', target as LimitTargetScale | undefined);
      expect(c).toMatchObject({ unit: '£k', value: 250 });
      expect(stampKeys(c)).toEqual([]);
    });
  }

  it('"£k" 250 on a "GBP" node is "GBP" 250000 — the node\'s own spelling, so PLoT reads them as one unit', () => {
    expect(admit1(250, '£k', { unit: 'GBP', cap: 1_000_000 })).toMatchObject({ unit: 'GBP', value: 250000 });
  });

  // ── CONTROLS: the rewrite still happens where the node's level IS the percentage / 100 ──
  for (const [why, target] of [
    ['a node capped at exactly 100', { unit: '%', cap: 100, value: 0.07, raw_value: 7 }],
    ['an estimate framed on 100', { unit: '%', value: 0.07, raw_value: 7, scale_frame: 100 }],
    ['a capless proportion with no unit', { value: 0.07 }],
  ] as const) {
    it(`CONTROL: "percent per month" 10 is "%" on ${why}`, () => {
      expect(admit1(10, 'percent per month', target as LimitTargetScale)).toMatchObject({ unit: '%', value: 10 });
    });
  }
});

/** Through the REAL model admission — binds that the call site hands each limit its own node's scale. */
describe('admitCandidateModel hands each limit its target node', () => {
  const faithful = JSON.parse(
    readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/faithful.json', 'utf-8'),
  ) as CandidateModel;
  function admittedLimit(
    factor: { unit: string; baseline_value: number; plausible_max?: number; baseline_known?: boolean },
    limit: { value: number; unit: string },
  ): AdmittedConstraint {
    const candidate = {
      ...faithful,
      factors: [
        ...faithful.factors.filter((f) => f.label !== 'Monthly churn rate'),
        { label: 'Monthly churn rate', role: 'observable', provenance: 'explicit', baseline_known: true, ...factor },
      ],
      constraints: [{ metric: 'Monthly churn rate', operator: '<', provenance: 'explicit', ...limit }],
    } as unknown as CandidateModel;
    const m = admitCandidateModel(candidate);
    const node = m.nodes.find((n) => n.label === 'Monthly churn rate');
    expect(node, 'the churn factor is admitted').toBeDefined();
    const hit = m.goal_constraints.find((c) => c.constraint_id === `agent-lane:${node!.id}:<=`);
    expect(hit, 'the limit is admitted on that node, by id').toBeDefined();
    return hit as AdmittedConstraint;
  }

  it('a {percent per month, plausible_max 20} factor keeps a "percent per month" limit verbatim', () => {
    expect(admittedLimit({ unit: 'percent per month', baseline_value: 7, plausible_max: 20 }, { value: 10, unit: 'percent per month' }))
      .toMatchObject({ unit: 'percent per month', value: 10 });
  });

  it('a percent-spelled baseline below 1 with no usable range stays verbatim (0.8 "percent per month" is 0.8% or 80%: PLoT must flag it)', () => {
    const c = admittedLimit({ unit: 'percent per month', baseline_value: 0.8, plausible_max: 1 }, { value: 1, unit: 'percent per month' });
    expect(c).toMatchObject({ unit: 'percent per month', value: 1 });
    expect(stampKeys(c)).toEqual([]);
  });

  it('an AI ESTIMATE framed on 100 (scale_frame, no cap) admits the limit as "%" — the node frame reaches the rewrite', () => {
    expect(admittedLimit({ unit: 'percent per month', baseline_value: 7, plausible_max: 100, baseline_known: false }, { value: 10, unit: 'percent per month' }))
      .toMatchObject({ unit: '%', value: 10 });
  });

  it('a "£" factor turns a "£k" limit into £', () => {
    expect(admittedLimit({ unit: '£', baseline_value: 400_000, plausible_max: 1_000_000 }, { value: 250, unit: '£k' }))
      .toMatchObject({ unit: '£', value: 250000 });
  });

  it('a "£k" factor keeps a "£k" limit verbatim', () => {
    expect(admittedLimit({ unit: '£k', baseline_value: 400, plausible_max: 1000 }, { value: 250, unit: '£k' }))
      .toMatchObject({ unit: '£k', value: 250 });
  });
});

// ── the WIRE: the payload PLoT actually receives, through the real handler (harness of
//    run-analysis-goal-direction-wire.test.ts) ──
const happyFixture = JSON.parse(
  readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8'),
) as V2RunResponseEnvelope;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function invocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO,
      request_id: 'req-limit-unit-wire',
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-limit-unit-wire',
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

async function plotPayloadFor(admitted: AdmittedConstraint): Promise<Record<string, unknown>> {
  // The persisted graph parse hop (`GraphV3.safeParse`, build-model.ts:741 / build-turn-context.ts:3037) strips
  // undeclared keys — so this binds that the canonical unit AND its stamp survive the schema, not just admission.
  const graph = GraphV3.parse({
    nodes: [
      { id: 'goal_metric', kind: 'goal', label: 'Grow revenue' },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { fac_lever: 0.8 } },
      { id: 'opt_b', kind: 'option', label: 'Option B', interventions: { fac_lever: 0.2 } },
      { id: 'fac_lever', kind: 'factor', label: 'Lever' },
    ],
    edges: [
      { from: 'fac_lever', to: 'goal_metric', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
    goal_constraints: [admitted],
  });
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_lever: 0.8 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_lever: 0.2 } },
    ],
    goal_node_id: 'goal_metric',
    rawPersistedGraph: graph,
    // mirrors the loader, build-turn-context.ts:3068-3073
    ...(graph.goal_constraints !== undefined ? { goal_constraints: graph.goal_constraints } : {}),
  } as RunAnalysisScenarioSnapshot;
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation()).catch(() => undefined);
  expect(run).toHaveBeenCalledOnce();
  return captured as Record<string, unknown>;
}

function wireConstraint(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const list = payload.goal_constraints as Array<Record<string, unknown>> | undefined;
  return list?.find((c) => c.constraint_id === LEVER);
}

describe('the canonical unit is what PLoT receives', () => {
  it('a "percent per month" 10 limit reaches PLoT as "%" 10 (PLoT: [0,100] → 0.10, not clamped to 1.0)', async () => {
    const c = wireConstraint(await plotPayloadFor(admit1(10, 'percent per month')));
    expect(c).toMatchObject({ unit: '%', value: 10 });
  });

  it('a "£k" 250 limit reaches PLoT as "£" 250000, with its stamp intact through the schema', async () => {
    const c = wireConstraint(await plotPayloadFor(admit1(250, '£k', POUNDS)));
    expect(c).toMatchObject({ unit: '£', value: 250000, provenance_unit_normalised: { original_value: 250, original_unit: '£k' } });
  });

  it('CONTROL: an unknown unit reaches PLoT verbatim (PLoT then fails closed on it)', async () => {
    const c = wireConstraint(await plotPayloadFor(admit1(40000, 'GBP/year')));
    expect(c).toMatchObject({ unit: 'GBP/year', value: 40000 });
  });
});
