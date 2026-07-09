/**
 * ROADMAP 1.18 — cap-doctrine unification (CEE).
 *
 * Verified 7 Jul: the SAME raw goal-success target could produce a
 * different `goal_threshold` depending on which of the two registration
 * paths it travelled:
 *   - draft path: the factor-extraction enricher's goal-threshold
 *     redirection (`enrichGraphWithFactorsAsync`, this module's sibling
 *     `enricher.ts`) — historically used a unit-blind next-power-of-10
 *     rounding (`computeNormalisationCap`).
 *   - chat path: the `add_constraint` handler's goal-threshold join
 *     (orchestrator-v5/tools/handlers/add-constraint.ts) — used the %→/100
 *     else 25%-headroom doctrine (`resolveGoalThresholdCap`,
 *     utils/goal-threshold-cap.ts).
 *
 * This test pins parity directly: the same raw target, registered via
 * each path independently (fresh graph, no shared state), must produce
 * an IDENTICAL `goal_threshold`. No test previously exercised the draft
 * path's goal-threshold redirection at all, so this is the first fixture
 * proving (rather than asserting from code inspection) that both paths
 * delegate to the same doctrine.
 */
import { describe, expect, it } from 'vitest';

import { enrichGraphWithFactorsAsync } from '../enricher.js';
import type { GraphT } from '../../../schemas/graph.js';
import { createAddConstraintHandler } from '../../../orchestrator-v5/tools/handlers/add-constraint.js';
import { buildD1Fixture } from '../../../orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.js';
import type { HandlerInvocation } from '../../../orchestrator-v5/tools/registry.js';
import type { ProposalAction } from '../../../orchestrator-v5/routing/types.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

function draftPathGraph(): GraphT {
  return {
    version: '1',
    default_seed: 17,
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
      { id: 'd1', kind: 'decision', label: 'Pricing decision' },
    ],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
  } as unknown as GraphT;
}

function buildChatInvocation(graph: GraphV3T, value: number): HandlerInvocation {
  const proposal: ProposalAction = {
    handler_id: 'add_constraint',
    entity: {
      id: 'g-revenue',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value, source: 'user_explicit' },
    ],
    cited_context_fields: [],
  };
  return {
    context: {
      session_id: 'scn-parity',
      stage: 'frame',
      request_id: 'req-parity',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-parity',
      turn_id: 'turn-parity',
      stage: 'frame',
      message: `Set the success target to ${value}`,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-parity',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

describe('cap-doctrine unification (ROADMAP 1.18): draft vs chat goal_threshold parity', () => {
  it('identical unitless raw target produces identical goal_threshold via draft and chat paths', async () => {
    const draftResult = await enrichGraphWithFactorsAsync(
      draftPathGraph(),
      'Our target is 800.',
    );
    const draftGoal = draftResult.graph.nodes.find((n) => n.kind === 'goal');
    expect(draftGoal?.goal_threshold_raw).toBe(800);

    const handler = createAddConstraintHandler();
    const chatOutcome = await handler(buildChatInvocation(buildD1Fixture(), 800));
    const chatGoal = (chatOutcome.mutated_graph as GraphV3T).nodes.find(
      (n) => n.kind === 'goal',
    );
    expect(chatGoal?.goal_threshold_raw).toBe(800);

    // The parity claim: same raw target, same cap doctrine, same threshold —
    // regardless of which path registered it.
    expect(draftGoal?.goal_threshold_cap).toBe(chatGoal?.goal_threshold_cap);
    expect(draftGoal?.goal_threshold).toBeCloseTo(chatGoal?.goal_threshold as number, 10);
  });

  it('identical percentage raw target produces identical goal_threshold via draft and chat paths', async () => {
    const draftResult = await enrichGraphWithFactorsAsync(
      draftPathGraph(),
      'Our target is 15%.',
    );
    const draftGoal = draftResult.graph.nodes.find((n) => n.kind === 'goal');

    const handler = createAddConstraintHandler();
    const graph = buildD1Fixture();
    const proposal: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'g-revenue',
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
        { name: 'value', value: 15, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const invocation: HandlerInvocation = {
      context: {
        session_id: 'scn-parity-pct',
        stage: 'frame',
        request_id: 'req-parity-pct',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as unknown as HandlerInvocation['context'],
      payload: {
        kind: 'message',
        scenario_id: 'scn-parity-pct',
        turn_id: 'turn-parity-pct',
        stage: 'frame',
        message: 'Set the success target to 15%',
      } as unknown as HandlerInvocation['payload'],
      requestId: 'req-parity-pct',
      signal: new AbortController().signal,
      orientationText: '',
      proposal,
      graphForTurn: graph,
    };
    const chatOutcome = await handler(invocation);
    const chatGoal = (chatOutcome.mutated_graph as GraphV3T).nodes.find(
      (n) => n.kind === 'goal',
    );

    expect(draftGoal?.goal_threshold_cap).toBe(chatGoal?.goal_threshold_cap);
    expect(draftGoal?.goal_threshold).toBeCloseTo(chatGoal?.goal_threshold as number, 10);
  });
});
