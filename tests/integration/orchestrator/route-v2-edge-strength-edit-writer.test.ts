import { stampRunAnalysisProjection } from '../../../src/orchestrator-v5/context/analysis-projection-policy.js';
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

import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { DEFAULT_STRENGTH_STD } from '../../../src/cee/constants.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { computeGraphIdentityHash } from '../../../src/orchestrator-v5/context/graph-identity.js';
import { GraphStaleWriteError } from '../../../src/orchestrator-v5/session/store.js';
import { isProvenanceOnlyEdgeConfirmation } from '../../../src/orchestrator-v5/system-events/edge-strength-edit.js';
import { edgeBandStd } from '../../../src/orchestrator-v5/format/edge-strength-bands.js';
import { log } from '../../../src/utils/telemetry.js';

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
const readScenarioRunAnalysisFactsForMock = vi.fn();
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
    // The scenario's durable analysis record: COMPLETE and EMPTY — what "never
    // analysed" means. Without the port the record is degraded, and an empty
    // 20-row window alone cannot prove absence (every writer's reply now uses the
    // shared rule, dispatch.ts `deriveWriteReplyFreshness`).
    readScenarioRunAnalysisFactsFor: readScenarioRunAnalysisFactsForMock,
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
// Imported AFTER the mocks, as the adoption precedent does (route-v2-option-intervention-edit.test.ts), so the
// context the test enters is the instance the route's writer reads.
const { runWithStatedLinkBand } = await import('../../../src/orchestrator-v5/agent-lane/stated-link-band-context.js');

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
      // Model a healthy Run produced by the current stamped producer.
    enrichment: stampRunAnalysisProjection({ analysis_status: 'computed' }),
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
    readScenarioRunAnalysisFactsForMock.mockReset();
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({ facts: [], total_count: 0 });
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

    // A6f (AIQ N1 on #2096): the UI's exact figure keeps Olumi's RELATIVE spread (0.1 at |0.4| → 0.175 at |0.7|),
    // flagged as Olumi's, through the real dispatcher, projection and post-commit guards.
    expect(committedEdge()).toMatchObject({
      strength: { mean: -0.7, std: 0.175 },
      std_defaulted: true,
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
        strength: { mean: -0.7, std: 0.175 },
        effect_direction: 'negative',
      },
    });
    const draftGraph = bodyRecord.draft_graph as Record<string, unknown>;
    const receiptEdges = draftGraph.edges as Array<Record<string, unknown>>;
    expect(receiptEdges.find(
      (edge) => edge.from === 'f-demand' && edge.to === 'g-growth',
    )).toMatchObject({
      strength: { mean: -0.7, std: 0.175 },
      std_defaulted: true, // A6f: the flag reaches the wire the UI reads
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
      // A6f: a mean of 0 has no relative spread, so the std is Olumi's default spread, flagged.
      expect(committedEdge()).toMatchObject({
        strength: { mean: 0, std: DEFAULT_STRENGTH_STD },
        std_defaulted: true,
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
    // R11 (AIQ #72 5872082179): a confirm is REVIEW, not authorship — source, reasoning and display KEPT, the review
    // recorded. (Before R11 this row pinned the `user_specified` / `user_set` stamp.)
    expect(committedEdge()).toMatchObject({
      strength: { mean: 0, std: 0.1 },
      effect_direction: 'negative',
      provenance: {
        source: 'cee_hypothesis',
        reasoning: 'Initial hypothesis',
        reviewed_by_user: { intent: 'confirm' },
      },
      provenance_display: 'ai_inferred',
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
    // R11: the receipt carries the same review record the commit does (before R11: the `user_specified` stamp).
    expect(receiptEdge).toMatchObject({
      strength: { mean: 0, std: 0.1 },
      effect_direction: 'negative',
      provenance: { source: 'cee_hypothesis', reviewed_by_user: { intent: 'confirm' } },
      provenance_display: 'ai_inferred',
    });
    // R3 5942069984: the stored link is Olumi's (cee_hypothesis, no sizing marker) — the receipt claims no authorship.
    expect(body.assistant_text).toContain('Confirmed the current strength of the link between Demand and Growth.');
    expect(body.assistant_text).not.toContain('your judgement');
    expect(body.assistant_text).not.toContain('Adjusted');
  });

  it('CONTROL (R3 5942069984): a USER-sized link confirmed → the receipt keeps "as your judgement" (the stored link is theirs)', async () => {
    const graph = buildPersistedGraph();
    graph.edges[0]!.strength.mean = 0;
    graph.edges[0]!.effect_direction = 'negative';
    (graph.edges[0] as Record<string, unknown>).provenance = { source: 'user_specified', reasoning: 'Initial hypothesis' };
    persisted = graph;
    const beforeHash = computeAnalysisAffectingGraphHash(graph as never)!;
    readRecentMock.mockResolvedValueOnce([{ id: 'prior-run-row' }]);
    readFactsForMock.mockResolvedValueOnce([successfulRunFact(beforeHash)]);
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0, direction_intent: 'preserve', expected: { mean: 0, effect_direction: 'negative' }, intent: 'confirm_current' }), '94'),
    });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(200);
    expect(committedEdge()).toMatchObject({ provenance: { source: 'user_specified', reviewed_by_user: { intent: 'confirm' } } });
    expect((JSON.parse(response.body) as { assistant_text: string }).assistant_text)
      .toContain('Confirmed the current strength of the link between Demand and Growth as your judgement.');
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
    // BOTH reads degraded: a complete durable record would decide on its own (its
    // absence is authoritative), so "we could not read the history" needs both.
    readScenarioRunAnalysisFactsForMock.mockRejectedValueOnce(
      new Error('simulated durable analysis-fact read failure'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.8 }), 'C0'),
    });

    expect(response.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(committedEdge()).toMatchObject({
      strength: { mean: -0.8, std: 0.2 }, // A6f: Olumi's relative spread carried to |0.8|
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
      strength: { mean: -0.7, std: 0.175 }, // A6f: Olumi's relative spread carried to |0.7|
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
      // Gesture-neutral on purpose: since 0.50.0 this ONE kind carries both a
      // strength change and a helps/hurts direction change, and the copy table
      // is keyed on `event.kind` alone — it cannot know which the user made.
      assistant_text:
        "I can't apply this link change in this version, so I haven't changed the model.",
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

  // F4: a REUSED turn id carrying a different request. The store signals
  // `priorTurnConflict` and writes nothing, so the commit's graph fields are the
  // reread snapshot (which still holds -0.4). Before the gate, the writer's
  // readback check compared that snapshot to its own candidate (-0.7) and
  // answered a KNOWN no-write with a retryable 500 — a retry under the same id
  // conflicts again. It must answer the commit's corrected reply instead.
  it('F4: a reused-id CONFLICT answers the commit\'s corrected reply (no success, no retryable 500) and presents the stored snapshot', async () => {
    const infoSpy = vi.spyOn(log, 'info');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch attempted in a no-provider test');
    });
    try {
      appendMock.mockResolvedValueOnce({ id: 'prior-row', priorTurnConflict: true });
      const stored = structuredClone(persisted) as ReturnType<typeof buildPersistedGraph>;

      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(validEvent(), 'f4'),
      });

      // Premise: the request reached the append WITH a candidate at -0.7, and
      // the store (whose graph this harness never mutates) still holds -0.4.
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(committedEdge()?.strength).toMatchObject({ mean: -0.7 });
      expect(await appendMock.mock.results[0]!.value).toMatchObject({ priorTurnConflict: true });
      expect(persisted).toEqual(stored);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(String(body.assistant_text)).toMatch(/did not make that change/i);
      const patches = ((body.blocks ?? []) as Array<Record<string, unknown>>).filter(
        (block) => block.type === 'graph_patch',
      );
      expect(patches.filter((patch) => patch.status === 'applied')).toEqual([]);
      expect(body.model_version_receipt).toBeUndefined();
      // The stored snapshot, for display only — never the unwritten candidate.
      const draftGraph = body.draft_graph as Record<string, unknown>;
      const edge = (draftGraph.edges as Array<Record<string, unknown>>).find(
        (candidate) => candidate.from === 'f-demand' && candidate.to === 'g-growth',
      );
      expect(edge).toMatchObject({ strength: { mean: -0.4 } });
      expect(body.graph_hash).toBe(computeAnalysisAffectingGraphHash(stored as never));
      // No success attestation for this attempt; the probe does see the
      // writer's no-write line in the same run (present control).
      const messages = infoSpy.mock.calls.map((call) => String(call[1]));
      expect(messages.filter((m) => m.startsWith('V5 edge_strength_edit committed'))).toEqual([]);
      expect(
        messages.filter((m) => m.startsWith('V5 edge_strength_edit — this attempt wrote nothing')),
      ).toHaveLength(1);
      expect(llmChatMock).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  // F4: a replay flag is not proof the edit happened — a committed REFUSAL row
  // under the same turn id replays too. "Already recorded" is said only when the
  // reread edge carries the requested mean, direction AND user-set provenance;
  // the three cases pin each side of the writer's `requestedChangeVisibleIn`.
  it('F4: a REPLAY with no receipt naming this turn never says "already recorded"; it says the change is in the model only when the reread edge carries the requested strength and user-set provenance', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('fetch attempted in a no-provider test');
    });
    const NOT_IN_MODEL =
      'Nothing new was written just now, and that change is not in the model at the moment.';
    const IN_MODEL =
      'Nothing new was written just now, and the model already reflects that change.';
    const post = async (event: Record<string, unknown>, suffix: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(event, suffix),
      });
      expect(response.statusCode).toBe(200);
      return JSON.parse(response.body) as Record<string, unknown>;
    };
    const storedEdge = () =>
      ((persisted as { edges: Array<Record<string, unknown>> }).edges).find(
        (edge) => edge.from === 'f-demand' && edge.to === 'g-growth',
      );
    try {
      // (1) set -0.7, NOT visible — the store still holds -0.4.
      appendMock.mockResolvedValueOnce({ id: 'prior-row', replayedPriorTurn: true });
      const notVisible = await post(validEvent(), 'f5');
      expect(await appendMock.mock.results[0]!.value).toMatchObject({ replayedPriorTurn: true });
      expect(storedEdge()).toMatchObject({ strength: { mean: -0.4 } });
      expect(String(notVisible.assistant_text)).toBe(NOT_IN_MODEL);
      expect(notVisible.model_version_receipt).toBeUndefined();

      // (2) set -0.7, visible — the store holds the committed edit.
      appendMock.mockImplementationOnce(async (write: { graph?: unknown }) => {
        persisted = write.graph;
        return { id: 'prior-row', replayedPriorTurn: true };
      });
      const visible = await post(validEvent(), 'f6');
      expect(storedEdge()).toMatchObject({
        strength: { mean: -0.7 },
        provenance: { source: 'user_specified' },
      });
      // Visible, but no receipt names this turn: in the model, attributed to no one.
      expect(String(visible.assistant_text)).not.toMatch(/already been recorded/i);
      expect(String(visible.assistant_text)).toBe(IN_MODEL);
      expect(visible.model_version_receipt).toBeUndefined();

      // (3) confirm_current, tuple unchanged by design, the review NOT recorded in
      //     the store — the review record is the whole change (R11: a confirm keeps
      //     the source and records `reviewed_by_user`), so it is not visible.
      persisted = buildPersistedGraph();
      appendMock.mockResolvedValueOnce({ id: 'prior-row', replayedPriorTurn: true });
      const unstamped = await post(
        validEvent({
          magnitude: 0.4,
          expected: { mean: -0.4, effect_direction: 'negative' },
          intent: 'confirm_current',
        }),
        'f7',
      );
      expect(committedEdge()).toMatchObject({
        strength: { mean: -0.4 },
        provenance: { source: 'cee_hypothesis', reviewed_by_user: { intent: 'confirm' } },
      });
      expect(storedEdge()).toMatchObject({
        strength: { mean: -0.4 },
        provenance: { source: 'cee_hypothesis' },
      });
      expect((storedEdge() as { provenance?: Record<string, unknown> }).provenance).not.toHaveProperty('reviewed_by_user');
      expect(String(unstamped.assistant_text)).toBe(NOT_IN_MODEL);

      expect(llmChatMock).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
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

  /**
   * `defaulted: true` says Olumi applied a default strength (EdgeV3, `schemas/cee-v3.ts`). This writer stamps the
   * edge `user_specified` in the same write, so a surviving flag contradicts that stamp. Served (F) row F8 on
   * `fd4c483` measured it twice (`f-20260926T083927Z`, `f-20260926T084243Z`). The Agent's `get_canonical_state`,
   * admissibility ("a strength this system chose") and coaching then read the user's own strength as a placeholder.
   */
  describe('a strength the user sets or confirms is no longer marked defaulted', () => {
    type LooseGraph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } & Record<string, unknown>;
    function withDefaultedEdges(): LooseGraph {
      const graph = buildPersistedGraph() as LooseGraph;
      graph.edges[0]!.defaulted = true;
      graph.nodes.push({ id: 'f-price', kind: 'factor', label: 'Price' });
      graph.edges.push({
        from: 'f-price',
        to: 'g-growth',
        strength: { mean: 0.5, std: 0.125 },
        exists_probability: 0.8,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', reasoning: 'Projected' },
        provenance_display: 'ai_inferred',
        defaulted: true,
      });
      return graph;
    }
    const edgeOf = (graph: unknown, from: string, to: string) =>
      ((graph as LooseGraph | undefined)?.edges ?? []).find((e) => e.from === from && e.to === to);

    it('⭐ a SET clears it on the edge it stamps as the user\'s, in the commit and the receipt; the untouched edge keeps it', async () => {
      persisted = withDefaultedEdges();
      const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payloadFor(validEvent(), 'a1') });

      expect(response.statusCode).toBe(200);
      expect(committedEdge()).toMatchObject({ strength: { mean: -0.7 }, provenance: { source: 'user_specified' } });
      expect(committedEdge()).not.toHaveProperty('defaulted');
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(edgeOf(body.draft_graph, 'f-demand', 'g-growth')).not.toHaveProperty('defaulted');
      expect(edgeOf(lastAppend().graph, 'f-price', 'g-growth'), 'contrast: an edge the user did not touch').toMatchObject({ defaulted: true });
    });

    // R11 (AIQ #72 5872082179, adopted by the DL): a confirm is REVIEW, not authorship — the source and `defaulted`
    // are KEPT and the review recorded. Before R11 this row pinned "adopts the strength as the user's: the flag clears".
    it('⭐ R11: confirm_current is review: source and the flag KEPT, review recorded, the analysis hash does not move', async () => {
      persisted = withDefaultedEdges();
      const beforeHash = computeAnalysisAffectingGraphHash(persisted as never);
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(
          validEvent({ magnitude: 0.4, direction_intent: 'preserve', expected: { mean: -0.4, effect_direction: 'negative' }, intent: 'confirm_current' }),
          'a2',
        ),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.assistant_text).toContain("You accepted Olumi's estimate for how much Demand changes Growth.");
      expect(committedEdge()).toMatchObject({
        strength: { mean: -0.4, std: 0.1 },
        // L4 (DL 5929790081): Olumi's default, approved, is sized as Olumi's estimate — authorship kept.
        provenance: { source: 'cee_hypothesis', reasoning: 'Initial hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } },
        provenance_display: 'ai_inferred',
        defaulted: true,
      });
      expect(committedEdge()).not.toHaveProperty('exists_defaulted');
      // The analysis hash moves by that sizing ALONE (the Run correctly reads out of date), and by nothing else.
      expect(computeAnalysisAffectingGraphHash(lastAppend().graph as never)).not.toBe(beforeHash);
      const sizedOnly = structuredClone(persisted) as { edges: Array<{ from: string; to: string; provenance?: Record<string, unknown> }> };
      const target = sizedOnly.edges.find((e) => e.from === 'f-demand' && e.to === 'g-growth')!;
      target.provenance = { ...(target.provenance ?? {}), magnitude: 'olumi_estimate' };
      expect(computeAnalysisAffectingGraphHash(lastAppend().graph as never)).toBe(computeAnalysisAffectingGraphHash(sizedOnly as never));
      expect(edgeOf(lastAppend().graph, 'f-price', 'g-growth'), 'contrast: an edge the user did not touch').toMatchObject({ defaulted: true });
    });

    it('the Agent\'s approval path (the same typed event at stage frame, agent-capabilities.ts) clears it too', async () => {
      persisted = withDefaultedEdges();
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'system_event',
          turn_id: `${TURN_ID_BASE}a3`,
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          event: { kind: 'edge_strength_edit', from: 'f-demand', to: 'g-growth', intent: 'set', direction_intent: 'preserve', magnitude: 0.7, expected: { mean: -0.4, effect_direction: 'negative' } },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(committedEdge()).toMatchObject({ strength: { mean: -0.7 }, provenance: { source: 'user_specified' } });
      expect(committedEdge()).not.toHaveProperty('defaulted');
    });

    /**
     * A6e (AIQ #70 5855430153): the Agent's `confirm_current` is the BAND path — the user named the band the link
     * already sits in. The band rides the approval in-process (`stated-link-band-context.ts`), exactly as
     * `authorise_change` wraps its `app.inject`, and the writer stores the band's own spread. The dispatcher re-runs
     * the confirmation guard on the COMMITTED bytes, so it must judge them with the same band or it withholds a
     * write that landed (500 `system_event_commit_failed`).
     */
    // R11: the band's spread is still stored (A6e) and the band recorded in the review; every authorship byte is KEPT.
    // Before R11 this row pinned `user_specified`, `defaulted` → `exists_defaulted`, and the reasoning dropped.
    // ⛔ #2473 CR (CODEX_CLI_OVERFLOW 5937437431, DL concur): this row used to pin the Agent's band confirm storing the
    // band's spread. A no-change confirm keeps the whole strength byte-equal; the band is recorded in the review only.
    it('⭐ A6e × R11 × #2473: the Agent\'s band confirm keeps the WHOLE strength, keeps every authorship byte, records the band — and the post-commit receipt guard admits it', async () => {
      persisted = withDefaultedEdges();
      const strengthBefore = structuredClone(edgeOf(persisted, 'f-demand', 'g-growth')!.strength);
      const response = await runWithStatedLinkBand(
        { scenarioId: SCENARIO_ID, proposalId: 'p-route-a6e', from: 'f-demand', to: 'g-growth', band: 'strong' },
        // ⚠ AWAITED INSIDE the scope, as production's `dispatchFor` does: `app.inject()` returns a lazy thenable
        // that dispatches on `.then()`, so a bare `() => app.inject(...)` would fire OUTSIDE the context.
        async () => await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: {
            kind: 'system_event',
            turn_id: `${TURN_ID_BASE}a4`,
            scenario_id: SCENARIO_ID,
            stage: 'frame',
            event: { kind: 'edge_strength_edit', from: 'f-demand', to: 'g-growth', intent: 'confirm_current', direction_intent: 'preserve', magnitude: 0.4, expected: { mean: -0.4, effect_direction: 'negative' } },
          },
        }),
      );

      expect(response.statusCode, response.body).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.assistant_text).toContain("You accepted Olumi's estimate for how much Demand changes Growth.");
      expect(committedEdge()?.strength).toStrictEqual(strengthBefore);
      expect((committedEdge()?.strength as { std: number }).std).not.toBe(edgeBandStd('strong'));
      expect(committedEdge()).toMatchObject({
        strength: { mean: -0.4 },
        effect_direction: 'negative',
        exists_probability: 0.9,
        defaulted: true,
        provenance: {
          source: 'cee_hypothesis',
          reasoning: 'Initial hypothesis',
          reviewed_by_user: { intent: 'confirm', band: 'strong' },
        },
      });
      expect(committedEdge()).not.toHaveProperty('exists_defaulted');
      expect(edgeOf(body.draft_graph, 'f-demand', 'g-growth')).toMatchObject({ defaulted: true, strength: strengthBefore });
      // R11: flags kept exactly — none was present, none is added.
      expect(committedEdge()).not.toHaveProperty('std_defaulted');
    });

    // R11: the allowlist now admits the review record and KEEPS `defaulted` — before R11 it admitted exactly
    // `defaulted` → absent (with `exists_defaulted: true`) alongside the `user_specified` stamp.
    describe('the confirmation allowlist keeps `defaulted` on the target edge exactly (R11), nothing wider', () => {
      const stamped = (graph: LooseGraph) => {
        const after = structuredClone(graph);
        const target = edgeOf(after, 'f-demand', 'g-growth')!;
        target.provenance = {
          ...(target.provenance as Record<string, unknown>),
          reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' },
        };
        return after;
      };
      const confirm = (before: LooseGraph, after: LooseGraph) =>
        isProvenanceOnlyEdgeConfirmation({ before, after, from: 'f-demand', to: 'g-growth' });

      it('⭐ R11: the target\'s flag KEPT: admitted; removed, even WITH the per-field `exists_defaulted: true` (the pre-R11 adoption): refused', () => {
        const before = withDefaultedEdges();
        expect(confirm(before, stamped(before))).toBe(true);
        const after = stamped(before);
        delete edgeOf(after, 'f-demand', 'g-growth')!.defaulted;
        edgeOf(after, 'f-demand', 'g-growth')!.exists_defaulted = true;
        expect(confirm(before, after)).toBe(false);
      });

      it('A6e: the target\'s flag removed WITHOUT `exists_defaulted`: refused — the pair moves together', () => {
        const before = withDefaultedEdges();
        const after = stamped(before);
        delete edgeOf(after, 'f-demand', 'g-growth')!.defaulted;
        expect(confirm(before, after)).toBe(false);
      });

      it('the flag ADDED to the target: refused', () => {
        const before = buildPersistedGraph() as LooseGraph;
        const after = stamped(before);
        edgeOf(after, 'f-demand', 'g-growth')!.defaulted = true;
        expect(confirm(before, after)).toBe(false);
      });

      it('the target\'s flag flipped to false: refused', () => {
        const before = withDefaultedEdges();
        const after = stamped(before);
        edgeOf(after, 'f-demand', 'g-growth')!.defaulted = false;
        expect(confirm(before, after)).toBe(false);
      });

      it('ANOTHER edge\'s flag removed: refused', () => {
        const before = withDefaultedEdges();
        const after = stamped(before);
        delete edgeOf(after, 'f-price', 'g-growth')!.defaulted;
        expect(confirm(before, after)).toBe(false);
      });
    });
  });

  /**
   * ⭐ CONFIRMING AN OLUMI-SIZED LINK ADOPTS IT. Served on CEE `1226b3e` / UI `853feeb7` (Canvas #70 5848798561):
   * "The link from Pro plan price to Monthly churn is slight." Olumi's default already sat in the slight band, so
   * `propose_link_strength` prepared a CONFIRM; the user approved, `authorise_change` answered `not_applied` and the
   * user read "Not saved: none of it was applied." The link was unchanged. The writer drops `provenance.natural_effect`
   * and `provenance.magnitude` on every user write (magnitude contract, R&C 5845818897, `adjust-edge-strength.ts`), and
   * the confirmation allowlist did not admit those two removals, so every confirm on a sized link refused
   * `confirmation_would_change_non_provenance_state`. The edge below is the served edge, verbatim.
   */
  describe('confirming an Olumi-sized link adopts it: the allowlist admits the magnitude contract\'s two removals, nothing wider', () => {
    type LooseGraph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } & Record<string, unknown>;
    const FROM = 'pro_plan_price';
    const TO = 'monthly_churn';
    const SERVED_MEAN = 0.19999999999999998;
    /** The served edge (`turns.jsonl`, turn 1 `draft_graph`), verbatim. */
    const servedEdge = (): Record<string, unknown> => ({
      to: TO,
      from: FROM,
      strength: { std: 0.09999999999999999, mean: SERVED_MEAN },
      defaulted: true,
      provenance: {
        source: 'cee_hypothesis',
        magnitude: 'olumi_estimate',
        natural_effect: {
          amount: 1,
          amount_unit: 'percentage points',
          strength_mean: SERVED_MEAN,
          per_source_change: 10,
          strength_mean_frame: 'edge_strength',
          per_source_change_unit: 'GBP/month',
        },
      },
      effect_direction: 'positive',
      exists_probability: 0.8,
    });
    function withOlumiSizedLink(): LooseGraph {
      const graph = buildPersistedGraph() as LooseGraph;
      graph.nodes.push(
        { id: FROM, kind: 'factor', label: 'Pro plan price' },
        { id: TO, kind: 'factor', label: 'Monthly churn' },
      );
      graph.edges.push(servedEdge());
      return graph;
    }
    const edgeOf = (graph: unknown, from: string, to: string) =>
      ((graph as LooseGraph | undefined)?.edges ?? []).find((e) => e.from === from && e.to === to);

    // R11 (AIQ #72 5872082179): the confirm still LANDS (the Canvas #70 5848798561 defect stays fixed), but as review:
    // Olumi's sizing, the source and `defaulted` are KEPT and the review recorded. Before R11 this row pinned the
    // adoption (`user_specified`, `user_set`, sizing and `defaulted` gone).
    it('⭐ R11: the approved confirm lands through the route: strength unchanged, Olumi\'s sizing and source KEPT, review recorded — in the commit and the receipt', async () => {
      persisted = withOlumiSizedLink();
      const beforeStrength = structuredClone(edgeOf(persisted, FROM, TO)!.strength);
      const beforeHash = computeAnalysisAffectingGraphHash(persisted as never);
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'system_event',
          turn_id: `${TURN_ID_BASE}b1`,
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          // Exactly what `authorise_change` dispatches for a confirm (agent-capabilities.ts): magnitude = |mean|.
          event: {
            kind: 'edge_strength_edit',
            from: FROM,
            to: TO,
            intent: 'confirm_current',
            direction_intent: 'preserve',
            magnitude: SERVED_MEAN,
            expected: { mean: SERVED_MEAN, effect_direction: 'positive' },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.assistant_text).toContain("You accepted Olumi's estimate for how much Pro plan price changes Monthly churn.");
      const committed = edgeOf(lastAppend().graph, FROM, TO);
      const receipt = edgeOf(body.draft_graph, FROM, TO);
      for (const [where, edge] of [['commit', committed], ['receipt', receipt]] as const) {
        expect(edge, where).toBeDefined();
        expect(edge!.strength, where).toStrictEqual(beforeStrength);
        expect(edge!.effect_direction, where).toBe('positive');
        const { reviewed_by_user: review, ...kept } = edge!.provenance as Record<string, unknown>;
        expect(kept, where).toStrictEqual(servedEdge().provenance);
        expect(review, where).toMatchObject({ intent: 'confirm' });
        expect(edge, where).not.toHaveProperty('provenance_display');
        expect(edge!.defaulted, where).toBe(true);
      }
      expect(computeAnalysisAffectingGraphHash(lastAppend().graph as never)).toBe(beforeHash);
      expect(edgeOf(lastAppend().graph, 'f-demand', 'g-growth'), 'contrast: an edge the user did not touch')
        .toMatchObject(buildPersistedGraph().edges[0]!);
    });

    describe('the pure guard', () => {
      /**
       * The writer's projection for a confirm on the served edge — R11: everything KEPT, the review recorded. (Before
       * R11: stamped, Olumi's sizing and reasoning dropped (A6c), `defaulted` → `exists_defaulted` (A6e), A6f flag.)
       */
      const projected = (graph: LooseGraph) => {
        const after = structuredClone(graph);
        const target = edgeOf(after, FROM, TO)!;
        target.provenance = {
          ...(target.provenance as Record<string, unknown>),
          reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' },
        };
        return after;
      };
      const confirm = (before: LooseGraph, after: LooseGraph) =>
        isProvenanceOnlyEdgeConfirmation({ before, after, from: FROM, to: TO });
      const provenanceOf = (graph: LooseGraph, from = FROM, to = TO) =>
        edgeOf(graph, from, to)!.provenance as Record<string, unknown>;

      it('⭐ R11: natural_effect and magnitude KEPT on the target: admitted; PRESENT → ABSENT (the pre-R11 adoption): refused', () => {
        const before = withOlumiSizedLink();
        expect(confirm(before, projected(before))).toBe(true);
        const dropped = projected(before);
        delete provenanceOf(dropped).natural_effect;
        delete provenanceOf(dropped).magnitude;
        expect(confirm(before, dropped)).toBe(false);
      });

      it('natural_effect ADDED to an unsized target: refused', () => {
        const before = withOlumiSizedLink();
        const target = edgeOf(before, FROM, TO)!;
        target.provenance = { source: 'cee_hypothesis' };
        const after = projected(before);
        provenanceOf(after).natural_effect = (servedEdge().provenance as Record<string, unknown>).natural_effect;
        expect(confirm(before, after)).toBe(false);
      });

      it('magnitude ADDED to an unsized target: refused', () => {
        const before = withOlumiSizedLink();
        edgeOf(before, FROM, TO)!.provenance = { source: 'cee_hypothesis' };
        const after = projected(before);
        provenanceOf(after).magnitude = 'user_stated';
        expect(confirm(before, after)).toBe(false);
      });

      it('natural_effect REWRITTEN: refused', () => {
        const before = withOlumiSizedLink();
        const after = projected(before);
        provenanceOf(after).natural_effect = {
          ...((servedEdge().provenance as Record<string, unknown>).natural_effect as Record<string, unknown>),
          amount: 2,
        };
        expect(confirm(before, after)).toBe(false);
      });

      it('CONTRAST: both removed AND provenance.reasoning rewritten: refused', () => {
        const before = withOlumiSizedLink();
        provenanceOf(before).reasoning = 'Olumi estimate';
        const after = projected(before);
        provenanceOf(after).reasoning = 'rewritten';
        expect(confirm(before, after)).toBe(false);
      });

      it('ANOTHER edge\'s natural_effect removed: refused', () => {
        const before = withOlumiSizedLink();
        provenanceOf(before, 'f-demand', 'g-growth').natural_effect = (servedEdge().provenance as Record<string, unknown>).natural_effect;
        const after = projected(before);
        delete provenanceOf(after, 'f-demand', 'g-growth').natural_effect;
        expect(confirm(before, after)).toBe(false);
      });
    });
  });

  /**
   * THE BAND READER through the mounted route (schemas 0.60.0 `edge_strength_edit.band`): the canvas band pill's
   * event crosses the real B1 parser, the writer stores the band's spread, and the dispatcher's post-commit receipt
   * guard judges a band confirm by the SAME band the adapter used — or it would withhold a write that landed.
   * Unit rows (mapping, contrast, parse): `src/orchestrator-v5/system-events/__tests__/edge-band-reader.test.ts`.
   */
  describe('0.60.0 `band` on the UI event (the canvas band pill)', () => {
    it('⭐ a band SET: committed std is the band’s, no `std_defaulted`, the mean is the pill’s', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(validEvent({ magnitude: 0.55, band: 'strong' }), 'd1'),
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(committedEdge()).toMatchObject({
        strength: { mean: -0.55, std: edgeBandStd('strong') },
        effect_direction: 'negative',
        provenance: { source: 'user_specified' },
      });
      expect(committedEdge()).not.toHaveProperty('std_defaulted');
    });

    it('⭐ a band outside the magnitude ("slight" at 0.55): refused, no graph written, the stored graph untouched', async () => {
      const beforeGraph = structuredClone(persisted);
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(validEvent({ magnitude: 0.55, band: 'slight' }), 'd2'),
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(appendMock).toHaveBeenCalledTimes(1);
      expect(lastAppend().graph).toBeUndefined();
      expect(lastAppend().handler_facts).toEqual([]);
      expect(persisted).toStrictEqual(beforeGraph);
      expect(JSON.parse(response.body)).not.toHaveProperty('draft_graph');
    });

    // ⛔ #2473 CR (CODEX_CLI_OVERFLOW 5937437431, DL concur): the canvas pill's typed band on a confirm used to move std
    // to the band's spread and the analysis hash with it. A no-change confirm is byte-equal through every door.
    it('⭐ #2473: a band CONFIRM keeps the whole strength, the analysis hash does NOT move, and the receipt guard admits it', async () => {
      const beforeHash = computeAnalysisAffectingGraphHash(persisted as never);
      const strengthBefore = structuredClone(((persisted as { edges: Array<Record<string, unknown>> }).edges
        .find((e) => e.from === 'f-demand' && e.to === 'g-growth')!).strength);
      const response = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: payloadFor(
          validEvent({ magnitude: 0.4, expected: { mean: -0.4, effect_direction: 'negative' }, intent: 'confirm_current', band: 'strong' }),
          'd3',
        ),
      });

      expect(response.statusCode, response.body).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;
      expect(body.assistant_text).toContain('Confirmed the current strength');
      expect(committedEdge()?.strength).toStrictEqual(strengthBefore);
      expect(committedEdge()).toMatchObject({ strength: { mean: -0.4 }, effect_direction: 'negative' });
      expect(committedEdge()).not.toHaveProperty('std_defaulted');
      expect(computeAnalysisAffectingGraphHash(lastAppend().graph as never)).toBe(beforeHash);
    });
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

