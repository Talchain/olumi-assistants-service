/**
 * A3 graph CAS — TRUSTED BASE acceptance test (hard acceptance item).
 *
 * The expected-base hashes on an edit commit must derive ONLY from the
 * server-side persisted graph (`loadPersistedGraphStrict`) — NEVER from the
 * request-supplied `graphState`, and NEVER from the graph being written.
 * A CAS that validates the write against itself always "matches" and is
 * worthless; this test makes that regression loud.
 *
 * OFF preserves staging read order. ON binds provider and save to one strict
 * server graph/revision read; a failed read refuses before the provider.
 *
 * Setup mirrors `edit-graph-dispatch-fact-emission.test.ts`: mocked
 * `handleEditGraph` (applied mutation), mocked `commitDirectAnswer`
 * (captures the metadata), and a mocked `loadPersistedScenarioStateStrict` returning
 * a persisted server graph and its revision from one read.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { AppliedChanges, PatchOperation } from '../../../orchestrator/types.js';

// ── module-level mocks ──────────────────────────────────────────────

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

// Stub the strict persisted reads; everything else in build-turn-context
// stays real (buildTurnContext failing against the unconfigured test store is
// caught by the dispatch's freshness try/catch).
const { persistedBaseRef } = vi.hoisted(() => ({
  persistedBaseRef: { current: null as unknown, revision: 7 },
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadScenarioBriefText: vi.fn(async () => null),
    loadPersistedGraphStrict: vi.fn(async () => persistedBaseRef.current),
    loadPersistedScenarioStateStrict: vi.fn(async () => ({ graph: persistedBaseRef.current, briefText: null, revision: persistedBaseRef.revision })),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { loadPersistedGraphStrict, loadPersistedScenarioStateStrict, loadScenarioBriefText } from '../../build-turn-context.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { _resetConfigCache } from '../../../config/index.js';
import { __setUseAppendV6ForTest } from '../../session/supabase-store.js';

// ── fixtures ────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STUB_REQUEST = {} as FastifyRequest;

function makePayload() {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Rename Price to Price (revised)',
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/** What the CLIENT sent — a lossy/stale echo, NOT the trusted base. */
const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price' },
  ],
  // A strictly-canonical base (GraphV3-valid edge). A structurally-invalid base
  // never persists an edit (`BASE_GRAPH_INVALID`, edit-graph-dispatch-fallback-
  // keeps-untouched.test.ts), and this suite pins applied-edit persistence.
  edges: [{ from: 'fac_price', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
};

/**
 * What the SERVER has persisted — richer than the client echo (extra factor,
 * observed values, goal_node_id). Deliberately different from INGRESS_GRAPH
 * in BOTH hash projections.
 */
const PERSISTED_SERVER_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend', observed_state: { value: 0.3 } },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_marketing',
      to: 'goal_revenue',
      strength: { mean: 0.3, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_revenue',
};

const POST_EDIT_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price (revised)' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive' as const,
    },
  ],
};

const APPLIED_CHANGES: AppliedChanges = {
  summary: 'Renamed "Price" to "Price (revised)"',
  changes: [{ label: 'Price', description: 'Renamed.', element_ref: 'fac_price' }],
  rerun_recommended: false,
};

const OPS: PatchOperation[] = [
  { op: 'update_node', path: 'fac_price', value: { label: 'Price (revised)' } },
];

function makeAppliedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Renamed "Price" to "Price (revised)"',
    latencyMs: 900,
    appliedGraph: POST_EDIT_GRAPH as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    appliedChanges: APPLIED_CHANGES,
    operations: OPS,
    operation_meta: [{ impact: 'low', rationale: '' }],
  };
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-cas-base',
    graphPersisted: true,
  };
}

function idHash(raw: unknown): string {
  const parsedGraph = GraphStateIngressSchema.safeParse(raw);
  if (!parsedGraph.success) throw new Error('fixture must parse');
  const h = computeGraphIdentityHash(parsedGraph.data);
  if (h === null) throw new Error('fixture must hash');
  return h.value;
}

