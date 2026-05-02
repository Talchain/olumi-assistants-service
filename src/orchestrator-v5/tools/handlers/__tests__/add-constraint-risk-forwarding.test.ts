/**
 * V5 D1 golden-path closure (A3.1 Task 5) — risk-node constraints.
 *
 * Pre-fix `add_constraint`'s ALLOWED_TARGET_KINDS was
 * `{factor, outcome, goal}`. "Keep churn risk below 5%" against a
 * risk-kind node was rejected with ENTITY_KIND_MISMATCH despite
 * GoalConstraintSchema being kind-agnostic and PLoT forwarding
 * constraints regardless of constrained-node kind.
 *
 * Post-fix:
 *   - 'risk' joins the allowlist.
 *   - End-to-end forwarding test: drive a fixture with a risk-node
 *     constraint, run loadScenarioSnapshotForRunAnalysis, then
 *     drive runAnalysisHandler against a captured plot client to
 *     prove the risk-node constraint reaches plotPayload.goal_constraints.
 */

import { describe, it, expect } from 'vitest';

import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import type { ProposalAction } from '../../../routing/types.js';

import { createAddConstraintHandler } from '../add-constraint.js';
import {
  buildD1Fixture,
  buildHandlerInvocation,
} from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(graph: GraphV3T, proposal: ProposalAction) {
  return buildHandlerInvocation({
    graph,
    proposal,
    scenarioId: 'scn-risk',
    turnId: 'turn-risk',
    requestId: 'req-risk',
    message: 'add risk constraint',
  });
}

function withRiskNode(): GraphV3T {
  const base = buildD1Fixture();
  return {
    ...base,
    nodes: [
      ...base.nodes,
      {
        id: 'r-churn-risk',
        kind: 'risk',
        label: 'Customer Churn Risk',
        observed_state: { value: 0.05, raw_value: 5, unit: '%', cap: 100 },
      },
    ],
  };
}

describe('A3.1 Task 5 — add_constraint accepts risk-node targets', () => {
  it('rejection metadata: accepted_kinds includes "risk" (post-A3.1) so user-facing recovery matches actual behaviour', async () => {
    // Drive a rejection (target is an option — not in the allowlist)
    // and assert the error.details.accepted_kinds list reflects the
    // post-A3.1 allowlist. Pre-fix the metadata reported
    // {factor, outcome, goal} even after `risk` joined the gate —
    // chip generator and telemetry would have misled users about
    // which kinds are accepted.
    const ingress = withRiskNode();
    const proposal: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'o-launch', // option — not in allowlist
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 5, source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const handler = createAddConstraintHandler();
    let caught: unknown;
    try {
      await handler(buildInvocation(ingress, proposal));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const details = (caught as { details?: Record<string, unknown> }).details;
    expect(details?.accepted_kinds).toEqual(
      expect.arrayContaining(['factor', 'outcome', 'goal', 'risk']),
    );
  });

  it('"Keep Customer Churn Risk at most 5%" → constraint persists, no ENTITY_KIND_MISMATCH', async () => {
    const ingress = withRiskNode();
    const proposal: ProposalAction = {
      handler_id: 'add_constraint',
      entity: {
        id: 'r-churn-risk',
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
        { name: 'value', value: 5, source: 'user_explicit' },
        { name: 'unit', value: '%', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    };
    const handler = createAddConstraintHandler();
    const outcome = await handler(buildInvocation(ingress, proposal));
    const mutated = outcome.mutated_graph as GraphV3T;
    expect(mutated.goal_constraints).toBeDefined();
    expect(mutated.goal_constraints).toHaveLength(1);
    const c = mutated.goal_constraints![0];
    expect(c.node_id).toBe('r-churn-risk');
    expect(c.operator).toBe('<=');
    expect(c.value).toBe(5);
    expect(c.unit).toBe('%');
  });
});

describe('A3.1 Task 5 — risk-node constraint reaches PLoT payload via run-analysis', () => {
  it('snapshot.goal_constraints carries the risk-node constraint and plotClient.run receives it', async () => {
    // End-to-end coverage: a graph with a risk-node constraint, run
    // through loadScenarioSnapshotForRunAnalysis and the handler, must
    // reach plotPayload.goal_constraints unchanged.
    const { createRunAnalysisHandler } = await import('../run-analysis.js');
    const riskGraph = withRiskNode();
    riskGraph.goal_constraints = [
      {
        constraint_id: 'gc-risk-1',
        node_id: 'r-churn-risk',
        operator: '<=' as const,
        value: 5,
        unit: '%',
        label: 'Customer Churn Risk cap',
        provenance: 'explicit' as const,
      },
    ];

    let capturedPayload: Record<string, unknown> | null = null;
    const fakePlotClient = {
      run: async (payload: Record<string, unknown>) => {
        capturedPayload = payload;
        // V5 alpha hardening Phase 2.3 contract: PLoT staging emits
        // `analysis_status: 'computed'` for healthy runs (the legacy
        // 'completed' literal still parses but is no longer the
        // canonical status). Mock against the current contract so
        // this test doesn't reinforce the legacy vocabulary.
        return {
          analysis_status: 'computed',
          results: [{ option_id: 'o-launch', win_probability: 0.6 }],
        } as unknown as Awaited<
          ReturnType<
            Awaited<ReturnType<typeof createRunAnalysisHandler>>
          > extends infer _R ? unknown : never
        >;
      },
      validatePatch: async () => {
        throw new Error('not used in this test');
      },
    } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];

    const handler = createRunAnalysisHandler({
      plotClient: fakePlotClient,
      scenarioReader: async () => ({
        graph: riskGraph as unknown as never,
        options: [
          {
            id: 'o-launch',
            option_id: 'o-launch',
            label: 'Launch now',
            interventions: { 'f-churn': 1 },
          },
        ],
        goal_node_id: 'g-revenue',
        goal_constraints: riskGraph.goal_constraints,
        rawPersistedGraph: riskGraph,
      }),
    });

    const SCN = '11111111-1111-4111-8111-111111111111';
    const TURN = '22222222-2222-4222-8222-222222222222';
    await handler({
      context: {
        session_id: SCN,
        stage: 'analyse',
        request_id: 'req-risk-fwd',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as never,
      payload: {
        kind: 'message',
        scenario_id: SCN,
        turn_id: TURN,
        stage: 'analyse',
        message: 'run the analysis',
      } as never,
      requestId: 'req-risk-fwd',
      signal: new AbortController().signal,
      orientationText: '',
    });

    expect(capturedPayload).not.toBeNull();
    const forwardedConstraints = (capturedPayload as Record<string, unknown>)
      .goal_constraints as Array<{ node_id: string; operator: string; value: number }>;
    expect(forwardedConstraints).toBeDefined();
    expect(forwardedConstraints).toHaveLength(1);
    expect(forwardedConstraints[0].node_id).toBe('r-churn-risk');
    expect(forwardedConstraints[0].operator).toBe('<=');
    expect(forwardedConstraints[0].value).toBe(5);
  });
});
