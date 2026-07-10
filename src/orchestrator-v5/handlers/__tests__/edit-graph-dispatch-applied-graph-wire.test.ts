/**
 * F2-CEE (1.16 run-3 diagnosis) — an APPLIED edit must return the applied
 * graph on the wire.
 *
 * Defect under test: the edit_graph apply path returned `blocks: []` and NO
 * graph payload, on the "phantom contract" assumption that the UI re-reads
 * the persisted scenarios.graph row — it never does. The UI's only
 * inline-graph ingestion path is the top-level `draft_graph` field
 * (adaptDraftResponse / applyDraftResult, CEE v0.8.0+), so applied server
 * edits were invisible on the canvas.
 *
 * Fix under test: the dispatch success return attaches the applied
 * post-mutation graph via the EXISTING `draft_graph` wire field (no new
 * wire fields — 0.15.0 schema constraint), same shape as the draft
 * dispatch emits: { nodes, edges, node_count, edge_count }, gated by the
 * SAME predicate as the returned `graph` (effective applied mutation, not
 * withheld) and attached only after `commitDirectAnswer` resolved.
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

// Stub ONLY the strict persisted read (V5-PERSIST-FIX-01 seam) so applied
// mutations do not fail closed against the unconfigured test store. `null` =
// genuinely-empty scenarios.graph → ingress-base fallback merge.
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

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
    message: 'Add a marketing spend factor',
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

// Post-edit graph carrying a node the ingress graph does NOT have
// (fac_marketing) — the RED assertion targets exactly that node so a
// pre-mutation echo cannot pass accidentally.
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
    assistantText: 'Added the marketing spend factor.',
    latencyMs: 100,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      { op: 'add_node', path: 'fac_marketing', value: { kind: 'factor' } },
    ],
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

function noopResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Nothing to change.',
    latencyMs: 100,
    appliedGraph: null,
    wasRejected: false,
    operations: [],
  };
}

function commitOk() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-1',
    graphPersisted: true,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

type DraftGraphField = {
  nodes: unknown[];
  edges: unknown[];
  node_count: number;
  edge_count: number;
};

describe('edit-graph-dispatch — applied edits carry the applied graph on the wire (F2-CEE)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successful apply: response.draft_graph carries the POST-mutation graph (new node present, counts authoritative)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(),
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      commitOk() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-applied-wire',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const dg = (out.response as { draft_graph?: DraftGraphField }).draft_graph;
    expect(dg).toBeDefined();
    // The node this edit ADDED is present — a pre-mutation echo would miss it.
    const nodeIds = (dg!.nodes as Array<{ id?: unknown }>).map((n) => n.id);
    expect(nodeIds).toContain('fac_marketing');
    // Same shape as the draft dispatch emits: counts derived from the SAME graph.
    expect(dg!.node_count).toBe(POST_EDIT_GRAPH.nodes.length);
    expect(dg!.edge_count).toBe(POST_EDIT_GRAPH.edges.length);
    expect(dg!.nodes).toHaveLength(dg!.node_count);
    expect(dg!.edges).toHaveLength(dg!.edge_count);
    // Attached only AFTER the commit resolved.
    expect(commitDirectAnswer).toHaveBeenCalledTimes(1);
    // Lockstep with the returned egress graph (same predicate).
    expect(out.graph).not.toBeNull();
  });

  it('rejected edit: no draft_graph — the canvas is unchanged', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      rejectedResult(),
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      commitOk() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-rejected-wire',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect('draft_graph' in out.response).toBe(false);
    expect(out.graph).toBeNull();
  });

  it('no-op edit (zero operations): no draft_graph — nothing was applied', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      noopResult(),
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      commitOk() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-noop-wire',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect('draft_graph' in out.response).toBe(false);
    expect(out.graph).toBeNull();
  });

  it('commit failure: no draft_graph — a failed commit never advertises unpersisted state', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult(),
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockRejectedValue(
      new Error('append_turn_atomic unavailable'),
    );

    const out = await dispatchEditGraph({
      payload: payload(),
      requestId: 'req-edit-commitfail-wire',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(out.commitPerformed).toBe(false);
    expect('draft_graph' in out.response).toBe(false);
    expect(out.graph).toBeNull();
  });
});
