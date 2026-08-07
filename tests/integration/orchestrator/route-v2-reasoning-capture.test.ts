/**
 * ROADMAP 1.42 — flag-gated `_reasoning` on /orchestrate/v2/turn.
 *
 * Contract:
 *   - `config.features.reasoningCaptureEnabled === false` (default) ⇒ no
 *     `_reasoning` on the wire, even when `run.reasoning` is present.
 *   - `=== true` ⇒ `_reasoning` is attached, VERBATIM, post-egress-validation
 *     — same strip → validate → re-attach machinery `_context_summary` /
 *     `_diagnostic_trace` use (mirrors route-v2-canonical-state-threading.test.ts).
 *   - Flag ON but `run.reasoning` absent ⇒ still no `_reasoning` (never
 *     fabricated).
 *   - Egress validation failure (typed-fallback path) ⇒ the fallback
 *     envelope NEVER carries `_reasoning`, even with the flag on and an
 *     upstream body pre-attach.
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

const SCENARIO_ID = '99999999-9999-4999-8999-999999999999';
const REASONING_TEXT =
  'Weighing option A vs option B: A has higher expected value but more variance.';

function mkRunResult(opts: { withReasoning: boolean }) {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Here is the analysis.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    effectiveGraph: null,
    ...(opts.withReasoning ? { reasoning: REASONING_TEXT } : {}),
    telemetry: {
      stages_completed: ['orient', 'execute'],
      response_emitted: true as const,
      llm_calls_used: 1,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      turn_class: 'handler',
      intent_class: 'execute',
      coaching_mode: null,
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
      message: 'What does the analysis show?',
      turn_class: 'decide',
      source: 'composer',
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 — flag-gated `_reasoning` (ROADMAP 1.42)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
    configHolder.features.reasoningCaptureEnabled = false;
  });

  it('flag OFF (default) → no `_reasoning` on the wire, even when run.reasoning is present', async () => {
    configHolder.features.reasoningCaptureEnabled = false;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withReasoning: true }));
    const { status, body } = await postTurn(app, 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa01');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_reasoning');
    expect(JSON.stringify(body)).not.toContain(REASONING_TEXT);
  });

  it('flag ON + run.reasoning present → `_reasoning` attached verbatim, post-validation', async () => {
    configHolder.features.reasoningCaptureEnabled = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withReasoning: true }));
    const { status, body } = await postTurn(app, 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa02');
    expect(status).toBe(200);
    expect(body).toHaveProperty('_reasoning');
    expect(body._reasoning).toBe(REASONING_TEXT);
  });

  it('flag ON but run.reasoning absent → still no `_reasoning` (never fabricated)', async () => {
    configHolder.features.reasoningCaptureEnabled = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withReasoning: false }));
    const { status, body } = await postTurn(app, 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa03');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_reasoning');
  });

  it('flag ON + egress validation fails → typed-fallback 200 carries NO `_reasoning`, even with an upstream body pre-attach', async () => {
    configHolder.features.reasoningCaptureEnabled = true;
    runTurnExecutorMock.mockResolvedValue({
      response: {
        // Malformed product envelope: response_version must be the literal 2,
        // so OlumiResponseSchema.safeParse fails → typed fallback path.
        response_version: 'NOT_TWO' as unknown as 2,
        assistant_text: 'Here is the analysis.',
        blocks: [] as const,
        suggested_actions: [] as const,
        insights: [] as const,
        stage_indicator: 'analyse' as const,
        // Upstream body pre-attach that the strip step MUST drop.
        _reasoning: 'LEAKED_UPSTREAM_REASONING',
      },
      analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
      effectiveGraph: null,
      reasoning: REASONING_TEXT,
      telemetry: {
        stages_completed: ['orient', 'execute'],
        response_emitted: true as const,
        llm_calls_used: 1,
        commit_performed: true,
        failure_type: null,
        wall_clock_ms: 5,
        turn_class: 'handler',
        intent_class: 'execute',
        coaching_mode: null,
        validation_error_code: null,
      },
    });
    const { status, body } = await postTurn(app, 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaa04');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_reasoning');
    expect(JSON.stringify(body)).not.toContain('LEAKED_UPSTREAM_REASONING');
    expect(JSON.stringify(body)).not.toContain(REASONING_TEXT);
    // Fallback envelope still satisfies the schema (response_version: 2).
    expect(body.response_version).toBe(2);
  });
});
