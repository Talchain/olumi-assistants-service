/**
 * Dual-carry of PLoT's typed failure codes into HandlerInvocationFailedError
 * details (seam item 3, CRITIQUE_BUCKETS ruling).
 *
 * PLoT's typed failure envelope (#212) carries discriminating critique codes
 * (GRAPH_TOO_COMPLEX, ISL_TIMEOUT, PLOT_INTERNAL_ERROR, …) that the handler
 * previously discarded when wrapping PLoTErrors — every typed failure
 * collapsed to a generic `plot_error` with handler_id + timing details only,
 * so the composer could never surface honest, code-keyed copy.
 *
 * Pins:
 *  - 422 blocked with critique codes → `analysis_blocked` WITH
 *    plot_critique_codes / plot_primary_code / plot_user_message /
 *    plot_status_reason on details. (⚠ WAS `plot_error`, "the 422→recoverable
 *    reroute is War-Room-gated". Changed by the P0 analysis-500 lane, 14 Aug
 *    2026: that mapping is what returned HTTP 500 for PLoT's own typed verdict,
 *    measured at 3/12 first-use analyse turns — see
 *    `TRIGGER-SETTLED-LANE-F2.md`. The dual-carry this file exists to pin is
 *    unchanged.)
 *  - typed failed(200) envelope (carried via PLoTError.v2RunError by the
 *    plot-client carve-out) → `analysis_failed` (unifies "PLoT said failed"
 *    with the parsed-envelope path; both fatal, no recoverability change)
 *    with the same code keys;
 *  - PLoTError with no v2RunError → `plot_error` with NO plot_* code keys
 *    (unknown-shape fallback unchanged);
 *  - the preflight missing-intervention recovery is untouched.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import type { V2RunError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEST_REQUEST_ID = 'req-plot-failure-codes';

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  };
}

function makeScenarioReader(): ScenarioReader {
  return vi.fn(() => Promise.resolve(makeScenarioSnapshot())) as unknown as ScenarioReader;
}

function makePlotClientRejecting(error: () => Error): PLoTClient {
  const run = vi.fn((..._args: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
    Promise.reject<V2RunResponseEnvelope>(error()),
  );
  const validatePatch = vi.fn().mockResolvedValue({});
  return { run, validatePatch } as unknown as PLoTClient;
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
}

function make422BlockedError(): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'blocked',
    status_reason: 'Graph too complex to analyse',
    critiques: [
      {
        code: 'GRAPH_TOO_COMPLEX',
        message: 'graph exceeds complexity budget',
        user_message: 'Your model is too complex to analyse. Simplify it.',
      },
    ],
  };
  const err = new PLoTError(
    'PLoT run analysis blocked: Graph too complex to analyse',
    422,
    'run',
    50,
    'req-id',
  );
  err.v2RunError = v2Err;
  return err;
}

function makeTypedFailedEnvelopeError(): PLoTError {
  // Shape produced by the plot-client typed-failure carve-out: a 200 body
  // with analysis_status 'failed' and no usable results.
  const v2Err: V2RunError = {
    analysis_status: 'failed',
    status_reason: 'ISL timed out',
    critiques: [
      {
        code: 'ISL_TIMEOUT',
        message: 'inference timed out after 30s',
        user_message: 'The analysis timed out. Try again.',
      },
    ],
  };
  const err = new PLoTError('PLoT run analysis failed: ISL timed out', 200, 'run', 50, 'req-id');
  err.v2RunError = v2Err;
  return err;
}

async function invokeAndCatch(plotError: () => Error): Promise<HandlerInvocationFailedError> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClientRejecting(plotError),
    scenarioReader: makeScenarioReader(),
  });
  try {
    await handler(makeInvocation());
  } catch (err) {
    return err as HandlerInvocationFailedError;
  }
  throw new Error('handler should have thrown');
}

describe('run_analysis — PLoT typed failure codes dual-carried into details', () => {
  it('422 blocked with GRAPH_TOO_COMPLEX → analysis_blocked with code keys on details', async () => {
    const caught = await invokeAndCatch(make422BlockedError);

    expect(caught.name).toBe('HandlerInvocationFailedError');
    // ⚠ EXPECTATION CHANGED `plot_error` → `analysis_blocked` (P0 analysis-500
    // lane, 2026-08-14), and the change is the FIX, not an accommodation.
    //
    // This assertion pinned the defect. `plot_error` is not on
    // `RECOVERABLE_HANDLER_CAUSES`, so this test guaranteed that a PLoT 422
    // `blocked` — the engine's own typed verdict that it cannot answer a model —
    // reached the user as HTTP 500 INTERNAL_ERROR. Measured cost: 3 of 12
    // first-use analyse turns on staging (`TRIGGER-SETTLED-LANE-F2.md`).
    //
    // The original rationale was *"the 422→recoverable reroute is
    // War-Room-gated"*, and that gate was a reasonable caution when nothing had
    // measured the class. It has now been measured, at the Render logs, on real
    // users: all three banked 500s were exactly this shape.
    //
    // Everything this test actually exists for — the dual-carry of PLoT's codes
    // into `details` — is unchanged and still asserted below. Only the
    // disposition moved, and with it the recoverability that decides 200 vs 500.
    expect(caught.cause_kind).toBe('analysis_blocked');
    expect(caught.details.plot_primary_code).toBe('GRAPH_TOO_COMPLEX');
    expect(caught.details.plot_critique_codes).toEqual(['GRAPH_TOO_COMPLEX']);
    expect(caught.details.plot_user_message).toBe('Your model is too complex to analyse. Simplify it.');
    expect(caught.details.plot_status_reason).toBe('Graph too complex to analyse');
    expect(caught.details.plot_analysis_status).toBe('blocked');
  });

  it('typed failed(200) envelope with ISL_TIMEOUT → analysis_failed with code keys', async () => {
    const caught = await invokeAndCatch(makeTypedFailedEnvelopeError);

    expect(caught.cause_kind).toBe('analysis_failed');
    expect(caught.retryable).toBe(true);
    expect(caught.details.plot_primary_code).toBe('ISL_TIMEOUT');
    expect(caught.details.plot_critique_codes).toEqual(['ISL_TIMEOUT']);
    expect(caught.details.plot_analysis_status).toBe('failed');
  });

  it('PLoTError without v2RunError → plot_error with no plot_* code keys (fallback unchanged)', async () => {
    const caught = await invokeAndCatch(
      () => new PLoTError('PLoT run returned 500', 500, 'run', 50, 'req-id'),
    );

    expect(caught.cause_kind).toBe('plot_error');
    expect(caught.details.plot_primary_code).toBeUndefined();
    expect(caught.details.plot_critique_codes).toBeUndefined();
    expect(caught.details.plot_user_message).toBeUndefined();
  });

  it('preflight missing-intervention recovery is untouched by the dual-carry', async () => {
    const caught = await invokeAndCatch(() => {
      const v2Err: V2RunError = {
        analysis_status: 'preflight_validation_failed',
        status_reason: 'Preflight validation failed',
        critiques: [
          {
            message:
              "Option 'Option A' does not specify what it changes. Each option must define at least one intervention.",
          },
        ],
      };
      const err = new PLoTError('PLoT run analysis blocked: Preflight validation failed', 422, 'run', 50, 'req-id');
      err.v2RunError = v2Err;
      return err;
    });

    expect(caught.cause_kind).toBe('options_not_configured');
    expect(caught.retryable).toBe(false);
    expect(caught.details.first_option_label).toBe('Option A');
  });
});
