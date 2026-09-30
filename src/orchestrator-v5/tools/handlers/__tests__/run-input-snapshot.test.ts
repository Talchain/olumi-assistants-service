/**
 * SC-24 — the input a Run was sent, captured from the REAL `run_analysis` request (lease DL #75 5915191128).
 *
 * Every row drives `createRunAnalysisHandler` with a stub PLoT client and reads the snapshot off the payload the
 * handler actually built — never a hand-written request. The output is parsed with the contract's own zod module
 * (schemas #76, test-only copy until CEE vendors the release).
 *   acceptance: Run A (£59) → £60 → Run B: the two snapshots differ in exactly that one option setting, in the
 *               user's unit, and the digests differ; the goal unit is exactly the authored `goal_threshold_unit`;
 *   absence:    a goal with no authored unit carries no unit (never GBP by default);
 *   identity:   the same request twice gives the same digest (the request id is not an input).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { captureRunInputSnapshot, sentDigest, type RunInputSnapshot } from '../run-input-snapshot.js';
import { RunInputSnapshotSchema } from './fixtures/schemas-76-run-input-snapshot.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Paul's pricing shape: an MRR goal authored in "GBP per month", keep £49 vs raise to `raisedTo`. */
function graphWith(raisedTo: number, goalUnit: string | null = 'GBP per month') {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR', goal_threshold_raw: 100000, ...(goalUnit !== null ? { goal_threshold_unit: goalUnit } : {}), goal_direction: '>=', goal_threshold: 0.8 },
      { id: 'opt_keep', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.49, raw_value: 49, unit: 'GBP per month', source: 'brief_extraction' } } },
      { id: 'opt_raise', kind: 'option', label: `Raise to £${raisedTo}`, interventions: { fac_price: { value: raisedTo / 100, raw_value: raisedTo, unit: 'GBP per month', source: 'user_stated' } } },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, unit: 'GBP per month', source: 'brief_extraction', extractionType: 'explicit' } },
    ],
    edges: [{ from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' }],
  });
}

async function sentRequest(raisedTo: number, requestId: string, goalUnit: string | null = 'GBP per month'): Promise<Rec> {
  const graph = graphWith(raisedTo, goalUnit);
  const snapshot = {
    graph, goal_node_id: 'goal_mrr', rawPersistedGraph: graph,
    options: [
      { id: 'opt_keep', option_id: 'opt_keep', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_raise', option_id: 'opt_raise', label: `Raise to £${raisedTo}`, interventions: { fac_price: raisedTo / 100 } },
    ],
  } as RunAnalysisScenarioSnapshot;
  let captured: Rec | undefined;
  const run = vi.fn((payload: Rec) => { captured = payload; return Promise.resolve(JSON.parse(JSON.stringify(happy)) as V2RunResponseEnvelope); });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const invocation = {
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO_ID, request_id: requestId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
  await createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(() => Promise.resolve(snapshot)) })(invocation);
  expect(run).toHaveBeenCalledOnce();
  return captured!;
}

const settingOf = (s: RunInputSnapshot, optionId: string, factorId: string) =>
  s.options.find((o) => o.option_id === optionId)?.settings.find((x) => x.factor_id === factorId);

