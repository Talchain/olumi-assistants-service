/**
 * A LEVEL LIMIT ON A NODE THE OPTIONS MOVE IS CHECKED AGAINST THAT NODE'S CURRENT LEVEL — carried on the wire at run
 * time, never persisted (`level-limit-baseline.ts`).
 *
 * ⚠ WHY (WIRE, #70 5841905430 / accepted 5841918509): on Paul's pricing brief the churn limit reads "could not be
 * checked". Churn is NON-ROOT (price → churn), and ISL checks a level limit there only as `baseline + (option − status
 * quo)`, refusing without `observed_state.baseline` (`missing_target_baseline`, C50 L2). The node's current level is
 * already on it (`observed_state.value`), so the carrier is that value — never a new number.
 *
 * ⚠ REVIEW 5842183627 (CHANGES_REQUIRED on `ee5623b1`, which persisted the carrier at admission):
 *   · B1 — a `"%"` limit ≤ 1 carried a baseline, and PLoT reads such a row as a FRACTION beside a batch-mate above 1:
 *     "0.5%" certified as 50%. Rows `B1:` below.
 *   · B2 — a persisted copy went stale when the user corrected the level (`set_factor_value` rewrites `value`, never
 *     `baseline`). Rows `B2:` below: nothing is persisted, and the run reads the level on the model at that moment.
 *
 * Every row binds the churn node BY LABEL → id and asserts the baseline by identity with the node's own value.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { admitCandidateModel, type CandidateModel } from '../../../agent-lane/admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../../../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot, type ScenarioReader } from '../run-analysis.js';
import { carryLevelLimitBaselines, levelLimitBaselineNodeIds } from '../level-limit-baseline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';

const faithful = JSON.parse(
  readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/faithful.json', 'utf-8'),
) as CandidateModel;
const CHURN = 'Monthly churn rate';

type Churn = { unit: string; baseline_known: boolean; baseline_value: number; plausible_max?: number };
type Limit = { metric?: string; value: number; unit?: string; frame?: 'level' | 'delta' };
/** The served churn shape (F runs): an Olumi ESTIMATE of 7%, framed on 100 → `{value 0.07, raw 7}` + `scale_frame 100`. */
const ESTIMATE: Churn = { unit: '%', baseline_known: false, baseline_value: 7, plausible_max: 100 };
/** Paul's other limit: a £ cap whose value leaves [0,1], so PLoT normalises EVERY row of the batch. */
const BUDGET = { metric: 'MRR', operator: '>=', value: 20000, unit: '£', provenance: 'explicit', frame: 'level' };

function candidate(churn: Churn, limits: Limit[], opts: { churnIsRoot?: boolean } = {}): CandidateModel {
  return {
    ...faithful,
    factors: [
      ...faithful.factors.filter((f) => f.label !== CHURN),
      { label: CHURN, role: 'observable', provenance: 'explicit', ...churn },
    ],
    // The fixture's price → churn link is unsigned (`direction: 'unknown'`), which admission withholds by ruling, so
    // churn would be a ROOT. Paul's served graph has it non-root (PLoT: "calculated from the factors feeding into
    // it"), so the link is signed here: a higher price, higher churn.
    links: opts.churnIsRoot === true
      ? faithful.links.filter((l) => !(l.from === 'Pro plan price' && l.to === CHURN))
      : faithful.links.map((l) => (l.from === 'Pro plan price' && l.to === CHURN ? { ...l, direction: 'positive' } : l)),
    constraints: limits.map((limit) =>
      limit.metric === 'MRR' && limit.unit === '£'
        ? BUDGET
        : {
            metric: limit.metric ?? CHURN, operator: '<', value: limit.value, provenance: 'explicit',
            ...(limit.unit !== undefined ? { unit: limit.unit } : {}),
            ...(limit.frame !== undefined ? { frame: limit.frame } : {}),
          }),
  } as unknown as CandidateModel;
}

type WireNode = { id: string; label?: string; observed_state?: { value?: number; baseline?: number }; scale_frame?: number };

/** Admit the model, then derive the wire graph exactly as `run_analysis` does. */
function carried(churn: Churn, limits: Limit[], opts: { churnIsRoot?: boolean } = {}) {
  const m = admitCandidateModel(candidate(churn, limits, opts));
  const admitted = m.nodes.find((n) => n.label === CHURN) as unknown as WireNode | undefined;
  expect(admitted, 'the churn factor is admitted').toBeDefined();
  const goal = m.nodes.find((n) => n.kind === 'goal');
  const graph = { nodes: m.nodes, edges: m.edges };
  const wire = carryLevelLimitBaselines(graph, m.goal_constraints, goal?.id) as unknown as { nodes: WireNode[] };
  return {
    m,
    admitted: admitted!,
    ids: levelLimitBaselineNodeIds(graph, m.goal_constraints, goal?.id),
    wire: wire.nodes.find((n) => n.id === admitted!.id)!,
  };
}

