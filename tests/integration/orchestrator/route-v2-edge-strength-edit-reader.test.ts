/**
 * Mounted compatibility-reader proof for the 0.42 `edge_strength_edit` event.
 *
 * Train B is intentionally NOT the writer. A valid event crosses the real B1
 * root parser and deterministic route, but the only durable effect is the
 * refusal transcript: no graph, handler fact, or newly-derived pending action
 * is handed to the atomic append; legitimate prior pendings use the canonical
 * carry-forward lifecycle. Malformed or contradictory events stop at B1 with
 * 422.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { OlumiResponseSchema } from '@talchain/schemas/boundary';

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const loadGraphMock = vi.fn();
const loadGraphAndBriefTextMock = vi.fn();
const readFactsForMock = vi.fn().mockResolvedValue([]);
const readMostRecentPendingActionsMock = vi.fn().mockResolvedValue([]);

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: readFactsForMock,
    readMostRecentPendingActions: readMostRecentPendingActionsMock,
    loadGraph: loadGraphMock,
    loadGraphAndBriefText: loadGraphAndBriefTextMock,
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

const PRIOR_PENDING = {
  id: 'pa-reader-preserve-1',
  scenario_id: SCENARIO_ID,
  chip_id: 'chip-run-analysis-prior',
  action: { kind: 'run_analysis' },
  preconditions: {},
  expires_at_turn_count: 3,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-08-15T10:00:00.000Z',
} as const;

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
  graph?: unknown;
  handler_facts?: readonly unknown[];
  pending_actions?: readonly unknown[];
  turn_class?: string;
  handler_id?: string | null;
};

function lastAppend(): AppendArg {
  return (appendMock.mock.calls.at(-1)?.[0] ?? {}) as AppendArg;
}

describe('POST /orchestrate/v2/turn — edge_strength_edit compatibility reader', () => {
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
    appendMock.mockClear();
    loadGraphMock.mockClear();
    loadGraphAndBriefTextMock.mockClear();
    readFactsForMock.mockClear();
    readMostRecentPendingActionsMock.mockReset();
    readMostRecentPendingActionsMock.mockResolvedValue([]);
    llmChatMock.mockClear();
  });

  it('returns a typed non-retryable refusal and creates no graph, fact, or pending action', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '90'),
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

    expect(appendMock).toHaveBeenCalledTimes(1);
    const append = lastAppend();
    expect(append.turn_class).toBe('direct_answer');
    expect(append.handler_id ?? null).toBeNull();
    expect(append.graph).toBeUndefined();
    expect(append.handler_facts).toEqual([]);
    expect(append.pending_actions).toEqual([]);
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledTimes(1);
    expect(readMostRecentPendingActionsMock).toHaveBeenCalledWith(SCENARIO_ID);

    expect(body).not.toHaveProperty('analysis_ready');
    expect(body).not.toHaveProperty('draft_graph');
    expect(body).not.toHaveProperty('graph_hash');

    // Positive route controls: if the event were accidentally wired to the
    // existing mutation path, it would need the canonical graph/fact reads.
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(loadGraphAndBriefTextMock).not.toHaveBeenCalled();
    expect(readFactsForMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('carries the prior legitimate pending through the real commit lifecycle and derives none from refusal prose', async () => {
    readMostRecentPendingActionsMock.mockResolvedValueOnce([PRIOR_PENDING]);

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '94'),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body.assistant_text).toBe(
      "I can't apply this link-strength change in this version, so I haven't changed the model.",
    );
    expect(body.suggested_actions).toEqual([]);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const append = lastAppend();
    expect(append.graph).toBeUndefined();
    expect(append.handler_facts).toEqual([]);
    expect(append.pending_actions).toEqual([
      { ...PRIOR_PENDING, expires_at_turn_count: 2 },
    ]);

    const persisted = append.pending_actions as ReadonlyArray<{
      action?: { kind?: string };
      chip_id?: string;
    }>;
    expect(persisted.map((pending) => pending.chip_id)).toEqual([
      PRIOR_PENDING.chip_id,
    ]);
    expect(persisted.map((pending) => pending.action?.kind)).toEqual([
      'run_analysis',
    ]);
    expect(persisted.some((pending) => pending.action?.kind === 'proposed_concept')).toBe(false);

    expect(readMostRecentPendingActionsMock).toHaveBeenCalledTimes(1);
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(loadGraphAndBriefTextMock).not.toHaveBeenCalled();
    expect(readFactsForMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('fails the refusal commit closed when prior pending state cannot be read', async () => {
    readMostRecentPendingActionsMock.mockRejectedValueOnce(
      new Error('simulated pending read failure'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent(), '95'),
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
    expect(appendMock).not.toHaveBeenCalled();
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(loadGraphAndBriefTextMock).not.toHaveBeenCalled();
    expect(readFactsForMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });

  it('the response is independent of requested value — no payload is echoed as if applied', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.2 }), '91'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(validEvent({ magnitude: 0.9 }), '92'),
    });

    const project = (raw: string) => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      return {
        assistant_text: body.assistant_text,
        blocks: body.blocks,
        suggested_actions: body.suggested_actions,
        insights: body.insights,
      };
    };
    expect(project(first.body)).toStrictEqual(project(second.body));
    expect(appendMock).toHaveBeenCalledTimes(2);
    for (const [write] of appendMock.mock.calls) {
      const arg = write as AppendArg;
      expect(arg.graph).toBeUndefined();
      expect(arg.handler_facts).toEqual([]);
      expect(arg.pending_actions).toEqual([]);
    }
  });

  it.each([
    ['unknown authority field', validEvent({ provenance: 'user_set' })],
    ['contradictory expected direction', validEvent({
      expected: { mean: 0.4, effect_direction: 'negative' },
    })],
    ['contradictory confirmation', validEvent({
      magnitude: 0.7,
      direction_intent: 'negative',
      intent: 'confirm_current',
    })],
  ])('rejects %s at B1 before dispatch or append', async (_label, event) => {
    const response = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payloadFor(event, '93'),
    });

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      error: 'INGRESS_CONTRACT_VIOLATION',
      boundary: 'B1',
      direction: 'ingress',
      validator: 'OrchestratorTurnPayload',
      retryable: false,
    });
    expect(appendMock).not.toHaveBeenCalled();
    expect(loadGraphMock).not.toHaveBeenCalled();
    expect(readFactsForMock).not.toHaveBeenCalled();
    expect(llmChatMock).not.toHaveBeenCalled();
  });
});
