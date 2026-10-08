/**
 * ⛔ A graph saved before #2300 cannot buy a goal chance by being old (DL #72 5893532787; R3 acceptance 5893378853).
 *
 * Served `77afc7b`: re-running saved Run `c96fc4bb` (drafted before #2300: NO identity; MRR's parents are the user's £49
 * and 1,500, £73,500 within 5% of £75,000) shipped 14 goal-chance fields. The Run-time guard carries the card's reading
 * on the WIRE copy as Olumi's unconfirmed product, so PLoT #420 withholds. Pinned here:
 *   · the served graph gets the reading on the wire, and only there (stored graph, raw mirror, hash untouched);
 *   · a USER-STATED or CONFIRMED product is never touched (its chance is the user's: the control);
 *   · Olumi's own unconfirmed product is left as it is (PLoT (d) already withholds it);
 *   · outside the card's domain (an Olumi level; > 5% off) nothing is carried.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { carryUnconfirmedGoalProduct, unconfirmedGoalProductFor } from '../../../../../src/orchestrator-v5/tools/handlers/unconfirmed-goal-product.js';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../../../../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import { computeAnalysisAffectingGraphHash } from '../../../../../src/orchestrator-v5/context/graph-hash.js';
import { GraphStateIngressSchema } from '../../../../../src/orchestrator-v5/boundary/request-extensions.js';
import type { HandlerInvocation } from '../../../../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../../../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../../src/orchestrator/types.js';

import minimalFixture from '../../../../fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../../../../fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')) as { goal_node_id: string; graph: Rec };
const served = (): Rec => JSON.parse(JSON.stringify(FX.graph));
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const withGoalIdentity = (g: Rec, identity: Rec): Rec => { node(g, 'mrr').nonlinear_identity = identity; return g; };
const INFERRED = { operation: 'product', factor_ids: ['pro_plan_price', 'paying_subscribers'], stated_in_brief: false };

afterEach(() => { vi.restoreAllMocks(); });

describe('unconfirmedGoalProductFor / carryUnconfirmedGoalProduct — the card\'s reading, on the wire only', () => {
  it('⭐ served c96fc4bb (no identity, the card\'s domain): the goal carries Olumi\'s UNCONFIRMED product on the wire copy', () => {
    const stored = served();
    const before = JSON.stringify(stored);
    const wire = carryUnconfirmedGoalProduct(served(), stored);
    expect(node(wire, 'mrr').nonlinear_identity).toEqual(INFERRED);
    expect(JSON.stringify(stored)).toBe(before); // the stored graph is never written
    expect(node(stored, 'mrr').nonlinear_identity).toBeUndefined();
  });

  it('CONTROL: a USER-STATED / CONFIRMED goal product is never touched (its chance is the user\'s)', () => {
    const stored = withGoalIdentity(served(), { ...INFERRED, stated_in_brief: true });
    const wire = withGoalIdentity(served(), { ...INFERRED, stated_in_brief: true });
    expect(unconfirmedGoalProductFor(stored)).toBeNull();
    expect(carryUnconfirmedGoalProduct(wire, stored)).toBe(wire);
  });

  it('Olumi\'s own unconfirmed product already on the goal is left as it is (PLoT (d) withholds it already)', () => {
    const stored = withGoalIdentity(served(), INFERRED);
    const wire = withGoalIdentity(served(), INFERRED);
    expect(unconfirmedGoalProductFor(stored)).toBeNull();
    expect(carryUnconfirmedGoalProduct(wire, stored)).toBe(wire);
  });

  it.each([
    ['a parent\'s level is Olumi\'s (not the card\'s domain)', (g: Rec) => { node(g, 'paying_subscribers').observed_state.source = 'cee_inference'; }],
    ['the parts miss the goal by more than 5% (£49 × 1,200 = £58,800 vs £75,000)', (g: Rec) => { node(g, 'paying_subscribers').observed_state.raw_value = 1200; }],
    ['the goal\'s level is Olumi\'s', (g: Rec) => { node(g, 'mrr').observed_state.source = 'cee_inference'; }],
  ])('outside the card\'s domain — nothing carried: %s', (_label, edit) => {
    const stored = served(); edit(stored);
    const wire = served();
    expect(carryUnconfirmedGoalProduct(wire, stored)).toBe(wire);
  });
});

function invocation(): HandlerInvocation {
  return { payload: { scenario_id: 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4' }, requestId: 'req-c96', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation;
}
function snapshotOf(graph: Rec): RunAnalysisScenarioSnapshot {
  const options = graph.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => ({ id: n.id, option_id: n.id, label: n.label, interventions: { pro_plan_price: 59 } }));
  return { graph: JSON.parse(JSON.stringify(graph)), options, goal_node_id: FX.goal_node_id, rawPersistedGraph: JSON.parse(JSON.stringify(graph)) } as RunAnalysisScenarioSnapshot;
}
async function sentGraph(snapshot: RunAnalysisScenarioSnapshot): Promise<{ graph: Rec; outcome: unknown }> {
  const runMock = vi.fn(async () => JSON.parse(JSON.stringify(minimalFixture)) as V2RunResponseEnvelope);
  const plotClient = { run: runMock, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot });
  const outcome = await handler(invocation()).catch((e: unknown) => e);
  expect(runMock).toHaveBeenCalledTimes(1);
  return { graph: ((runMock.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph, outcome };
}

describe('run_analysis wiring — the served graph\'s Run carries the reading to PLoT; the stored graph and its hash do not change', () => {
  it('⭐ c96fc4bb: PLoT receives Olumi\'s unconfirmed goal product; snapshot.graph + rawPersistedGraph unchanged; the freshness hash is the stored graph\'s', async () => {
    const snapshot = snapshotOf(served());
    const rawBefore = JSON.stringify(snapshot.rawPersistedGraph);
    const hashBefore = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snapshot.rawPersistedGraph));
    const { graph } = await sentGraph(snapshot);
    expect(node(graph, 'mrr').nonlinear_identity).toEqual({ ...INFERRED, reading_licence: 'olumi_reading', addends: [] });
    expect(node(snapshot.graph as Rec, 'mrr').nonlinear_identity).toBeUndefined();
    expect(JSON.stringify(snapshot.rawPersistedGraph)).toBe(rawBefore);
    expect(computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snapshot.rawPersistedGraph))).toBe(hashBefore);
  });

  it('CONTROL: a CONFIRMED goal product reaches PLoT exactly as stored (stated_in_brief: true), nothing added', async () => {
    const snapshot = snapshotOf(withGoalIdentity(served(), { ...INFERRED, stated_in_brief: true }));
    const { graph } = await sentGraph(snapshot);
    expect(node(graph, 'mrr').nonlinear_identity).toEqual({ ...INFERRED, stated_in_brief: true });
  });
});
