/**
 * ⛔⛔ A PERCENT LIMIT REACHES PLoT FRAMED ONLY WHERE PLoT READS IT ON THE LEVEL'S OWN SCALE (#70 5843365832).
 *
 * WIRE (engine-direct, PLoT b09c0f2 · ISL 2795a8c; AI Quality `quality-evidence/pct-cap-contrast-20260926/`): C50 U3b
 * with only ROOT `fac_churn`'s encoding changed, one limit `<= 10 "%"` framed `level`:
 *   · the same 4% level scored P(meet) 1 framed on 100 and 0.017 framed on 20;
 *   · the same 12% level scored 0.017 framed on 100 and 1 framed on 200 — a broken limit reported as met;
 *   · all four `unit_percent`, `decision_grade: true`.
 * The frame is what lets that number through, so `run_analysis` sends such a limit UNFRAMED on its wire copy (ISL then
 * refuses it: "could not be checked"). Derived from the graph the run reads — never persisted — and applied to every
 * writer's row: agent-lane admission (`agent-lane:`) and V5 `add_constraint` (`gc-`).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { unprovablePercentFrameIds, withholdUnprovablePercentFrames } from '../level-limit-baseline.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

type Rec = Record<string, unknown>;
const CHURN = 'Monthly churn';

/** Root churn (no in-edge) with the given level shape — the WIRE contrast's node. */
function graphWith(churn: Rec): Rec {
  return {
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      { id: 'fac_churn', kind: 'factor', label: CHURN, ...churn },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_mrr' },
      { from: 'fac_churn', to: 'goal_mrr' },
    ],
  };
}
const ON_20 = { observed_state: { value: 0.2, raw_value: 4, cap: 20, unit: '%' } };
const ESTIMATE_ON_20 = { scale_frame: 20, observed_state: { value: 0.2, raw_value: 4, unit: '%', source: 'cee_inference' } };
const ON_200 = { observed_state: { value: 0.06, raw_value: 12, cap: 200, unit: '%' } };
const ON_100 = { observed_state: { value: 0.04, raw_value: 4, cap: 100, unit: '%' } };
const ESTIMATE_ON_100 = { scale_frame: 100, observed_state: { value: 0.07, raw_value: 7, source: 'cee_inference' } };
const FRAMED_NO_LEVEL = { scale_frame: 100 };
const NO_LEVEL_NO_FRAME = {};

const limit = (extra: Rec = {}): Rec => ({
  constraint_id: 'agent-lane:fac_churn:<=', node_id: 'fac_churn', operator: '<=', value: 10, unit: '%', value_frame: 'level', ...extra,
});

