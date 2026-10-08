/** ⭐ PR-S1 (#87 6027634829): identity-bound ranges and the A7 clause, including the real loader/handler seam. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import { GOAL_CHANCE_RANGE, goalChanceRangeOf, withGoalChanceRange, type GoalChanceRangeInputs } from '../goal-chance-range.js';
import { GOAL_CHANCE_LICENSED, withGoalChanceLicence } from '../goal-chance-licence.js';
import {
  GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PROBABILITY_UNUSABLE, GOAL_FIGURES_WITHHELD_CODES,
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, runWithheldGoalFigures,
} from '../../../orchestrator/context/option-result-source.js';
import { withholdOptionGoalFigures } from '../../../orchestrator/context/constraint-feasibility.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { GOAL_HORIZON_NOT_TESTED } from '../../agent-lane/decision-input-ask.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';

type Json = Record<string, any>;
const clone = <T>(v: T): T => structuredClone(v);
const A = 'raise', B = 'keep', FROM = 'price', TO = 'revenue';
const line = 'The original deadline sentence, kept verbatim.';
const horizon = { code: GOAL_HORIZON_NOT_TESTED, severity: 'info', message: line, node_ids: [TO] };
const row = (patch: Json = {}): Json => ({
  kind: 'link_strength', quantity_id: `${FROM}->${TO}`, from: FROM, to: TO, status: 'resolved',
  spread: 0.4, p_goal_if_low: 0.234, p_goal_if_high: 0.876, n_low: 4000, n_high: 40, ...patch,
});
const graph = (): Json => ({
  nodes: [
    { id: A, kind: 'option', interventions: { [FROM]: 0.7 } },
    { id: B, kind: 'option', interventions: { [FROM]: 0.5 } },
    { id: FROM, kind: 'factor', label: 'Price', observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, unit: '£', cap: 100 } },
    { id: TO, kind: 'goal', label: 'Revenue', goal_direction: '>=', goal_threshold: 0.8,
      goal_threshold_raw: 800, goal_threshold_unit: '£', goal_threshold_frame: 'level',
      observed_state: { value: 0.5, baseline: 0.5, raw_value: 500, unit: '£', cap: 1000 } },
  ],
  edges: [{ from: A, to: FROM, strength: { mean: 1, std: 0.01 } }, { from: B, to: FROM, strength: { mean: 1, std: 0.01 } },
    { from: FROM, to: TO, strength: { mean: 0.5, std: 0.1 }, provenance: { magnitude: 'olumi_placeholder' }, defaulted: true }],
});
const inputs = (rows: Json[] = [row()], patch: Json = {}): GoalChanceRangeInputs => ({
  driversByOption: new Map([[A, { drivers: rows, ...patch }]]),
  goalPaths: [{ option_id: A, links: [{ from: FROM, to: TO }] }], plotWithheld: false, goalId: TO,
});
const warning = (code = GOAL_FIGURES_PLACEHOLDER_PATH, option_ids = [A]): Json => ({ code, severity: 'warning', message: 'Withheld.', option_ids });
const envelope = (): Json => ({ option_comparison: [{ option_id: A }, { option_id: B, probability_of_goal: 0.63 }], inference_warnings: [warning()] });
const expected = { low_pct: 23, high_pct: 90, low_rounding: 'whole', high_rounding: 'nearest_5',
  kind: 'link_strength', from: FROM, to: TO, among: 'all' };
const record = (e: Json, code = GOAL_CHANCE_RANGE): Json | undefined => e.inference_warnings.find((w: Json) => w.code === code);

function absent(e: Json, g: Json, i: GoalChanceRangeInputs): void {
  expect(goalChanceRangeOf(e, g, A, i)).toBeNull();
  expect(withGoalChanceRange(e, g, i)).toBe(e);
  expect(record(e)).toBeUndefined();
}

describe('ruling 1: a range belongs to one option and one unsized path link', () => {
  it('P5-only placeholder: exact group endpoints, own group steps, info carrier and identity', () => {
    expect(targetTestabilityOf(graph())).toMatchObject({ kind: 'not_testable', goal_id: TO,
      failures: [{ precondition: 'P5', code: 'goal_path_placeholder', links: [{ from: FROM, to: TO }] }] });
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs())).toEqual(expected);
    const out = withGoalChanceRange(envelope(), graph(), inputs());
    expect(record(out)).toEqual({ code: GOAL_CHANCE_RANGE, severity: 'info',
      message: "Some options' chances are shown as a range: a link on the way to your goal isn't sized in the model yet.",
      option_ids: [A], range_by_option: { [A]: expected } });
    expect(record(out)?.range_by_option).not.toHaveProperty(B);
    expect(withGoalChanceRange(out, graph(), inputs())).toBe(out);
    expect(Object.keys(record(out)!).filter(k => /^rank/.test(k))).toEqual([]);
    expect(record(out)).not.toHaveProperty('leader_option_id');
  });

  it('existence row uses absent/present, reverses endpoints with their own steps, and falls back to quantity_id', () => {
    const r = row({ kind: 'link_existence', from: undefined, to: undefined,
      p_goal_if_absent: 0.876, p_goal_if_present: 0.234, n_absent: 40, n_present: 4000,
      p_goal_if_low: 0.01, p_goal_if_high: 0.99 });
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs([r]))).toEqual({ ...expected, kind: 'link_existence' });
  });

  it.each(['P1', 'P2', 'P4'] as const)('%s failure bars this option despite a placeholder warning', precondition => {
    const g = graph(), goal = g.nodes.find((n: Json) => n.id === TO);
    if (precondition === 'P1') delete goal.observed_state.baseline;
    if (precondition === 'P2') goal.goal_threshold = 1;
    if (precondition === 'P4') goal.goal_threshold_unit = 'months';
    expect(targetTestabilityOf(g)).toMatchObject({ kind: 'not_testable', goal_id: TO,
      failures: expect.arrayContaining([expect.objectContaining({ precondition })]) });
    absent(envelope(), g, inputs());
  });

  it('identity_unconfirmed never grants a range', () => {
    const g = graph();
    g.nodes.find((n: Json) => n.id === TO).nonlinear_identity = { operation: 'product', factor_ids: [FROM], stated_in_brief: false };
    expect(targetTestabilityOf(g)).toMatchObject({ kind: 'not_testable', goal_id: TO,
      failures: [expect.objectContaining({ code: 'identity_unconfirmed' })] });
    absent(envelope(), g, inputs());
  });

  it.each([GOAL_FIGURES_PRODUCT_NOT_READ, GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PROBABILITY_UNUSABLE,
    GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED])('%s blocks at option scope and run scope', code => {
    for (const ids of [[A], []]) {
      const e = envelope(); e.inference_warnings.push(warning(code, ids)); absent(e, graph(), inputs());
    }
    const e = envelope(); e.inference_warnings.push(warning(code, [B]));
    expect(goalChanceRangeOf(e, graph(), A, inputs())).toEqual(expected);
  });

  it('PLoT already withheld before CEE: no range even if its record names another option', () => {
    absent(envelope(), graph(), { ...inputs(), plotWithheld: true });
  });

  it.each([{ status: 'below_resolution' }, { status: 'unknown' }, { correlated: true }, { correlated: null }])(
    'excludes unresolved or correlated rows: %j', patch => absent(envelope(), graph(), inputs([row(patch)])),
  );

  // ⛔ S1 review r1 #1 (MUST SHOW): ISL omits `correlated` unless true and PLoT forwards only `true`, so the wire never
  // carries `false`. The row below is the FIRST link_strength row of the in-repo served capture (served-w3-f440be4a, T1b),
  // keys and figures untouched, rebound only to this graph's ends. A self-authored `correlated:false` is not the wire.
  it('a SERVED driver row (no correlated key) shows its range; an explicit false is the same', () => {
    const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-w3-f440be4a-t1b-7ab6c1af.json', import.meta.url), 'utf8'));
    const block = served.blocks[0].enrichment.option_comparison[0].probability_of_goal_drivers;
    const servedRow = block.drivers.find((r: Json) => r.kind === 'link_strength');
    expect(servedRow).not.toHaveProperty('correlated');
    const asServed = { ...servedRow, from: FROM, to: TO, quantity_id: `${FROM}->${TO}` };
    const shown = goalChanceRangeOf(envelope(), graph(), A, inputs([asServed]));
    expect(shown).not.toBeNull();
    expect(shown).toMatchObject({ kind: 'link_strength', from: FROM, to: TO, among: 'all' });
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs([{ ...asServed, correlated: false }]))).toEqual(shown);
  });

  // ⛔ S1 review r1 #2: a chance unusable for the whole Run (here: no stated direction) bars every range, even though the
  // gate never names an option the placeholder arm already withheld.
  it('Run-wide unusable chance (no stated direction): no range', () => {
    const g = graph(); delete g.nodes.find((n: Json) => n.id === TO).goal_direction;
    absent(envelope(), g, inputs());
    // CONTROL: the same graph with its direction stated shows the range.
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs())).toEqual(expected);
  });

  // Every non-P5 testability failure bars a range; each row first proves the verdict really carries that failure.
  // (P3: since the 6 Oct relaxation a `<` held on the goal node is scorable — probe at 0f2c3b23 — so no P3 row is built
  // that way; a P3 arises only from a `<` the row alone states, which the same `every` check rejects.)
  it.each([
    ['P1 (no today\'s level)', (g: Json) => { const goal = g.nodes.find((n: Json) => n.id === TO); delete goal.observed_state; }, 'P1'],
    ['P4 (target unit differs from the goal\'s)', (g: Json) => { g.nodes.find((n: Json) => n.id === TO).goal_threshold_unit = 'orders'; }, 'P4'],
  ])('%s never grants a range', (_name, mutate, precondition) => {
    const g = graph(); (mutate as (g: Json) => void)(g);
    const v = targetTestabilityOf(g);
    expect(v.kind === 'not_testable' && v.failures.some((f) => f.precondition === precondition)).toBe(true);
    const e = envelope(); e.inference_warnings = [warning(GOAL_FIGURES_TARGET_NOT_TESTABLE)];
    absent(e, g, inputs());
  });

  // ⛔ S1 review r1 #3: the first row on an unsized link decides; a lower unsized row never stands in for it.
  it('an unsized link below resolution that outranks a resolved unsized link: no range', () => {
    const g = graph();
    g.nodes.push({ id: 'cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, unit: '£', cap: 100 } });
    g.edges.push({ from: A, to: 'cost', strength: { mean: 1, std: 0.01 } },
      { from: 'cost', to: TO, strength: { mean: -0.5, std: 0.1 }, provenance: { magnitude: 'olumi_placeholder' }, defaulted: true });
    const L1 = row({ kind: 'link_existence', status: 'below_resolution', spread: 0.30, p_goal_if_absent: 0.3, p_goal_if_present: 0.6, n_absent: 400, n_present: 1600 });
    const L2 = row({ quantity_id: `cost->${TO}`, from: 'cost', to: TO, spread: 0.10, p_goal_if_low: 0.40, p_goal_if_high: 0.50 });
    const i: GoalChanceRangeInputs = { ...inputs([L1, L2]), goalPaths: [{ option_id: A, links: [{ from: FROM, to: TO }, { from: 'cost', to: TO }] }] };
    absent(envelope(), g, i);
    // CONTROL: without the outranking unresolved row, L2 shows.
    expect(goalChanceRangeOf(envelope(), g, A, { ...i, driversByOption: new Map([[A, { drivers: [L2] }]]) })).toMatchObject({ from: 'cost', to: TO });
  });

  it('STOP: different raw group chances display equally, so there is no range', () => {
    absent(envelope(), graph(), inputs([row({ p_goal_if_low: 0.431, p_goal_if_high: 0.439, n_low: 40, n_high: 40 })]));
  });

  it.each([1, -1, null, undefined])('invalid_rows_dropped = %s fails closed', value => {
    absent(envelope(), graph(), inputs([row()], { invalid_rows_dropped: value }));
  });

  it('an unrankable non-candidate row fails closed', () => {
    absent(envelope(), graph(), inputs([row(), { kind: 'factor_value', quantity_id: FROM, spread: NaN }]));
  });

  it.each([{ n_low: 0 }, { n_high: 1.5 }, { p_goal_if_low: -0.1 }, { p_goal_if_high: NaN }])(
    'unusable group endpoints/counts fail closed: %j', patch => absent(envelope(), graph(), inputs([row(patch)])),
  );

  // ⛔ S1 review r2 #1 (DL 6028386916): an unsized link OFF this option's path outranking the on-path one makes "Of the
  // links not sized yet, it depends most on Price → Revenue" false: no range (Science ruling, fail closed).
  const offPath = (provenance: Json | undefined): Json => {
    const g = graph();
    g.nodes.push({ id: 'market', kind: 'factor', label: 'Market', observed_state: { value: 0.5, baseline: 0.5, raw_value: 50, unit: '£', cap: 100 } });
    g.edges.push({ from: 'market', to: TO, strength: { mean: 0.5, std: 0.25 }, ...(provenance ? { provenance } : {}) });
    return g;
  };
  const market = row({ quantity_id: `market->${TO}`, from: 'market', to: TO, spread: 0.50 });
  const price = row({ spread: 0.30 });
  it.each([{ magnitude: 'olumi_placeholder' }, { mean_projected: true }])('an off-path unsized link (%j) outranks the on-path one: no range', (provenance) => {
    absent(envelope(), offPath(provenance), inputs([market, price]));
  });
  it('CONTROL: the same off-path link, sized, outranks it: the range shows, among unsized_links', () => {
    expect(goalChanceRangeOf(envelope(), offPath(undefined), A, inputs([market, price]))).toEqual({ ...expected, among: 'unsized_links' });
  });

  it('sized factor outranks the unsized link: among unsized_links; ISL order chooses the link', () => {
    expect(goalChanceRangeOf(envelope(), graph(), A, inputs([
      row(), { kind: 'factor_value', quantity_id: FROM, spread: 0.9, status: 'resolved', correlated: false },
    ]))).toEqual({ ...expected, among: 'unsized_links' });
  });

  it('never chooses a link outside this option\'s unsized set or absent from the Run graph', () => {
    const g = graph(); g.edges.push({ from: 'elsewhere', to: TO, strength: { mean: 1 } });
    absent(envelope(), g, inputs([row({ from: 'elsewhere', quantity_id: `elsewhere->${TO}` })]));
    const i = { ...inputs([row({ from: 'missing', to: TO })]), goalPaths: [{ option_id: A, links: [{ from: 'missing', to: TO }] }] };
    absent(envelope(), graph(), i);
    expect(goalChanceRangeOf(envelope(), graph(), B, inputs())).toBeNull();
  });

  it('P5 failing links also qualify when the placeholder walk is empty, under TARGET_NOT_TESTABLE', () => {
    const e = envelope(); e.inference_warnings = [warning(GOAL_FIGURES_TARGET_NOT_TESTABLE)];
    expect(goalChanceRangeOf(e, graph(), A, { ...inputs(), goalPaths: [] })).toEqual(expected);
  });

  it('withheld option keeps no probability, precision, drivers or win share; range leaves the stripped result intact', () => {
    const before = { option_comparison: [{ option_id: A, probability_of_goal: 0.999, win_probability: 0.9,
      probability_of_goal_precision: { n_met: 3996, n_informative: 4000 }, probability_of_goal_drivers: { drivers: [row()] } }],
      inference_warnings: [] };
    const stripped = withholdOptionGoalFigures(before, new Set([A]), warning());
    const out = withGoalChanceRange(stripped, graph(), inputs());
    expect(out.option_comparison).toEqual(stripped.option_comparison);
    expect(out.option_comparison[0]).toEqual({ option_id: A });
    expect(record(out)?.range_by_option[A]).toEqual(expected);
    expect(runWithheldGoalFigures(out)).toBe(true);
  });

  it('range is not a withheld code and cannot affect runWithheldGoalFigures', () => {
    expect(GOAL_FIGURES_WITHHELD_CODES.has(GOAL_CHANCE_RANGE)).toBe(false);
    const out = withGoalChanceRange(envelope(), graph(), inputs());
    expect(runWithheldGoalFigures(out)).toBe(true);
    expect(runWithheldGoalFigures({ inference_warnings: [record(out)] })).toBe(false);
  });
});

describe('ruling 2: both goal-chance records copy only the envelope\'s A7 info record', () => {
  it('range and licence carry horizon_untested and the exact original message, with no figure change', () => {
    const e = envelope(); e.inference_warnings.push(horizon);
    const out = withGoalChanceLicence(withGoalChanceRange(e, graph(), inputs()), graph(), TO);
    for (const code of [GOAL_CHANCE_RANGE, GOAL_CHANCE_LICENSED]) {
      expect(record(out, code)).toMatchObject({ code, horizon_untested: true, horizon_line: line });
    }
    expect(record(out)?.option_ids).toEqual([A]);
    expect(record(out, GOAL_CHANCE_LICENSED)).toMatchObject({ option_ids: [A, B], withheld_option_ids: [A], pct_by_option: { [B]: 63 }, form: 'each' });
    expect(out.option_comparison).toEqual(e.option_comparison);
  });

  it('both fields are absent without the A7 record even when the graph holds a deadline', () => {
    const g = graph(); g.nodes.find((n: Json) => n.id === TO).goal_horizon_months = 12;
    const out = withGoalChanceLicence(withGoalChanceRange(envelope(), g, inputs()), g, TO);
    for (const code of [GOAL_CHANCE_RANGE, GOAL_CHANCE_LICENSED]) {
      expect(record(out, code)?.code).toBe(code);
      expect(record(out, code)).not.toHaveProperty('horizon_untested');
      expect(record(out, code)).not.toHaveProperty('horizon_line');
    }
  });
});

const M1 = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = 'c8108752-0000-4000-8000-0000000000a7';
async function runOn(g: Json, body: Json): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(g), briefText: M1._provenance.brief_text })),
    loadGraph: vi.fn(async () => clone(g)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-range-load', store as never);
  const run = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({ context: {
    stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: SCENARIO, request_id: 'req-range-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
  }, payload: makeMessagePayload({ turn_id: 't-range', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
  requestId: 'req-range-run', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  expect(fact.fact_type).toBe('run_analysis');
  if (fact.fact_type !== 'run_analysis') throw new Error('Expected the real run_analysis fact');
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Json;
}

/** Real served fixture, one unsized price→churn link; every other guessed route is made user-sized. */
function servedGraph(placeholder: boolean): Json {
  const g = clone(M1.graph);
  for (const e of g.edges as Json[]) {
    if (e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') {
      e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
    }
    if (placeholder && e.from === 'pro_plan_price' && e.to === 'monthly_churn_rate') {
      e.provenance = { ...(e.provenance ?? {}), source: 'cee_hypothesis', magnitude: 'olumi_placeholder' };
    }
  }
  return g;
}

