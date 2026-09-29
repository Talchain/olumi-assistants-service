/**
 * Part 3 — CEE must always speak BEFORE the browser proxy does.
 *
 * THE OBJECTION THIS DISSOLVES. Raising the PLoT cap converts some 30s
 * failures into ~75s failures. The stated risk was that a slow turn drifts
 * past BROWSER_PROXY_TIMEOUT_MS (125s), at which point the proxy answers
 * first and the user gets a generic "the model generation service did not
 * respond" instead of CEE's own analysis-specific error.
 *
 * If CEE is GUARANTEED to produce a typed error comfortably before 125s, that
 * failure mode cannot occur and the cap raise degrades to "a slow request
 * fails a bit later, cleanly".
 *
 * This drives the REAL run_analysis handler over the REAL PLoT client with a
 * hanging socket — no mocked client, no mocked timeout — and asserts both
 * halves: the error is CEE's own typed one, AND it arrives with headroom to
 * spare against the proxy deadline.
 *
 * Note on what "typed" means here: the proxy's own 504 is also structured
 * JSON (PROXY_UPSTREAM_TIMEOUT), so "typed vs untyped" is not the real
 * distinction — WHOSE error it is, and whether it can name the operation the
 * user was waiting on, is. This test pins that CEE's plot_timeout cause wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PLOT_RUN_TIMEOUT_MS } from '../../../src/config/timeouts.js';
import { HandlerInvocationFailedError } from '../../../src/orchestrator-v5/tools/handler-errors.js';
import { getTurnExecutorBudgets, getHandlerBudgetMs } from '../../../src/orchestrator-v5/budgets.js';
import { config } from '../../../src/config/index.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
} from '../../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import { createPLoTClient } from '../../../src/orchestrator/plot-client.js';
import type { HandlerInvocation } from '../../../src/orchestrator-v5/tools/registry.js';

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'plot') {
          return { baseUrl: 'http://plot-test:3002', authToken: 'test-token' };
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const GRAPH = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Goal' },
    { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.5 } },
  ],
  edges: [],
};

function makeSnapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: JSON.parse(JSON.stringify(GRAPH)),
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_a: 1 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_a: 0.5 } },
    ],
    goal_node_id: 'goal_1',
    rawPersistedGraph: JSON.parse(JSON.stringify(GRAPH)),
  } as RunAnalysisScenarioSnapshot;
}

function makeInvocation(signal: AbortSignal): HandlerInvocation {
  return {
    payload: { scenario_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    requestId: 'req-slowpath',
    signal,
    context: {},
    orientationText: '',
  } as unknown as HandlerInvocation;
}

describe('slow analysis path yields a typed CEE error before the proxy deadline', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('produces a typed plot_timeout HandlerInvocationFailedError, with headroom before BROWSER_PROXY_TIMEOUT_MS', async () => {
    // A PLoT socket that accepts the request and then never answers — the
    // exact shape of the failure the raised cap makes longer.
    fetchSpy.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
          });
        }),
    );

    const handler = createRunAnalysisHandler({
      plotClient: createPLoTClient()!,
      scenarioReader: async () => makeSnapshot(),
    });

    const startedAt = Date.now();
    const turnAbort = new AbortController();
    const promise = handler(makeInvocation(turnAbort.signal));

    let caught: unknown;
    promise.catch((e) => {
      caught = e;
    });

    // Advance past the raised cap. Deliberately NOT past the proxy deadline —
    // if CEE needed longer than this, the assertions below would not be
    // reachable at all.
    await vi.advanceTimersByTimeAsync(PLOT_RUN_TIMEOUT_MS + 5_000);
    const elapsedMs = Date.now() - startedAt;

    // 1. CEE produced its OWN typed error — not a hang, not a bare AbortError.
    expect(caught).toBeInstanceOf(HandlerInvocationFailedError);
    const err = caught as HandlerInvocationFailedError;
    // The cause names the operation the user was waiting on. A proxy timeout
    // structurally cannot carry this — it does not know what CEE was doing.
    expect(err.cause_kind).toBe('plot_timeout');
    expect(err.kind).toBe('HANDLER_INVOCATION_FAILED');
    expect(err.details.handler_id).toBe('run_analysis');
    // Recoverable: the user can meaningfully retry an analysis that timed out.
    expect(err.retryable).toBe(true);

    // 2. It arrived with real headroom before the proxy would have answered.
    expect(elapsedMs).toBeLessThan(config.proxy.browserProxyTimeoutMs);
    expect(config.proxy.browserProxyTimeoutMs - elapsedMs).toBeGreaterThan(30_000);

    // 3. Exactly ONE PLoT attempt — the timeout class is not retried, so the
    //    raised cap cannot compound into two overlapping expensive runs.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('bounds the analysis path inside the turn budget, which is itself inside the proxy deadline', () => {
    // The arithmetic backing the guarantee, stated as an executable chain
    // rather than as prose in a comment that nobody re-checks.
    const { turn_ms } = getTurnExecutorBudgets();
    const handlerBudget = getHandlerBudgetMs();
    const proxy = config.proxy.browserProxyTimeoutMs;

    // worst-case PLoT leg after this lane: one full attempt, no timeout retry
    const worstCasePlotLeg = PLOT_RUN_TIMEOUT_MS;

    expect(worstCasePlotLeg).toBeLessThan(handlerBudget);
    expect(handlerBudget).toBeLessThan(turn_ms);
    expect(turn_ms).toBeLessThan(proxy);
  });
});
