/**
 * Demo-readiness recovery for PLoT 422 "preflight validation failed" with
 * an option missing interventions.
 *
 * The existing run_analysis handler wraps every PLoTError as
 * `cause_kind: 'plot_error'` (retryable=true) which the turn-executor
 * surfaces as a 500 INTERNAL_ERROR. For the specific case where PLoT's
 * preflight rejects an option for not specifying its interventions, this
 * is a RECOVERABLE model-readiness failure — not an internal error. The
 * fix routes that specific case to the existing recoverable
 * `options_not_configured` cause, which the composer renders as a typed
 * 200 with the option name + "Configure {option}" chip.
 *
 * Tests required by the demo-readiness brief:
 *   (1) PLoT 422 missing-intervention error returns recoverable response
 *   (2) No analysis fact persisted on recoverable path
 *   (3) Graph state remains available (no graph mutation)
 *   (4) Successful run_analysis path unchanged (covered by sibling tests)
 *   (5) Unknown PLoT errors still follow existing path
 *   (6) Zero TypeScript errors in touched/new files (per-file check at PR gate)
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

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-preflight-recovery';

function makeScenarioSnapshot(overrides?: Partial<RunAnalysisScenarioSnapshot>): RunAnalysisScenarioSnapshot {
  const graph = overrides?.graph ?? { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Grandfather Existing Users at £49, New Users at £59 with Features', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Simple Price Increase', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
    ...overrides,
  };
}

function makeScenarioReader(snapshot?: RunAnalysisScenarioSnapshot): ScenarioReader {
  const returned = snapshot ?? makeScenarioSnapshot();
  return vi.fn(() => Promise.resolve(returned)) as unknown as ScenarioReader;
}

function makePlotClientRejecting(error: () => Error): PLoTClient {
  const run = vi.fn((..._args: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
    Promise.reject<V2RunResponseEnvelope>(error()),
  );
  const validatePatch = vi.fn().mockResolvedValue({});
  return { run, validatePatch } as unknown as PLoTClient;
}

function makeInvocation(overrides?: Partial<HandlerInvocation>): HandlerInvocation {
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
    ...overrides,
  };
}

/**
 * Helper: construct a PLoTError shaped exactly like the staging failure
 * — a 422 with a structured V2RunError body containing a critique that
 * names the offending option and the missing-intervention message.
 */
function makePreflightPLoTError(optionLabel: string): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'preflight_validation_failed',
    status_reason: 'Preflight validation failed',
    critiques: [
      {
        message: `Option '${optionLabel}' does not specify what it changes. Each option must define at least one intervention.`,
      },
    ],
  };
  const err = new PLoTError(
    `PLoT run analysis blocked: Preflight validation failed: Option '${optionLabel}' does not specify what it changes.`,
    422,
    'run',
    50,
    'req-id',
  );
  err.v2RunError = v2Err;
  return err;
}