describe('captureRunInputSnapshot — from the request run_analysis really sends', () => {
  it('acceptance: Run A (£59) → £60 → Run B differ in exactly that one setting, in the user\'s unit', async () => {
    const a = captureRunInputSnapshot(await sentRequest(59, 'req-run-a'))!;
    const b = captureRunInputSnapshot(await sentRequest(60, 'req-run-b'))!;
    expect(RunInputSnapshotSchema.parse(a)).toEqual(a);
    expect(RunInputSnapshotSchema.parse(b)).toEqual(b);

    expect(settingOf(a, 'opt_raise', 'fac_price')).toEqual({ factor_id: 'fac_price', label: 'Pro plan price', raw: 59, unit: 'GBP per month', encoded: 0.59 });
    expect(settingOf(b, 'opt_raise', 'fac_price')).toMatchObject({ raw: 60, unit: 'GBP per month', encoded: 0.6 });
    expect(settingOf(b, 'opt_keep', 'fac_price')).toEqual(settingOf(a, 'opt_keep', 'fac_price'));
    expect(a.sent_digest).not.toBe(b.sent_digest);

    // The goal the gate reads: the authored unit exactly, the target in that unit, the user's held comparator.
    expect(a.goal).toEqual({ node_id: 'goal_mrr', label: 'MRR', target_raw: 100000, unit: 'GBP per month', operator: '>=' });
    expect(a.factors).toContainEqual({ factor_id: 'fac_price', label: 'Pro plan price', raw: 49, unit: 'GBP per month', encoded: 0.49, source: 'brief_extraction' });
    expect(a.links).toEqual([{ from: 'fac_price', to: 'goal_mrr', mean: 0.6, std: 0.1, exists_probability: 0.9 }]);
  });

  it('a goal with no authored unit carries NO unit — never GBP by default', async () => {
    const s = captureRunInputSnapshot(await sentRequest(59, 'req-no-unit', null))!;
    expect(RunInputSnapshotSchema.parse(s)).toEqual(s);
    expect(s.goal).not.toHaveProperty('unit');
  });

  it('the request id is not an input: the same request twice has the same digest', async () => {
    const first = await sentRequest(59, 'req-one');
    const second = await sentRequest(59, 'req-two');
    expect(first.request_id).not.toBe(second.request_id);
    expect(sentDigest(first)).toBe(sentDigest(second));
  });

  it('a value CEE held for an option (the node sets nothing there) is marked held; a limit is copied as sent', () => {
    const payload: Rec = {
      goal_node_id: 'goal_mrr', request_id: 'r',
      graph: { nodes: [{ id: 'goal_mrr', kind: 'goal', label: 'MRR' }, { id: 'opt_sq', kind: 'option', label: 'Status quo' }, { id: 'fac_price', kind: 'factor', label: 'Price' }], edges: [] },
      options: [{ id: 'opt_sq', option_id: 'opt_sq', label: 'Status quo', is_baseline: true, interventions: { fac_price: 0.49 } }],
      goal_constraints: [
        { constraint_id: 'agent-lane:fac_churn:<=', node_id: 'fac_churn', operator: '<=', value: 4, unit: '%', value_frame: 'level', label: 'Monthly churn' },
        { constraint_id: 'odd', node_id: 'fac_churn', operator: '==', value: 4 },
      ],
    };
    const s = captureRunInputSnapshot(payload)!;
    expect(RunInputSnapshotSchema.parse(s)).toEqual(s);
    expect(s.options[0]).toEqual({ option_id: 'opt_sq', label: 'Status quo', is_baseline: true, settings: [{ factor_id: 'fac_price', label: 'Price', encoded: 0.49, held: true }] });
    expect(s.constraints).toEqual([{ constraint_id: 'agent-lane:fac_churn:<=', node_id: 'fac_churn', label: 'Monthly churn', operator: '<=', raw: 4, unit: '%', frame: 'level' }]);
    expect(s.goal).toEqual({ node_id: 'goal_mrr', label: 'MRR' });
  });

  it('options the Run was not sent are recorded with their reason; over the contract\'s bounds there is no snapshot', () => {
    const base: Rec = { goal_node_id: 'g', graph: { nodes: [], edges: [] }, options: [] };
    const s = captureRunInputSnapshot(base, [{ option_id: 'opt_pilot', label: 'Angel pilot', reason: 'olumi_proposed' }])!;
    expect(RunInputSnapshotSchema.parse(s).options_not_sent).toEqual([{ option_id: 'opt_pilot', label: 'Angel pilot', reason: 'olumi_proposed' }]);
    expect(s.goal).toBeNull();
    const tooMany = { ...base, options: Array.from({ length: 51 }, (_, i) => ({ id: `o${i}`, option_id: `o${i}`, interventions: {} })) };
    expect(captureRunInputSnapshot(tooMany)).toBeNull();
  });
});