describe('the wire copy withholds a percent frame the target level cannot prove', () => {
  it.each([
    ['a stated level on cap 20 (WIRE 0.017 for a 4% level)', ON_20],
    ['an estimate framed on 20', ESTIMATE_ON_20],
    ['a stated level on cap 200 (WIRE 1 for a 12% level)', ON_200],
    ['a node with no level and no frame', NO_LEVEL_NO_FRAME],
  ])('RED: "10 %%" framed level on %s → sent without value_frame; the rest of the row is kept', (_n, churn) => {
    const g = graphWith(churn);
    const out = withholdUnprovablePercentFrames(g, [limit()]) as Rec[];
    expect(out).toEqual([{ constraint_id: 'agent-lane:fac_churn:<=', node_id: 'fac_churn', operator: '<=', value: 10, unit: '%' }]);
    expect(unprovablePercentFrameIds(g, [limit()])).toEqual(['agent-lane:fac_churn:<=']);
  });

  it('RED: a DELTA frame, and the spellings "percent" and "pct", are withheld the same way', () => {
    const g = graphWith(ON_20);
    for (const extra of [{ value_frame: 'delta' }, { unit: 'percent' }, { unit: 'pct' }]) {
      expect(unprovablePercentFrameIds(g, [limit(extra)]), JSON.stringify(extra)).toEqual(['agent-lane:fac_churn:<=']);
    }
  });

  it('RED: an add_constraint row (gc-…) is covered at the same site', () => {
    const g = graphWith(ON_20);
    expect(unprovablePercentFrameIds(g, [limit({ constraint_id: 'gc-1a2b' })])).toEqual(['gc-1a2b']);
  });

  it('RED: a limit whose node is not on the graph has no level to prove — withheld', () => {
    expect(unprovablePercentFrameIds(graphWith(ON_100), [limit({ node_id: 'fac_absent', constraint_id: 'gc-absent' })])).toEqual(['gc-absent']);
  });

  it('the input array and its rows are never mutated (the record is the user\'s)', () => {
    const rows = [limit()];
    const before = JSON.stringify(rows);
    withholdUnprovablePercentFrames(graphWith(ON_20), rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('CONTROLS — the frame is kept wherever PLoT reads the limit on the level\'s own scale', () => {
  it.each([
    ['a stated level on cap 100', ON_100],
    ['the served agent-lane estimate (scale_frame 100)', ESTIMATE_ON_100],
    ['#1965\'s converted factor: framed on 100, no level yet', FRAMED_NO_LEVEL],
    ['the served capless proportion (0.07, no unit)', { observed_state: { value: 0.07 } }],
  ])('"10 %%" framed level on %s keeps value_frame (the SAME array is returned)', (_n, churn) => {
    const rows = [limit()];
    expect(withholdUnprovablePercentFrames(graphWith(churn), rows)).toBe(rows);
  });

  it('a NON-token spelling ("% per month") on a node framed on 20 keeps its frame: PLoT reads it on the node\'s cap', () => {
    const g = graphWith({ observed_state: { value: 0.2, raw_value: 4, cap: 20, unit: '% per month' } });
    expect(unprovablePercentFrameIds(g, [limit({ unit: '% per month' })])).toEqual([]);
  });

  it('a currency limit, an unframed limit and a unitless limit are left alone', () => {
    const g = graphWith(ON_20);
    expect(unprovablePercentFrameIds(g, [limit({ unit: '£' }), limit({ value_frame: undefined }), limit({ unit: undefined })])).toEqual([]);
  });

  it('a node carrying its own goal_threshold_cap is read on [0, cap] before the percent rung: left alone', () => {
    const g = graphWith({ ...ON_20, goal_threshold_cap: 20 });
    expect(unprovablePercentFrameIds(g, [limit()])).toEqual([]);
  });
});

// ── WIRE: through the real handler, the goal_constraints PLoT receives ─────────────────────────────────────────────────
const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'req-percent-frame-wire';

function persisted(churn: Rec) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      { id: 'fac_churn', kind: 'factor', label: CHURN, ...churn },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_churn', to: 'goal_mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}

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

async function sentConstraints(churn: Rec, rows: Rec[]): Promise<{ sent: Rec[]; recordAfter: string; recordBefore: string }> {
  const graph = persisted(churn);
  const goal_constraints = rows.map((r) => ({ ...r }));
  const recordBefore = JSON.stringify(goal_constraints);
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
  return { sent: captured!.goal_constraints as Rec[], recordAfter: JSON.stringify(goal_constraints), recordBefore };
}

describe('WIRE: the goal_constraints run_analysis sends to PLoT', () => {
  it('RED: a root churn framed on 20 — the limit reaches PLoT WITHOUT value_frame; the record keeps it', async () => {
    const { sent, recordAfter, recordBefore } = await sentConstraints(ON_20, [limit()]);
    expect(sent.find((c) => c.constraint_id === 'agent-lane:fac_churn:<=')).not.toHaveProperty('value_frame');
    expect(recordAfter).toBe(recordBefore);
    expect(JSON.parse(recordAfter)[0].value_frame).toBe('level');
  });

  it('RED: an add_constraint row on a root churn framed on 200 reaches PLoT without value_frame', async () => {
    const { sent } = await sentConstraints(ON_200, [limit({ constraint_id: 'gc-9f8e' })]);
    expect(sent.find((c) => c.constraint_id === 'gc-9f8e')).not.toHaveProperty('value_frame');
  });

  it('CONTROL: the same limit on churn framed on 100 reaches PLoT framed, byte-identical to the record', async () => {
    const { sent, recordBefore } = await sentConstraints(ON_100, [limit()]);
    expect(JSON.stringify(sent)).toBe(recordBefore);
  });

  it('CONTROL: only the unprovable row changes — a £ limit beside it is sent exactly as recorded', async () => {
    const pounds = { constraint_id: 'agent-lane:fac_price:<=', node_id: 'fac_price', operator: '<=', value: 59, unit: '£', value_frame: 'level' };
    const { sent } = await sentConstraints(ON_20, [limit(), pounds]);
    expect(sent.find((c) => c.constraint_id === 'agent-lane:fac_price:<=')).toEqual(pounds);
  });
});
