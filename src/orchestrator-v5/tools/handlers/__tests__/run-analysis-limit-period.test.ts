/**
 * ⛔⛔ A PERCENT LIMIT ON A DIFFERENT PERIOD NEVER REACHES PLoT AS "%" (rule1-limit-period, 28 Sep).
 *
 * WIRE, engine-direct on PLoT `22f3d94` (`canonical-state/rule1-limit-period/MEASURE.md`): PLoT never reads
 * `provenance_unit_relabelled` (0 reads in `src`), so a `"%"` limit is scored on its node's period whatever the user
 * said. "Annual churn under 10 %" relabelled to `"%"` on a `% per month` node scored P = 1 on every option,
 * decision-grade (J-a-10); in its own unit PLoT refuses it and names the unit (J-yn-10).
 *
 * Two ways such a row reaches the run, each bound here on the payload PLoT receives through the real handler:
 *   · a limit admitted NOW (`canonicaliseLimitUnit` keeps it verbatim);
 *   · a row already STORED as `"%"` with a relabel stamp from another period (admitted before the fix, or its node's
 *     unit rewritten since). The wire copy sends it in the unit it was stated in, with no stamp and no baseline.
 * The same-period relabel, and a bare `"%"`, reach PLoT exactly as today (CONTROLS).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { admitCandidateConstraints, type LimitTargetScale } from '../../../agent-lane/admit-constraint.js';
import { levelLimitBaselineNodeIds, withholdUnprovablePercentFrames } from '../level-limit-baseline.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const CHURN = 'Monthly churn';
const ID = 'agent-lane:fac_churn:<=';

/**
 * Paul's churn as captured (`base-paul-8bc6f257.request.json`): an Olumi estimate `{value 0.03, raw_value 3}` on
 * `scale_frame` 100, NON-ROOT (price → churn), so a `"%"` level limit on it carries the baseline today.
 */
