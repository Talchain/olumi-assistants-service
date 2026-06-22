/**
 * V5 M5 — route hand-off for read-only canonical state (turn_executor exit).
 *
 * Proves the route threads runTurnExecutor's `canonicalState` into the
 * flag-gated `_context_summary`, and that the executor's FULL fact-based state
 * (with degraded detection + contradictions) WINS over the freshness-only
 * partial fallback — and that a non-execute result (no canonicalState) retains
 * the partial fallback. This is the route-side proof the turn-executor unit
 * test cannot give (it stops at the run result).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectCanonicalAnalysisState } from '../../../src/orchestrator-v5/context/canonical-analysis-state.js';
import { deriveAnalysisFreshness } from '../../../src/orchestrator-v5/context/freshness.js';

const configHolder = {
  cee: { timingDebugEnabled: false, turnDebugEnabled: false, contextSummaryEnabled: false },
  features: { optionShortcutRepair: true, diagnosticTraceEnabled: false },
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

const SCENARIO_ID = '77777777-7777-4777-8777-777777777777';
const HASH = 'HASH_EXEC';

// Prior facts: a successful run_analysis (t0) + a NEWER degraded run (t1). The
// fact-based selector produces freshness 'fresh' AND a
// `fact_status_success_but_degraded_newer` contradiction with
// degraded_fact_status — fields the freshness-only fallback CANNOT produce.
function successFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'ok',
      graph_hash_at_run: HASH,
      computed_at: '2026-04-30T01:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  } as HandlerFact;
}
function degradedNewerFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'partial',
      graph_hash_at_run: HASH,
      computed_at: '2026-04-30T02:00:00.000Z',
      enrichment: { analysis_status: 'partial' },
    },
  } as HandlerFact;
}

const UNIFIED = [degradedNewerFact(), successFact()]; // newest-first
const FULL_CANONICAL = selectCanonicalAnalysisState({
  priorFacts: UNIFIED,
  currentGraphHash: HASH,
  readiness: { status: 'ready', goal_node_id: 'goal' },
});
const FRESHNESS = deriveAnalysisFreshness(UNIFIED, HASH);

function mkRunResult(opts: { withCanonical: boolean }) {
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
    freshness: FRESHNESS,
    effectiveGraph: null,
    ...(opts.withCanonical ? { canonicalState: FULL_CANONICAL } : {}),
    telemetry: {
      stages_completed: ['orient', 'execute'],
      response_emitted: true as const,
      llm_calls_used: 0,
      commit_performed: true,
      failure_type: null,
      wall_clock_ms: 5,
      // Faithful terminology: this fixture represents an execute (handler) turn.
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

describe('route-v2 — canonical state hand-off (turn_executor exit)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    runTurnExecutorMock.mockReset();
    configHolder.cee.contextSummaryEnabled = false;
  });

  it('sanity: degraded/contradiction fields exist in the FULL state but NOT in the freshness-only fallback', () => {
    // The fact-based state carries the distinguishing fields.
    expect(FULL_CANONICAL.degraded_fact_status).toBe('partial');
    expect(FULL_CANONICAL.contradictions).toContain('fact_status_success_but_degraded_newer');
    expect(FULL_CANONICAL.freshness).toBe('fresh');
  });

  it('execute result with canonicalState → _context_summary uses the FULL state (degraded + contradiction)', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withCanonical: true }));
    const { status, body } = await postTurn(app, '88888888-8888-4888-8888-888888888801');
    expect(status).toBe(200);
    expect(runTurnExecutorMock).toHaveBeenCalled();
    expect(body).toHaveProperty('_context_summary');
    const as = body._context_summary.analysis_state;
    // These ONLY come from the executor's fact-based state — the freshness-only
    // fallback produces degraded_fact_status: null and no contradiction codes.
    expect(as.degraded_fact_status).toBe('partial');
    expect(as.contradiction_codes).toContain('fact_status_success_but_degraded_newer');
    expect(as.freshness).toBe('fresh');
  });

  it('non-execute result (no canonicalState) → _context_summary retains the freshness-only partial fallback', async () => {
    configHolder.cee.contextSummaryEnabled = true;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withCanonical: false }));
    const { status, body } = await postTurn(app, '88888888-8888-4888-8888-888888888802');
    expect(status).toBe(200);
    expect(body).toHaveProperty('_context_summary');
    const as = body._context_summary.analysis_state;
    // Fallback (canonicalStateFromFreshness) carries freshness but cannot
    // produce degraded detection or the degraded-newer contradiction.
    expect(as.freshness).toBe('fresh');
    expect(as.degraded_fact_status).toBeNull();
    expect(as.contradiction_codes).not.toContain('fact_status_success_but_degraded_newer');
  });

  it('flag OFF → no `_context_summary` even with canonicalState present', async () => {
    configHolder.cee.contextSummaryEnabled = false;
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withCanonical: true }));
    const { status, body } = await postTurn(app, '88888888-8888-4888-8888-888888888803');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('_context_summary');
  });
});
