/**
 * V5 C5 — chip-click `run_analysis` recoverable-cause escape repair.
 *
 * Root cause (see project memory / Candidate A): the chip-click dispatch path
 * (`dispatchChipClickRunAnalysis` → route-v2 outcome mapping) returned a 500
 * for EVERY typed handler failure, never consulting `isRecoverableHandlerCause`
 * — even though `options_not_configured` is on `RECOVERABLE_HANDLER_CAUSES` and
 * the Sonnet/TurnExecutor path composes a graceful 200 for the same cause.
 *
 * This suite pins the fix: the chip path now gates on the SAME shared
 * recoverable-cause set and composes the SAME graceful body via
 * `composeRecoverableHandlerResponse`, returning the new `handler_recovered`
 * outcome (route-v2 → 200) for recoverable causes while FATAL causes keep the
 * existing `handler_failure` → 500 behaviour.
 *
 * Two layers are exercised:
 *   - cause-gating / parity / telemetry / body — via injected throwing
 *     registries (the dispatch layer only sees the cause kind);
 *   - shape funnel (absent / {} / null interventions, and the PLoT-preflight
 *     rejection of a mixed graph) — via the REAL run_analysis handler injected
 *     through a real registry, proving each shape reaches `options_not_configured`
 *     and is then recovered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { log } from '../../../utils/telemetry.js';
import { RECOVERABLE_HANDLER_CAUSES } from '../../compose/recoverable-handler-causes.js';

// Mutable turn-budget holder so the budget-precedence test can shrink the
// turn_ms to make `turnAbort` fire before a (deliberately slow) handler throws.
// `vi.hoisted` guarantees it is initialised before the hoisted `vi.mock` factory.
const { budgetHolder } = vi.hoisted(() => ({ budgetHolder: { turnMs: 30000 } }));

// `dispatchChipClickRunAnalysis` calls `buildTurnContext` unconditionally at
// the top (even on the injected-registry test path), which would hit Supabase.
// Stub it with a minimal context; everything else (registry, handler) is real
// or injected explicitly via the `handlerRegistry` param.
vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'Run analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-c5',
      budgets: {
        turn_ms: budgetHolder.turnMs,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    })),
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';
import { createRegistry, type HandlerFn, type HandlerRegistry } from '../../tools/registry.js';
import {
  HandlerInvocationFailedError,
  type HandlerInvocationFailedCause,
} from '../../tools/handler-errors.js';
import type { RunAnalysisScenarioSnapshot, ScenarioReader } from '../../tools/handlers/run-analysis.js';
import type { PLoTClient, PLoTClientRunOpts, V2RunError } from '../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { V5ActionType } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

/** Injected registry whose run_analysis handler throws a chosen typed cause. */
function registryThrowing(
  cause: HandlerInvocationFailedCause,
  retryable = false,
): HandlerRegistry {
  const fn: HandlerFn = () =>
    Promise.reject(
      new HandlerInvocationFailedError(`forced ${cause}`, {
        cause_kind: cause,
        retryable,
        details: {
          handler_id: 'run_analysis',
          // Generic detail so every recoverable composer branch produces a
          // real (non-`fallback`) template.
          specific_issue: 'simulated',
          first_option_label: 'Aggressive In-House Build',
        },
      }),
    );
  return new Map<V5ActionType, HandlerFn>([['run_analysis', fn]]);
}

/** A scenario snapshot with the supplied PLoT-projection options. */
function snapshotWithOptions(options: unknown[]): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options,
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function readerFor(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return (() => Promise.resolve(snapshot)) as unknown as ScenarioReader;
}

/** PLoT client that fails the test if run() is ever called. */
function plotNeverCalled(): PLoTClient {
  return {
    run: vi.fn(() => Promise.reject(new Error('PLoT must not be reached for unconfigured options'))),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
}

/** PLoT 422 preflight rejection naming an option with no interventions. */
function makePreflightPLoTError(optionLabel: string): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'preflight_validation_failed',
    status_reason: 'Preflight validation failed',
    critiques: [
      {
        message: `Option '${optionLabel}' does not specify what it changes. Each option must define at least one intervention.`,
      },
    ],
  } as unknown as V2RunError;
  const err = new PLoTError(
    `PLoT run analysis blocked: Preflight validation failed: Option '${optionLabel}' does not specify what it changes.`,
    422,
    'run',
    50,
    'req-id',
  );
  (err as unknown as { v2RunError: V2RunError }).v2RunError = v2Err;
  return err;
}

