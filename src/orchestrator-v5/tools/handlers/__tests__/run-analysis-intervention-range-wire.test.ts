/**
 * TEMPORAL — the payload PLoT actually receives, through the REAL `run_analysis` handler with a mocked client.
 *
 * An option's stated range rides as `options[].intervention_ranges[factorId] = {low, high, meaning}` (PLoT #424) only
 * where the wire number is the raw point it brackets; with no range stated the options are byte-identical.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { diffRunInputs } from '../../../coaching/run-input-changes.js';

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-intervention-range-wire';
const RANGE = { low: 5, high: 20, meaning: 'likely_range', source: 'user_specified', source_quote: 'between 5 and 20 days' };

type Rec = Record<string, unknown>;
// The saved Run fact, read field by field in the snapshot rows below.
type Fact = Record<string, any>;

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

/** Lift-and-shift sets downtime to 10 days (raw); staying on-prem sets 0 days. A ≤ 14-day limit on downtime. */
async function wireOptions(range?: Rec): Promise<Rec[]> {
  return (await runOnce(range)).options;
}

/** The real handler, once: what PLoT received and the Run fact it saved. */
async function runOnce(range?: Rec): Promise<{ options: Rec[]; fact: Fact }> {
  const stayIv = { value: 0, raw_value: 0, unit: 'days', source: 'user_specified', target_match: { node_id: 'fac_downtime', match_type: 'exact_id', confidence: 'high' } };
  const liftIv = { value: 10, raw_value: 10, unit: 'days', source: 'user_specified', target_match: { node_id: 'fac_downtime', match_type: 'exact_id', confidence: 'high' }, ...(range ? { range } : {}) };
  const graph = GraphV3.parse({
    nodes: [
      { id: 'goal_cost', kind: 'goal', label: 'Annual cost' },
      { id: 'opt_lift', kind: 'option', label: 'Lift-and-shift', interventions: { fac_downtime: liftIv } },
      { id: 'opt_stay', kind: 'option', label: 'Stay on-prem', interventions: { fac_downtime: stayIv } },
      { id: 'fac_downtime', kind: 'factor', label: 'Migration downtime', observed_state: { value: 0, raw_value: 0, unit: 'days', source: 'user_override' } },
    ],
    edges: [
      { from: 'fac_downtime', to: 'goal_cost', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  });
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_lift', option_id: 'opt_lift', label: 'Lift-and-shift', interventions: { fac_downtime: liftIv } },
      { id: 'opt_stay', option_id: 'opt_stay', label: 'Stay on-prem', interventions: { fac_downtime: stayIv } },
    ],
    goal_node_id: 'goal_cost',
    goal_constraints: [{ node_id: 'fac_downtime', operator: '<=', value: 14, unit: 'days', value_frame: 'level' }],
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Rec | undefined;
  const run = vi.fn((payload: Rec) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const result = await createRunAnalysisHandler({ plotClient, scenarioReader })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  const fact = (result.handler_facts as unknown as Fact[]).find((f) => f.fact_type === 'run_analysis');
  return { options: captured!.options as Rec[], fact: fact! };
}

describe('WIRE: run_analysis forwards an option\'s stated range to PLoT', () => {
  it('RED: the lift-and-shift option carries {low, high, meaning} beside its raw 10 days — no author, no quote', async () => {
    const options = await wireOptions(RANGE);
    const lift = options.find((o) => o.id === 'opt_lift')!;
    expect(lift.interventions).toEqual({ fac_downtime: 10 });
    expect(lift.intervention_ranges).toEqual({ fac_downtime: { low: 5, high: 20, meaning: 'likely_range' } });
    expect(options.find((o) => o.id === 'opt_stay')!.intervention_ranges).toBeUndefined();
  });

  it('CONTROL: no range stated → no `intervention_ranges` key on any option', async () => {
    const options = await wireOptions();
    expect(options.every((o) => !Object.hasOwn(o, 'intervention_ranges'))).toBe(true);
  });

  it('a range that does not contain the option\'s value never reaches PLoT', async () => {
    const options = await wireOptions({ ...RANGE, low: 12, high: 30 });
    expect(options.every((o) => !Object.hasOwn(o, 'intervention_ranges'))).toBe(true);
  });

  // CODEX CEE BUDDY 5921095058: the Run's input snapshot records the options AS DISPATCHED, range included, so a
  // range-only edit (5–20 → 5–30 days) is a recorded input change, never "complete" with no rows.
  it('RED: the saved Run snapshot carries the range as sent, and 5–20 → 5–30 days is an input change', async () => {
    const a = await runOnce(RANGE);
    const b = await runOnce({ ...RANGE, high: 30 });
    const setting = (fact: Fact) => ((fact.result.input_snapshot.options as Rec[]).find((o) => o.option_id === 'opt_lift')!
      .settings as Rec[]).find((st) => st.factor_id === 'fac_downtime')!;
    expect(setting(a.fact).range).toEqual({ low: 5, high: 20, meaning: 'likely_range', source: 'user_specified', source_quote: 'between 5 and 20 days' });
    expect(setting(b.fact).range).toMatchObject({ low: 5, high: 30 });
    const diff = diffRunInputs(a.fact.result.input_snapshot, b.fact.result.input_snapshot);
    // AIQ 5921102025: a range-only pair reads PARTIAL (#2378's rule for a range difference), never complete with no rows.
    expect(diff.complete, 'a range-only change reads partial').toBe(false);
  });

  it('CONTROL: with no range, the snapshot setting has no range key and two identical Runs diff as complete, no rows', async () => {
    const a = await runOnce();
    const b = await runOnce();
    const setting = ((a.fact.result.input_snapshot.options as Rec[]).find((o) => o.option_id === 'opt_lift')!.settings as Rec[])
      .find((st) => st.factor_id === 'fac_downtime')!;
    expect(Object.hasOwn(setting, 'range')).toBe(false);
    expect(diffRunInputs(a.fact.result.input_snapshot, b.fact.result.input_snapshot)).toEqual({ rows: [], complete: true });
  });
});
