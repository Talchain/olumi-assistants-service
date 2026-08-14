/**
 * P0 (analysis-500 diagnosis §8, 2026-08-14) — the OUTCOME-LEVEL pins.
 *
 * `run-analysis-typed-refusal-not-500.test.ts` pins the handler's `cause_kind`.
 * That is necessary and NOT sufficient: `cause_kind` is an internal tag, and what
 * the user gets is decided one layer out, by the chip dispatcher's outcome and
 * route-v2's mapping of it. A cause on `RECOVERABLE_HANDLER_CAUSES` with no
 * composer branch still produces `template_id: 'fallback'` and is deliberately
 * failed loud back to a 500 — so "the cause is recoverable" does not entail "the
 * user gets a 200". These pins assert the outcome the user actually receives.
 *
 * The spec's RED-first pin, verbatim: *feed the handler a `PLoTError(status 503)`
 * with no `v2RunError` → assert `outcome: handler_recovered`, 200, retry chip.*
 *
 * ─────────────────────────────────────────────────────────────────
 * FIX B and the guard that had to change
 * ─────────────────────────────────────────────────────────────────
 * §8 FIX B specifies: *"a 500 produced by a `PLoTError(status 503)` carries
 * `downstream_http_status: 503`"*. **That guard is unsatisfiable after FIX A, by
 * construction** — a 503 no longer produces a 500, which is the entire point of
 * FIX A. Its INTENT (a fatal PLoT failure must be attributable on the wire, bound
 * by identity rather than by a value another disposition could satisfy — trap 19)
 * is preserved, on a shape that genuinely still 500s: a PLoT **502**. The 503's
 * status is asserted too, on its own recovered path where it now lives.
 *
 * ⚠ A stale guard kept for its literal wording would have been the worse
 * outcome: it can only pass if the P0 is still present.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { setTestSink, log } from '../../../utils/telemetry.js';
import { isRecoverableHandlerCause } from '../../compose/recoverable-handler-causes.js';

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
      request_id: 'req-p0',
      budgets: {
        turn_ms: 30000,
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
import { createRegistry, type HandlerRegistry } from '../../tools/registry.js';
import type { RunAnalysisScenarioSnapshot, ScenarioReader } from '../../tools/handlers/run-analysis.js';
import type { PLoTClient, PLoTClientRunOpts, V2RunError } from '../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';

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

/** A CONFIGURED snapshot — the pre-PLoT guard must not fire, so PLoT is reached. */
function configuredSnapshot(): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function realRegistryRejecting(error: () => Error): HandlerRegistry {
  const run = vi.fn((..._args: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
    Promise.reject<V2RunResponseEnvelope>(error()),
  );
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = configuredSnapshot();
  const reader = (() => Promise.resolve(snapshot)) as unknown as ScenarioReader;
  return createRegistry({ scenarioReader: reader, plotClient });
}

beforeEach(() => {
  setTestSink(() => {});
  vi.spyOn(log, 'warn').mockImplementation(() => {});
  vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('chip-click run_analysis — a PLoT 503 reaches the USER as a 200, not a 500', () => {
  it("SPEC PIN: PLoTError(503) with no v2RunError → handler_recovered + retry chip", async () => {
    // PRECONDITION PIN (trap 13b): the input is exactly the spec's shape. Built
    // here rather than borrowed, and asserted, so a fixture drift cannot turn
    // this into a test about some other disposition.
    const input = new PLoTError('PLoT run returned 503', 503, 'run', 1464, 'req-503');
    expect(input.status).toBe(503);
    expect(input.v2RunError).toBeUndefined();

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-503',
      handlerRegistry: realRegistryRejecting(() => input),
    });

    // THE assertion. `handler_failure` is what route-v2 maps to 500
    // (`route-v2.ts:2536`); `handler_recovered` is what it maps to
    // `sendFinalised200` (`:2504`). This is the 500-vs-200 fork itself.
    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome !== 'handler_recovered') throw new Error('unreachable');

    expect(out.causeKind).toBe('analysis_engine_busy');
    expect(isRecoverableHandlerCause('analysis_engine_busy')).toBe(true);

    // A RETRY chip, and bound by its ACTION TYPE, not by its label — a retry
    // whose chip cannot re-run the analysis is not a retry (trap 19).
    const retry = out.response.suggested_actions.find((a) => a.action_type === 'run_analysis');
    expect(retry).toBeDefined();
    expect(retry?.id).toBe('chip_action_retry_analysis');

    // A clean graceful body, not an error envelope.
    expect(out.response.blocks).toEqual([]);
    expect(out.commitPerformed).toBe(false);
    const serialised = JSON.stringify(out.response);
    expect(serialised).not.toContain('INTERNAL_ERROR');
    expect(serialised).not.toContain('BoundaryError');
    // No internal token leaks into user-facing prose.
    expect(out.response.assistant_text).not.toContain('analysis_engine_busy');
    expect(out.response.assistant_text).not.toContain('503');

    // ROADMAP 2.1085 — the typed readiness state must be present, or no consumer
    // can act on the refusal (the defect that shipped a 200 with no
    // `analysis_ready` key at all).
    expect(out.analysisReady).toBeDefined();
    expect(out.analysisReady.status).toBe('blocked');
  });

  it('⭐ MEASURED CASE: the duplicate-edge 422 that 500d 3/12 → handler_recovered', async () => {
    // The trigger settled at the Render logs, 2026-08-14
    // (`TRIGGER-SETTLED-LANE-F2.md`): all three banked 500s were PLoT 422
    // `blocked` / `DUPLICATE_EDGE_CONFLICT`. This is the acceptance condition at
    // the outcome layer — the shape that produced HTTP 500 on staging must now
    // produce a typed 200 with an honest blocked verdict.
    const v2Err: V2RunError = {
      analysis_status: 'blocked',
      status_reason: 'Conflicting duplicate edges',
      critiques: [
        {
          code: 'DUPLICATE_EDGE_CONFLICT',
          message:
            'Edges sha8:c1f82a62 -> sha8:12984236 (directed) appear 2 times with different values '
            + '(strength.mean, strength.std). Keep one edge per relationship, or merge the beliefs into a single edge.',
        },
      ],
    };
    const input = new PLoTError(
      'PLoT run analysis blocked: Conflicting duplicate edges',
      422,
      'run',
      95,
      '5518e447-51eb-460b-ad9b-d87aadf7111b',
    );
    input.v2RunError = v2Err;

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: '5518e447-51eb-460b-ad9b-d87aadf7111b',
      handlerRegistry: realRegistryRejecting(() => input),
    });

    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome !== 'handler_recovered') throw new Error('unreachable');
    expect(out.causeKind).toBe('analysis_blocked');

    // The acceptance condition is a DISJUNCTION and this is its second arm: an
    // honest typed refusal carrying a SPECIFIC reason (REPRODUCTION-NOTE.md).
    // A 200 that had lost `analysis_ready` would satisfy "not a 500" and still
    // be the defect ROADMAP 2.1085 closed.
    expect(out.analysisReady).toBeDefined();
    expect(out.analysisReady.status).toBe('blocked');
    expect(typeof out.analysisReady.blocked_reason).toBe('string');
    expect((out.analysisReady.blocked_reason ?? '').length).toBeGreaterThan(0);

    // CEE already held the right sentence for this code and the 500 discarded it.
    expect(out.response.assistant_text).toContain('Two connections in your model conflict');
    expect(JSON.stringify(out.response)).not.toContain('INTERNAL_ERROR');
    // PLoT's raw prose (which interpolates node ids) must never be rendered.
    expect(out.response.assistant_text).not.toContain('sha8:');
  });
});

