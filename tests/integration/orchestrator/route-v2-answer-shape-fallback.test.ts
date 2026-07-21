/**
 * Deterministic `_answer_shape` FALLBACK at the route egress chokepoint
 * (ROADMAP 1.132, F1).
 *
 * The defect: the coach/converse SHAPE path emits `_answer_shape` reliably,
 * but the intent-null / text_only PROSE path (and any deterministic-recovery
 * copy) ships a non-empty `assistant_text` with NO shape — an un-collapsible
 * wall of prose. F1 requires progressive disclosure (concise headline + <=3
 * bullets + everything else behind detail) on EVERY user-facing answer.
 *
 * The fix (route-v2 `sendFinalised200`, the single chokepoint for all five
 * dispatch families): when a finalised response carries a non-empty
 * `assistant_text` but no `_answer_shape`, synthesise one deterministically
 * (headline = first sentence; bullets = already-bulleted lines in order;
 * detail = the remainder) and SET `assistant_text := derive(shape)` so the
 * byte-equality invariant holds BY CONSTRUCTION.
 *
 * These tests drive the REAL route (app.inject through /orchestrate/v2/turn),
 * exercising the exact egress path — not the helper in isolation.
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

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';

// Intent-null / text_only prose: a run result WITHOUT `answerShape`, carrying
// a plain-prose assistant_text set directly from the model's answer_text.
function mkProseRun(assistantText: string) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: assistantText,
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    // No `answerShape` — this is the un-shaped prose path.
    telemetry: {
      stages_completed: ['orient', 'compose'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'explore',
      intent_class: 'converse',
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

describe('route-v2 — deterministic `_answer_shape` fallback (ROADMAP 1.132, F1)', () => {
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

  // ── RED-FIRST: the core defect ─────────────────────────────────────────
  // The hard case: a SINGLE PARAGRAPH of prose with NO blank lines. Before
  // the fix, this finalises with NO `_answer_shape` (wall of prose). This
  // assertion FAILS RED before the fix and PASSES after.
  it('intent-null prose (single paragraph, no blank lines) → `_answer_shape` synthesised at egress', async () => {
    const prose =
      'Team size is the biggest driver of the outcome. Raise it to twelve before deciding anything else.';
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, 'dddddddd-1111-4ddd-8ddd-dddddddddd01');
    expect(status).toBe(200);
    // THE DEFECT: before the fix, `_answer_shape` is absent on this path.
    expect(body._answer_shape).toBeDefined();
    expect(body._answer_shape.headline).toBe('Team size is the biggest driver of the outcome.');
    expect(body._answer_shape.bullets).toEqual([]);
    expect(body._answer_shape.detail).toBe('Raise it to twelve before deciding anything else.');
  });

  // ── Byte-equality invariant on the HARD case ───────────────────────────
  // Approach (b): assistant_text is SET to derive(shape). The single space
  // between the two sentences is reflowed to a blank-line break — that IS
  // the F1 progressive-disclosure win. Byte-equality holds by identity.
  it('byte-equality invariant: derive(_answer_shape) === assistant_text exactly (hard case)', async () => {
    const prose =
      'Team size is the biggest driver of the outcome. Raise it to twelve before deciding anything else.';
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, 'dddddddd-1111-4ddd-8ddd-dddddddddd02');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    // The invariant the sidecar contract enforces, proven on the wire body.
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
    // The reflow: the original single-space join became a blank-line break.
    expect(body.assistant_text).toBe(
      'Team size is the biggest driver of the outcome.\n\nRaise it to twelve before deciding anything else.',
    );
    // A single-paragraph prose has zero `\n\n`; the shaped text has exactly one.
    expect(prose.includes('\n\n')).toBe(false);
    expect((body.assistant_text.match(/\n\n/g) ?? []).length).toBe(1);
  });

  // ── Bullets extracted in order ─────────────────────────────────────────
  it('prose with already-bulleted lines → bullets extracted in order (cap 3), rest in detail', async () => {
    const prose =
      'Here are the top factors to weigh.\n- Team size dominates.\n- Budget is second.\nWeigh them before you decide.';
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, 'dddddddd-1111-4ddd-8ddd-dddddddddd03');
    expect(status).toBe(200);
    expect(body._answer_shape).toBeDefined();
    expect(body._answer_shape.headline).toBe('Here are the top factors to weigh.');
    expect(body._answer_shape.bullets).toEqual(['Team size dominates.', 'Budget is second.']);
    expect(body._answer_shape.detail).toBe('Weigh them before you decide.');
    // Byte-equality still holds by construction.
    expect(deriveAnswerTextFromShape(body._answer_shape)).toBe(body.assistant_text);
  });

  // ── Guard: single sentence → nothing to disclose, no shape ─────────────
  it('single-sentence prose (nothing to disclose) → NO `_answer_shape`, prose untouched', async () => {
    const prose = 'Raise team size to twelve before deciding.';
    runTurnExecutorMock.mockResolvedValue(mkProseRun(prose));
    const { status, body } = await postTurn(app, 'dddddddd-1111-4ddd-8ddd-dddddddddd04');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
    // The terse answer is shipped verbatim — no reflow, no fabricated shape.
    expect(body.assistant_text).toBe(prose);
  });

  // ── Guard: empty assistant_text → no shape ─────────────────────────────
  it('empty assistant_text → NO `_answer_shape` (nothing to shape)', async () => {
    runTurnExecutorMock.mockResolvedValue(mkProseRun('   '));
    const { status, body } = await postTurn(app, 'dddddddd-1111-4ddd-8ddd-dddddddddd05');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_answer_shape');
  });
});