describe('R3-9 × AIQ 5867435409 (1) at the ROUTE: the canvas edit reads the DURABLE last Run (DL verdict on #2229)', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready(); });
  afterAll(async () => { await app.close(); });

  // Growth = Demand × Price, declared by the brief: the edited link f-demand → g-growth is an operand of it.
  const productGraph = () => {
    const g = buildPersistedGraph() as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    g.nodes = g.nodes.map((n) => (n.id === 'g-growth'
      ? { ...n, nonlinear_identity: { operation: 'product', factor_ids: ['f-demand', 'f-price'], stated_in_brief: true } } : n));
    g.nodes.push({ id: 'f-price', kind: 'factor', label: 'Price' });
    g.edges.push({ from: 'f-price', to: 'g-growth', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive',
      provenance: { source: 'cee_hypothesis', reasoning: 'Initial hypothesis' }, provenance_display: 'ai_inferred' });
    return g;
  };
  const RUN_AT = '2026-09-28T09:00:00.000Z';
  const durableRun = (withdrawn: boolean) => RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO_ID, computed_at: RUN_AT, graph_hash_at_run: computeAnalysisAffectingGraphHash(productGraph() as never),
      leading_option_id: 'option-a', summary: 'Option A leads on the current model.', win_probabilities: { 'option-a': 0.6, 'option-b': 0.4 },
      enrichment: {
        analysis_status: 'completed',
        identity_evaluations: [{ node_id: 'g-growth', evaluated: !withdrawn }],
        ...(withdrawn ? { _meta: { identities_not_forwarded: [{ node_id: 'g-growth', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['f-price'] }] } } : {}),
      },
    },
  });

  beforeEach(() => {
    persisted = productGraph();
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
    readScenarioRunAnalysisFactsForMock.mockReset();
  });

  const seedDurable = (withdrawn: boolean) => readScenarioRunAnalysisFactsForMock.mockResolvedValue({
    facts: [{ fact: durableRun(withdrawn), fact_row_id: 'run-fact-row', fact_created_at: RUN_AT }], total_count: 1,
  });

  it('⭐ RED: the durable last Run WITHDREW the identity → the canvas edit is an ordinary belief: STORED through the handler', async () => {
    seedDurable(true);
    const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payloadFor(validEvent(), '91') });
    expect(response.statusCode).toBe(200);
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(lastAppend().handler_id).toBe('adjust_edge_strength');
    expect(committedEdge()).toMatchObject({ strength: { mean: -0.7 } });
  });

  it('CONTROL: the same durable Run WITHOUT the withdrawal (evaluated) → refused as definitional_link, the edge unchanged', async () => {
    seedDurable(false);
    const before = JSON.stringify(persisted);
    const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payloadFor(validEvent(), '92') });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { assistant_text?: string };
    expect(String(body.assistant_text)).toMatch(/This link is defined by Growth = Demand × Price/);
    expect(appendMock.mock.calls.every((c) => (c[0] as { handler_id?: unknown }).handler_id !== 'adjust_edge_strength')).toBe(true);
    expect(JSON.stringify(persisted)).toBe(before);
  });
});

