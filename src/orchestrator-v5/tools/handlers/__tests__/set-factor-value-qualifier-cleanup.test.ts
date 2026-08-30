import { describe, expect, it } from 'vitest';
import { selectFactorQuantity } from '@talchain/schemas';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { GraphV3, type GraphV3T } from '../../../../schemas/cee-v3.js';
import type { CollabStore, ElicitationEventRow } from '../../../../collab/types.js';
import { buildAppliedGraphWireField } from '../../../compose/applied-graph-emit.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import type { ProposalAction } from '../../../routing/types.js';
import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';
import { createSetFactorValueHandler } from '../set-factor-value.js';
import { mergeMutatedGraphForPersistence } from '../d1-shared/apply-graph-mutation.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';

const TARGET_ID = 'f-churn';
const OTHER_ID = 'f-churn-other';
const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const REASONING = {
  rationale: 'Fixture: provisional fallback pending a supplied value.',
  context_basis: ['fixture_context'],
};
const SYSTEM_PRIOR = {
  distribution: 'uniform', range_min: 0, range_max: 1,
  prior_is_unquantified: true, source: 'cee_inference', reasoning: REASONING,
};
const SOURCE_ABSENT_PRIOR = {
  distribution: 'uniform', range_min: 0, range_max: 0.132,
};
const SOURCE_ABSENT_FLAGGED_PRIOR = {
  distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true,
};

type Node = GraphV3T['nodes'][number];
type Graph = GraphV3T & Record<string, unknown>;

function node(graph: { nodes: readonly Node[] }, id = TARGET_ID): Node {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  expect(found, `canonical node ${id} must exist`).toBeDefined();
  return found!;
}

function fixture(prior: Node['prior'] = SYSTEM_PRIOR, value = 0.5): Graph {
  const graph: Graph = {
    ...buildD1Fixture(), goal_node_id: 'g-revenue',
    meta: { fixture: 'qualifier-cleanup', retained: true },
  };
  Object.assign(node(graph), {
    label: 'Customer churn', source_quote: 'Customer churn needs a supplied value.',
    observed_state: {
      value, raw_value: value * 100, unit: '%', cap: 100,
      std: 0.02, baseline: 0.33, source: 'cee_inference',
      value_tier: 'fallback_default', reasoning: REASONING,
    },
    prior,
  });
  graph.nodes.push({
    id: OTHER_ID, kind: 'factor', label: 'Customer churn',
    observed_state: { value: 0.12, raw_value: 12, unit: '%', cap: 100, std: 0.03 },
    prior: SOURCE_ABSENT_FLAGGED_PRIOR,
  });
  // Do not bypass the actual CEE boundary to create a test-only ingress.
  expect(GraphV3.safeParse(graph).success).toBe(true);
  return graph;
}

function proposal(raw: number, unit = '%'): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: TARGET_ID, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value: { value: raw, unit }, operator: 'set', source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function edit(graph: Graph, raw: number, unit = '%') {
  return createSetFactorValueHandler()(buildHandlerInvocation({
    graph, proposal: proposal(raw, unit), scenarioId: SCENARIO_ID,
    turnId: 'turn-qualifier-cleanup', requestId: 'req-qualifier-cleanup',
    message: `Set customer churn to ${raw}${unit}.`,
  }));
}

/** Real D1 commit adapters, JSON storage boundary, then the full applied graph. */
function commitAndReload(mutatedGraph: unknown, persistedBase: Graph) {
  expect(mutatedGraph).toBeDefined();
  const merged = mergeMutatedGraphForPersistence({
    mutatedGraph: mutatedGraph as Record<string, unknown>, persistedBase,
    requestId: 'req-qualifier-cleanup', scenarioId: SCENARIO_ID,
  });
  const projected = projectGraphForPersistence(merged, {
    scenarioId: SCENARIO_ID, turnId: 'turn-qualifier-cleanup', source: 'set_factor_value',
  });
  const reloaded = JSON.parse(JSON.stringify(projected)) as Graph;
  const parsed = GraphV3.parse(reloaded);
  const wire = buildAppliedGraphWireField(parsed);
  expect(wire.node_count).toBe(parsed.nodes.length);
  expect(wire.nodes).toEqual(parsed.nodes);
  expect(reloaded.goal_node_id).toBe(persistedBase.goal_node_id);
  expect(reloaded.meta).toEqual(persistedBase.meta);
  return { projected, reloaded, parsed, wire };
}