describe('real loader and run-analysis handler', () => {
  it('captures the driver before placeholder stripping, stores its range and copies the real horizon record', async () => {
    const body = clone(M1.plot_body);
    body.option_comparison.find((r: Json) => r.option_id === '59_price').probability_of_goal_drivers = {
      drivers: [row({ from: 'pro_plan_price', to: 'monthly_churn_rate', quantity_id: 'pro_plan_price->monthly_churn_rate' })],
    };
    body.option_comparison.find((r: Json) => r.option_id === '59_price').probability_of_goal_precision = { n_met: 3972, n_informative: 4000 };
    const result = await runOn(servedGraph(true), body);
    const e = result.enrichment as Json;
    expect(record(e)).toMatchObject({ code: GOAL_CHANCE_RANGE, option_ids: ['59_price'], horizon_untested: true,
      horizon_line: record(e, GOAL_HORIZON_NOT_TESTED)?.message,
      range_by_option: { '59_price': { ...expected, from: 'pro_plan_price', to: 'monthly_churn_rate' } } });
    expect(record(e, GOAL_HORIZON_NOT_TESTED)).toMatchObject({ code: GOAL_HORIZON_NOT_TESTED,
      message: "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £85,000 within 12 months.", node_ids: ['mrr'] });
    expect(e.option_comparison.find((r: Json) => r.option_id === '59_price')).toMatchObject({ option_id: '59_price' });
    for (const key of ['probability_of_goal', 'probability_of_goal_precision', 'probability_of_goal_drivers', 'win_probability']) {
      expect(e.option_comparison.find((r: Json) => r.option_id === '59_price')).not.toHaveProperty(key);
    }
  });

  it('a licensed real Run carries the same horizon sentence', async () => {
    const result = await runOn(servedGraph(false), clone(M1.plot_body));
    const e = result.enrichment as Json;
    expect(record(e, GOAL_CHANCE_LICENSED)).toMatchObject({ code: GOAL_CHANCE_LICENSED,
      option_ids: ['59_price', 'current_price'], horizon_untested: true, horizon_line: record(e, GOAL_HORIZON_NOT_TESTED)?.message });
    expect(record(e)).toBeUndefined();
  });
});

// ⛔ S1 review r1 #4: until the Agent has a ruled sentence for a range (PR-S2), the record never reaches its view raw.
describe('the Agent view carries no GOAL_CHANCE_RANGE record', () => {
  it('analysisResultForAgent drops the record at both levels; other warnings stay', async () => {
    const { analysisResultForAgent } = await import('../../agent-lane/decision-sensitivity.js');
    const rangeRecord = { code: GOAL_CHANCE_RANGE, severity: 'info', message: 'm', option_ids: [A], range_by_option: { [A]: expected } };
    const block = { inference_warnings: [rangeRecord, horizon], enrichment: { inference_warnings: [rangeRecord, horizon], option_comparison: [{ option_id: A }] } };
    const view = analysisResultForAgent(block) as Json;
    for (const ws of [view.inference_warnings, view.enrichment.inference_warnings]) {
      expect(ws.some((w: Json) => w.code === GOAL_CHANCE_RANGE)).toBe(false);
      expect(ws.some((w: Json) => w.code === GOAL_HORIZON_NOT_TESTED)).toBe(true); // CONTROL
    }
    expect(JSON.stringify(view)).not.toContain('range_by_option');
  });
});
