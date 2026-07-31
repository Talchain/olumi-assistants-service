/**
 * ROADMAP 2.202 fix ③ — a downstream 429 is BUSY, not INTERNAL_ERROR.
 *
 * `diagnosis-run-analysis-500s.md` §1: ISL's compute governor rejects a
 * concurrent analysis with HTTP 429; PLoT wraps it in a typed failure envelope;
 * CEE maps that to `analysis_failed` (FATAL) → `handler_failure` → **HTTP 500
 * INTERNAL_ERROR**. The tester is told the service is broken when the true
 * state is "the analysis engine is at its concurrency limit; retry in ~5s".
 *
 * CEE already accepted this exact principle for its OWN ingress limiter
 * (`41d5ecf0` — "429 RATE_LIMITED, not 500 INTERNAL"). This pins the same
 * principle applied to the DOWNSTREAM 429.
 *
 * ─────────────────────────────────────────────────────────────────
 * Where the 429 signal actually lives — derived, not guessed
 * ─────────────────────────────────────────────────────────────────
 * PLoT's envelope carries NO structured downstream status. The only carrier is
 * the `status_reason` prose, and it is a fixed template, verified at PLoT's own
 * staging tip `5ab93383` (`src/routes/v2/run.ts:1606`, `buildIslFailureDetail`):
 *
 *     error.code === 'ISL_ERROR' && error.status
 *       ? `The analysis service returned an error (HTTP ${error.status}).`
 *       : classStatusReason
 *
 * The fixtures below use the EXACT bytes captured off the wire on staging for
 * request `dfa7c743-d7ed-45db-b7fd-55735378d7c0` (diagnosis §1), including the
 * real critique-code ordering — `NORMALIZATION_WARNING` first, so
 * `plot_primary_code` is NOT `ISL_ERROR` and the code-keyed copy table does not
 * fire. That ordering matters: a fixture that put `ISL_ERROR` first would have
 * tested a path the live failure never takes.
 *
 * The SECOND ARM is not optional. A non-429 typed failure must STILL be fatal.
 * A fix that recovered every typed failure would hide genuine breakage — the
 * failure mode this whole programme exists to avoid.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import type { V2RunError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import { isRecoverableHandlerCause } from '../../../compose/recoverable-handler-causes.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TEST_REQUEST_ID = 'req-downstream-busy';

/** The exact `status_reason` captured on staging for the 429 failures. */
const CAPTURED_429_STATUS_REASON = 'The analysis service returned an error (HTTP 429).';

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
  return { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
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

/**
 * The failure exactly as captured on staging (diagnosis §1): a 200 body with
 * `analysis_status: 'failed'`, the HTTP-429 status_reason, and the real
 * critique ordering (NORMALIZATION_WARNING first, then ISL_ERROR /
 * ISL_CALL_FAILED).
 */
function makeCapturedIsl429Error(): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'failed',
    status_reason: CAPTURED_429_STATUS_REASON,
    critiques: [
      { code: 'NORMALIZATION_WARNING', message: 'normalisation applied' },
      { code: 'NORMALIZATION_WARNING', message: 'normalisation applied' },
      { code: 'NORMALIZATION_WARNING', message: 'normalisation applied' },
      { code: 'ISL_ERROR', message: CAPTURED_429_STATUS_REASON },
      { code: 'ISL_CALL_FAILED', message: 'ISL analysis failed. Please try again.' },
    ],
  };
  const err = new PLoTError(
    `PLoT run analysis failed: ${CAPTURED_429_STATUS_REASON}`,
    200,
    'run',
    179,
    'dfa7c743-d7ed-45db-b7fd-55735378d7c0',
  );
  err.v2RunError = v2Err;
  return err;
}

/** Same envelope shape, but a genuine downstream 500 — must stay FATAL. */
function makeIsl500Error(): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'failed',
    status_reason: 'The analysis service returned an error (HTTP 500).',
    critiques: [
      { code: 'ISL_ERROR', message: 'The analysis service returned an error (HTTP 500).' },
      { code: 'ISL_CALL_FAILED', message: 'ISL analysis failed. Please try again.' },
    ],
  };
  const err = new PLoTError(
    'PLoT run analysis failed: The analysis service returned an error (HTTP 500).',
    200,
    'run',
    120,
    'req-id',
  );
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

describe('run_analysis — a downstream 429 is BUSY, not a fatal INTERNAL_ERROR', () => {
  it('RED-FIRST: the captured ISL-429 envelope → analysis_engine_busy, recoverable', async () => {
    const caught = await invokeAndCatch(makeCapturedIsl429Error);

    expect(caught.name).toBe('HandlerInvocationFailedError');
    expect(caught.cause_kind).toBe('analysis_engine_busy');
    expect(caught.retryable).toBe(true);
    // The gate that turns this into a 200 rather than a 500.
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // The derived status is carried for telemetry, not re-parsed downstream.
    expect(caught.details.downstream_http_status).toBe(429);
    expect(caught.details.plot_status_reason).toBe(CAPTURED_429_STATUS_REASON);
  });

  it('SECOND ARM: a downstream 500 in the SAME envelope shape stays analysis_failed (fatal)', async () => {
    const caught = await invokeAndCatch(makeIsl500Error);

    expect(caught.cause_kind).toBe('analysis_failed');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
    expect(caught.details.downstream_http_status).toBeUndefined();
  });

  it('SECOND ARM: a typed failure with no HTTP status at all stays analysis_failed (fatal)', async () => {
    const caught = await invokeAndCatch(() => {
      const v2Err: V2RunError = {
        analysis_status: 'failed',
        status_reason: 'The analysis service timed out before returning a result.',
        critiques: [{ code: 'ISL_TIMEOUT', message: 'timed out' }],
      };
      const err = new PLoTError('PLoT run analysis failed: timeout', 200, 'run', 50, 'req-id');
      err.v2RunError = v2Err;
      return err;
    });

    expect(caught.cause_kind).toBe('analysis_failed');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
  });

  it("a 'blocked' envelope carrying a 429 stays analysis_blocked — the busy carve-out is failure-only", async () => {
    // `blocked` means PLoT DECIDED it cannot answer. Recovering it as "busy,
    // try again" would tell the user to retry something that will never
    // succeed. Scope the carve-out narrowly or it becomes a lie.
    const caught = await invokeAndCatch(() => {
      const v2Err: V2RunError = {
        analysis_status: 'blocked',
        status_reason: CAPTURED_429_STATUS_REASON,
        critiques: [{ code: 'GRAPH_TOO_COMPLEX', message: 'too complex' }],
      };
      const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 50, 'req-id');
      err.v2RunError = v2Err;
      return err;
    });

    expect(caught.cause_kind).not.toBe('analysis_engine_busy');
  });

  it('PLoT itself answering 429 (transport, no envelope) → analysis_engine_busy', async () => {
    // The other way a 429 can reach this seam: PLoT's own limiter rejects CEE.
    // Same product truth — busy, retryable — so the same cause.
    const caught = await invokeAndCatch(
      () => new PLoTError('PLoT run returned 429', 429, 'run', 12, 'req-id'),
    );

    expect(caught.cause_kind).toBe('analysis_engine_busy');
    expect(caught.retryable).toBe(true);
    expect(caught.details.downstream_http_status).toBe(429);
  });

  it('a non-429 transport failure without an envelope still maps to plot_error (unchanged)', async () => {
    const caught = await invokeAndCatch(
      () => new PLoTError('PLoT run returned 503', 503, 'run', 12, 'req-id'),
    );

    expect(caught.cause_kind).toBe('plot_error');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
  });
});
