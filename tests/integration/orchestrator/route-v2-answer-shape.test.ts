/**
 * `_answer_shape` on /orchestrate/v2/turn (ROADMAP 1.132, F2) — UNCONDITIONAL
 * since the F1 flag deletion (no-dark-launches doctrine).
 *
 * Contract (mirrors route-v2-reasoning-capture.test.ts — the `_reasoning`
 * product-sidecar mechanic):
 *   - `run.answerShape` present + final text IS the shape-derived text ⇒
 *     `_answer_shape` is attached post-egress-validation via the same
 *     strip → validate → re-attach machinery as `_reasoning` (the strict
 *     OlumiResponseSchema at the vendored pin must never see the unknown key
 *     — it would fail the whole envelope to the typed fallback).
 *   - `run.answerShape` present but the final assistant_text was REWRITTEN
 *     after capture ⇒ `_answer_shape` is DROPPED, never shipped stale (P1).
 *   - `run.answerShape` absent ⇒ no `_answer_shape` (never fabricated).
 *   - Egress validation failure (typed-fallback path) ⇒ the fallback
 *     envelope NEVER carries `_answer_shape`, even with an upstream body
 *     pre-attach.
 *   - An upstream body pre-attach with `run.answerShape` absent is stripped
 *     before the strict egress schema sees it (defence-in-depth).
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

function mkRunResult(opts: {
  withShape: boolean;
  assistantText?: string;
  answerKind?: 'substantive' | 'functional';
}) {
  // ROADMAP 1.132 (F1) — the executor's SUBSTANTIVE/FUNCTIONAL classification. A
  // run whose FINAL text is a real answer surfaces `answerKind: 'substantive'`;
  // one whose text was rewritten by a deterministic mutator (or is a
  // deterministic builder) surfaces 'functional'. Default: an un-shaped run
  // models the intent-null / text_only prose path (F1 target → substantive); a
  // shaped run's kind is irrelevant to the synthesiser (the model-shape
  // re-attach short-circuits it), so it defaults substantive. cc06 (a
  // post-capture rewrite to a deterministic decline) overrides to 'functional'.
  const answerKind = opts.answerKind ?? 'substantive';
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
    answerKind,
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

describe('route-v2 — `_answer_shape` (unconditional, ROADMAP 1.132)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
  });

  it('run.answerShape present + final text IS the shape-derived text → `_answer_shape` attached post-validation', async () => {
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

  it('run.answerShape present but final assistant_text was rewritten to DETERMINISTIC decline → STALE shape dropped AND the fallback is out of scope (no shape, text byte-identical)', async () => {
    // Simulates a post-capture rewriter (STEP 6.6 structural-claim honesty
    // swap, goal-receipt swap, empty-answer backstop, commit-failure
    // replacement): the captured shape's derived text is NOT the final text,
    // AND the final text is now DETERMINISTIC DECLINE copy — so the executor's
    // FINAL-text check downgrades the kind to 'functional' (modelled here
    // explicitly). Two things must hold: (1) the route drops the STALE captured
    // shape (fail-closed), and (2) the F1 synthesiser does NOT re-shape the
    // decline — a deterministic message keeps its second sentence visible.
    const rewritten =
      "I haven't changed the model. This version can't make that kind of model edit yet.";
    runTurnExecutorMock.mockResolvedValue(
      mkRunResult({ withShape: true, assistantText: rewritten, answerKind: 'functional' }),
    );
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc06');
    expect(status).toBe(200);
    // (1) The stale captured shape was dropped, and (2) the out-of-scope
    // fallback synthesised nothing: NO `_answer_shape` anywhere on the wire.
    expect(body).not.toHaveProperty('_answer_shape');
    // The deterministic decline ships verbatim — no reflow, no fabricated shape.
    expect(body.assistant_text).toBe(rewritten);
  });

  it('run.answerShape absent → multi-sentence prose is re-shaped by the deterministic egress fallback (F1)', async () => {
    // The intent-null / text_only prose path: no model-authored shape, a
    // non-empty multi-part assistant_text. The deterministic fallback shapes
    // it. (For a TERSE single-sentence answer — nothing to disclose — no shape
    // is fabricated; see route-v2-answer-shape-fallback.test.ts.)
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withShape: false }));
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc03');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    // Round-trip: derive(ANSWER_SHAPE) → synthesise reconstitutes ANSWER_SHAPE.
    expect(body._answer_shape).toEqual(ANSWER_SHAPE);
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });

  it('egress validation fails → typed-fallback 200 carries NO `_answer_shape`, even with an upstream body pre-attach', async () => {
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

  it('upstream body pre-attach with run.answerShape absent → the strip step removes it before the strict egress schema sees it; the egress fallback re-shapes from the TEXT, not the leaked attach (200, no fallback envelope)', async () => {
    const result = mkRunResult({ withShape: false });
    // A DISTINCTIVE upstream pre-attach — if it leaked through the strip step
    // it would appear on the wire verbatim. Its shape is deliberately NOT what
    // synthesis produces from the assistant_text, so the two are separable.
    (result.response as Record<string, unknown>)._answer_shape = {
      headline: 'LEAKED_UPSTREAM_SHAPE.',
      bullets: ['LEAKED_BULLET.'],
      detail: 'leaked detail',
    };
    runTurnExecutorMock.mockResolvedValue(result);
    const { status, body } = await postTurn(app, 'cccccccc-1111-4ccc-8ccc-cccccccccc05');
    expect(status).toBe(200);
    // The leaked upstream attach was stripped: it does not appear anywhere.
    expect(JSON.stringify(body)).not.toContain('LEAKED_UPSTREAM_SHAPE');
    expect(JSON.stringify(body)).not.toContain('LEAKED_BULLET');
    // Not the fallback envelope: the real assistant_text survived, which
    // proves the strict schema never saw the unknown key. The egress fallback
    // then re-shaped it deterministically FROM THE TEXT (round-trip of
    // ANSWER_SHAPE), and the tie holds.
    expect(body._answer_shape).toEqual(ANSWER_SHAPE);
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });
});