function anHash(raw: unknown): string {
  const parsedGraph = GraphStateIngressSchema.safeParse(raw);
  if (!parsedGraph.success) throw new Error('fixture must parse');
  const h = computeAnalysisAffectingGraphHash(parsedGraph.data);
  if (h === null) throw new Error('fixture must hash');
  return h;
}

async function runDispatch(
  duringEdit: () => void = () => {},
  graphState = INGRESS_GRAPH,
  persistedEditBase?: Awaited<ReturnType<typeof loadPersistedScenarioStateStrict>>,
): Promise<Parameters<typeof commitDirectAnswer>[1]> {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockImplementation(async () => {
    duringEdit();
    return makeAppliedEditResult();
  });
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );

  await dispatchEditGraph({
    payload: makePayload(),
    requestId: 'req-cas-trusted-base',
    request: STUB_REQUEST,
    graphState,
    analysisState: null,
    ...(persistedEditBase !== undefined ? { persistedEditBase } : {}),
  });

  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![1];
}

// ── tests ───────────────────────────────────────────────────────────

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
// Addendum 17: retain the prior flag-ON rows here while the staging file stays unchanged.
describe('Addendum 17 — append-v6 coverage', () => {
  beforeEach(() => {
    __setUseAppendV6ForTest(true);
    vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
    _resetConfigCache();
  });
  afterEach(() => {
    __setUseAppendV6ForTest(false);
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  describe('A3 graph CAS — trusted base rule on the edit path', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      persistedBaseRef.current = PERSISTED_SERVER_GRAPH;
      persistedBaseRef.revision = 7;
      vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
      _resetConfigCache();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      _resetConfigCache();
    });

    describe('append-v6 OFF compatibility', () => {
      beforeEach(() => __setUseAppendV6ForTest(false));
      afterEach(() => __setUseAppendV6ForTest(false));

      it('OFF: expected hashes use the persisted SERVER graph, not the client or the write', async () => {
        const metadata = await runDispatch();

        // Fixture sanity: the three graphs are pairwise identity-distinct.
        expect(idHash(PERSISTED_SERVER_GRAPH)).not.toBe(idHash(INGRESS_GRAPH));

        // The trusted base: the strict server read.
        expect(metadata.expectedGraphIdentityHash).toBe(idHash(PERSISTED_SERVER_GRAPH));
        expect(metadata.expectedGraphAnalysisHash).toBe(anHash(PERSISTED_SERVER_GRAPH));
        expect(metadata.expectedRevision).toBeUndefined();

        // …and NEVER the graph being written (the merged post-edit persisted
        // graph on metadata.graph): CAS must not validate the write against
        // itself.
        expect(metadata.graph).toBeDefined();
        expect(metadata.expectedGraphIdentityHash).not.toBe(idHash(metadata.graph));
      });
    });

    it('ON: server reload carries its combined base and does not acquire a later revision', async () => {
      const reloadBase = { graph: PERSISTED_SERVER_GRAPH, briefText: null, revision: 7 };
      persistedBaseRef.current = POST_EDIT_GRAPH;
      persistedBaseRef.revision = 8;
      const metadata = await runDispatch(() => {}, GraphStateIngressSchema.parse(reloadBase.graph), reloadBase);
      expect(metadata.expectedRevision).toBe(7);
      expect(metadata.expectedGraphIdentityHash).toBe(idHash(reloadBase.graph));
      expect(metadata.baseGraphForInvariants).toBe(reloadBase.graph);
      expect(loadPersistedScenarioStateStrict).not.toHaveBeenCalled();
    });

    it('ON: a competing write during the provider cannot refresh the mutation revision or merge base', async () => {
      const metadata = await runDispatch(() => {
        persistedBaseRef.current = POST_EDIT_GRAPH;
        persistedBaseRef.revision = 8;
      });
      expect(metadata.expectedRevision).toBe(7);
      expect(metadata.expectedGraphIdentityHash).toBe(idHash(PERSISTED_SERVER_GRAPH));
      expect(metadata.baseGraphForInvariants).toBe(PERSISTED_SERVER_GRAPH);
      expect(loadPersistedScenarioStateStrict).toHaveBeenCalledTimes(1);
    });

    describe('append-v6 OFF compatibility', () => {
      beforeEach(() => __setUseAppendV6ForTest(false));
      afterEach(() => __setUseAppendV6ForTest(false));

      it('mode off → the edit path threads no expected hashes (zero-cost flag-off)', async () => {
        vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
        _resetConfigCache();

        const metadata = await runDispatch();
        expect(metadata.expectedGraphIdentityHash).toBeUndefined();
        expect(metadata.expectedGraphAnalysisHash).toBeUndefined();
        expect(metadata.expectedRevision).toBeUndefined();
        // The write itself is unchanged: the merged graph still commits.
        expect(metadata.graph).toBeDefined();
      });
    });

    describe('append-v6 OFF compatibility', () => {
      beforeEach(() => __setUseAppendV6ForTest(false));
      afterEach(() => __setUseAppendV6ForTest(false));

      it('genuinely-empty server graph (strict read returned null) → expected hashes null, never manufactured from the request graph', async () => {
        persistedBaseRef.current = null;
        persistedBaseRef.revision = 3;

        const metadata = await runDispatch(() => {}, INGRESS_GRAPH);
        // Server base read happened; there was no graph → null (NOT the ingress
        // hash, NOT undefined).
        expect(metadata.expectedGraphIdentityHash).toBeNull();
        expect(metadata.expectedGraphAnalysisHash).toBeNull();
        expect(metadata.expectedRevision).toBeUndefined();
      });
    });

    describe('append-v6 OFF compatibility', () => {
      beforeEach(() => __setUseAppendV6ForTest(false));
      afterEach(() => __setUseAppendV6ForTest(false));

      it('OFF: a failed brief read does not prevent the later strict merge read and save', async () => {
        vi.mocked(loadScenarioBriefText).mockRejectedValueOnce(new Error('temporary brief read outage'));
        // Even a supplied ON-only snapshot must be ignored with the flag OFF.
        const metadata = await runDispatch(() => {}, INGRESS_GRAPH, {
          graph: POST_EDIT_GRAPH, briefText: 'ignored', revision: 99,
        });
        expect(loadScenarioBriefText).toHaveBeenCalledOnce();
        expect(loadPersistedGraphStrict).toHaveBeenCalledOnce();
        expect(loadPersistedScenarioStateStrict).not.toHaveBeenCalled();
        expect(metadata.expectedRevision).toBeUndefined();
        expect(metadata.expectedGraphIdentityHash).toBe(idHash(PERSISTED_SERVER_GRAPH));
        expect(metadata.baseGraphForInvariants).toBe(PERSISTED_SERVER_GRAPH);
      });
    });

    describe('append-v6 OFF compatibility', () => {
      beforeEach(() => __setUseAppendV6ForTest(false));
      afterEach(() => __setUseAppendV6ForTest(false));

      it('OFF: the strict merge base is read after the provider, as on staging', async () => {
        const metadata = await runDispatch(() => {
          persistedBaseRef.current = POST_EDIT_GRAPH;
          persistedBaseRef.revision = 8;
        });
        expect(loadScenarioBriefText).toHaveBeenCalledOnce();
        expect(loadPersistedGraphStrict).toHaveBeenCalledOnce();
        expect(loadPersistedScenarioStateStrict).not.toHaveBeenCalled();
        expect(metadata.baseGraphForInvariants).toBe(POST_EDIT_GRAPH);
        expect(metadata.expectedRevision).toBeUndefined();
      });
    });

    it('ON: a failed initial combined read refuses before the provider or commit, without retry', async () => {
      vi.mocked(loadPersistedScenarioStateStrict).mockRejectedValueOnce(new Error('temporary outage'));
      await expect(runDispatch()).rejects.toMatchObject({ name: 'ModelReadFailedError', code: 'model_read_failed', statusCode: 503, retryable: true });
      expect(loadPersistedScenarioStateStrict).toHaveBeenCalledOnce();
      expect(handleEditGraph).not.toHaveBeenCalled();
      expect(commitDirectAnswer).not.toHaveBeenCalled();
    });

  });

});
