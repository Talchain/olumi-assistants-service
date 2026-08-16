/**
 * GRAPH-EDIT-TRANSACTION §3.2 — the edit lane must advertise the hash of the
 * graph it PERSISTS, not of the graph it had before the commit-site passes.
 *
 * THE DEFECT (confirmed at the bytes on staging `5afef510`).
 * `edit-graph-dispatch.ts` computed `currentGraphHashForRecovery =
 * computeAnalysisAffectingGraphHash(persistedPostEditGraph)` and then handed
 * that same graph to `commitDirectAnswer`, which runs three passes —
 * `repairGraphForPersistence`, `normaliseOptionInterventionContract`,
 * `reconcileTopLevelOptionsFromNodes` — that mutate `intercept`, node
 * `interventions` and `options[]`. All three are inside the analysis-hash
 * projection. So the hash the dispatch handed to freshness, to the pending
 * re-pin (`graph_hash`) and to the hold thread-through
 * (`graphHashAfterCommit`) described a graph that was never stored.
 *
 * This drives the REAL dispatch through the REAL persist-merge seam (only the
 * edit LLM and the commit are faked) and asserts the property directly: the
 * graph handed to the commit is already in persisted form, and the advertised
 * hash is that graph's hash. RED before the projection is applied.
 */
import { describe, it, expect, vi, beforeEach, type MockedFunction, afterEach } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
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

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { canonicalCommitResultFixture } from './canonical-commit-result-fixture.js';

const SCENARIO_ID = '7c1f6f42-0f4e-4a3a-9a1f-2b8c5d3e9a11';
const TURN_ID = '2a9c4d8e-5b1f-4c7a-8e3d-6f0a1b2c3d4e';

const hash = (g: unknown) =>
  computeAnalysisAffectingGraphHash(g as GraphStateIngress | null | undefined);

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_cost', kind: 'goal', label: 'Reduce Operating Costs' },
    { id: 'fac_rent', kind: 'factor', label: 'Annual Office Rent' },
  ],
  edges: [{ from: 'fac_rent', to: 'goal_cost' }],
};

/**
 * An ordinary applied value edit whose result carries the duplicate
 * observed-root intercept pattern (`intercept === observed_state.value`) —
 * precisely what `repairGraphForPersistence` strips at the persist site, and a
 * field the analysis hash projects.
 */
function makeInterceptDuplicateEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Updated the annual office rent to 42.',
    latencyMs: 1200,
    appliedGraph: {
      nodes: [
        { id: 'goal_cost', kind: 'goal', label: 'Reduce Operating Costs' },
        {
          id: 'fac_rent',
          kind: 'factor',
          label: 'Annual Office Rent',
          intercept: 42,
          observed_state: { value: 42 },
        },
      ],
      edges: [
        {
          from: 'fac_rent',
          to: 'goal_cost',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative' as const,
        },
      ],
    } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [{ op: 'update_node', path: 'fac_rent', value: { observed_state: { value: 42 } } }],
    appliedChanges: {
      summary: 'Annual Office Rent: set to 42',
      changes: [
        { label: 'Annual Office Rent', description: 'Set to 42.', element_ref: 'fac_rent' },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'moderate', rationale: '' }],
  };
}

const makePayload = () => ({
  kind: 'message' as const,
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  stage: 'analyse' as const,
  message: 'Set the annual office rent to 42',
  turn_class: 'frame' as const,
  source: 'composer' as const,
});

const STUB_REQUEST = {} as FastifyRequest;

// ── ROADMAP 2.474 / A10 — the mode is now STATED, not inherited ──────────
// `CEE_GRAPH_MANAGEMENT_MODE`'s repo default moved 'off' → 'live' (the referee
// ships ON; a trust story hanging on a dashboard variable is one careless edit
// from being untrue). This file pins PERSISTENCE mechanics — the merge base,
// the projection, the advertised hash — on a turn that reaches the commit. It
// was authored under the implicit 'off' default, and that premise is exactly
// what it needs: 'off' is the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged. Stating it
// here preserves the property this file was written to prove, and makes the
// dependency visible instead of inherited. Live-mode ROUTING is covered by its
// own files (edit-graph-dispatch-graph-management-modes.test.ts and the
// referee-gate suites), which is where a live regression would surface.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('dispatchEditGraph — §3.2: the advertised hash describes the PERSISTED graph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockImplementation(
      async (_response, metadata) =>
        canonicalCommitResultFixture(metadata.graph ?? null, {
          persistedRowId: 'row-hash',
        }),
    );
  });

  it('premise: this edit result IS one the persist projection changes', () => {
    const applied = makeInterceptDuplicateEditResult().appliedGraph;
    expect(hash(projectGraphForPersistence(applied, {}))).not.toBe(hash(applied));
  });

  it('the graph handed to the commit is ALREADY in persisted form (a projection fixed point)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeInterceptDuplicateEditResult(),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-persisted-hash-1',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    expect(commitMock).toHaveBeenCalledTimes(1);
    const graph = commitMock.mock.calls[0]![1].graph;
    expect(graph).toBeDefined();

    // Re-projecting must be a no-op: if it is not, the commit-site passes will
    // move the hash after the dispatch has already advertised it.
    expect(hash(projectGraphForPersistence(graph, {}))).toBe(hash(graph));
    // Concretely: the duplicate observed-root intercept is already gone.
    const fac = (graph as { nodes: Array<{ id: string; intercept?: number }> }).nodes.find(
      (n) => n.id === 'fac_rent',
    )!;
    expect(fac.intercept).toBeUndefined();
  });

  it('the graph_hash threaded to the commit EQUALS the hash of the graph threaded with it', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeInterceptDuplicateEditResult(),
    );

    const out = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-persisted-hash-2',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const metadata = commitMock.mock.calls[0]![1];
    // The pending re-pin and the hold thread-through both ride this value.
    expect(metadata.graph_hash).toBe(hash(metadata.graph));
    // And it is NOT the hash of the unprojected applied graph — the stale value.
    expect(metadata.graph_hash).not.toBe(
      hash(makeInterceptDuplicateEditResult().appliedGraph),
    );

    // The success receipt is built from those exact projected/persisted bytes,
    // not the pre-projection applied graph or a parsed subset.
    const receipt = out.response.draft_graph as unknown as Record<string, unknown>;
    const persisted = metadata.graph as Record<string, unknown>;
    for (const key of [
      'nodes',
      'edges',
      'options',
      'goal_node_id',
      'goal_constraints',
    ] as const) {
      expect(Object.hasOwn(persisted, key), `persisted ${key}`).toBe(true);
      expect(Object.hasOwn(receipt, key), `receipt ${key}`).toBe(true);
      expect(receipt[key], key).toStrictEqual(persisted[key]);
    }
    expect(receipt.node_count).toBe((receipt.nodes as unknown[]).length);
    expect(receipt.edge_count).toBe((receipt.edges as unknown[]).length);
    expect(out.response.graph_hash).toBe(hash(metadata.graph));
  });
});