/**
 * ⭐ M1 ACCEPT RECEIPT AT THE AGENT CARD (R3 5942069984; DL 5942097719; Codex pre-review P1 on 63892196): the Agent's
 * own propose → authorise, dispatched into the REAL route and link writer. Whose figure the approval says is read off the
 * STORED link after the write (`linkSizing`), never off the card: a confirm is review (R11), so Olumi's estimate lands
 * `olumi_accepted` and the user reads RC's accept sentence — the same one the system-event receipt says.
 */
describe('M1 Accept receipt at the Agent card: whose figure is read off the stored link', () => {
  let app: FastifyInstance;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let linkSizing: typeof import('../../../src/cee/magnitude/link-sizing.js').linkSizing;
  let acceptedOlumiEstimateSentence: typeof import('../../../src/orchestrator-v5/agent-lane/rerun-explanation.js').acceptedOlumiEstimateSentence;
  let withoutAgentDirections: typeof import('../../../src/orchestrator-v5/agent-lane/write-outcome.js').withoutAgentDirections;
  beforeAll(async () => {
    app = Fastify(); await ceeOrchestratorRouteV2(app); await app.ready();
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js'));
    ({ acceptedOlumiEstimateSentence } = await import('../../../src/orchestrator-v5/agent-lane/rerun-explanation.js'));
    ({ withoutAgentDirections } = await import('../../../src/orchestrator-v5/agent-lane/write-outcome.js'));
  });
  afterAll(async () => { await app.close(); });

  const FROM = 'price_sensitivity';
  const TO = 'monthly_churn';
  // Codex's probe link: μ 0.85, σ 0.3 — "very strong" on CEE's cuts.
  const graphWithLink = (provenance: Record<string, unknown>, labels: readonly [string, string] = ['Price sensitivity', 'Monthly churn']) => {
    const g = buildPersistedGraph() as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    g.nodes.push({ id: FROM, kind: 'factor', label: labels[0] }, { id: TO, kind: 'factor', label: labels[1] });
    g.edges.push({ from: FROM, to: TO, strength: { mean: 0.85, std: 0.3 }, exists_probability: 0.9, effect_direction: 'positive', provenance });
    return g;
  };
  const storedLink = () => ((persisted as { edges: Record<string, unknown>[] }).edges).find((e) => e.from === FROM && e.to === TO);
  const SAYS = 'Record that link as very strong, as my own estimate.';
  /** What the one-click path SHOWS: `follow_up` through the route's boundary (`agent-v1-turn.ts` → `withoutAgentDirections`). */
  const shown = (followUp: unknown) => withoutAgentDirections(String(followUp));

  beforeEach(() => {
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
    readScenarioRunAnalysisFactsForMock.mockReset();
    readScenarioRunAnalysisFactsForMock.mockResolvedValue({ facts: [], total_count: 0 });
  });

  /** The Agent's own dispatch, wired to the real route; the committed graph becomes the stored one the read-back reads. */
  const approveOnTheCard = async (labels: readonly [string, string] = ['Price sensitivity', 'Monthly churn']) => {
    const dispatch = async (path: string, body: unknown) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: persisted, graph_hash: computeAnalysisAffectingGraphHash(persisted as never) } };
      const calls = appendMock.mock.calls.length;
      const res = await app.inject({ method: 'POST', url: path, payload: body as Record<string, unknown> });
      if (appendMock.mock.calls.length > calls && lastAppend().graph !== undefined) persisted = lastAppend().graph;
      return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
    };
    const caps = createAgentCapabilities(dispatch as never, new ProposalStore());
    const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: null, request_id: 'r', user_text: SAYS, user_turn_text: SAYS };
    const p = await caps.proposeLinkStrength!(ctx, { from_label: labels[0], to_label: labels[1], strength: 'very strong', rationale: 'x' });
    expect(p, JSON.stringify(p)).toMatchObject({ ok: true, link: { keeps_current_strength: true } });
    const r = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, applied: true });
    expect(lastAppend().handler_id).toBe('adjust_edge_strength');
    return { p, r };
  };

  it('⭐ RED: Olumi\'s estimate confirmed on the card → stored olumi_accepted → the user reads RC\'s accept sentence, never "your own estimate"', async () => {
    persisted = graphWithLink({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' });
    const { p, r } = await approveOnTheCard();
    expect(String(p.public_label)).not.toContain('your own');
    expect(String(p.note)).toContain('never the user’s own');
    expect(linkSizing(storedLink())).toBe('olumi_accepted');
    expect(r.follow_up).toBe(acceptedOlumiEstimateSentence('"Price sensitivity"', '"Monthly churn"'));
    expect(r.follow_up).toBe('You accepted Olumi\'s estimate for how much "Price sensitivity" changes "Monthly churn".');
    expect(shown(r.follow_up)).toEqual({ text: r.follow_up, dropped: [] });
    expect(String(r.note)).toMatch(/^Recorded as the user’s review: the strength stays Olumi’s estimate/);
  });

  it('CONTROL: the user\'s OWN link confirmed on the same card → stored user → "as your own estimate" is kept', async () => {
    persisted = graphWithLink({ source: 'user_specified' });
    const { p, r } = await approveOnTheCard();
    expect(String(p.public_label)).toContain('as very strong, as your own estimate (its strength stays as it is)');
    expect(linkSizing(storedLink())).toBe('user');
    expect(r.follow_up).toBe('Recorded "Price sensitivity" → "Monthly churn" as very strong, as your own estimate (its strength stays as it is).');
    expect(String(r.note)).toMatch(/^Recorded as the user’s own estimate\./);
  });

  it.each([
    [['Size of the user base', 'cost_per_hire'], 'You accepted Olumi\'s estimate for how much "Size of the user base" changes "cost_per_hire".'],
    // Codex pre-review 3 P2: a label holding its own straight quotes is held aside whole (curly quotes).
    [['Size of "the user" base', 'cost_per_hire'], 'You accepted Olumi\'s estimate for how much “Size of "the user" base” changes "cost_per_hire".'],
  ] as const)('⭐ RED (Codex pre-reviews 2+3 P2): labels %j that read as the user or a code — the accept sentence is SHOWN whole', async (labels, sentence) => {
    persisted = graphWithLink({ source: 'cee_hypothesis', magnitude: 'olumi_estimate' }, labels);
    const { r } = await approveOnTheCard(labels);
    expect(linkSizing(storedLink())).toBe('olumi_accepted');
    expect(r.follow_up).toBe(sentence);
    expect(shown(r.follow_up)).toEqual({ text: r.follow_up, dropped: [] });
  });
});
