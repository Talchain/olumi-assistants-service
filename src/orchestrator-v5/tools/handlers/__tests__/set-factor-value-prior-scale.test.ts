import { describe, expect, it } from 'vitest';
import { selectFactorQuantity } from '@talchain/schemas';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import { buildAppliedGraphWireField } from '../../../compose/applied-graph-emit.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import type { ProposalAction } from '../../../routing/types.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { mergeMutatedGraphForPersistence } from '../d1-shared/apply-graph-mutation.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

const TARGET_ID = 'f-budget';
const OTHER_ID = 'f-budget-nearby';
const PRIOR_SCALE = { unit: 'GBP', cap: 100_000, declared_scale: 'unit_interval' } as const;
const SYSTEM_PRIOR = {
  distribution: 'uniform', range_min: 0, range_max: 1,
  prior_is_unquantified: true, source: 'cee_inference', ...PRIOR_SCALE,
};
type Node = GraphV3T['nodes'][number];
type Graph = GraphV3T & Record<string, unknown>;

function node(graph: { nodes: readonly Node[] }, id = TARGET_ID): Node {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  expect(found, `canonical node ${id} must exist`).toBeDefined();
  return found!;
}

function fixture(): Graph {
  const graph: Graph = {
    ...buildD1Fixture(), goal_node_id: 'g-revenue', meta: { fixture: 'prior-scale' },
  };
  const target = node(graph);
  delete target.observed_state;
  target.prior = structuredClone(SYSTEM_PRIOR);
  graph.nodes.push({
    id: OTHER_ID, kind: 'factor', label: target.label,
    prior: { distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true, ...PRIOR_SCALE },
  });
  expect(GraphV3.safeParse(graph).success).toBe(true);
  expect(selectFactorQuantity(target)).toEqual({
    kind: 'fallback', carrier: 'prior', protected: false, source: 'cee_inference',
  });
  return graph;
}

function recordedObservation() {
  return {
    value: 0.5, raw_value: 50_000, ...PRIOR_SCALE, std: 0.02,
    source: 'cee_inference' as const,
  };
}

async function edit(graph: Graph, raw: number, unit?: string) {
  const proposal: ProposalAction = {
    handler_id: 'set_factor_value',
    entity: { id: TARGET_ID, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{
      name: 'value', value: unit === undefined ? raw : { value: raw, unit },
      operator: 'set', source: 'user_explicit',
    }],
    cited_context_fields: [],
  };
  return createSetFactorValueHandler()(buildHandlerInvocation({
    graph, proposal, scenarioId: 'scn-prior-scale', turnId: 'turn-prior-scale', requestId: 'req-prior-scale',
  }));
}

function commitAndReload(mutatedGraph: unknown, persistedBase: Graph) {
  expect(mutatedGraph).toBeDefined();
  const merged = mergeMutatedGraphForPersistence({
    mutatedGraph: mutatedGraph as Record<string, unknown>, persistedBase,
    scenarioId: 'scn-prior-scale', requestId: 'req-prior-scale',
  });
  const projected = projectGraphForPersistence(merged, { source: 'set_factor_value', scenarioId: 'scn-prior-scale' });
  const reloaded = JSON.parse(JSON.stringify(projected)) as Graph;
  const parsed = GraphV3.parse(reloaded);
  const wire = buildAppliedGraphWireField(parsed);
  expect(reloaded.goal_node_id).toBe(persistedBase.goal_node_id);
  expect(reloaded.meta).toEqual(persistedBase.meta);
  expect(wire.nodes).toEqual(parsed.nodes);
  expect(wire.node_count).toBe(parsed.nodes.length);
  return { reloaded, parsed, wire };
}

function expectSuppliedAmount(actual: Node) {
  expect(actual.id).toBe(TARGET_ID);
  expect(actual.observed_state).toMatchObject({
    value: 0.75, raw_value: 75_000, ...PRIOR_SCALE, source: 'user_override',
  });
  expect(actual.observed_state).not.toHaveProperty('value_tier');
  expect(actual.observed_state).not.toHaveProperty('reasoning');
  expect(actual.display_value).toBe('£75k');
}

async function expectRefusedWithoutMutation(graph: Graph, raw: number, unit?: string) {
  expect(GraphV3.safeParse(graph).success, 'refusal must exercise valid current CEE ingress').toBe(true);
  const original = JSON.stringify(graph);
  await expect(edit(graph, raw, unit)).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
  expect(JSON.stringify(graph)).toBe(original);
  expect(node(graph).prior).toEqual(SYSTEM_PRIOR);
}