function expectAcceptedPoint(actual: Node, raw: number, source = 'user_override') {
  expect(actual.id).toBe(TARGET_ID);
  expect(actual.observed_state).toMatchObject({
    value: raw / 100, raw_value: raw, unit: '%', cap: 100, std: 0.02, baseline: 0.33, source,
  });
  expect(actual.observed_state).not.toHaveProperty('value_tier');
  expect(actual.observed_state).not.toHaveProperty('reasoning');
  expect(selectFactorQuantity(actual)).toEqual({
    kind: 'point', carrier: 'observed_state', protected: true, source,
  });
  expect(actual.display_value).toBe(`${raw}%`);
}

describe('set_factor_value: accepted source and quantity markers are one mutation', () => {
  it.each([12, 24, 0])('supersedes system fallback with supplied %s%% across commit, reload and full receipt', async (raw) => {
    const graph = fixture();
    const original = JSON.stringify(graph);
    expect(selectFactorQuantity(node(graph))).toMatchObject({ kind: 'fallback', protected: false });

    const outcome = await edit(graph, raw);
    const { reloaded, parsed, wire } = commitAndReload(outcome.mutated_graph, graph);
    for (const stage of [outcome.mutated_graph as Graph, reloaded, parsed, { nodes: wire.nodes as Node[] }]) {
      const target = node(stage);
      expectAcceptedPoint(target, raw);
      expect(target).not.toHaveProperty('prior');
      expect(target.source_quote).toBe(node(graph).source_quote);
    }
    expect(outcome.handler_facts?.[0]).toMatchObject({
      noop: false, result: { target_id: TARGET_ID, status: 'applied' },
    });
    // Same label and even the same numeric value do not licence an attribution change.
    expect(node(reloaded, OTHER_ID)).toEqual(node(graph, OTHER_ID));
    expect(node(reloaded, OTHER_ID).observed_state).not.toHaveProperty('source');
    expect(selectFactorQuantity(node(reloaded, OTHER_ID))).toEqual({
      kind: 'ambiguous', carrier: null, protected: true, source: null,
    });
    expect(JSON.stringify(graph)).toBe(original);
  });

  it.each([SOURCE_ABSENT_PRIOR, SOURCE_ABSENT_FLAGGED_PRIOR])(
    'preserves source-absent prior byte for byte while selecting the accepted point %#',
    async (prior) => {
      const graph = fixture(prior);
      const priorBytes = JSON.stringify(node(graph).prior);
      const first = await edit(graph, 12);
      const { reloaded } = commitAndReload(first.mutated_graph, graph);
      expectAcceptedPoint(node(reloaded), 12);
      expect(JSON.stringify(node(reloaded).prior)).toBe(priorBytes);
      expect(node(reloaded).prior).not.toHaveProperty('source');

      const second = await edit(reloaded, 24);
      const again = commitAndReload(second.mutated_graph, reloaded).reloaded;
      expectAcceptedPoint(node(again), 24);
      expect(JSON.stringify(node(again).prior)).toBe(priorBytes);
      expect(node(again).prior).not.toHaveProperty('source');
    },
  );

  it('preserves a genuinely supplied prior and discloses the competing supplied quantities', async () => {
    const prior = { ...SOURCE_ABSENT_PRIOR, source: 'user_override' };
    const graph = fixture(prior);
    const before = JSON.stringify(node(graph).prior);
    const outcome = await edit(graph, 12);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expect(JSON.stringify(node(reloaded).prior)).toBe(before);
    expect(node(reloaded).observed_state).toMatchObject({ value: 0.12, source: 'user_override' });
    expect(node(reloaded).observed_state).not.toHaveProperty('value_tier');
    expect(node(reloaded).observed_state).not.toHaveProperty('reasoning');
    expect(selectFactorQuantity(node(reloaded))).toEqual({
      kind: 'ambiguous', carrier: null, protected: true, source: null,
    });
  });

  it('treats confirmation of an equal-number fallback as applied, with an honest one-sided receipt', async () => {
    const graph = fixture(SYSTEM_PRIOR, 0.12);
    const outcome = await edit(graph, 12);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expectAcceptedPoint(node(reloaded), 12);
    expect(outcome.handler_facts?.[0]).toMatchObject({
      noop: false, result: { target_id: TARGET_ID, status: 'applied' },
    });
    expect(outcome.assistant_text).toBe('Updated Customer churn to 12%.');
  });

  it('keeps an already supplied equal-number point a no-op', async () => {
    const graph = fixture(undefined, 0.12);
    const target = node(graph);
    delete target.prior;
    target.observed_state!.source = 'user_override';
    delete target.observed_state!.value_tier;
    delete target.observed_state!.reasoning;
    const outcome = await edit(graph, 12);
    expect(outcome.handler_facts?.[0]).toMatchObject({ noop: true, result: { status: 'noop' } });
    expect(outcome.assistant_text).not.toContain('Updated');
  });

  it.each(['cee_inference', undefined] as const)(
    'acknowledges equal-number confirmation from source %s even without stale qualifiers',
    async (source) => {
      const graph = fixture(SYSTEM_PRIOR, 0.12);
      const target = node(graph);
      delete target.prior;
      delete target.observed_state!.value_tier;
      delete target.observed_state!.reasoning;
      if (source === undefined) delete target.observed_state!.source;
      else target.observed_state!.source = source;
      const original = JSON.stringify(graph);

      const outcome = await edit(graph, 12);
      const { reloaded, wire } = commitAndReload(outcome.mutated_graph, graph);
      expectAcceptedPoint(node(reloaded), 12);
      expectAcceptedPoint(node({ nodes: wire.nodes as Node[] }), 12);
      expect(outcome.handler_facts?.[0]).toMatchObject({
        noop: false, result: { target_id: TARGET_ID, status: 'applied' },
      });
      expect(outcome.assistant_text).toBe('Updated Customer churn to 12%.');
      expect(JSON.stringify(graph)).toBe(original);
    },
  );

  it('ordinary equal-number retyping replaces panel attribution and clears its named identities', async () => {
    const graph = fixture(SYSTEM_PRIOR, 0.12);
    const target = node(graph);
    delete target.prior;
    delete target.observed_state!.value_tier;
    delete target.observed_state!.reasoning;
    target.observed_state!.source = 'panel_elicited';
    target.observed_state!.elicited_from = {
      round_id: '33333333-3333-4333-8333-333333333333',
      participant_id: '55555555-5555-4555-8555-555555555555',
      evidence_event_id: '88888888-8888-4888-8888-888888888888',
    };

    const outcome = await edit(graph, 12);
    const { reloaded, wire } = commitAndReload(outcome.mutated_graph, graph);
    for (const stage of [reloaded, { nodes: wire.nodes as Node[] }]) {
      expectAcceptedPoint(node(stage), 12);
      expect(node(stage).observed_state).not.toHaveProperty('elicited_from');
    }
    expect(node(reloaded, OTHER_ID)).toEqual(node(graph, OTHER_ID));
    expect(outcome.handler_facts?.[0]).toMatchObject({
      noop: false, result: { target_id: TARGET_ID, status: 'applied' },
    });
    expect(outcome.assistant_text).toBe('Updated Customer churn to 12%.');
  });

  it('does not clean markers or mutate the graph when the proposed unit is rejected', async () => {
    const graph = fixture();
    const original = JSON.stringify(graph);
    await expect(edit(graph, 12, '£')).rejects.toMatchObject({ cause_kind: 'parameter_invalid_at_execute' });
    expect(JSON.stringify(graph)).toBe(original);
    expect(selectFactorQuantity(node(graph))).toMatchObject({ kind: 'fallback', protected: false });
    expect(node(graph).prior).toEqual(SYSTEM_PRIOR);
  });

  it('semantic-loss control: restoring the stale tier makes the real selector refuse the supplied-point claim', async () => {
    const graph = fixture();
    const outcome = await edit(graph, 12);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    expectAcceptedPoint(node(reloaded), 12);
    node(reloaded).observed_state!.value_tier = 'fallback_default';
    const mutant = commitAndReload(reloaded, graph).reloaded;
    expect(selectFactorQuantity(node(mutant))).toEqual({
      kind: 'fallback', carrier: 'observed_state', protected: true, source: 'user_override',
    });
    expect(() => expectAcceptedPoint(node(mutant), 12)).toThrow();
  });

  it('unrelated control: changing the display label retains the same selected canonical point', async () => {
    const graph = fixture();
    const outcome = await edit(graph, 12);
    const { reloaded } = commitAndReload(outcome.mutated_graph, graph);
    const expected = structuredClone(node(reloaded).observed_state);
    node(reloaded).label = 'Renamed churn measure';
    const renamed = commitAndReload(reloaded, graph).reloaded;
    expectAcceptedPoint(node(renamed), 12);
    expect(node(renamed).observed_state).toEqual(expected);
    expect(node(renamed, OTHER_ID)).toEqual(node(graph, OTHER_ID));
  });
});

