/**
 * CEE_ANSWER_SHAPE_ENFORCED — flag-gated `_answer_shape` on
 * /orchestrate/v2/turn (ROADMAP 1.132, F2).
 *
 * Contract (mirrors route-v2-reasoning-capture.test.ts — the `_reasoning`
 * product-sidecar mechanic):
 *   - `config.features.answerShapeEnforced === false` (default) ⇒ no
 *     `_answer_shape` on the wire, even when `run.answerShape` is present.
 *   - `=== true` ⇒ `_answer_shape` is attached post-egress-validation via
 *     the same strip → validate → re-attach machinery as `_reasoning` (the
 *     strict OlumiResponseSchema at the vendored pin must never see the
 *     unknown key — it would fail the whole envelope to the typed fallback).
 *   - Flag ON but `run.answerShape` absent ⇒ still no `_answer_shape`.
 *   - Egress validation failure (typed-fallback path) ⇒ the fallback
 *     envelope NEVER carries `_answer_shape`, even with an upstream body
 *     pre-attach.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const configHolder = {
  cee: {
    timingDebugEnabled: false,
    turnDebugEnabled: false,
    contextSummaryEnabled: false,
    coachingStatePackEnabled: false,
  },
  features: {
    optionShortcutRepair: true,
    diagnosticTraceEnabled: false,
    reasoningCaptureEnabled: false,
    answerShapeEnforced: false,
  },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
const { deriveAnswerTextFromShape } = await import(
  '../../../src/orchestrator-v5/routing/answer-shape.js'
);

const SCENARIO_ID = '88888888-8888-4888-8888-888888888888';
const ANSWER_SHAPE = {
  headline: 'Focus on retention before pricing.',
  bullets: ['Churn dominates your graph.'],
  detail: 'The churn to revenue causal link is the strongest in the model.',
};

function mkRunResult(opts: { withShape: boolean; assistantText?: string }) {
  return {
    response: {
      response_version: 2 as const,
      // Default to the shape-derived text — the honest case where the final
      // assistant_text IS what the shape describes (the executor's capture
      // contract). Tests exercising a post-capture rewrite override this.
      assistant_text: opts.assistantText ?? deriveAnswerTextFromShape(ANSWER_SHAPE),
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    ...(opts.withShape ? { answerShape: ANSWER_SHAPE } : {}),
    telemetry: {
      stages_completed: ['orient', 'compose'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'coach',
      coaching_mode: 'reframe',
      validation_error_code: null,
    },
  };
}

async function postTurn(app: FastifyInstance, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'What should I do next?',
      turn_class: 'decide',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — flag-gated `_answer_shape` (ROADMAP 1.132)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
    configHolder.features.answerShapeEnforced = false;
  });

  it('flag OFF (default) → no `_answer_shape` on the wire, even when run.answerShape is present', async () => {
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withShape: true }));
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc01');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
  });

  it('flag ON + run.answerShape present + final text IS the shape-derived text → `_answer_shape` attached post-validation', async () => {
    configHolder.features.answerShapeEnforced = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withShape: true }));
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc02');
    expect(status).toBe(200);
    // Positive control for the drop test below: this harness CAN see the
    // sidecar when the tie holds.
    expect(body._answer_shape).toEqual(ANSWER_SHAPE);
    // Legacy consumers keep a populated assistant_text alongside the sidecar.
    expect(typeof body.assistant_text).toBe('string');
    expect(body.assistant_text.length).toBeGreaterThan(0);
  });

  it('flag ON + run.answerShape present but final assistant_text was rewritten after capture → `_answer_shape` is DROPPED, never shipped stale (P1)', async () => {
    configHolder.features.answerShapeEnforced = true;
    // Simulates any post-capture rewriter (STEP 6.6 honesty swap, goal-receipt
    // swap, empty-answer backstop, finaliser guards, commit-failure
    // replacement, route egress entity-id scrub): the run result carries a
    // captured shape whose derived text is NOT the final assistant_text.
    runTurnExecutorMock.mockResolvedValue(
      mkRunResult({
        withShape: true,
        assistantText:
          "I haven't changed the model. This version can't make that kind of model edit yet.",
      }),
    );
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc06');
    expect(status).toBe(200);
    // Fail closed: a sidecar describing text the user never sees must not ship.
    expect(body).not.toHaveProperty('_answer_shape');
    // The response itself is untouched — only the stale sidecar is withheld.
    expect(body.assistant_text).toBe(
      "I haven't changed the model. This version can't make that kind of model edit yet.",
    );
  });

  it('flag ON but run.answerShape absent → still no `_answer_shape` (never fabricated)', async () => {
    configHolder.features.answerShapeEnforced = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withShape: false }));
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc03');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
  });

  it('flag ON + egress validation fails → typed-fallback 200 carries NO `_answer_shape`, even with an upstream body pre-attach', async () => {
    configHolder.features.answerShapeEnforced = true;
    runTurnExecutorMock.mockResolvedValue({
      response: {
        response_version: 'NOT_TWO' as unknown as 2,
        assistant_text: 'Shaped answer.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
        // Upstream body pre-attach that the strip step MUST drop.
        _answer_shape: { headline: 'LEAKED_UPSTREAM_SHAPE.', bullets: [], detail: 'x' },
      },
      analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
      effectiveGraph: null,
      answerShape: ANSWER_SHAPE,
      telemetry: {
        stages_completed: ['orient', 'compose'],
        response_emitted: true as const,
        llm_calls_used: 1,
        commit_performed: true,
        failure_type: null,
        wall_clock_ms: 5,
        turn_class: 'explore',
        intent_class: 'coach',
        coaching_mode: 'reframe',
        validation_error_code: null,
      },
    });
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc04');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    expect(JSON.stringify(body)).not.toContain('LEAKED_UPSTREAM_SHAPE');
    expect(body.response_version).toBe(2);
  });

  it('flag OFF + upstream body pre-attach → the strip step removes `_answer_shape` before the strict egress schema sees it (200, no fallback)', async () => {
    const result = mkRunResult({ withShape: false });
    (result.response as Record<string, unknown>)._answer_shape = ANSWER_SHAPE;
    runTurnExecutorMock.mockResolvedValue(result);
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc05');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    // Not the fallback envelope: the real assistant_text survived, which
    // proves the strict schema never saw the unknown key.
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(ANSWER_SHAPE));
  });
});
