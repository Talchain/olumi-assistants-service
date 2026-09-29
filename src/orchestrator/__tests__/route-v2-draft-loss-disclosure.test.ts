/**
 * ROADMAP 2.735 — THE DRAFT-LOSS DISCLOSURE GATE.
 *
 * ── THE DEFECT THIS SUITE EXISTS FOR ────────────────────────────────────────
 * `route-v2.ts`'s draft-graph catch block wraps EVERY failure `dispatchDraftGraph`
 * can rethrow: a provider rate limit, an LLM timeout, a parse failure, a brief
 * that never reached the model — as well as a late `CEE_GRAPH_INVALID` that
 * lands after a GRAPH_READY preview has already streamed to the browser. It
 * marked all of them identically, and the scenario's next turn then told the
 * user "your last draft didn't save … the graph you saw was never saved".
 *
 * For every pre-preview failure that sentence is FALSE TWICE: there was no
 * draft, and there was no graph they saw. Our own review passed it; an external
 * audit (Codex, 2026-08-08) caught it. It was dark in production only because
 * the migration that creates the mark columns has not executed — which is why
 * that migration is BLOCKED on this fix rather than the other way round.
 *
 * ── WHAT IS PINNED, AND HOW IT DISCRIMINATES ────────────────────────────────
 * The route now states the claim explicitly at the marking site — `draft_loss`
 * or `turn_dead_only` — so this suite asserts the CLAIM, by identity, not a
 * side effect that some other code path could also produce (trap 19).
 *
 * The three cases below are a DISCRIMINATING SET, not three separate pins:
 * the same assertion shape is made about the same call with a different claim
 * in each, so a fix that simply hard-coded one value would fail the others.
 * Trap 13 is served by construction — the two `draft_loss` cases are the
 * positive controls proving this suite can SEE a real loss being marked, and
 * they fail if the marking is switched off wholesale rather than narrowed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import { runWithStageStream } from '../../cee/unified-pipeline/stage-stream-context.js';
import type { PipelineStageEvent } from '../../cee/unified-pipeline/types.js';

// ── dispatchDraftGraph: mocked as a detector + canned outcome ─────────────
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
const markGraphWriteFailedMock = vi.fn(async () => undefined);
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => false,
    hasOtherAdmittedLiveTurn: async () => false,
    scenarioDraftLossStands: async () => false,
    markGraphWriteFailed: markGraphWriteFailedMock,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const chatWithToolsMock = vi.fn(async () => ({
  content: [{ type: 'text', text: 'Executor reply.' }],
  usage: { input_tokens: 1, output_tokens: 1 },
}));
vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'narrate',
      resolved_model: 'test-model',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2, DRAFT_LOSS_NOTICE } = await import('../../orchestrator/route-v2.js');

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const TURN_ID = '99999999-9999-4999-8999-999999999999';
const COMPLETE_BRIEF =
  'Should we hire a senior tech lead or two junior developers to accelerate the platform rebuild this year?';

function makeDraftMockResult(overrides: Record<string, unknown> = {}) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted the model.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true,
    graph: null,
    ...overrides,
  };
}

function messagePayload(message: string): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    turn_class: 'frame',
    message,
    source: 'composer',
  };
}

/**
 * A GRAPH_READY frame, exactly as the streamed-turn route's own observer sees
 * it. Built from the pipeline's `PipelineStageEvent` union so it cannot drift
 * from the real emission shape.
 */
const GRAPH_READY_EVENT: PipelineStageEvent = {
  kind: 'GRAPH_READY',
  graph: { nodes: [], edges: [] },
  schema_version: 'v3',
  elapsed_ms: 33_000,
};

