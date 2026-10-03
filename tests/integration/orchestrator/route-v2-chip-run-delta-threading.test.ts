/**
 * D1 — THE WIRE WITNESS FOR `run_delta` ON THE CHIP-CLICK RUN EXIT.
 *
 * `route-v2-run-delta-threading.test.ts` pins the turn_executor exit. The Run the user asks for does not take it:
 * the Run chip, the Agent's Run fast path and the Agent's `run_analysis` tool all post a typed
 * `chip_click` / `run_analysis` turn, which route-v2 sends to `dispatchDeterministicChipClick` and finalises at
 * the chip exit. Served `a327556` (Canonical #70 5850113962, scenario `a87c883b`: brief → approve → Run →
 * "our monthly churn is actually 12%" → approve → re-run): no `run_delta` and no absence reason on either run,
 * and CEE logged `run_delta_outcome skipped / prior_facts_absent` — the chip exit never passed the window.
 *
 * Same construction as the executor twin, deliberately: identical dispatch result, the ONLY difference being
 * whether it carries `priorFacts`. Mocked seam: the chip dispatcher (the dispatcher's own half — that it
 * returns the post-dispatch window, gated — is `chip-click-run-delta-window.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { deriveAnalysisFreshness } from '../../../src/orchestrator-v5/context/freshness.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const configHolder = {
  cee: { timingDebugEnabled: false, turnDebugEnabled: false, contextSummaryEnabled: false },
  features: { optionShortcutRepair: true, diagnosticTraceEnabled: false },
};
vi.mock('../../../src/config/index.js', () => ({
  config: configHolder,
  isProduction: () => false,
}));

// The executor is mocked only to prove the chip turn never falls through to it.
const runTurnExecutorMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/turn-executor.js', () => ({
  runTurnExecutor: runTurnExecutorMock,
}));

const dispatchDeterministicChipClickMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', () => ({
  dispatchChipClickRunAnalysis: vi.fn(),
  dispatchDeterministicChipClick: dispatchDeterministicChipClickMock,
  isDeterministicChipClickActionType: (actionType: string) =>
    actionType === 'run_analysis' || actionType === 'explain_results' || actionType === 'what_would_flip',
  DETERMINISTIC_CHIP_ACTION_TYPES: new Set(['run_analysis', 'explain_results', 'what_would_flip']),
}));

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    readMostRecentPendingActions: async () => [],
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

const SCENARIO_ID = 'a87c883b-a718-4655-a4ad-244e1cb5fb9c';
// The served shape: churn 6% → 12% per month (approved), then the re-run.
const graphAtChurn = (value: number) => ({
  nodes: [{ id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value } }],
  edges: [],
});
const PRIOR_HASH = computeAnalysisAffectingGraphHash(graphAtChurn(0.06))!;
const CURRENT_HASH = computeAnalysisAffectingGraphHash(graphAtChurn(0.12))!;

function runFact(opts: {
  seed: string;
  hash: string;
  computedAt: string;
  options: ReadonlyArray<{ id: string; label: string; win: number }>;
}): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: opts.options[0].id,
      summary: 'ok',
      graph_hash_at_run: opts.hash,
      computed_at: opts.computedAt,
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      enrichment: {
        analysis_status: 'completed',
        results: opts.options.map((o) => ({ option_id: o.id, option_label: o.label, win_probability: o.win })),
        meta: { seed_used: opts.seed, n_samples: 10_000 },
      },
    },
  };
}

const PRIOR = runFact({
  seed: '111',
  hash: PRIOR_HASH,
  computedAt: '2026-09-26T21:36:10.000Z',
  options: [
    { id: 'opt_59', label: 'Raise to £59', win: 0.62 },
    { id: 'opt_49', label: 'Keep £49', win: 0.38 },
  ],
});
const CURRENT = runFact({
  seed: '222',
  hash: CURRENT_HASH,
  computedAt: '2026-09-26T21:36:58.000Z',
  options: [
    { id: 'opt_59', label: 'Raise to £59', win: 0.45 },
    { id: 'opt_49', label: 'Keep £49', win: 0.55 },
  ],
});
// Exactly what the dispatcher's post-dispatch window is: this turn's run first, then the entry window.
const WINDOW: readonly HandlerFact[] = [CURRENT, PRIOR];

function chipOk(opts: { withPriorFacts: boolean }) {
  return {
    outcome: 'ok' as const,
    response: {
      response_version: 2 as const,
      assistant_text: 'Ran analysis on your current scenario.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'analyse' as const,
    },
    commitPerformed: true as const,
    analysisReady: { status: 'ready', goal_node_id: 'goal', options: [] },
    graph: null,
    // The dispatcher derives freshness over the SAME window it returns.
    freshness: deriveAnalysisFreshness(WINDOW, CURRENT_HASH),
    mayNameLeadingOption: true,
    answerKind: 'functional' as const,
    ...(opts.withPriorFacts ? { priorFacts: WINDOW } : {}),
  };
}

async function postChipRun(app: FastifyInstance, turnId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: turnId,
      scenario_id: SCENARIO_ID,
      stage: 'analyse',
      message: 'the user pressed Run',
      turn_class: 'decide',
      source: 'chip_click',
      chip: { id: 'agent_run_analysis', action_type: 'run_analysis' },
    },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, any> };
}

describe('route-v2 chip-click Run — run_delta reaches the wire (D1)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    dispatchDeterministicChipClickMock.mockReset();
    runTurnExecutorMock.mockReset();
  });

  it('RED (served a87c883b shape): the chip Run after an approved revision ships `run_delta` — the real pair, current = this run', async () => {
    dispatchDeterministicChipClickMock.mockResolvedValue(chipOk({ withPriorFacts: true }));
    const { status, body } = await postChipRun(app, 'd1d1d1d1-0000-4000-8000-000000000001');
    expect(status).toBe(200);
    expect(dispatchDeterministicChipClickMock).toHaveBeenCalledTimes(1);
    expect(runTurnExecutorMock).not.toHaveBeenCalled();

    expect(body).toHaveProperty('run_delta');
    expect(body.run_delta.leader.prior_leading_option_id).toBe('opt_59');
    expect(body.run_delta.leader.current_leading_option_id).toBe('opt_49');
    expect(body.run_delta.leader.changed).toBe(true);
    const raise = body.run_delta.win_probabilities.find((r: any) => r.option_id === 'opt_59');
    expect(raise).toMatchObject({ prior: 0.62, current: 0.45 });
  });

  it('the window also binds analysis_state to THIS run — complete_current, no identity withhold', async () => {
    dispatchDeterministicChipClickMock.mockResolvedValue(chipOk({ withPriorFacts: true }));
    const { body } = await postChipRun(app, 'd1d1d1d1-0000-4000-8000-000000000002');
    expect(body.analysis_state.run_state).toEqual({ kind: 'complete_current', computed_at: CURRENT.result.computed_at });
    expect(String(body.analysis_state.leader_claim?.withheld_reason ?? '')).not.toMatch(/identity/);
    expect(body.analysis_state.contradictions.filter((c: string) => /identity/.test(c))).toEqual([]);
  });

  it('CONTROL: a chip Run that completed no run (no window) ships NO `run_delta` key — absence, never a placeholder', async () => {
    dispatchDeterministicChipClickMock.mockResolvedValue(chipOk({ withPriorFacts: false }));
    const { status, body } = await postChipRun(app, 'd1d1d1d1-0000-4000-8000-000000000003');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('run_delta');
  });

  it('the two dispatch results differ ONLY in `priorFacts` (so the pair proves the hand-off)', () => {
    const withIt = chipOk({ withPriorFacts: true }) as Record<string, unknown>;
    const without = chipOk({ withPriorFacts: false }) as Record<string, unknown>;
    expect(Object.keys(withIt).filter((k) => JSON.stringify(withIt[k]) !== JSON.stringify(without[k]))).toEqual(['priorFacts']);
  });
});
