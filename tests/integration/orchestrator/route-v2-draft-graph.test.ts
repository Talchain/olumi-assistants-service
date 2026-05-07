/**
 * Task 2 — route-level tests for V5 draft_graph pre-Sonnet dispatch.
 *
 * Validates the route-v2 branch that delegates first-time brief
 * submissions (stage=frame, no graph_state, message length meets
 * DRAFT_GRAPH_MIN_BRIEF_LENGTH) to the unified pipeline via
 * dispatchDraftGraph.
 *
 * We mock dispatchDraftGraph itself — the adapter's contract with the route
 * is what this test locks in. The unified pipeline's internal behaviour is
 * covered by existing pipeline tests; doubling that surface here would
 * produce a fragile fixture that needs LLM + PLoT mocks.
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

// Session store mock for TurnExecutor fallthrough cases.
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

// Text-only LLM mock for TurnExecutor fallthrough on short messages.
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

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '11111111-1111-4111-8111-111111111111';

const LONG_BRIEF = 'Should we expand the product into the German market next quarter or hold?';
const _SHORT_BRIEF = 'What now?';

function makeDraftGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph with 3 nodes and 2 edges.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

describe('POST /orchestrate/v2/turn — draft_graph dispatch', () => {
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
    appendMock.mockClear();
  });

  it('stage=frame + no graph + message >= MIN_BRIEF_LENGTH → dispatches draft_graph, returns 200', async () => {
    // Sanity: the test brief is actually above threshold.
    expect(LONG_BRIEF.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: TURN_ID,
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(res.body);
    expect(body.response_version).toBe(2);
    expect(body.assistant_text).toContain('Drafted a decision graph');
    expect(body.stage_indicator).toBe('frame');
  });

  it('boundary test: message length exactly MIN_BRIEF_LENGTH with decision keyword → dispatch fires', async () => {
    // Pad with a decision keyword + filler so length is exactly the threshold.
    const base = 'Should we launch?';
    const padding = 'a'.repeat(DRAFT_GRAPH_MIN_BRIEF_LENGTH - base.length);
    const exactlyMin = base + padding;
    expect(exactlyMin.length).toBe(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111112',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: exactlyMin,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
  });

  it('boundary test: message length MIN_BRIEF_LENGTH - 1 → fall through (422 ingress, not dispatch)', async () => {
    const base = 'Should we launch?';
    const padding = 'a'.repeat(DRAFT_GRAPH_MIN_BRIEF_LENGTH - 1 - base.length);
    const belowMin = base + padding;
    expect(belowMin.length).toBe(DRAFT_GRAPH_MIN_BRIEF_LENGTH - 1);
    // The v0.7.0 schema allows any message >= 1 char, so this passes ingress
    // validation but falls through to the TurnExecutor path (text-only LLM
    // response), NOT the draft_graph dispatcher.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111113',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: belowMin,
        turn_class: 'frame',
        source: 'composer',
      },
    });

    // Dispatch must NOT have been called — the trigger guard rejects
    // messages below the draft threshold. The fallthrough path exercises
    // TurnExecutor, which may succeed (200) or fail (500) depending on
    // session state in this test environment. What matters for the
    // trigger contract is that dispatchDraftGraph stayed untouched.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=frame + graph_state present → fall through (not a new draft)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111114',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
        graph_state: { nodes: [{ id: 'n1', kind: 'option', label: 'Option A' }], edges: [] },
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('conversational message without decision keywords → fall through (not a brief)', async () => {
    const conversational = 'Give me a short framing for this whole thing please';
    expect(conversational.length).toBeGreaterThanOrEqual(DRAFT_GRAPH_MIN_BRIEF_LENGTH);
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-11111111111a',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: conversational,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('stage=decide → fall through (draft is frame-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111115',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: LONG_BRIEF,
        turn_class: 'decide',
        source: 'composer',
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  it('draft dispatch commit failure → 500 BoundaryError', async () => {
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: makeDraftGraphMockResult().response,
      commitPerformed: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111116',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_commit_failed');
  });

  it('draft dispatcher throws → 500 BoundaryError', async () => {
    dispatchDraftGraphMock.mockRejectedValueOnce(new Error('pipeline exploded'));
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '11111111-1111-4111-8111-111111111117',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: LONG_BRIEF,
        turn_class: 'frame',
        source: 'composer',
      },
    });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.details.reason).toBe('draft_graph_pipeline_threw');
  });

  // ------------------------------------------------------------------
  // Regression: phrasings that might trip the heuristic trigger
  // ------------------------------------------------------------------
  // The heuristic regex is known to produce false negatives on valid
  // decision briefs that don't use the tracked verbs. These cases
  // document current behaviour so a future trigger change can see
  // exactly which phrasings it's affecting. False negatives fall
  // through to TurnExecutor text_only (already WORKING in the matrix),
  // so the user still gets a response — just not a graph.

  describe('regression phrasings — current trigger behaviour', () => {
    const cases = [
      {
        label: 'positive: "should we" + decide',
        message: 'Should we launch the new SKU in Q3 or hold?',
        expectDispatch: true,
      },
      {
        label: 'positive: "whether to"',
        message: 'Whether to acquire the smaller competitor this year or next',
        expectDispatch: true,
      },
      {
        label: 'positive: ends with ?',
        message: 'Is this a reasonable plan for the next six months of growth?',
        expectDispatch: true,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: declarative "I am thinking about"',
        message: 'I am thinking about moving the team to Austin next spring',
        expectDispatch: false,
      },
      {
        label: 'KNOWN FALSE NEGATIVE: "considering options"',
        message: 'Considering our options for hiring senior engineers this year',
        expectDispatch: false,
      },
      {
        label: 'positive: "pivot"',
        message: 'Pivot from enterprise to SMB — is this the right move now?',
        expectDispatch: true,
      },
    ];

    let turnIdSuffix = 0;
    for (const c of cases) {
      it(`${c.label}`, async () => {
        if (c.expectDispatch) {
          dispatchDraftGraphMock.mockResolvedValueOnce(makeDraftGraphMockResult());
        }
        const res = await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: {
            kind: 'message',
            turn_id: `11111111-1111-4111-8111-1111111dd1${String(turnIdSuffix++).padStart(2, '0')}`,
            scenario_id: SCENARIO_ID,
            stage: 'frame',
            message: c.message,
            turn_class: 'frame',
            source: 'composer',
          },
        });
        if (c.expectDispatch) {
          expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
        } else {
          expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
        }
        expect([200, 500]).toContain(res.statusCode);
      });
    }
  });
});