describe('a level limit on a non-root node is checked against that node\'s current level', () => {
  // ── RED before #1919: no baseline, so ISL refuses `missing_target_baseline` ──
  it('the served shape: a "%" limit on the churn ESTIMATE framed on 100 carries baseline = its own value (0.07)', () => {
    const { admitted, ids, wire } = carried(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }]);
    expect(admitted.scale_frame).toBe(100);
    expect(ids).toEqual(new Set([admitted.id]));
    expect(wire.observed_state?.value).toBeCloseTo(0.07, 12);
    expect(wire.observed_state?.baseline).toBe(wire.observed_state?.value);
  });

  it('beside Paul\'s £ limit (the batch PLoT normalises) the churn limit still carries it', () => {
    const { admitted, ids } = carried(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }, { metric: 'MRR', value: 20000, unit: '£' }]);
    expect(ids).toEqual(new Set([admitted.id]));
  });

  it('a "percent per month" limit (canonicalised to "%" on that node) carries it too', () => {
    const { admitted, ids } = carried({ ...ESTIMATE, unit: 'percent per month' }, [{ value: 10, unit: 'percent per month', frame: 'level' }]);
    expect(ids).toEqual(new Set([admitted.id]));
  });

  it('the top of the percent range, "≤ 100%", carries it (PLoT reads it unclamped)', () => {
    const { admitted, ids } = carried(ESTIMATE, [{ value: 100, unit: '%', frame: 'level' }]);
    expect(ids).toEqual(new Set([admitted.id]));
  });

  // ── B1: a "%" row PLoT may read as a fraction never carries ──
  it('B1: "0.5%" beside a £ limit carries NOTHING (PLoT would read it as 50% and certify it)', () => {
    const { ids, wire } = carried(ESTIMATE, [{ value: 0.5, unit: '%', frame: 'level' }, { metric: 'MRR', value: 20000, unit: '£' }]);
    expect(ids.size).toBe(0);
    expect(wire.observed_state?.baseline).toBeUndefined();
  });

  it('B1: exactly "1%" carries nothing (PLoT\'s fraction reading covers [0,1])', () => {
    expect(carried(ESTIMATE, [{ value: 1, unit: '%', frame: 'level' }]).ids.size).toBe(0);
  });

  it('B1: "100.5%" carries nothing (PLoT clamps above 100)', () => {
    expect(carried(ESTIMATE, [{ value: 100.5, unit: '%', frame: 'level' }]).ids.size).toBe(0);
  });

  // ── CONTROLS: never carried where it would be wrong or pointless ──
  it('CONTROL: a "%" limit on a node framed on 20 carries nothing (PLoT would read "≤ 10%" on [0,100] against raw/20)', () => {
    const { admitted, ids } = carried({ ...ESTIMATE, plausible_max: 20 }, [{ value: 10, unit: '%', frame: 'level' }]);
    expect(admitted.scale_frame).toBe(20);
    expect(ids.size).toBe(0);
  });

  it('CONTROL: a KNOWN level on a capped node, limit in the node\'s own spelling, carries nothing (not the proven "%" shape)', () => {
    const { ids } = carried({ unit: 'percent per month', baseline_known: true, baseline_value: 7, plausible_max: 20 }, [{ value: 10, unit: 'percent per month', frame: 'level' }]);
    expect(ids.size).toBe(0);
  });

  it('CONTROL: a UNITLESS limit carries nothing', () => {
    expect(carried(ESTIMATE, [{ value: 10, frame: 'level' }]).ids.size).toBe(0);
  });

  it('CONTROL: a ROOT target carries nothing (ISL reads a root at its own level)', () => {
    expect(carried(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }], { churnIsRoot: true }).ids.size).toBe(0);
  });

  it('CONTROL: a DELTA limit carries nothing', () => {
    expect(carried(ESTIMATE, [{ value: 2, unit: '%', frame: 'delta' }]).ids.size).toBe(0);
  });

  it('CONTROL: an UNFRAMED limit carries nothing (it keeps failing closed at the frame hop)', () => {
    expect(carried(ESTIMATE, [{ value: 10, unit: '%' }]).ids.size).toBe(0);
  });

  it('CONTROL: a node with no level at all carries nothing', () => {
    const { ids } = carried({ unit: '%', baseline_known: false, baseline_value: Number.NaN }, [{ value: 10, unit: '%', frame: 'level' }]);
    expect(ids.size).toBe(0);
  });

  it('CONTROL: a limit on the GOAL carries nothing through this path (#1840 owns the goal\'s)', () => {
    expect(carried(ESTIMATE, [{ metric: 'MRR', value: 20000, unit: '£' }]).ids.size).toBe(0);
  });

  it('FILL-ONLY: an existing baseline, whoever wrote it, is never overwritten', () => {
    const m = admitCandidateModel(candidate(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }]));
    const nodes = m.nodes.map((n) => (n.label === CHURN ? { ...n, observed_state: { ...n.observed_state!, baseline: 0.05 } } : n));
    const churnId = nodes.find((n) => n.label === CHURN)!.id;
    const wire = carryLevelLimitBaselines({ nodes, edges: m.edges }, m.goal_constraints) as unknown as { nodes: WireNode[] };
    expect(levelLimitBaselineNodeIds({ nodes, edges: m.edges }, m.goal_constraints).size).toBe(0);
    expect(wire.nodes.find((n) => n.id === churnId)!.observed_state?.baseline).toBe(0.05);
  });
});

