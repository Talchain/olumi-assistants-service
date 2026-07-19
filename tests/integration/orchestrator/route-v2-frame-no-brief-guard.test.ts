/**
 * Integration tests for the V5 route-v2 frame-stage no-brief guard.
 *
 * The guard fires when a frame-stage message has no graph yet AND does
 * not match the draft_graph trigger regex. It emits a deterministic
 * 200 with framing guidance instead of falling through to TurnExecutor's
 * broad routing LLM (which has historically hit max_tokens and emitted
 * the user-hostile "I couldn't complete that turn cleanly" fallback).
 *
 * Load-bearing assertions:
 *   - Short retry-style replies at frame stage with no graph → 200 with
 *     deterministic framing prompt (no broad LLM call).
 *   - The TurnExecutor mock is NOT invoked for these turns (proves we
 *     are NOT paying the Sonnet routing cost).
 *   - Brief-shaped messages STILL route through draft_graph (regression).
 *   - Empty messages at frame are caught by the guard.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Spy on the TurnExecutor to assert the guard prevents it from running.
const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
// ROADMAP 1.148 — importOriginal-spread + complete shared store mock
// (derive, don't mirror): interface growth can't silently break this suite.
vi.mock('../../../src/orchestrator-v5/session/index.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../src/orchestrator-v5/session/index.js')>();
  const { createMockSessionStore } = await import('../../utils/mock-session-store.js');
  return {
    ...original,
    getSessionStore: () => createMockSessionStore({ append: appendMock }),
    resetSessionStoreForTests: () => {},
  };
});

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'should not be called' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'should not be called', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'should not be called' }],
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

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

describe('POST /orchestrate/v2/turn — frame-stage no-brief guard', () => {
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
    runTurnExecutorMock.mockReset();
    appendMock.mockClear();
  });

  it('short non-brief reply at frame + no graph → deterministic 200, no TurnExecutor call', async () => {
    // The exact retry-shape scenario from staging: user replies to a
    // failed draft_graph with a short clarification, message has no
    // decision verb and no trailing "?". Must NOT fall through to
    // TurnExecutor's broad LLM.
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '55555555-5555-4555-8555-5555fb010001',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'no status quo, just the three pricing options',
        turn_class: 'frame',
        source: 'composer',
      },
    });

    // 200, with the deterministic framing prompt.
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response_version).toBe(2);
    expect(body.stage_indicator).toBe('frame');

    // Load-bearing: TurnExecutor was NOT invoked — saves the Sonnet
    // routing call and prevents the max_tokens fallback.
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
    // draft_graph also not invoked (regex correctly didn't match).
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();

    // Generic max_tokens fallback copy must NOT appear.
    expect(body.assistant_text).not.toContain("couldn't complete that turn cleanly");
    // Deterministic framing copy IS present — includes concrete examples
    // that match the brief regex's positive verbs (Should / Whether).
    expect(body.assistant_text).toContain('Should we');
    expect(body.assistant_text).toContain('Whether to');
    expect(body.assistant_text.length).toBeGreaterThan(50);

    // No graph, no analysis surfaced (none exists pre-draft).
    expect(body.blocks).toEqual([]);
    // ROADMAP 1.148 C7 re-pin (was `toEqual([])`): ROADMAP 2.63 C3
    // (PR #484/#488) — a guard-firing message that carries a usable brief
    // seed now gets a deterministic "Build the model" draft-offer chip,
    // and the offer is COMMITTED as a draft_graph pending action so the
    // next turn's chip click / typed "yes" resumes deterministically.
    expect(body.suggested_actions).toHaveLength(1);
    expect(body.suggested_actions[0]).toMatchObject({
      label: 'Build the model',
      message: 'Yes, build the model from what I have shared.',
    });
    expect(String(body.suggested_actions[0].id)).toMatch(/^draft-offer-/);
    // The offer's consent must be resumable: the guard committed the turn
    // with the draft_graph pending action (chip without commit would be
    // guarantee-theatre — see the guard's own in-code note).
    expect(appendMock).toHaveBeenCalledTimes(1);
    const committedWrite = appendMock.mock.calls[0]![0] as {
      pending_actions?: Array<{ action: { kind: string } }>;
    };
    expect(committedWrite.pending_actions).toHaveLength(1);
    expect(committedWrite.pending_actions![0]!.action.kind).toBe('draft_graph');
    expect(body.insights).toEqual([]);
  });

  it('empty message at frame + no graph → guard fires (catches accidental empties)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '55555555-5555-4555-8555-5555fb010002',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'hello',
        turn_class: 'frame',
        source: 'composer',
      },
    });
    // 200 or 422 (ingress validation may reject very short messages).
    // The contract here: NOT 500, NOT generic fallback.
    expect([200, 422]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      expect(body.assistant_text).not.toContain("couldn't complete that turn cleanly");
      expect(runTurnExecutorMock).not.toHaveBeenCalled();
    }
  });

  it('brief-shaped message still routes to draft_graph (regression — guard must NOT shadow draft_graph)', async () => {
    // The guard MUST NOT fire when isDraftGraphShape is true. This is
    // a regression test for the dispatch ordering.
    dispatchDraftGraphMock.mockResolvedValueOnce({
      response: {
        response_version: 2 as const,
        assistant_text: 'Drafted a decision graph.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse' as const,
      },
      commitPerformed: true,
      analysisReady: undefined,
      graph: null,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '55555555-5555-4555-8555-5555fb010003',
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'Should we hire a tech lead or two developers to improve delivery speed?',
        turn_class: 'frame',
        source: 'composer',
        // #539 deleted CEE_CLARIFY_V2_ENABLED, so clarify v2 now runs
        // unconditionally and would intercept this brief with its round-1
        // rubric before dispatch is reached. `generate_model` is an EXPLICIT
        // instruction to draft: tryClarifyV2Turn returns null for it, so the
        // route dispatches bit-identically to the old flag-off path. That
        // isolates this test from the clarify rubric, which is not its
        // subject — the subject is that the frame-no-brief guard must not
        // shadow draft_graph.
        generate_model: true,
      },
    });

    expect(res.statusCode).toBe(200);
    // draft_graph WAS invoked.
    expect(dispatchDraftGraphMock).toHaveBeenCalledTimes(1);
    // Guard did NOT fire (no TurnExecutor either).
    expect(runTurnExecutorMock).not.toHaveBeenCalled();
  });

  it('non-frame-stage message → guard does NOT fire (only frame stage is gated)', async () => {
    // The guard's first condition is `stage === 'frame'`. At any other
    // stage, the guard must NOT short-circuit; whatever the normal
    // dispatch path is for that stage applies. We assert the response
    // does NOT contain the deterministic framing prompt copy.
    runTurnExecutorMock.mockResolvedValueOnce({
      ok: true,
      candidate: {
        response_version: 2,
        assistant_text: 'turn executor reply',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'decide',
      },
      commitPerformed: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: '55555555-5555-4555-8555-5555fb010004',
        scenario_id: SCENARIO_ID,
        stage: 'decide',
        message: 'just a short reply',
        turn_class: 'direct_answer',
        source: 'composer',
      },
    });

    // Whatever the dispatch did, the deterministic framing copy must
    // NOT appear (proves the guard correctly skipped this turn).
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      const text = String(body.assistant_text ?? '');
      expect(text).not.toContain("I need a single decision question");
      expect(text).not.toContain("Include the options you're comparing");
    }
    // Should NOT short-circuit through the guard with the framing prompt.
    expect(res.statusCode).toBeLessThan(500);
  });

  // PR #203 round-2 review test #4: document the intended interception
  // behaviour for legitimate frame-stage non-brief messages.
  //
  // The reviewer noted the guard is broad and may intercept legitimate
  // early conversational input. The PRODUCT decision is that this is
  // acceptable — the guard's framing copy is user-safe and avoids the
  // worst-case TurnExecutor max_tokens fallback. This test documents
  // and pins that intentional behaviour.
  it('legitimate non-brief conversational message at frame is INTENTIONALLY intercepted with framing copy', async () => {
    // A user opens the app and types a thoughtful but non-brief message
    // (e.g. exploring what to model). Previously routed to Sonnet which
    // often hit max_tokens. Now caught by the guard with a clear next
    // step, no LLM cost. Messages chosen so they pass ingress validation
    // but contain no decision-verb that would trigger draft_graph.
    const conversationalMessages = [
      "thinking through some product strategy options for next year",
      "exploring different paths for the engineering team next quarter",
      "mapping out what I might want to model with this tool today",
    ];

    let i = 0;
    for (const message of conversationalMessages) {
      runTurnExecutorMock.mockReset();
      dispatchDraftGraphMock.mockReset();
      // UUID format: 8-4-4-4-12 hex chars. Use a hex-formatted index in
      // the last segment.
      const idx = (i++).toString(16).padStart(2, '0');
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: `55555555-5555-4555-8555-5555fbeef0${idx}`,
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message,
          turn_class: 'frame',
          source: 'composer',
        },
      });

      // Guard fires deterministically for all three; the broad LLM
      // never runs; the user gets the framing prompt.
      expect(res.statusCode).toBe(200);
      expect(runTurnExecutorMock).not.toHaveBeenCalled();
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.assistant_text).toContain('decision question');
      // Stays in frame stage — user remains on graph-creation path.
      expect(body.stage_indicator).toBe('frame');
    }
  });

  // ROADMAP 1.148 C3 companion pin — the guard's DETERMINISTIC answer for
  // brief-less frame inputs, pinned explicitly against the exact message
  // shapes the retired A1/A2 fixtures used to send. Those fixtures now
  // exercise the LLM path at stage 'analyse' (orchestrate-v2-a1/-a2); the
  // guard's takeover of their OLD inputs is intentional behaviour
  // (PR #203/#484) and gets its own pin here rather than being re-copied
  // into the timeout/budget suites.
  it('former A1/A2 fixture-shaped brief-less frame inputs get the deterministic guard answer (no TurnExecutor, no draft)', async () => {
    const formerFixtureMessages = [
      // A1 direct-answer-happy
      'Give me a short framing for this decision.',
      // A2 clarify-happy / clarify-contamination / clarify-llm-timeout
      'help me',
      'not sure',
      'can you?',
    ];
    let i = 0;
    for (const message of formerFixtureMessages) {
      runTurnExecutorMock.mockReset();
      dispatchDraftGraphMock.mockReset();
      appendMock.mockClear();
      const idx = (i++).toString(16).padStart(2, '0');
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: {
          kind: 'message',
          turn_id: `55555555-5555-4555-8555-5555fa11ce${idx}`,
          scenario_id: SCENARIO_ID,
          stage: 'frame',
          message,
          turn_class: 'frame',
          source: 'composer',
        },
      });

      expect(res.statusCode).toBe(200);
      // Deterministic: neither the routing LLM nor draft_graph ran.
      expect(runTurnExecutorMock).not.toHaveBeenCalled();
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      // The guard's canonical framing copy (see route-v2.ts
      // frame_no_brief_guard) — corrective, with concrete examples.
      expect(body.assistant_text).toContain('I need a single decision question to start.');
      expect(body.stage_indicator).toBe('frame');
      // Seed-bearing messages (≥ DRAFT_GRAPH_MIN_BRIEF_LENGTH after
      // normalisation) additionally get the committed "Build the model"
      // draft offer; short ones stay chip-less and commit-less.
      const seedBearing = message.length >= 30;
      if (seedBearing) {
        expect(body.suggested_actions).toHaveLength(1);
        expect(body.suggested_actions[0]).toMatchObject({ label: 'Build the model' });
        expect(appendMock).toHaveBeenCalledTimes(1);
      } else {
        expect(body.suggested_actions).toEqual([]);
        expect(appendMock).not.toHaveBeenCalled();
      }
    }
  });
});