describe('POST /orchestrate/v2/turn — 2.735 draft-loss disclosure gate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    _resetConfigCache();
  });
  beforeEach(() => {
    dispatchDraftGraphMock.mockReset();
    dispatchDraftGraphMock.mockResolvedValue(makeDraftMockResult());
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
    markGraphWriteFailedMock.mockClear();
  });

  // ═══ THE FIX: a failure BEFORE any preview is not a lost graph ═══════════

  it('a pipeline failure with NO GRAPH_READY streamed marks the turn dead but NOT a draft loss', async () => {
    // The witnessed pre-preview classes all arrive here identically: the
    // dispatcher rethrows whatever the unified pipeline raised. This one is
    // a provider rate limit — the user never saw a node.
    dispatchDraftGraphMock.mockRejectedValue(
      Object.assign(new Error('LLM_PROVIDER_RATE_LIMITED'), {
        pipelineStatusCode: 429,
        pipelineErrorCode: 'LLM_PROVIDER_RATE_LIMITED',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
    // The turn is still marked DEAD — continuation detection must stop
    // counting it, or a graph-less scenario looks like a continuation
    // forever and the brief can never be redrafted. What must NOT happen is
    // the disclosure.
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.any(String),
      'turn_dead_only',
    );
  });

  // ═══ POSITIVE CONTROL 1 (trap 13) — a real loss IS still marked ══════════

  it('POSITIVE CONTROL: the SAME failure AFTER a GRAPH_READY frame streamed IS a draft loss', async () => {
    // Identical rejection, identical route, identical assertion shape — the
    // ONE difference is that the client was handed a graph to render first.
    // If this test cannot see a real loss being marked, the negative test
    // above proves nothing (trap 13).
    dispatchDraftGraphMock.mockRejectedValue(
      Object.assign(new Error('CEE_GRAPH_INVALID'), {
        pipelineStatusCode: 422,
        pipelineErrorCode: 'CEE_GRAPH_INVALID',
      }),
    );

    const seen: PipelineStageEvent[] = [];
    const res = await runWithStageStream(
      (event) => {
        seen.push(event);
      },
      async () => {
        // The streamed-turn route installs the emitter and the pipeline emits
        // through it. Here the pipeline is mocked away, so the frame is
        // emitted by the caller — through the SAME ambient seam, which is the
        // thing under test.
        const emitFrame = (
          await import('../../cee/unified-pipeline/stage-stream-context.js')
        ).currentStageEmitter();
        emitFrame?.(GRAPH_READY_EVENT);
        return await app.inject({
          method: 'POST',
          url: '/orchestrate/v2/turn',
          payload: messagePayload(COMPLETE_BRIEF),
        });
      },
    );

    // PRECONDITION PINNED IN-TEST (trap 13b third face): the frame really did
    // travel the seam. Without this the assertion below could pass because
    // the emitter silently did nothing, and the test would agree with itself.
    expect(seen.map((e) => e.kind)).toContain('GRAPH_READY');

    expect(res.statusCode).toBe(500);
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.any(String),
      'draft_loss',
    );
  });

  // ═══ POSITIVE CONTROL 2 — an attempted commit is a loss with or without a preview ═══

  it('POSITIVE CONTROL: a failed COMMIT (commitPerformed=false) is a draft loss even with no preview', async () => {
    // `commitPerformed: false` is returned only from the dispatcher's commit
    // catch — the pipeline had produced a graph and the append was attempted.
    // A model existed and was being saved. That is a loss regardless of what
    // the client had rendered.
    dispatchDraftGraphMock.mockResolvedValue(
      makeDraftMockResult({ commitPerformed: false, graph: { nodes: [{ id: 'n1' }], edges: [] } }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: messagePayload(COMPLETE_BRIEF),
    });

    expect(res.statusCode).toBe(500);
    expect(markGraphWriteFailedMock).toHaveBeenCalledWith(
      SCENARIO_ID,
      TURN_ID,
      expect.any(String),
      'draft_loss',
    );
  });

  // ═══ The copy itself ═════════════════════════════════════════════════════

  it('the notice no longer claims the user was shown a graph', () => {
    // The second half of 2.735. Even with the marking gate correct, a
    // `draft_loss` can be marked for an attempted commit on a BUFFERED turn,
    // which streams no GRAPH_READY frame at all — so "the graph you saw" was
    // false for a whole class of genuine losses. The notice must assert only
    // what its own gate proves.
    expect(DRAFT_LOSS_NOTICE).not.toMatch(/graph you saw/i);
    expect(DRAFT_LOSS_NOTICE).not.toMatch(/\byou saw\b/i);
    // …while still stating the two facts the gate DOES prove, so this is a
    // narrowing rather than a deletion.
    expect(DRAFT_LOSS_NOTICE).toMatch(/didn't save/i);
    expect(DRAFT_LOSS_NOTICE).toMatch(/no model is stored/i);
  });
});