describe('B2: nothing is persisted, so nothing can go stale', () => {
  it('admission writes NO baseline on the churn node (every value writer spreads observed_state)', () => {
    const { admitted } = carried(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }]);
    expect(admitted.observed_state?.value).toBeCloseTo(0.07, 12);
    expect(admitted.observed_state?.baseline).toBeUndefined();
  });

  it('WIRE: the churn node /graph/register persists carries no baseline', async () => {
    let registered: { nodes?: Array<Record<string, unknown>> } | null = null;
    const fn = vi.fn(async () => ({ text: JSON.stringify(candidate(ESTIMATE, [{ value: 10, unit: '%', frame: 'level' }])) })) as unknown as CallStructuredModel;
    const dispatch = (async (path: string, body: unknown) => {
      if (path.endsWith('/graph/register')) { registered = (body as { graph: typeof registered }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
      if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
      return { status: 200, json: { versions: [] } };
    }) as unknown as InternalDispatch;
    await buildModelFromBrief('88888888-8888-4888-8888-888888888888', 'Should we raise the Pro price from £49 to £59? Keep monthly churn under 10%.', dispatch, fn);
    const node = (registered as { nodes?: Array<Record<string, unknown>> } | null)?.nodes?.find((n) => n.label === CHURN);
    expect(node, 'the churn node was registered').toBeDefined();
    const os = node!.observed_state as { value?: number; baseline?: number };
    expect(typeof os.value).toBe('number');
    expect(os.baseline).toBeUndefined();
  });
});

// ── WIRE: the payload PLoT actually receives, through the real handler with a mocked client ──
const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'req-level-limit-baseline-wire';

/** Churn as the served estimate after the user's value edit: `set_factor_value` writes `{...os, value, raw_value}`. */
function persistedGraph(churnRaw: number) {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
      { id: 'fac_price', kind: 'factor', label: 'Pro plan price' },
      {
        id: 'fac_churn', kind: 'factor', label: CHURN, scale_frame: 100,
        observed_state: { value: churnRaw / 100, raw_value: churnRaw, source: 'cee_inference', extractionType: 'inferred' },
      },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_price', to: 'fac_churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'fac_churn', to: 'goal_mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
    ],
  });
}

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

async function payloadFor(churnRaw: number, limit: Record<string, unknown>) {
  const graph = persistedGraph(churnRaw);
  const before = JSON.stringify(graph);
  const snapshot: RunAnalysisScenarioSnapshot = {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Keep £49', interventions: { fac_price: 0.49 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Raise to £59', interventions: { fac_price: 0.59 } },
    ],
    goal_node_id: 'goal_mrr',
    goal_constraints: [{ node_id: 'fac_churn', operator: '<=', ...limit }],
    rawPersistedGraph: graph,
  };
  const scenarioReader: ScenarioReader = vi.fn(() => Promise.resolve(snapshot));
  let captured: Record<string, unknown> | undefined;
  const run = vi.fn((payload: Record<string, unknown>) => {
    captured = payload;
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  await createRunAnalysisHandler({ plotClient, scenarioReader })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  expect(JSON.stringify(graph), 'the persisted graph is never touched').toBe(before);
  const churn = ((captured!.graph as { nodes: WireNode[] }).nodes).find((n) => n.id === 'fac_churn')!;
  return churn.observed_state!;
}

describe('WIRE: run_analysis sends the level the model holds NOW', () => {
  it('Paul\'s churn limit reaches PLoT with baseline = the estimate on the model (0.07)', async () => {
    const os = await payloadFor(7, { value: 10, unit: '%', value_frame: 'level' });
    expect(os.baseline).toBe(os.value);
    expect(os.baseline).toBeCloseTo(0.07, 12);
  });

  it('B2: after the user corrects churn to 12%, the run checks against 0.12 — not the 7% they replaced', async () => {
    const os = await payloadFor(12, { value: 10, unit: '%', value_frame: 'level' });
    expect(os.baseline).toBeCloseTo(0.12, 12);
  });

  it('B1 at the wire: a "0.5%" limit reaches PLoT with NO baseline (fails closed as before)', async () => {
    const os = await payloadFor(7, { value: 0.5, unit: '%', value_frame: 'level' });
    expect(os.baseline).toBeUndefined();
  });

  it('CONTROL at the wire: an unframed limit reaches PLoT with no baseline', async () => {
    const os = await payloadFor(7, { value: 10, unit: '%' });
    expect(os.baseline).toBeUndefined();
  });
});
