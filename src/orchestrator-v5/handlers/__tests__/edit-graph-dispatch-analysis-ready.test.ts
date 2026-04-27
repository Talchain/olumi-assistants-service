/**
 * V5 analysis_ready contract — edit-graph-dispatch coverage.
 *
 * Pins the CEE-1.5 wire fix: an applied edit ships analysis_ready computed
 * from editResult.appliedGraph, and a rejected edit (no applied graph) ships
 * no analysis_ready. Without this the UI's wire-driven readiness path would
 * stay stale across edit turns and the legacy fallback would mis-fire on
 * every edit follow-up.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Bump the launch→revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

// A complete, schema-valid post-edit graph: 1 decision, 1 goal, 2 options
// each with an intervention edge to a factor. computeStructuralReadiness
// should resolve goal_node_id and produce ready/needs_user_mapping.
const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    {
      id: 'opt_launch',
      kind: 'option',
      label: 'Launch now',
      data: { interventions: { fac_marketing: 0.7 } },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Status quo',
      data: { interventions: { fac_marketing: 0.3 } },
    },
  ],
  edges: [
    { from: 'opt_launch', to: 'fac_marketing' },
    { from: 'opt_status_quo', to: 'fac_marketing' },
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

function appliedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge updated.',
    latencyMs: 100,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
  };
}

function rejectedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edit rejected.',
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: true,
  };
}

function commitOk() {
  return { response: {}, performed: true as const, persisted_row_id: 'row-1', graphPersisted: true };
}

const STUB_REQUEST = {} as FastifyRequest;

describe('edit-graph-dispatch — analysisReady surfacing (response-finaliser brief)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applied edit surfaces analysisReady on the dispatch result, not on the response', async () => {
    // After the response-finaliser brief, the composer no longer stamps
    // analysis_ready. The dispatcher computes structural readiness from
    // editResult.appliedGraph and surfaces it on DispatchEditGraphResult
    // for the route-v2.ts finaliser to stamp.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(appliedResult());
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      commitOk() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-applied',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    // Response itself is clean — composer-cleanliness invariant.
    expect('analysis_ready' in out.response).toBe(false);

    // Dispatch result carries the pre-computed payload.
    expect(out.analysisReady).toBeDefined();
    const ar = out.analysisReady!;
    expect(ar.goal_node_id).toBe('goal_revenue');
    expect(typeof ar.status).toBe('string');
    expect(ar.options.map((o) => o.option_id).sort()).toEqual(['opt_launch', 'opt_status_quo']);
    // The dispatcher does NOT attach computed_at — that's the finaliser's job.
    expect((ar as { computed_at?: string }).computed_at).toBeUndefined();
  });

  it('rejected edit surfaces no analysisReady — UI retains prior store value', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(rejectedResult());
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      { response: {}, performed: true as const, persisted_row_id: 'row-2', graphPersisted: false } as Awaited<
        ReturnType<typeof commitDirectAnswer>
      >,
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-rejected',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect('analysis_ready' in out.response).toBe(false);
    expect(out.analysisReady).toBeUndefined();
  });
});