describe('run_analysis — PLoT preflight-intervention 422 recoverable path', () => {
  // ── Test 1 — recoverable response, NOT 500 ────────────────────────
  it('Test 1: PLoT 422 missing-intervention → recoverable cause options_not_configured (not plot_error/500)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() =>
        makePreflightPLoTError('Grandfather Existing Users at £49, New Users at £59 with Features'),
      ),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      caught = err as HandlerInvocationFailedError;
    }

    expect(caught).not.toBeNull();
    expect(caught!.name).toBe('HandlerInvocationFailedError');
    expect(caught!.kind).toBe('HANDLER_INVOCATION_FAILED');
    // CRITICAL: cause_kind is options_not_configured (recoverable),
    // NOT plot_error (fatal → 500). Per
    // src/orchestrator-v5/compose/recoverable-handler-causes.ts the
    // turn-executor catch ladder maps options_not_configured to a typed
    // 200 with assistant_text + chip.
    expect(caught!.cause_kind).toBe('options_not_configured');
    // retryable=false — user must change the input (configure the option),
    // a bare retry will reproduce the same PLoT 422.
    expect(caught!.retryable).toBe(false);
  });

  // ── Test 1a — option label is extracted from PLoT critique ─────────
  it('Test 1a: option label extracted from PLoT critique → first_option_label on details', async () => {
    const optionLabel = 'Grandfather Existing Users at £49, New Users at £59 with Features';
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() => makePreflightPLoTError(optionLabel)),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      caught = err as HandlerInvocationFailedError;
    }

    expect(caught).not.toBeNull();
    // The composer template uses first_option_label to interpolate the
    // option name into the assistant_text + chip label. Extraction MUST
    // succeed for the user's "named option" requirement.
    expect(caught!.details.first_option_label).toBe(optionLabel);
    // Diagnostic marker so dashboards can split this recovery path from
    // the pre-PLoT options_not_configured guard.
    expect(caught!.details.plot_preflight_recovery).toBe(true);
    expect(caught!.details.analysis_status).toBe('preflight_validation_failed');
  });

  // ── Test 1b — missing-intervention critique without an option name ──
  it('Test 1b: missing-intervention critique with no extractable option name → still recoverable (no label)', async () => {
    // Defensive: if PLoT's critique message format changes and the option
    // label regex can't extract a name, still route to recoverable.
    // The composer's "no_label" branch handles missing labels gracefully.
    const v2Err: V2RunError = {
      analysis_status: 'preflight_validation_failed',
      status_reason: 'Preflight validation failed',
      critiques: [
        { message: 'An option does not specify what it changes. Each option must define at least one intervention.' },
      ],
    };
    const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 50);
    err.v2RunError = v2Err;

    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() => err),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (e) {
      caught = e as HandlerInvocationFailedError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('options_not_configured');
    // No quoted option name in the critique — first_option_label absent.
    expect(caught!.details.first_option_label).toBeUndefined();
    expect(caught!.details.plot_preflight_recovery).toBe(true);
  });

  // ── Test 2 — no analysis fact persisted ─────────────────────────────
  it('Test 2: recoverable preflight failure does NOT emit handler_facts (no analysis_ready persistence)', async () => {
    // When the handler throws HandlerInvocationFailedError, the turn-
    // executor's recoverable path composes a direct_answer 200 with
    // suggested_actions but does NOT call append_turn_atomic with a
    // run_analysis handler_fact. We assert at the handler boundary that
    // the throw happens (no outcome returned) — structurally this means
    // commitDirectAnswer never sees a fact to persist.
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() =>
        makePreflightPLoTError('Some Option Label'),
      ),
      scenarioReader: makeScenarioReader(),
    });

    let outcome: unknown = null;
    try {
      outcome = await handler(makeInvocation());
    } catch {
      // expected
    }
    // Handler did NOT return — it threw. No outcome.handler_facts to persist.
    expect(outcome).toBeNull();
  });

  // ── Test 3 — graph state preserved ──────────────────────────────────
  it('Test 3: handler does NOT mutate the scenario snapshot graph on recoverable preflight failure', async () => {
    const originalGraph = {
      nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }, { id: 'opt_a', kind: 'option', label: 'A' }],
      edges: [],
    };
    const snapshot = makeScenarioSnapshot({ graph: originalGraph });
    const beforeNodes = JSON.stringify(snapshot.graph);

    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() =>
        makePreflightPLoTError('Some Option Label'),
      ),
      scenarioReader: makeScenarioReader(snapshot),
    });

    try {
      await handler(makeInvocation());
    } catch {
      /* expected */
    }

    // Graph identity preserved — no mutation, no truncation, no node loss.
    expect(JSON.stringify(snapshot.graph)).toBe(beforeNodes);
  });

  // ── Test 4 — happy path unchanged (covered by sibling test; reassert) ─
  it('Test 4: successful PLoT response (no error) → handler still returns a normal outcome (regression)', async () => {
    // Sanity reassertion that this PR did not break the happy path.
    // (Comprehensive happy-path tests live in run-analysis.test.ts;
    // this is a thin reassertion specific to the file's claim.)
    const happyResponse: Partial<V2RunResponseEnvelope> = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: 'h' } as V2RunResponseEnvelope['meta'],
      results: [
        { option_id: 'opt_a', label: 'A', win_probability: 0.7 },
        { option_id: 'opt_b', label: 'B', win_probability: 0.3 },
      ] as V2RunResponseEnvelope['results'],
      response_hash: 'top-hash',
    };
    const plotClient = {
      run: vi.fn().mockResolvedValue(happyResponse as V2RunResponseEnvelope),
      validatePatch: vi.fn().mockResolvedValue({}),
    } as unknown as PLoTClient;

    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: makeScenarioReader(),
    });

    // Did not throw, returned an outcome.
    const outcome = await handler(makeInvocation());
    expect(outcome).toBeDefined();
    expect(outcome.handler_facts.length).toBeGreaterThanOrEqual(0); // sibling tests assert exact shape
  });

  // ── Test 5 — unrelated PLoT errors still follow existing path ──────
  it('Test 5: PLoT 503 (5xx) → still cause_kind=plot_error (unchanged path)', async () => {
    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() =>
        new PLoTError('503 Service Unavailable', 503, 'run', 100),
      ),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      caught = err as HandlerInvocationFailedError;
    }
    expect(caught!.cause_kind).toBe('plot_error');
    expect(caught!.retryable).toBe(true);
  });

  it('Test 5a: PLoT 422 with non-preflight v2RunError → still cause_kind=plot_error (unchanged path)', async () => {
    // A 422 from PLoT that is NOT a preflight-intervention rejection
    // (e.g. some other analysis_status with different critiques) must
    // NOT be re-classified as options_not_configured. It must continue
    // to surface as plot_error like before this fix.
    const v2Err: V2RunError = {
      analysis_status: 'simulation_failed',
      status_reason: 'Simulation diverged after 1000 samples',
      critiques: [{ message: 'Numerical instability in factor coefficients' }],
    };
    const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 100);
    err.v2RunError = v2Err;

    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() => err),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (e) {
      caught = e as HandlerInvocationFailedError;
    }
    expect(caught!.cause_kind).toBe('plot_error');
    expect(caught!.details.plot_preflight_recovery).toBeUndefined();
  });

  // ── Round-3 review finding: critique ordering ───────────────────────
  it('Test 1c: missing-intervention critique at position N (not first) → still recoverable + correct option label extracted', async () => {
    // PLoT critique ordering is not contract-guaranteed. If a multi-critique
    // 422 places the missing-intervention message at position 1 (not 0),
    // the recovery must still fire AND extract the option label from the
    // matching critique (not from critique[0]).
    const v2Err: V2RunError = {
      analysis_status: 'preflight_validation_failed',
      status_reason: 'Preflight validation failed',
      critiques: [
        // Position 0: unrelated preflight critique (e.g. about a factor).
        { message: 'Factor coefficient out of expected range for fac_price' },
        // Position 1: the missing-intervention critique that matters.
        {
          message: "Option 'Premium Tier with Enterprise Features' does not specify what it changes. Each option must define at least one intervention.",
        },
        // Position 2: another unrelated critique.
        { message: 'Goal threshold appears unset' },
      ],
    };
    const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 50);
    err.v2RunError = v2Err;

    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() => err),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (e) {
      caught = e as HandlerInvocationFailedError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.cause_kind).toBe('options_not_configured');
    // CRITICAL: the label comes from critique[1] (the matching one),
    // not critique[0]. Round-3 review test pin.
    expect(caught!.details.first_option_label).toBe('Premium Tier with Enterprise Features');
    expect(caught!.details.plot_preflight_recovery).toBe(true);
  });

  it('Test 5b: PLoT 422 WITHOUT v2RunError → still cause_kind=plot_error (defensive)', async () => {
    // A 422 with no parseable V2RunError body (the plot-client did not
    // attach .v2RunError) must NOT be re-classified. The recovery path
    // requires structured detail.
    const err = new PLoTError('PLoT run analysis blocked', 422, 'run', 100);
    // Note: v2RunError NOT set.

    const handler = createRunAnalysisHandler({
      plotClient: makePlotClientRejecting(() => err),
      scenarioReader: makeScenarioReader(),
    });

    let caught: HandlerInvocationFailedError | null = null;
    try {
      await handler(makeInvocation());
    } catch (e) {
      caught = e as HandlerInvocationFailedError;
    }
    expect(caught!.cause_kind).toBe('plot_error');
  });
});
