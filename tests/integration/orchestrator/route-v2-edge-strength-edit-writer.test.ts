/**
 * Mounted proof for the 0.42 `edge_strength_edit` canonical writer.
 *
 * The tests cross the real B1 root parser and deterministic route. They pin
 * exact persisted-edge authority, the reused `adjust_edge_strength` writer,
 * atomic trusted-base CAS inputs, lossless newest-pending carry-forward, and
 * hash/freshness behaviour for both value changes and provenance-only
 * confirmation. No LLM participates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import {
  BoundaryErrorSchema,
  OlumiResponseSchema,
} from '@talchain/schemas/boundary';

import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../../src/orchestrator-v5/context/graph-identity.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';

function buildPersistedGraph() {
  return {
    goal_node_id: 'g-growth',
    nodes: [
      { id: 'g-growth', kind: 'goal', label: 'Growth' },
      { id: 'f-demand', kind: 'factor', label: 'Demand' },
    ],
    edges: [
      {
        from: 'f-demand',
        to: 'g-growth',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
        provenance: { source: 'cee_hypothesis', reasoning: 'Initial hypothesis' },
        provenance_display: 'ai_inferred',
      },
    ],
  };
}

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
const readMostRecentPendingActionsMock = vi.fn();
const readRecentMock = vi.fn();
const readFactsForMock = vi.fn().mockResolvedValue([]);
let persisted: unknown = buildPersistedGraph();
let graphCasRpcEnforce = true;
const commitReceiptState = vi.hoisted(() => ({
  mode: 'normal' as
    | 'normal'
    | 'graph_not_persisted'
    | 'hash_missing'
    | 'graph_null'
    | 'graph_malformed'
    | 'target_mismatch'
    | 'confirmation_cosmetic_mismatch',
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: readRecentMock,
    readFactsFor: readFactsForMock,
    readMostRecentPendingActions: readMostRecentPendingActionsMock,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    invalidateScoped: async (_scenarioId: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/orchestrator-v5/commit.js', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('../../../src/orchestrator-v5/commit.js')
  >();
  return {
    ...original,
    commitDirectAnswer: async (
      ...args: Parameters<typeof original.commitDirectAnswer>
    ) => {
      const result = await original.commitDirectAnswer(...args);
      switch (commitReceiptState.mode) {
        case 'normal':
          return result;
        case 'graph_not_persisted':
          return { ...result, graphPersisted: false };
        case 'hash_missing':
          return { ...result, persistedAnalysisGraphHash: null };
        case 'graph_null':
          return { ...result, persistedGraph: null };
        case 'graph_malformed':
          return { ...result, persistedGraph: { edges: 'not-an-array' } };
        case 'target_mismatch': {
          const graph = structuredClone(result.persistedGraph) as Record<
            string,
            unknown
          >;
          const edges = graph.edges as Array<Record<string, unknown>>;
          const edge = edges.find(
            (candidate) =>
              candidate.from === 'f-demand' && candidate.to === 'g-growth',
          )!;
          edge.strength = { mean: -0.65, std: 0.1 };
          return { ...result, persistedGraph: graph };
        }
        case 'confirmation_cosmetic_mismatch': {
          const graph = structuredClone(result.persistedGraph) as Record<
            string,
            unknown
          >;
          const nodes = graph.nodes as Array<Record<string, unknown>>;
          nodes[0] = { ...nodes[0], label: 'Unexpected committed label' };
          return { ...result, persistedGraph: graph };
        }
      }
    },
  };
});

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: llmChatMock,
    chatWithTools: llmChatMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: llmChatMock,
      chatWithTools: llmChatMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featureTarget, featureProp) {
              if (featureProp === 'pipelineV4Enabled') return false;
              if (featureProp === 'graphCas') {
                return graphCasRpcEnforce
                  ? {
                      appMode: 'observe',
                      rpcMode: 'enforce',
                      rpcEnforce: true,
                      requiresExpectedHash: true,
                    }
                  : {
                      appMode: 'off',
                      rpcMode: 'shadow',
                      rpcEnforce: false,
                      requiresExpectedHash: false,
                    };
              }
              return Reflect.get(featureTarget, featureProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID_BASE = '11111111-1111-4111-8111-1111111111';
const STRICT_PENDING_READ = { validation: 'strict' } as const;

function pendingPinnedTo(graphHash: string) {
  return {
    id: 'pa-edge-writer-prior',
    scenario_id: SCENARIO_ID,
    chip_id: 'chip-run-analysis-prior',
    action: { kind: 'run_analysis' as const },
    preconditions: { graph_hash: graphHash },
    expires_at_turn_count: 3,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-15T10:00:00.000Z',
  };
}

function successfulRunFact(graphHash: string) {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt-leading',
      summary: 'Analysis completed.',
      graph_hash_at_run: graphHash,
      computed_at: '2026-08-15T10:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  };
}

function payloadFor(event: Record<string, unknown>, suffix: string) {
  return {
    kind: 'system_event',
    turn_id: `${TURN_ID_BASE}${suffix}`,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'edge_strength_edit',
    from: 'f-demand',
    to: 'g-growth',
    magnitude: 0.7,
    direction_intent: 'preserve',
    expected: { mean: -0.4, effect_direction: 'negative' },
    intent: 'set',
    ...overrides,
  };
}

type AppendArg = {
  graph?: Record<string, unknown>;
  handler_facts?: readonly Record<string, unknown>[];
  pending_actions?: readonly Record<string, unknown>[];
  turn_class?: string;
  handler_id?: string | null;
  expectedGraphIdentityHash?: string;
  expectedGraphAnalysisHash?: string;
};

function lastAppend(): AppendArg {
  return (appendMock.mock.calls.at(-1)?.[0] ?? {}) as AppendArg;
}

function committedEdge() {
  const graph = lastAppend().graph;
  const edges = (graph?.edges ?? []) as Array<Record<string, unknown>>;
  return edges.find(
    (edge) => edge.from === 'f-demand' && edge.to === 'g-growth',
  );
}

describe('POST /orchestrate/v2/turn — edge_strength_edit writer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    persisted = buildPersistedGraph();
    graphCasRpcEnforce = true;
    commitReceiptState.mode = 'normal';
    appendMock.mockReset();
    appendMock.mockResolvedValue({ id: 'mock-row-id' });
    loadGraphMock.mockReset();
    loadGraphMock.mockImplementation(async () => persisted);
    readMostRecentPendingActionsMock.mockReset();
    readMostRecentPendingActionsMock.mockResolvedValue([]);
    readRecentMock.mockReset();
    readRecentMock.mockResolvedValue([]);
    readFactsForMock.mockReset();
    readFactsForMock.mockResolvedValue([]);
    llmChatMock.mockClear();
  });

  it('writes the exact persisted edge through the canonical handler with trusted CAS', async () => {
    const base = structuredClone(persisted);
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '90'),
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = JSON.parse(response.body);
    expect(OlumiResponseSchema.safeParse(body).success).toBe(true);
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(loadGraphMock).toHaveBeenCalledTimes(1);
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      STRICT_PENDING_READ,
    );
    expect(
      readMostRecentPendingActionsMock.mock.invocationCallOrder[0],
    ).toBeLessThan(appendMock.mock.invocationCallOrder[0]!);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const append = lastAppend();
    expect(append.turn_class).toBe('handler');
    expect(append.handler_id).toBe('adjust_edge_strength');
    expect(append.expectedGraphIdentityHash).toBe(
      computeGraphIdentityHash(base as never)?.value,
    );
    expect(append.expectedGraphAnalysisHash).toBe(
      computeAnalysisAffectingGraphHash(base as never),
    );
    expect(append.pending_actions).toEqual([]);
    expect(append.handler_facts?.[0]).toMatchObject({
      fact_type: 'adjust_edge_strength',
      noop: false,
      result: { status: 'applied' },
    });

    expect(committedEdge()).toMatchObject({
      strength: { mean: -0.7, std: 0.1 },
      effect_direction: 'negative',
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
    const bodyRecord = body as Record<string, unknown>;
    const patch = (bodyRecord.blocks as Array<Record<string, unknown>>).find(
      (block) => block.type === 'graph_patch',
    );
    expect(patch).toStrictEqual({
      type: 'graph_patch',
      status: 'applied',
      operation: 'adjust_edge_strength',
      target_id: 'f-demand→g-growth',
      before: {
        from: 'f-demand',
        to: 'g-growth',
        strength: { mean: -0.4, std: 0.1 },
        effect_direction: 'negative',
      },
      after: {
        from: 'f-demand',
        to: 'g-growth',
        strength: { mean: -0.7, std: 0.1 },
        effect_direction: 'negative',
      },
    });
    const draftGraph = bodyRecord.draft_graph as Record<string, unknown>;
    const receiptEdges = draftGraph.edges as Array<Record<string, unknown>>;
    expect(receiptEdges.find(
      (edge) => edge.from === 'f-demand' && edge.to === 'g-growth',
    )).toMatchObject({
      strength: { mean: -0.7, std: 0.1 },
      effect_direction: 'negative',
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
    expect(draftGraph.node_count).toBe(2);
    expect(draftGraph.edge_count).toBe(1);
    expect(bodyRecord.assistant_text).toContain('Demand');
    expect(bodyRecord.assistant_text).toContain('Growth');
    expect(bodyRecord.graph_hash).toBe(
      computeAnalysisAffectingGraphHash(append.graph as never),
    );
    expect(bodyRecord.analysis_ready).toBeDefined();
    expect(bodyRecord.analysis_ready).toMatchObject({
      freshness: 'none',
      freshness_reason: 'no_successful_run_analysis_fact',
    });
  });

  it.each([
    ['positive', -0.4, 'negative'],
    ['negative', 0.4, 'positive'],
  ] as const)(
    'persists explicit %s direction at zero without inventing influence',
    async (direction, beforeMean, beforeDirection) => {
      const graph = buildPersistedGraph();
      graph.edges[0]!.strength.mean = beforeMean;
      graph.edges[0]!.effect_direction = beforeDirection;
      persisted = graph;

      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(
          validEvent({
            magnitude: 0,
            direction_intent: direction,
            expected: {
              mean: beforeMean,
              effect_direction: beforeDirection,
            },
          }),
          direction === 'positive' ? '91' : '92',
        ),
      });

      expect(response.statusCode).toBe(200);
      expect(committedEdge()).toMatchObject({
        strength: { mean: 0, std: 0.1 },
        effect_direction: direction,
      });
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.assistant_text).toContain('zero');
      expect(body.assistant_text).toContain(`stored direction is ${direction}`);
    },
  );

  it('confirm_current changes provenance only, keeps freshness hash, and carries a pinned pending', async () => {
    const graph = buildPersistedGraph();
    graph.edges[0]!.strength.mean = 0;
    graph.edges[0]!.effect_direction = 'negative';
    persisted = graph;
    const beforeHash = computeAnalysisAffectingGraphHash(graph as never)!;
    const beforeIdentity = computeGraphIdentityHash(graph as never)?.value;
    readRecentMock.mockResolvedValueOnce([{ id: 'prior-run-row' }]);
    readFactsForMock.mockResolvedValueOnce([successfulRunFact(beforeHash)]);
    readMostRecentPendingActionsMock.mockResolvedValueOnce([
      pendingPinnedTo(beforeHash),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        validEvent({
          magnitude: 0,
          direction_intent: 'preserve',
          expected: { mean: 0, effect_direction: 'negative' },
          intent: 'confirm_current',
        }),
        '93',
      ),
    });

    expect(response.statusCode).toBe(200);
    const append = lastAppend();
    expect(committedEdge()).toMatchObject({
      strength: { mean: 0, std: 0.1 },
      effect_direction: 'negative',
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
    expect(append.handler_facts?.[0]).toMatchObject({ noop: true });
    expect(computeAnalysisAffectingGraphHash(append.graph as never)).toBe(
      beforeHash,
    );
    expect(computeGraphIdentityHash(append.graph as never)?.value).not.toBe(
      beforeIdentity,
    );
    expect(append.pending_actions).toEqual([
      { ...pendingPinnedTo(beforeHash), expires_at_turn_count: 2 },
    ]);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.graph_hash).toBe(beforeHash);
    expect(body.analysis_ready).toMatchObject({
      freshness: 'fresh',
      freshness_reason: 'graph_hash_match',
      computed_at: '2026-08-15T10:00:00.000Z',
    });
    expect((body.blocks as Array<Record<string, unknown>>).find(
      (block) => block.type === 'graph_patch',
    )).toStrictEqual({
      type: 'graph_patch',
      status: 'noop',
      operation: 'adjust_edge_strength',
      target_id: 'f-demand→g-growth',
      before: {
        from: 'f-demand',
        to: 'g-growth',
        strength: { mean: 0, std: 0.1 },
        effect_direction: 'negative',
      },
      after: {
        from: 'f-demand',
        to: 'g-growth',
        strength: { mean: 0, std: 0.1 },
        effect_direction: 'negative',
      },
    });
    const draftGraph = body.draft_graph as Record<string, unknown>;
    const receiptEdge = (draftGraph.edges as Array<Record<string, unknown>>).find(
      (candidate) => candidate.from === 'f-demand' && candidate.to === 'g-growth',
    );
    expect(receiptEdge).toMatchObject({
      strength: { mean: 0, std: 0.1 },
      effect_direction: 'negative',
      provenance: { source: 'user_specified' },
      provenance_display: 'user_set',
    });
    expect(body.assistant_text).toContain('Confirmed the current strength');
    expect(body.assistant_text).toContain('as your judgement');
    expect(body.assistant_text).not.toContain('Adjusted');
  });

  it('refuses an unchanged set without graph, fact, or provenance write and carries prior pending canonically', async () => {
    const beforeGraph = structuredClone(persisted);
    const beforeHash = computeAnalysisAffectingGraphHash(persisted as never)!;
    readMostRecentPendingActionsMock.mockResolvedValueOnce([
      pendingPinnedTo(beforeHash),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        validEvent({ magnitude: 0.4, direction_intent: 'preserve' }),
        'C1',
      ),
    });

    expect(response.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    const append = lastAppend();
    expect(append).toMatchObject({
      turn_class: 'direct_answer',
      handler_id: null,
      handler_facts: [],
      pending_actions: [
        { ...pendingPinnedTo(beforeHash), expires_at_turn_count: 2 },
      ],
    });
    expect(append.graph).toBeUndefined();
    expect(persisted).toStrictEqual(beforeGraph);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.assistant_text).toContain(
      'Confirm the current strength explicitly',
    );
    expect(body.assistant_text).not.toContain('confirm_current');
    expect(body.graph_hash).toBe(beforeHash);
    expect(body).not.toHaveProperty('draft_graph');
    expect((body.blocks as Array<Record<string, unknown>>).some(
      (block) => block.type === 'graph_patch',
    )).toBe(false);
  });

  it('an analysis-changing set moves freshness and invalidates a prior hash-pinned pending', async () => {
    const beforeHash = computeAnalysisAffectingGraphHash(persisted as never)!;
    readRecentMock.mockResolvedValueOnce([{ id: 'prior-run-row' }]);
    readFactsForMock.mockResolvedValueOnce([successfulRunFact(beforeHash)]);
    readMostRecentPendingActionsMock.mockResolvedValueOnce([
      pendingPinnedTo(beforeHash),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.8 }), '94'),
    });

    expect(response.statusCode).toBe(200);
    const append = lastAppend();
    const afterHash = computeAnalysisAffectingGraphHash(append.graph as never);
    expect(afterHash).not.toBe(beforeHash);
    expect(append.pending_actions).toEqual([]);
    expect((JSON.parse(response.body) as Record<string, unknown>).graph_hash).toBe(
      afterHash,
    );
    expect((JSON.parse(response.body) as Record<string, unknown>).analysis_ready)
      .toMatchObject({
        freshness: 'stale',
        freshness_reason: 'graph_hash_diverged',
        computed_at: '2026-08-15T10:00:00.000Z',
      });
  });

  it('keeps a degraded prior-fact read observational and reports freshness unknown', async () => {
    readRecentMock.mockResolvedValueOnce([{ id: 'prior-run-row' }]);
    readFactsForMock.mockRejectedValueOnce(
      new Error('simulated prior-fact read failure'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.8 }), 'C0'),
    });

    expect(response.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedEdge()).toMatchObject({
      strength: { mean: -0.8, std: 0.1 },
      effect_direction: 'negative',
    });
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.analysis_ready).toMatchObject({
      freshness: 'unknown',
      freshness_reason: 'derivation_failed',
    });
  });

  it('ignores a divergent request graph_state and writes only from persisted authority', async () => {
    const clientGraph = buildPersistedGraph();
    clientGraph.edges[0]!.strength.mean = 0.95;
    clientGraph.edges[0]!.effect_direction = 'positive';

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        ...payloadFor(validEvent(), 'A0'),
        graph_state: clientGraph,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(loadGraphMock).toHaveBeenCalledTimes(1);
    expect(committedEdge()).toMatchObject({
      strength: { mean: -0.7, std: 0.1 },
      effect_direction: 'negative',
    });
  });

  it('keeps the deployed reader floor active while atomic RPC enforcement is not active', async () => {
    graphCasRpcEnforce = false;
    const currentHash = computeAnalysisAffectingGraphHash(persisted as never)!;
    readMostRecentPendingActionsMock.mockResolvedValueOnce([
      pendingPinnedTo(currentHash),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), 'A1'),
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = JSON.parse(response.body);
    expect(OlumiResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      response_version: 2,
      assistant_text:
        "I can't apply this link-strength change in this version, so I haven't changed the model.",
      blocks: [
        {
          type: 'error',
          error_code: 'FEATURE_NOT_ENABLED',
          severity: 'warn',
          details: {
            reason: 'edge_strength_edit_reader_only',
            retryable: false,
          },
        },
      ],
      suggested_actions: [],
      insights: [],
    });
    expect(body).not.toHaveProperty('analysis_ready');
    expect(body).not.toHaveProperty('draft_graph');
    expect(body).not.toHaveProperty('graph_hash');
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      STRICT_PENDING_READ,
    );
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(lastAppend()).toMatchObject({
      turn_class: 'direct_answer',
      handler_id: null,
      handler_facts: [],
      pending_actions: [
        { ...pendingPinnedTo(currentHash), expires_at_turn_count: 2 },
      ],
    });
    expect(lastAppend().graph).toBeUndefined();
    expect(readFactsForMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-array newest pending_actions', 'jsonb_not_array', 'B0'],
    ['mixed valid/corrupt newest pending_actions', 'parse_failed', 'B1'],
    ['newest pending scenario mismatch', 'scenario_mismatch', 'B2'],
  ])(
    'keeps the reader floor fail-closed when strict pending rejects %s',
    async (_label, reason, suffix) => {
      graphCasRpcEnforce = false;
      readMostRecentPendingActionsMock.mockRejectedValueOnce(
        Object.assign(new Error(`simulated strict pending failure: ${reason}`), {
          name: 'SessionReadError',
          code: 'pending_actions_corrupt',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(validEvent(), suffix),
      });

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        boundary: 'B1',
        direction: 'egress',
        retryable: true,
        details: {
          reason: 'system_event_commit_failed',
          event_kind: 'edge_strength_edit',
        },
      });
      expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
        SCENARIO_ID,
        STRICT_PENDING_READ,
      );
      expect(appendMock).not.toHaveBeenCalled();
      expect(loadGraphMock).not.toHaveBeenCalled();
      expect(readFactsForMock).not.toHaveBeenCalled();
      expect(llmChatMock).not.toHaveBeenCalled();
    },
  );

  it('keeps reader-floor refusal bytes independent of the requested magnitude', async () => {
    graphCasRpcEnforce = false;
    const first = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.2 }), 'B3'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.9 }), 'B4'),
    });

    const refusalProjection = (raw: string) => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      return {
        assistant_text: body.assistant_text,
        blocks: body.blocks,
        suggested_actions: body.suggested_actions,
        insights: body.insights,
      };
    };
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(refusalProjection(first.body)).toStrictEqual(
      refusalProjection(second.body),
    );
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(appendMock).toHaveBeenCalledTimes(2);
    for (const [write] of appendMock.mock.calls) {
      const append = write as AppendArg;
      expect(append.graph).toBeUndefined();
      expect(append).toMatchObject({
        handler_facts: [],
        pending_actions: [],
      });
    }
  });

  it('fails closed on a non-null malformed persisted graph, with 500 and no append', async () => {
    persisted = { nodes: [], edges: [{ from: 'broken' }] };

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), 'A2'),
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toMatchObject({
      retryable: true,
      details: {
        reason: 'system_event_commit_failed',
        event_kind: 'edge_strength_edit',
      },
    });
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      STRICT_PENDING_READ,
    );
    expect(appendMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', 'edge_target_not_found', 0],
    ['reversed', 'edge_target_not_found', 0],
    ['duplicate', 'edge_target_ambiguous', 2],
  ] as const)(
    'returns a distinct typed 409 for a %s exact endpoint target',
    async (variant, conflictCategory, matchCount) => {
      if (variant === 'duplicate') {
        const graph = buildPersistedGraph();
        graph.edges.push(structuredClone(graph.edges[0]!));
        persisted = graph;
      }
      const event =
        variant === 'missing'
          ? validEvent({ from: 'f-missing' })
          : variant === 'reversed'
            ? validEvent({ from: 'g-growth', to: 'f-demand' })
            : validEvent();
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(
          event,
          variant === 'missing' ? 'A3' : variant === 'reversed' ? 'A5' : 'A4',
        ),
      });

      expect(response.statusCode).toBe(409);
      expect(appendMock).not.toHaveBeenCalled();
      expect(BoundaryErrorSchema.parse(JSON.parse(response.body))).toMatchObject({
        error: 'GRAPH_DIVERGED',
        retryable: false,
        details: {
          recovery_action: 'refresh_and_reconfirm',
          conflict_category: conflictCategory,
          edge: { match_count: matchCount },
        },
      });
    },
  );

  it('returns typed 409 for a stale expected tuple, appends nothing, and leaves the prior pending row authoritative', async () => {
    const currentHash = computeAnalysisAffectingGraphHash(persisted as never)!;
    readMostRecentPendingActionsMock.mockResolvedValueOnce([
      pendingPinnedTo(currentHash),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        validEvent({
          expected: { mean: -0.3, effect_direction: 'negative' },
        }),
        '95',
      ),
    });

    expect(response.statusCode).toBe(409);
    expect(appendMock).not.toHaveBeenCalled();
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      STRICT_PENDING_READ,
    );
    const body = BoundaryErrorSchema.parse(JSON.parse(response.body));
    expect(body.error).toBe('GRAPH_DIVERGED');
    expect(body.retryable).toBe(false);
    expect(body.details).toMatchObject({
      reason: 'graph_write_conflict',
      failure_type: 'GRAPH_DIVERGED',
      event_kind: 'edge_strength_edit',
      recovery_action: 'refresh_and_reconfirm',
      conflict_category: 'edge_expected_tuple_mismatch',
      expected_base_graph_hash: null,
      edge: {
        from: 'f-demand',
        to: 'g-growth',
        expected: { mean: -0.3, effect_direction: 'negative' },
        current: { mean: -0.4, std: 0.1, effect_direction: 'negative' },
        match_count: 1,
      },
    });
    // No newest row was appended, so the mock's prior pending remains at its
    // original TTL rather than being silently consumed or decremented.
    expect(pendingPinnedTo(currentHash).expires_at_turn_count).toBe(3);
  });

  it('fails before append when the integrity-strict newest-pending read rejects', async () => {
    readMostRecentPendingActionsMock.mockRejectedValueOnce(
      Object.assign(new Error('simulated corrupt pending row'), {
        name: 'SessionReadError',
        code: 'pending_actions_corrupt',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '96'),
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toMatchObject({
      boundary: 'B1',
      direction: 'egress',
      retryable: true,
      details: {
        reason: 'system_event_commit_failed',
        event_kind: 'edge_strength_edit',
      },
    });
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      STRICT_PENDING_READ,
    );
    expect(appendMock).not.toHaveBeenCalled();
  });

  it('returns typed 409 when the enforcing atomic CAS rejects, never a generic retryable 500', async () => {
    appendMock.mockRejectedValueOnce(
      new GraphStaleWriteError('simulated OLGC1 atomic CAS conflict', {
        conflict_category: 'rpc_cas_conflict',
        expected_base_graph_hash: 'expected-base-identity',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '97'),
    });

    expect(response.statusCode).toBe(409);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(lastAppend()).toMatchObject({
      handler_id: 'adjust_edge_strength',
      expectedGraphIdentityHash: expect.any(String),
      expectedGraphAnalysisHash: expect.any(String),
    });
    // ⚠ THIS ASSERTION WAS INVERTED UNTIL THE P0 FIX, and the old expectation
    // — `expected_base_graph_hash: 'expected-base-identity'`, i.e. whatever
    // 64-hex IDENTITY value the error happened to carry — was PINNING THE
    // DEFECT. The envelope tells the user to "refresh and reconfirm", and the
    // only hash a client can hold or send is the 16-hex ANALYSIS hash
    // (`OlumiResponse.graph_hash` / `freshness.current_graph_hash`); the
    // identity hash has no wire emitter at all. Handing one back named a
    // recovery that could never be performed (P8), and it made ONE wire field
    // carry TWO hash spaces depending on which gate refused.
    //
    // The pair below is what makes this discriminating rather than merely
    // green: the POSITIVE names the exact analysis-space value the server
    // holds, and the NEGATIVE proves the identity-space value the error
    // carried is no longer echoed. Either alone would pass for the wrong
    // reason.
    const currentAnalysisHash = computeAnalysisAffectingGraphHash(
      persisted as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );
    expect(currentAnalysisHash).toMatch(/^[0-9a-f]{16}$/);
    const body = BoundaryErrorSchema.parse(JSON.parse(response.body));
    expect(body).toMatchObject({
      error: 'GRAPH_DIVERGED',
      retryable: false,
      details: {
        reason: 'graph_write_conflict',
        recovery_action: 'refresh_and_reconfirm',
        conflict_category: 'rpc_cas_conflict',
        expected_base_graph_hash: currentAnalysisHash,
      },
    });
    expect(
      (body.details as { expected_base_graph_hash?: unknown })
        .expected_base_graph_hash,
    ).not.toBe('expected-base-identity');
  });

  it.each([
    'graph_not_persisted',
    'hash_missing',
    'graph_null',
    'graph_malformed',
    'target_mismatch',
  ] as const)(
    'withholds HTTP success when the post-append canonical receipt is %s',
    async (mode) => {
      commitReceiptState.mode = mode;

      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(validEvent(), 'C2'),
      });

      // The real commit path reached append successfully, but an invalid
      // authoritative receipt is not enough to release the UI write barrier.
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        retryable: true,
        details: {
          reason: 'system_event_commit_failed',
          event_kind: 'edge_strength_edit',
        },
      });
      expect(response.body).not.toContain('draft_graph');
    },
  );

  it('withholds confirmation success when authoritative readback exceeds the provenance-only allowlist', async () => {
    commitReceiptState.mode = 'confirmation_cosmetic_mismatch';

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(
        validEvent({
          magnitude: 0.4,
          direction_intent: 'preserve',
          intent: 'confirm_current',
        }),
        'C3',
      ),
    });

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toMatchObject({
      retryable: true,
      details: {
        reason: 'system_event_commit_failed',
        event_kind: 'edge_strength_edit',
      },
    });
    expect(response.body).not.toContain('draft_graph');
  });

  it('commits an honest no-graph refusal without inventing a graph write', async () => {
    persisted = null;
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '98'),
    });

    expect(response.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(lastAppend().graph).toBeUndefined();
    expect((JSON.parse(response.body) as Record<string, unknown>).assistant_text)
      .toMatch(/no saved model/i);
  });

  it.each([
    ['unknown authority field', validEvent({ provenance: 'user_set' })],
    [
      'contradictory expected direction',
      validEvent({ expected: { mean: 0.4, effect_direction: 'negative' } }),
    ],
    [
      'contradictory confirmation',
      validEvent({
        magnitude: 0.7,
        direction_intent: 'negative',
        intent: 'confirm_current',
      }),
    ],
  ])('rejects %s at B1 before reads or append', async (_label, event) => {
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(event, '99'),
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'INGRESS_CONTRACT_VIOLATION',
      boundary: 'B1',
      direction: 'ingress',
      validator: 'OrchestratorTurnPayload',
      retryable: false,
    });
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(readMostRecentPendingActionsMock).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });
});
