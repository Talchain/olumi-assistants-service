/**
 * R2 — auto-run provisional analysis: route-level trigger placement.
 *
 * The scheduler fires from EXACTLY ONE place — route-v2's draft_graph branch,
 * AFTER `sendFinalised200` has handed the draft response to the transport.
 * These specs pin:
 *
 *   1. POSITIVE: a successful fresh-draft turn schedules the auto-run once,
 *      with the draft's graph, analysis-affecting hash and turn id.
 *   2. LATENCY / NON-BLOCKING: a scheduler that throws synchronously cannot
 *      change the delivered draft response — the 200 and its body are already
 *      on the wire-side of the call.
 *   3. NEGATIVES (fresh drafts only):
 *      - a draft that produced no graph does not schedule;
 *      - a failed draft commit (500) does not schedule;
 *      - a chip-click run_analysis turn does not schedule (no re-trigger
 *        loops: the run path never schedules more runs);
 *      - a short non-draft message (TurnExecutor fallthrough) does not
 *        schedule. Reloads send no turn at all, so they cannot reach the
 *        trigger by construction — the route is the only caller.
 *
 * Harness: same seams as route-v2-draft-graph.test.ts — dispatchDraftGraph is
 * mocked at the module boundary (the route↔dispatcher contract is what this
 * file locks), and the auto-run module is mocked to observe scheduling.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { DRAFT_GRAPH_MIN_BRIEF_LENGTH } from '../../../src/schemas/assist.js';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const scheduleAutoRunMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/auto-run-after-draft.js', () => ({
  scheduleAutoRunAfterFreshDraft: scheduleAutoRunMock,
}));

const dispatchChipClickMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js')
  >('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js');
  return {
    ...actual,
    dispatchDeterministicChipClick: dispatchChipClickMock,
  };
});

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'short text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'short text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
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
const TURN_ID = '11111111-1111-4111-8111-111111111111';
const LONG_BRIEF =
  'Should we expand the product into the German market next quarter or hold?';

const DRAFT_GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
    { id: 'opt_1', kind: 'option', label: 'Expand', interventions: { fac_1: 0.4 } },
    { id: 'opt_2', kind: 'option', label: 'Hold' },
    { id: 'fac_1', kind: 'factor', label: 'Market demand' },
  ],
  edges: [],
};
const DRAFT_GRAPH_HASH = 'aag_v1:11112222333344445555666677778888';

function draftResult(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision model from your brief.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
    graph: DRAFT_GRAPH,
    freshness: {
      freshness: 'none' as const,
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: DRAFT_GRAPH_HASH,
      computed_at: null,
    },
    ...overrides,
  };
}

function draftTurnPayload(turnId = TURN_ID) {
  return {
    kind: 'message',
    turn_id: turnId,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message: LONG_BRIEF,
    turn_class: 'frame',
    source: 'composer',
  };
}

describe('POST /orchestrate/v2/turn — R2 auto-run scheduling after a fresh draft', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    expect(LONG_BRIEF.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    dispatchChipClickMock.mockReset();
    scheduleAutoRunMock.mockReset();
    appendMock.mockClear();
  });

  it('a successful fresh draft schedules the auto-run ONCE with the draft graph, hash and turn id', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload(),
    });

    expect(res.statusCode).toBe(200);
    expect(scheduleAutoRunMock).toHaveBeenCalledTimes(1);
    const args = scheduleAutoRunMock.mock.calls[0][0];
    expect(args.scenarioId).toBe(SCENARIO_ID);
    expect(args.draftTurnId).toBe(TURN_ID);
    expect(args.draftGraph).toEqual(DRAFT_GRAPH);
    expect(args.draftGraphHash).toBe(DRAFT_GRAPH_HASH);
    expect(typeof args.requestId).toBe('string');
  });

  it('a synchronously-throwing scheduler cannot affect the delivered draft (200 + body intact)', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(draftResult());
    scheduleAutoRunMock.mockImplementationOnce(() => {
      throw new Error('scheduling fault');
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload('11111111-1111-4111-8111-111111111112'),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain('Drafted a decision model');
  });

  it('a draft that produced NO graph does not schedule', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(
      draftResult({ graph: null, freshness: undefined, analysisReady: undefined }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload('11111111-1111-4111-8111-111111111113'),
    });

    expect(res.statusCode).toBe(200);
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
  });

  it('a failed draft commit (500) does not schedule', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce(
      draftResult({ commitPerformed: false }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: draftTurnPayload('11111111-1111-4111-8111-111111111114'),
    });

    expect(res.statusCode).toBe(500);
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
  });

  it('a chip-click run_analysis turn does NOT schedule (the run path never schedules more runs)', async () => {
    dispatchChipClickMock.mockResolvedValueOnce({
      outcome: 'ok',
      response: {
        response_version: 2 as const,
        assistant_text: 'Analysis complete.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
      graph: null,
      answerKind: 'functional',
      mayNameLeadingOption: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111115',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Run analysis.',
        turn_class: 'decide',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchChipClickMock).toHaveBeenCalledTimes(1);
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  it('a short non-draft message (TurnExecutor fallthrough) does not schedule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111116',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'What now?',
        turn_class: 'frame',
        source: 'composer',
      },
    });

    // Same tolerance as route-v2-draft-graph.test.ts: the fallthrough may 200
    // or 500 in this harness. What matters is the trigger contract.
    expect([200, 500]).toContain(res.statusCode);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(scheduleAutoRunMock).not.toHaveBeenCalled();
  });
});
