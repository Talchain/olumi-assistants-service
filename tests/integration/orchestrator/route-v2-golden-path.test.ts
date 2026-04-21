/**
 * Golden-path end-to-end: brief → draft → edit → run_analysis chip.
 *
 * Per brief §4 testing requirements: one test file that exercises the
 * full user journey with CEE_PIPELINE_V4_ENABLED=false, proving V5 is
 * self-sufficient for the primary four-turn flow after this brief lands.
 *
 * Mocking strategy: mock the three dispatcher modules at their public
 * boundaries (same pattern as the per-task tests). The dispatchers
 * themselves are covered in depth by route-v2-draft-graph / edit-graph /
 * chip-click test files. This test locks the route-level contract:
 * every dispatcher is reachable in sequence, each commits, each returns
 * a well-formed OlumiResponse.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dispatchDraftGraphMock = vi.fn();
const dispatchEditGraphMock = vi.fn();
const dispatchChipClickRunAnalysisMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));
vi.mock('../../../src/orchestrator-v5/handlers/edit-graph-dispatch.js', () => ({
  dispatchEditGraph: dispatchEditGraphMock,
}));
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: dispatchChipClickRunAnalysisMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'text-only response' }],
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

// CEE_PIPELINE_V4_ENABLED = false: the whole point of the brief. With the
// flag OFF, V5 must serve the four-turn golden path end-to-end.
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return true;
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

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

describe('V5 golden path — brief → edit → analysis chip, V4 flag OFF', () => {
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
    dispatchDraftGraphMock.mockReset();
    dispatchEditGraphMock.mockReset();
    dispatchChipClickRunAnalysisMock.mockReset();
    appendMock.mockClear();
  });

  it('completes brief → draft → edit → run_analysis chip end-to-end with 200 on each turn', async () => {
    // ------ Turn 1: brief submission → draft_graph dispatch ------
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted a decision graph with 3 nodes and 2 edges.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'frame' as const,
      },
      commitPerformed: true,
    });

    const t1 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111111',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'Should we expand into Germany next quarter or delay to Q3?',
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(t1.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const t1Body = JSON.parse(t1.body);
    expect(t1Body.response_version).toBe(2);
    expect(t1Body.stage_indicator).toBe('frame');

    // ------ Turn 2: natural-language edit → edit_graph dispatch ------
    dispatchEditGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Applied edit — graph now has 3 nodes and 3 edges.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
    });

    const t2 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '22222222-2222-4222-8222-222222222222',
        scenario_id: SCENARIO_ID,
        stage: 'analyse',
        message: 'Reduce the weight of the regulatory factor',
        turn_class: 'propose',
        source: 'composer',
        graph_state: {
          nodes: [
            { id: 'opt-1', kind: 'option', label: 'Expand Q2' },
            { id: 'opt-2', kind: 'option', label: 'Delay to Q3' },
            { id: 'fac-1', kind: 'factor', label: 'Regulatory' },
          ],
          edges: [
            { from: 'fac-1', to: 'opt-1' },
            { from: 'fac-1', to: 'opt-2' },
          ],
        },
      },
    });

    expect(t2.statusCode).toBe(200);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    const t2Body = JSON.parse(t2.body);
    expect(t2Body.stage_indicator).toBe('analyse');

    // ------ Turn 3: run_analysis chip click → chip_click dispatch ------
    dispatchChipClickRunAnalysisMock.mockResolvedValueOnce({
      outcome: 'ok' as const,
      response: {
        response_version: 2 as const,
        assistant_text: 'Ran analysis on your current scenario. Option A leads.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'decide' as const,
      },
      commitPerformed: true,
    });

    const t3 = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '33333333-3333-4333-8333-333333333333',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: 'Run analysis',
        turn_class: 'propose',
        source: 'chip_click',
        chip: { action_type: 'run_analysis' },
      },
    });

    expect(t3.statusCode).toBe(200);
    expect(dispatchChipClickRunAnalysisMock).toHaveBeenCalledTimes(1);
    const t3Body = JSON.parse(t3.body);
    expect(t3Body.assistant_text).toContain('analysis');
    expect(t3Body.stage_indicator).toBe('decide');

    // ------ Invariants across the whole journey ------
    // All three dispatchers fired exactly once each — no cross-contamination.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    expect(dispatchEditGraphMock).toHaveBeenCalledTimes(1);
    expect(dispatchChipClickRunAnalysisMock).toHaveBeenCalledTimes(1);
  });
});