describe('set_factor_value: known scale on a selected system prior survives its replacement', () => {
  it.each([
    { name: 'explicit original unit', unit: 'GBP' },
    { name: 'equivalent unit spelling', unit: 'gbp' },
    { name: 'bare amount in the already known unit', unit: undefined },
  ])('$name preserves the existing scale through handler, commit, reload and full receipt', async ({ unit }) => {
    const graph = fixture();
    const original = JSON.stringify(graph);
    const outcome = await edit(graph, 75_000, unit);
    const { reloaded, parsed, wire } = commitAndReload(outcome.mutated_graph, graph);
    for (const stage of [outcome.mutated_graph as Graph, reloaded, parsed, { nodes: wire.nodes as Node[] }]) {
      const target = node(stage);
      expectSuppliedAmount(target);
      expect(target).not.toHaveProperty('prior');
      expect(selectFactorQuantity(target)).toEqual({
        kind: 'point', carrier: 'observed_state', protected: true, source: 'user_override',
      });
    }
    expect(outcome.handler_facts?.[0]).toMatchObject({ noop: false, result: { status: 'applied', target_id: TARGET_ID } });
    expect(outcome.assistant_text).toBe('Updated Marketing budget to 75,000 GBP.');
    expect(node(reloaded, OTHER_ID)).toEqual(node(graph, OTHER_ID));
    expect(node(reloaded, OTHER_ID).prior).not.toHaveProperty('source');
    expect(JSON.stringify(graph)).toBe(original);
  });

  it('refuses a different currency instead of copying the old cap onto a new unit', async () => {
    await expectRefusedWithoutMutation(fixture(), 75_000, 'EUR');
  });

  it('uses the existing bare-ratio ambiguity refusal for 0.75 on a GBP scale', async () => {
    await expectRefusedWithoutMutation(fixture(), 0.75);
  });

  it('uses the existing cap limit instead of discarding it with the old prior', async () => {
    await expectRefusedWithoutMutation(fixture(), 150_000, 'GBP');
  });

  it('refuses cleanup when a selected observed fallback would erase the only known prior scale', async () => {
    const graph = fixture();
    node(graph).observed_state = { value: 0.5, source: 'cee_inference', value_tier: 'fallback_default' };
    expect(selectFactorQuantity(node(graph))).toMatchObject({ kind: 'fallback', carrier: 'observed_state', protected: false });
    // Bare input is valid for this observed point; the refusal must guard the
    // scale that cleanup would discard, not an unrelated unit-redeclaration.
    await expectRefusedWithoutMutation(graph, 0.75);
  });

  it.each([
    { name: 'unit', changed: { unit: 'EUR' }, editUnit: 'EUR' },
    { name: 'cap', changed: { cap: 200_000 }, editUnit: 'GBP' },
    { name: 'declared scale', changed: { declared_scale: 'ratio' }, editUnit: 'GBP' },
  ])('refuses conflicting $name on the observed fallback instead of deleting the prior declaration', async ({ changed, editUnit }) => {
    const graph = fixture();
    node(graph).observed_state = { ...recordedObservation(), ...changed, value_tier: 'fallback_default' };
    expect(selectFactorQuantity(node(graph))).toMatchObject({ kind: 'fallback', carrier: 'observed_state', protected: false });
    await expectRefusedWithoutMutation(graph, 75_000, editUnit);
  });

  it('accepts matching observed scale while removing the superseded system prior', async () => {
    const graph = fixture();
    node(graph).observed_state = { ...recordedObservation(), value_tier: 'fallback_default' };
    const outcome = await edit(graph, 75_000, 'GBP');
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expectSuppliedAmount(node(reloaded));
    expect(node(reloaded).observed_state?.std).toBe(0.02);
    expect(node(reloaded)).not.toHaveProperty('prior');
  });

  it('unrelated control: an ordinary observed point and renamed label retain existing amount semantics', async () => {
    const graph = fixture();
    delete node(graph).prior;
    node(graph).observed_state = recordedObservation();
    node(graph).label = 'Renamed support budget';
    const outcome = await edit(graph, 75_000, 'GBP');
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expectSuppliedAmount(node(reloaded));
    expect(node(reloaded).label).toBe('Renamed support budget');
    expect(node(reloaded, OTHER_ID)).toEqual(node(graph, OTHER_ID));
  });

  it('retains a genuine supplied prior byte for byte instead of treating it as disposable scale metadata', async () => {
    const graph = fixture();
    node(graph).observed_state = recordedObservation();
    node(graph).prior = { distribution: 'uniform', range_min: 0.1, range_max: 0.9, source: 'user_override', ...PRIOR_SCALE };
    const priorBytes = JSON.stringify(node(graph).prior);
    const outcome = await edit(graph, 75_000, 'GBP');
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expectSuppliedAmount(node(reloaded));
    expect(JSON.stringify(node(reloaded).prior)).toBe(priorBytes);
    expect(selectFactorQuantity(node(reloaded))).toEqual({ kind: 'ambiguous', carrier: null, protected: true, source: null });
  });

  it('refuses 2 on a declared unit interval even when no cap or unit was recorded', async () => {
    const graph = fixture();
    node(graph).prior = {
      distribution: 'uniform', range_min: 0, range_max: 1,
      prior_is_unquantified: true, source: 'cee_inference', declared_scale: 'unit_interval',
    };
    const original = JSON.stringify(graph);
    await expect(edit(graph, 2)).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
    expect(JSON.stringify(graph)).toBe(original);
  });

  it('accepts 0.75 on a declared unit interval without inventing a cap or unit', async () => {
    const graph = fixture();
    node(graph).prior = {
      distribution: 'uniform', range_min: 0, range_max: 1,
      prior_is_unquantified: true, source: 'cee_inference', declared_scale: 'unit_interval',
    };
    const outcome = await edit(graph, 0.75);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expect(node(reloaded).observed_state).toEqual({
      value: 0.75, raw_value: 0.75, source: 'user_override', declared_scale: 'unit_interval',
    });
    expect(node(reloaded)).not.toHaveProperty('prior');
    expect(node(reloaded)).not.toHaveProperty('scale_frame');
  });

  it('refuses a raw-count declaration whose recorded cap would divide the supplied GBP amount', async () => {
    const graph = fixture();
    node(graph).prior = { ...SYSTEM_PRIOR, declared_scale: 'raw_count' };
    const original = JSON.stringify(graph);
    await expect(edit(graph, 75_000, 'GBP')).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
    expect(JSON.stringify(graph)).toBe(original);
  });

  it('refuses a raw-count declaration with an existing divisor even when the supplied value is zero', async () => {
    const graph = fixture();
    node(graph).prior = {
      distribution: 'uniform', range_min: 0, range_max: 1,
      prior_is_unquantified: true, source: 'cee_inference', declared_scale: 'raw_count',
    };
    node(graph).scale_frame = 100_000;
    const original = JSON.stringify(graph);
    await expect(edit(graph, 0)).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
    expect(JSON.stringify(graph)).toBe(original);
  });

  it('preserves an unnormalised raw-count GBP amount when no cap or frame was recorded', async () => {
    const graph = fixture();
    node(graph).prior = {
      distribution: 'uniform', range_min: 0, range_max: 1,
      prior_is_unquantified: true, source: 'cee_inference', declared_scale: 'raw_count', unit: 'GBP',
    };
    const outcome = await edit(graph, 75_000, 'GBP');
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expect(node(reloaded).observed_state).toEqual({
      value: 75_000, raw_value: 75_000, unit: 'GBP', source: 'user_override', declared_scale: 'raw_count',
    });
    expect(node(reloaded)).not.toHaveProperty('prior');
    expect(node(reloaded)).not.toHaveProperty('scale_frame');
    expect(node(reloaded).display_value).toBe('£75k');
  });

  it('accepts a declared ratio of 2 without imposing an undeclared unit interval', async () => {
    const graph = fixture();
    node(graph).prior = {
      distribution: 'uniform', range_min: 0, range_max: 1,
      prior_is_unquantified: true, source: 'cee_inference', declared_scale: 'ratio',
    };
    const outcome = await edit(graph, 2);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expect(node(reloaded).observed_state).toEqual({
      value: 2, raw_value: 2, source: 'user_override', declared_scale: 'ratio',
    });
    expect(node(reloaded)).not.toHaveProperty('prior');
    expect(node(reloaded)).not.toHaveProperty('scale_frame');
  });
});
