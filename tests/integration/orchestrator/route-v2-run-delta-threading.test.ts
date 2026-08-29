/**
 * THE WIRE WITNESS FOR `run_delta` — route hand-off of `priorFacts`
 * (turn_executor exit).
 *
 * ⭐⭐ WHY THIS TEST EXISTS, AND WHY A UNIT TEST WOULD NOT HAVE CAUGHT IT.
 * The `run_delta` producer (`coaching/build-run-delta.ts`) and its call site in
 * `response-finaliser.ts` both merged, with 27 producer tests and an 11-mutant
 * kit, ALL GREEN — while the field reached nobody. Nothing threaded the facts,
 * so `attachRunDelta`'s `if (ctx.priorFacts === undefined) return response;`
 * fired on every single turn. **A green suite is exactly what "built but not
 * plugged in" looks like from the inside.**
 *
 * So the acceptance condition for the threading is not "the producer works" —
 * it is `run_delta` PRESENT ON A RESPONSE BODY. This test posts a real turn
 * through the real route and reads the parsed body, mocking only
 * `runTurnExecutor` (the same seam and the same construction as
 * `route-v2-canonical-state-threading.test.ts`, deliberately).
 *
 * ⚠ THE PAIR IS THE PROOF, NOT THE POSITIVE CASE. Identical facts, identical
 * response, identical everything — the ONLY difference is whether the run
 * result carries `priorFacts`. Present ⇒ the block ships. Absent ⇒ NO
 * `run_delta` key at all, which is the honest refusal the contract models
 * ("a consumer renders NO delta card on absence") and is also precisely the
 * pre-threading behaviour. One case alone would prove neither.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

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

/**
 * A persisted `run_analysis` fact carrying everything the producer reads off a
 * REAL PLoT envelope: `meta.seed_used` / `meta.n_samples` (producer echoes),
 * `graph_hash_at_run`, `computed_at`, the raw option records, and the
 * claim-safety stamp without which leader ids are fail-closed to withheld.
 */
function runFact(opts: {
  seed: string;
  hash: string;
  computedAt: string;
  options: ReadonlyArray<{ id: string; label: string; win: number }>;
}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: [...opts.options].sort((a, b) => b.win - a.win)[0]!.id,
      summary: 'ok',
      graph_hash_at_run: opts.hash,
      computed_at: opts.computedAt,
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'evaluated_feasible' as const,
      },
      enrichment: {
        analysis_status: 'completed',
        robustness_status: 'computed',
        robustness: { near_tie: { is_tie: false } },
        results: opts.options.map((o) => ({
          option_id: o.id,
          option_label: o.label,
          win_probability: o.win,
        })),
        meta: { seed_used: opts.seed, n_samples: 10_000 },
      },
    },
  } as unknown as HandlerFact;
}

// A FACTOR-VALUE EDIT then a re-run: PLoT derives its seed from a projection
// that includes `observed_state.value`, so the edit moves the seed AND the
// analysis hash together. Newest-first, as the turn loader delivers them.
const PRIOR = runFact({
  seed: '111',
  hash: 'HASH_A',
  computedAt: '2026-08-26T01:00:00.000Z',
  options: [
    { id: 'opt_a', label: 'Offshore', win: 0.62 },
    { id: 'opt_b', label: 'Onshore', win: 0.38 },
  ],
});
const CURRENT = runFact({
  seed: '222',
  hash: 'HASH_B',
  computedAt: '2026-08-26T02:00:00.000Z',
  options: [
    { id: 'opt_a', label: 'Offshore', win: 0.45 },
    { id: 'opt_b', label: 'Onshore', win: 0.55 },
  ],
});
const TWO_RUNS: readonly HandlerFact[] = [CURRENT, PRIOR];

function mkRunResult(opts: { withPriorFacts: boolean }) {
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
    freshness: {
      freshness: 'fresh' as const,
      reason: 'graph_hash_match' as const,
      selected_fact_index: 0,
      graph_hash_at_run: 'HASH_B',
      current_graph_hash: 'HASH_B',
      computed_at: '2026-08-26T02:00:00.000Z',
    },
    rawRobustness: { level: null, near_tie_is_tie: false },
    reasoningGraph: null,
    mayNameLeadingOption: true,
    mayNameLeadingOptionProvenance: 'fact_verdict_permitted',
    ...(opts.withPriorFacts ? { priorFacts: TWO_RUNS } : {}),
    telemetry: {
      stages_completed: ['orient', 'execute'],
      response_emitted: true as const,
      llm_calls_used: 0,
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

describe('route-v2 — run_delta reaches the wire (priorFacts hand-off)', () => {
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

  it('THREADED → `run_delta` is PRESENT on the response body', async () => {
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withPriorFacts: true }));
    const { status, body } = await postTurn(app, '99999999-9999-4999-8999-999999999901');
    expect(status).toBe(200);
    expect(runTurnExecutorMock).toHaveBeenCalled();

    // THE WITNESS.
    expect(body).toHaveProperty('run_delta');

    // And it is the REAL comparison of the two persisted facts, not a stub.
    // Seed and hash both moved (a factor-value edit) and the builds echo is
    // absent, so the honest classification is C2_unpaired.
    expect(body.run_delta.attribution_case).toBe('C2_unpaired');
    expect(body.run_delta.pair_provenance).toEqual({
      seed_equal: false,
      hash_equal: false,
      builds_equal: 'unknown',
      n_equal: true,
    });

    // Leader movement, identity-bound (never a label).
    expect(body.run_delta.leader.prior_leading_option_id).toBe('opt_a');
    expect(body.run_delta.leader.current_leading_option_id).toBe('opt_b');
    expect(body.run_delta.leader.changed).toBe(true);

    // Per-option movement with a real noise verdict: 0.62 → 0.45 at n=10,000 is
    // far outside the binomial band, so this is signal rather than sampling.
    const a = body.run_delta.win_probabilities.find((r: any) => r.option_id === 'opt_a');
    expect(a).toMatchObject({ prior: 0.62, current: 0.45, noise_verdict: 'signal' });

    // The withheld Tier-3 slot ships empty, and no causal case is constructible.
    expect(body.run_delta.flip_thresholds).toEqual([]);
    expect(body.run_delta.edit_list).toBeUndefined();
  });

  it('NOT THREADED → NO `run_delta` key at all (the honest refusal, and the pre-fix behaviour)', async () => {
    runTurnExecutorMock.mockResolvedValue(mkRunResult({ withPriorFacts: false }));
    const { status, body } = await postTurn(app, '99999999-9999-4999-8999-999999999902');
    expect(status).toBe(200);
    // Absence, not an empty or placeholder block: the contract's own semantics.
    expect(body).not.toHaveProperty('run_delta');
  });

  it('the two cases differ ONLY in the threading (so the pair proves the hand-off)', () => {
    const withIt = mkRunResult({ withPriorFacts: true }) as Record<string, unknown>;
    const without = mkRunResult({ withPriorFacts: false }) as Record<string, unknown>;
    const diff = Object.keys(withIt).filter(
      (k) => JSON.stringify(withIt[k]) !== JSON.stringify(without[k]),
    );
    expect(diff).toEqual(['priorFacts']);
  });
});