function plotRejectingPreflight(optionLabel: string): PLoTClient {
  const run = vi.fn((..._args: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
    Promise.reject<V2RunResponseEnvelope>(makePreflightPLoTError(optionLabel)),
  );
  return { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
}

/** Real registry with the REAL run_analysis handler over an injected reader/PLoT. */
function realRegistry(snapshot: RunAnalysisScenarioSnapshot, plotClient: PLoTClient): HandlerRegistry {
  return createRegistry({ scenarioReader: readerFor(snapshot), plotClient });
}

let events: Array<{ event: string; data: Record<string, unknown> }> = [];
let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  budgetHolder.turnMs = 30000;
  setTestSink(null);
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('chip-click run_analysis — recoverable-cause escape (cause gating)', () => {
  it('options_not_configured → graceful handler_recovered (NOT handler_failure / 500)', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-onc',
      handlerRegistry: registryThrowing('options_not_configured'),
    });

    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome !== 'handler_recovered') throw new Error('unreachable');

    // Graceful body: coaching text + a recovery chip, clean (no error block).
    expect(out.response.assistant_text.length).toBeGreaterThan(0);
    expect(out.response.blocks).toEqual([]);
    expect(out.response.suggested_actions.length).toBeGreaterThan(0);

    // No analysis ran / no graph mutated → no analysis_ready, no commit.
    expect(out.analysisReady).toBeUndefined();
    expect(out.commitPerformed).toBe(false);
    expect(out.causeKind).toBe('options_not_configured');
  });

  it('does not leak BoundaryError/internal wording and does not claim the option was configured', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-noleak',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    if (out.outcome !== 'handler_recovered') throw new Error(`expected handler_recovered, got ${out.outcome}`);

    const body = JSON.stringify(out.response);
    expect(body).not.toContain('BoundaryError');
    expect(body).not.toContain('INTERNAL_ERROR');
    expect(body).not.toMatch(/boundary/i);
    // No internal cause token leaks into user-facing text.
    expect(out.response.assistant_text).not.toContain('options_not_configured');
    expect(out.response.assistant_text).not.toContain('cause_kind');
    // Honest: must NOT claim success / completion.
    expect(body).not.toMatch(/successfully configured/i);
    expect(body).not.toMatch(/analysis complete/i);
    expect(body).not.toMatch(/configured successfully/i);
  });

  it('every RECOVERABLE_HANDLER_CAUSES cause recovers on the chip path (shared set — cannot diverge from Sonnet path)', async () => {
    for (const cause of RECOVERABLE_HANDLER_CAUSES) {
      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-${cause}`,
        handlerRegistry: registryThrowing(cause),
      });
      expect(out.outcome, `${cause} should map to handler_recovered`).toBe('handler_recovered');
    }
  });

  it('FATAL handler causes still return handler_failure (cause-gated, not a blanket downgrade)', async () => {
    const fatalCauses: HandlerInvocationFailedCause[] = [
      'plot_error',
      'scenario_read_failed',
      'plot_timeout',
      'analysis_failed',
      'graph_invariant_violated',
    ];
    for (const cause of fatalCauses) {
      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-fatal-${cause}`,
        handlerRegistry: registryThrowing(cause, /* retryable */ true),
      });
      expect(out.outcome, `${cause} must stay handler_failure (→ 500)`).toBe('handler_failure');
    }
  });

  it('BUDGET precedence: a recoverable cause thrown AFTER the turn budget aborts → handler_failure (NOT recovered), parity with TurnExecutor BUDGET_EXCEEDED', async () => {
    // Shrink the turn budget so `turnAbort` fires (~immediately) before the
    // handler — which deliberately delays — throws its recoverable cause. The
    // catch ladder must see `turnAbort.signal.aborted` and fail loud.
    budgetHolder.turnMs = 0;
    const slowThenRecoverable: HandlerFn = async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new HandlerInvocationFailedError('late options_not_configured', {
        cause_kind: 'options_not_configured',
        retryable: false,
        details: { handler_id: 'run_analysis' },
      });
    };
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-budget-precedence',
      handlerRegistry: new Map<V5ActionType, HandlerFn>([['run_analysis', slowThenRecoverable]]),
    });
    expect(out.outcome).toBe('handler_failure');
  });

  it('emits v5.recovery_response telemetry recording the recoverable cause', async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-telemetry',
      handlerRegistry: registryThrowing('options_not_configured'),
    });

    const recovery = events.find((e) => e.event === 'v5.recovery_response');
    expect(recovery, 'v5.recovery_response not emitted').toBeDefined();
    expect(recovery!.data.failure_origin).toBe('handler');
    expect(recovery!.data.handler_cause_kind).toBe('options_not_configured');
  });
});