function persisted(unit: string, raw = 3) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      {
        id: 'fac_churn', kind: 'factor', label: CHURN, scale_frame: 100,
        observed_state: { value: raw / 100, raw_value: raw, unit, source: 'cee_inference', extractionType: 'inferred' },
      },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      // Sized by Olumi in churn's unit, so R-c's parts predicate (AI Quality 5882087383) leaves this row's subject alone.
      { from: 'fac_price', to: 'fac_churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 1, amount_unit: 'percentage points', per_source_change: 10, per_source_change_unit: 'GBP per month', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } },
      { from: 'fac_churn', to: 'goal_mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}

/** The churn node's scale exactly as admission reads it (`admit-model.ts`: `{...observed_state, scale_frame}`). */
function targetScale(graph: ReturnType<typeof persisted>): LimitTargetScale {
  const churn = (graph.nodes as unknown as Rec[]).find((n) => n.id === 'fac_churn')!;
  return { ...(churn.observed_state as Rec), scale_frame: churn.scale_frame } as LimitTargetScale;
}

/** Admit ONE stated level limit on churn against the churn node on `graph`, as agent-lane admission does. */
function admitted(graph: ReturnType<typeof persisted>, value: number, unit: string): Rec[] {
  const { constraints } = admitCandidateConstraints(
    [{ metric: CHURN, operator: '<', value, unit, provenance: 'explicit', frame: 'level' }],
    (m) => (m === CHURN ? 'fac_churn' : undefined),
    (id) => (id === 'fac_churn' ? targetScale(graph) : undefined),
  );
  return constraints as unknown as Rec[];
}

/** A row stored BEFORE the fix: `"%"` with the stamp naming the unit as stated. */
const storedRelabel = (value: number, statedUnit: string): Rec => ({
  constraint_id: ID, node_id: 'fac_churn', operator: '<=', value, unit: '%', value_frame: 'level', provenance: 'explicit',
  label: CHURN,
  provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1', pre_normalisation_value: value, pre_normalisation_unit: statedUnit },
});

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REQUEST_ID = 'req-limit-period-wire';

function invocation(): HandlerInvocation {
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

/** The PLoT request `run_analysis` builds: the churn limit (by constraint_id) and the churn node's wire observed_state. */
async function plotRequest(graph: ReturnType<typeof persisted>, rows: Rec[]) {
  const goal_constraints = rows.map((r) => JSON.parse(JSON.stringify(r)) as Rec);
  const recordBefore = JSON.stringify(goal_constraints);
  const graphBefore = JSON.stringify(graph);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints,
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Rec | undefined;
  const run = vi.fn((payload: Rec) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  await createRunAnalysisHandler({ plotClient, scenarioReader })(invocation());
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.stringify(goal_constraints), 'the stored limit is never touched').toBe(recordBefore);
  expect(JSON.stringify(graph), 'the persisted graph is never touched').toBe(graphBefore);
  const limit = (captured!.goal_constraints as Rec[]).find((c) => c.constraint_id === ID);
  expect(limit, 'the churn limit reaches PLoT (found by its id)').toBeDefined();
  const churn = ((captured!.graph as { nodes: Rec[] }).nodes).find((n) => n.id === 'fac_churn')!;
  return { limit: limit!, os: churn.observed_state as Rec };
}

describe('row 5 (RED at base): a different-period limit never reaches PLoT as "%"', () => {
  it('ADMITTED NOW: "annual churn < 10 % per year" on the `% per month` churn → PLoT gets "% per year", no stamp, no baseline', async () => {
    const graph = persisted('% per month');
    const { limit, os } = await plotRequest(graph, admitted(graph, 10, '% per year'));
    expect(limit.unit).not.toBe('%');
    expect(limit).toMatchObject({ unit: '% per year', value: 10, value_frame: 'level' });
    expect(limit).not.toHaveProperty('provenance_unit_relabelled');
    expect(os.baseline, 'no baseline is carried for a limit PLoT cannot read on this level').toBeUndefined();
  });

  it('STORED before the fix: "%" relabelled from "% per year" on the `% per month` churn → PLoT gets "% per year", no stamp, no baseline', async () => {
    const { limit, os } = await plotRequest(persisted('% per month'), [storedRelabel(10, '% per year')]);
    expect(limit.unit).not.toBe('%');
    expect(limit).toMatchObject({ unit: '% per year', value: 10, value_frame: 'level' });
    expect(limit).not.toHaveProperty('provenance_unit_relabelled');
    expect(os.baseline).toBeUndefined();
  });

  it('STORED, the reverse: "%" relabelled from "% per month" on a `% per year` churn → PLoT gets "% per month"', async () => {
    const { limit, os } = await plotRequest(persisted('% per year', 30), [storedRelabel(4, '% per month')]);
    expect(limit).toMatchObject({ unit: '% per month', value: 4 });
    expect(os.baseline).toBeUndefined();
  });

  it('the node\'s unit rewritten since admission ("% per month" → "% per year") → the stored "%" goes out as "% per month"', () => {
    const graph = persisted('% per year', 30);
    const rows = [storedRelabel(4, '% per month')];
    const out = withholdUnprovablePercentFrames(graph, rows) as Rec[];
    expect(out[0]).toMatchObject({ constraint_id: ID, unit: '% per month', value: 4, value_frame: 'level' });
    expect(out[0]).not.toHaveProperty('provenance_unit_relabelled');
    expect(levelLimitBaselineNodeIds(graph, rows, 'goal_mrr').size).toBe(0);
  });
});

describe('CONTROLS: the same-period relabel and a bare "%" reach PLoT exactly as today', () => {
  it('ADMITTED NOW: "4 % per month" on the `% per month` churn → PLoT gets "%" 4, stamped, baseline = the level (0.03)', async () => {
    const graph = persisted('% per month');
    const { limit, os } = await plotRequest(graph, admitted(graph, 4, '% per month'));
    expect(limit).toMatchObject({ unit: '%', value: 4, value_frame: 'level', provenance_unit_relabelled: { pre_normalisation_unit: '% per month' } });
    expect(os.baseline).toBe(os.value);
    expect(os.baseline).toBeCloseTo(0.03, 12);
  });

  it('STORED: "%" relabelled from "% per month" on the `% per month` churn (Paul\'s captured row) → "%" as today', async () => {
    const { limit, os } = await plotRequest(persisted('% per month'), [storedRelabel(4, '% per month')]);
    expect(limit).toMatchObject({ unit: '%', value: 4, provenance_unit_relabelled: { pre_normalisation_unit: '% per month' } });
    expect(os.baseline).toBe(os.value);
  });

  it('a bare "%" limit → "%" as today, baseline carried', async () => {
    const graph = persisted('% per month');
    const { limit, os } = await plotRequest(graph, admitted(graph, 4, '%'));
    expect(limit).toMatchObject({ unit: '%', value: 4 });
    expect(limit).not.toHaveProperty('provenance_unit_relabelled');
    expect(os.baseline).toBe(os.value);
  });

  it('with nothing to restore, withholdUnprovablePercentFrames returns the SAME array', () => {
    const rows = [storedRelabel(4, '% per month')];
    expect(withholdUnprovablePercentFrames(persisted('% per month'), rows)).toBe(rows);
  });
});