it('verified panel apply retires system markers without dropping participant or cited evidence identity', async () => {
  const roundId = '33333333-3333-4333-8333-333333333333';
  const participantId = '55555555-5555-4555-8555-555555555555';
  const evidenceAuthorId = '66666666-6666-4666-8666-666666666666';
  const evidenceId = '88888888-8888-4888-8888-888888888888';
  const provenance = {
    authored_by: participantId, method: 'elicited_nl', elicitation_version: 'cee-belief-elicitation-v1',
  } as const;
  const common = {
    round_id: roundId, event_version: 1 as const, target: { kind: 'factor' as const, id: TARGET_ID },
    created_at: '2026-08-30T12:00:00.000Z',
  };
  const events: ElicitationEventRow[] = [
    {
      ...common, event_id: '99999999-9999-4999-8999-999999999999',
      participant_id: participantId, kind: 'belief_submitted',
      belief: { value: 0.12, expression_raw: null, confidence: null }, evidence: null, provenance,
    },
    {
      ...common, event_id: evidenceId, participant_id: evidenceAuthorId, kind: 'evidence_attached',
      belief: null,
      evidence: { kind: 'note', body: 'Fixture supplied renewal record.', url: null, stance: 'supports', about_participant_id: null },
      provenance: { ...provenance, authored_by: evidenceAuthorId },
    },
  ];
  // Only storage is replaced; applyFactorValueEdit runs the real attribution verifier.
  const store = {
    getRound: async () => ({ round_id: roundId, scenario_id: SCENARIO_ID, status: 'closed' }),
    getParticipant: async () => ({ participant_id: participantId, round_id: roundId }),
    listAllRoundEvents: async () => structuredClone(events),
  } as unknown as CollabStore;
  const elicitedFrom = { round_id: roundId, participant_id: participantId, evidence_event_id: evidenceId };
  const payload: SystemEventTurnPayload = {
    kind: 'system_event', scenario_id: SCENARIO_ID,
    turn_id: '77777777-7777-4777-8777-777777777777', stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: TARGET_ID, value: 0.12, field: 'value', applied_from: elicitedFrom },
  };
  const graph = fixture();
  const result = await applyFactorValueEdit({
    payload, event: payload.event as Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>,
    requestId: 'req-panel-qualifier-cleanup', persistedGraph: graph, priorFacts: [], collabStore: store,
  });
  expect(result.kind).toBe('mutated');
  if (result.kind !== 'mutated') throw new Error(`Verified panel apply was refused: ${result.reason}`);
  const { reloaded, wire } = commitAndReload(result.mutatedGraph, graph);
  for (const stage of [reloaded, { nodes: wire.nodes as Node[] }]) {
    expectAcceptedPoint(node(stage), 12, 'panel_elicited');
    expect(node(stage)).not.toHaveProperty('prior');
    expect(node(stage).observed_state!.elicited_from).toEqual(elicitedFrom);
  }
  expect(result.handlerFacts.find((fact) => fact.fact_type === 'set_factor_value')).toMatchObject({
    result: { status: 'applied', after: { source: 'panel_elicited', elicited_from: elicitedFrom } },
  });
});