describe('chip-click run_analysis — shape funnel through the REAL handler', () => {
  it('ABSENT interventions (added unconfigured option) → options_not_configured → handler_recovered', async () => {
    const snapshot = snapshotWithOptions([
      { id: 'opt_a', option_id: 'opt_a', label: 'Aggressive In-House Build' /* no interventions key */ },
    ]);
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-shape-absent',
      handlerRegistry: realRegistry(snapshot, plotNeverCalled()),
    });
    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome === 'handler_recovered') expect(out.causeKind).toBe('options_not_configured');
  });

  it('EMPTY-object {} interventions → options_not_configured → handler_recovered', async () => {
    const snapshot = snapshotWithOptions([
      { id: 'opt_a', option_id: 'opt_a', label: 'Aggressive In-House Build', interventions: {} },
    ]);
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-shape-empty',
      handlerRegistry: realRegistry(snapshot, plotNeverCalled()),
    });
    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome === 'handler_recovered') expect(out.causeKind).toBe('options_not_configured');
  });

  it('LEGACY null interventions → options_not_configured → handler_recovered (when it reaches the handler)', async () => {
    // NOTE: in PRODUCTION a persisted `interventions:null` graph fails
    // `GraphV3.safeParse` at load → `scenario_read_failed` (fatal), so null is
    // prevented at the WRITE boundary by #283 and never reaches this preflight.
    // IF a null nonetheless reaches the handler's snapshot (e.g. a projection
    // that tolerated it), the step-2.5 guard treats it as unconfigured and the
    // chip path recovers gracefully rather than 500-ing.
    const snapshot = snapshotWithOptions([
      { id: 'opt_a', option_id: 'opt_a', label: 'Aggressive In-House Build', interventions: null },
    ]);
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-shape-null',
      handlerRegistry: realRegistry(snapshot, plotNeverCalled()),
    });
    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome === 'handler_recovered') expect(out.causeKind).toBe('options_not_configured');
  });

  it('PLoT preflight rejection (mixed/real C5 case) → options_not_configured → handler_recovered, PLoT was reached', async () => {
    // Options are configured enough to pass the pre-PLoT step-2.5 guard, so the
    // request reaches PLoT, whose stricter preflight rejects an option for
    // missing interventions — the exact acceptance-T2 path (added option
    // alongside configured ones). The handler maps that 422 to the recoverable
    // options_not_configured cause; the chip path must recover it.
    const snapshot = snapshotWithOptions([
      { id: 'opt_a', option_id: 'opt_a', label: 'Configured Option', interventions: { fac_price: 0.9 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Aggressive In-House Build', interventions: { fac_price: 1.2 } },
    ]);
    const plot = plotRejectingPreflight('Aggressive In-House Build');
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-shape-plot-preflight',
      handlerRegistry: realRegistry(snapshot, plot),
    });
    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome === 'handler_recovered') expect(out.causeKind).toBe('options_not_configured');
    expect((plot.run as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
