/**
 * V5 latency observability (Fix 4) — run_analysis timing preservation
 * on PLoT failure paths.
 *
 * Verifies the review-fix requirement: every PLoT-failure exit
 * (timeout, plot_error, payload_invalid, unknown) must surface
 * `plot_request_ms` in the thrown HandlerInvocationFailedError details
 * AND emit the V5RunAnalysisTimings telemetry event with a non-null
 * `plot_request_ms` value. Without this, the staging replay harness
 * cannot diagnose PLoT-side latency during outages — which is exactly
 * the window we most need the data.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setTestSink,
  TelemetryEvents,
} from '../../../../utils/telemetry.js';

import type {
  PLoTClient,
  PLoTClientRunOpts,
} from '../../../../orchestrator/plot-client.js';
import { PLoTError, PLoTTimeoutError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-timing-test';

function makeScenarioSnapshot(): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_x: 1 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  };
}

function makeScenarioReader(): ScenarioReader {
  return vi.fn<[string, AbortSignal | undefined], Promise<RunAnalysisScenarioSnapshot>>(
    () => Promise.resolve(makeScenarioSnapshot()),
  );
}

function makeFailingPlotClient(throwFn: () => unknown): PLoTClient {
  const run = vi.fn<[Record<string, unknown>, string, PLoTClientRunOpts | undefined], Promise<V2RunResponseEnvelope>>(
    () => Promise.reject(throwFn()),
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

describe('run_analysis — PLoT failure path timing preservation (Fix 4)', () => {
  let telemetryEvents: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    telemetryEvents = [];
    setTestSink((event, payload) => {
      telemetryEvents.push({ event, payload });
    });
  });

  afterEach(() => {
    setTestSink(null);
  });

  it('PLoT timeout — error details carry plot_request_ms and telemetry emits', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makeFailingPlotClient(() => new PLoTTimeoutError('PLoT request timed out')),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      if (err instanceof HandlerInvocationFailedError) caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('plot_timeout');
    expect(caught!.details).toHaveProperty('handler_id', 'run_analysis');
    // The blocking-review requirement: error details must surface the
    // PLoT round-trip time so the replay harness can attribute outage
    // latency.
    expect(typeof caught!.details?.plot_request_ms).toBe('number');
    expect(caught!.details?.plot_request_ms as number).toBeGreaterThanOrEqual(0);

    // Telemetry must emit on the failure path too.
    const timingEvents = telemetryEvents.filter(
      (e) => e.event === TelemetryEvents.V5RunAnalysisTimings,
    );
    expect(timingEvents.length).toBe(1);
    expect(timingEvents[0]!.payload.plot_request_ms).toBeTypeOf('number');
    expect(timingEvents[0]!.payload.plot_status).toBeNull();
  });

  it('PLoT 5xx error — error details carry plot_request_ms', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makeFailingPlotClient(() => new PLoTError('PLoT 502 Bad Gateway', 502)),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      if (err instanceof HandlerInvocationFailedError) caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('plot_error');
    expect(typeof caught!.details?.plot_request_ms).toBe('number');
    expect(telemetryEvents.some((e) => e.event === TelemetryEvents.V5RunAnalysisTimings)).toBe(true);
  });

  it('PLoT unknown error — error details carry plot_request_ms', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makeFailingPlotClient(() => new Error('something else')),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      if (err instanceof HandlerInvocationFailedError) caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('plot_unknown');
    expect(typeof caught!.details?.plot_request_ms).toBe('number');
  });

  it('PLoT payload-invalid (orchestratorError) — error details carry plot_request_ms', async () => {
    const orchestratorError = Object.assign(new Error('invalid'), {
      orchestratorError: { message: 'bad payload' },
    });
    const handler = createRunAnalysisHandler({
      plotClient: makeFailingPlotClient(() => orchestratorError),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      if (err instanceof HandlerInvocationFailedError) caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('plot_payload_invalid');
    expect(typeof caught!.details?.plot_request_ms).toBe('number');
  });
});
