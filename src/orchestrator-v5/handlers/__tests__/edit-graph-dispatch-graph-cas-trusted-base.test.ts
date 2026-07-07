/**
 * A3 graph CAS — TRUSTED BASE acceptance test (hard acceptance item).
 *
 * The expected-base hashes on an edit commit must derive ONLY from the
 * server-side persisted graph (`loadPersistedGraphStrict`) — NEVER from the
 * request-supplied `graphState`, and NEVER from the graph being written.
 * A CAS that validates the write against itself always "matches" and is
 * worthless; this test makes that regression loud.
 *
 * Setup mirrors `edit-graph-dispatch-fact-emission.test.ts`: mocked
 * `handleEditGraph` (applied mutation), mocked `commitDirectAnswer`
 * (captures the metadata), and a mocked `loadPersistedGraphStrict` returning
 * a persisted server graph that DIFFERS from the incoming request graph.
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

// Stub ONLY the strict persisted read; everything else in build-turn-context
// stays real (buildTurnContext failing against the unconfigured test store is
// caught by the dispatch's freshness try/catch).
const { persistedBaseRef } = vi.hoisted(() => ({
  persistedBaseRef: { current: null as unknown },
}));
vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn(async () => persistedBaseRef.current),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { _resetConfigCache } from '../../../config/index.js';

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
  edges: [{ from: 'fac_price', to: 'goal_revenue' }],
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

async function runDispatch(): Promise<Parameters<typeof commitDirectAnswer>[1]> {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
    makeAppliedEditResult(),
  );
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );

  await dispatchEditGraph({
    payload: makePayload(),
    requestId: 'req-cas-trusted-base',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });

  const calls = (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![1];
}

// ── tests ───────────────────────────────────────────────────────────

describe('A3 graph CAS — trusted base rule on the edit path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedBaseRef.current = PERSISTED_SERVER_GRAPH;
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
    _resetConfigCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('expected hashes == hash(persisted SERVER graph), NOT hash(incoming request graph) and NOT hash(the write itself)', async () => {
    const metadata = await runDispatch();

    // Fixture sanity: the three graphs are pairwise identity-distinct.
    expect(idHash(PERSISTED_SERVER_GRAPH)).not.toBe(idHash(INGRESS_GRAPH));

    // The trusted base: the strict server read.
    expect(metadata.expectedGraphIdentityHash).toBe(idHash(PERSISTED_SERVER_GRAPH));
    expect(metadata.expectedGraphAnalysisHash).toBe(anHash(PERSISTED_SERVER_GRAPH));

    // NEVER the request-supplied graph_state…
    expect(metadata.expectedGraphIdentityHash).not.toBe(idHash(INGRESS_GRAPH));

    // …and NEVER the graph being written (the merged post-edit persisted
    // graph on metadata.graph): CAS must not validate the write against
    // itself.
    expect(metadata.graph).toBeDefined();
    expect(metadata.expectedGraphIdentityHash).not.toBe(idHash(metadata.graph));
  });

  it('mode off → the edit path threads no expected hashes (zero-cost flag-off)', async () => {
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'off');
    _resetConfigCache();

    const metadata = await runDispatch();
    expect(metadata.expectedGraphIdentityHash).toBeUndefined();
    expect(metadata.expectedGraphAnalysisHash).toBeUndefined();
    // The write itself is unchanged: the merged graph still commits.
    expect(metadata.graph).toBeDefined();
  });

  it('genuinely-empty server graph (strict read returned null) → expected hashes null, never manufactured from the request graph', async () => {
    persistedBaseRef.current = null;

    const metadata = await runDispatch();
    // Server base read happened; there was no graph → null (NOT the ingress
    // hash, NOT undefined).
    expect(metadata.expectedGraphIdentityHash).toBeNull();
    expect(metadata.expectedGraphAnalysisHash).toBeNull();
  });
});