describe('chip-click run_analysis — FIX B: a fatal PLoT failure is ATTRIBUTABLE on the wire', () => {
  it('a still-fatal PLoT 502 carries downstream_http_status on the failure diagnostics', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-502',
      handlerRegistry: realRegistryRejecting(
        () => new PLoTError('PLoT run returned 502', 502, 'run', 15, 'req-502'),
      ),
    });

    // PRECONDITION PIN: this arm is only meaningful if the shape is STILL fatal —
    // otherwise it would be asserting diagnostics on a path that no longer 500s
    // (the trap the literal FIX B guard fell into).
    expect(out.outcome).toBe('handler_failure');
    if (out.outcome !== 'handler_failure') throw new Error('unreachable');
    expect(out.causeKind).toBe('plot_error');

    // The diagnostic that `route-v2.ts` used to discard. Bound to the identifying
    // VALUE, so a different disposition could not satisfy it (trap 19).
    expect(out.diagnostics).toBeDefined();
    expect(out.diagnostics?.downstream_http_status).toBe(502);
    expect(out.diagnostics?.handler_id).toBe('run_analysis');
  });

  it('the diagnostics allowlist EXCLUDES prose and user content, even when details carry it', async () => {
    // The handler's `details` carry PLoT-authored prose that interpolates the
    // user's own option labels (`preflight-v2.ts:191`). An error body reaches
    // logs and clients, so the projection must drop those keys — and this must be
    // asserted with a payload that ACTUALLY CONTAINS them, or it proves nothing
    // (trap 13: an absence assertion needs a demonstrable presence).
    const v2Err: V2RunError = {
      analysis_status: 'failed',
      status_reason: "Option 'Acquire Northwind Ltd for £4.2m' could not be priced",
      critiques: [
        {
          code: 'ISL_REJECTED',
          message: "Option 'Acquire Northwind Ltd for £4.2m' was rejected",
          user_message: "We could not analyse 'Acquire Northwind Ltd for £4.2m'",
        },
      ],
    };
    const input = new PLoTError('PLoT run analysis failed', 200, 'run', 90, 'req-prose');
    input.v2RunError = v2Err;

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-prose',
      handlerRegistry: realRegistryRejecting(() => input),
    });

    expect(out.outcome).toBe('handler_failure');
    if (out.outcome !== 'handler_failure') throw new Error('unreachable');

    // POSITIVE CONTROL: the projection is not simply empty — the bounded code
    // came through. Without this the absence assertions below would pass on a
    // function that returned nothing at all.
    expect(out.diagnostics?.plot_primary_code).toBe('ISL_REJECTED');

    // And the prose did NOT.
    const serialised = JSON.stringify(out.diagnostics ?? {});
    expect(serialised).not.toContain('Northwind');
    expect(serialised).not.toContain('£4.2m');
    expect(out.diagnostics?.plot_status_reason).toBeUndefined();
    expect(out.diagnostics?.plot_user_message).toBeUndefined();
    expect(out.diagnostics?.first_option_label).toBeUndefined();
  });
});
