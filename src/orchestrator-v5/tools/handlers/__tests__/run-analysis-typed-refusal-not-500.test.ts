/**
 * P0 — a TYPED, BLAME-FREE downstream refusal from PLoT is not `INTERNAL_ERROR`.
 *
 * Source: `olumi-docs/PHASE0-EVIDENCE-2026-07-28/analysis-500-diagnosis-2026-08-14/DIAGNOSIS.md`
 * §3 (the seam, byte-verified) and §8 (FIX A/FIX B). Regression Shield arm A
 * `run-2` measured **3 of 12** first-use analyse turns returning HTTP 500
 * `cause_kind: 'plot_error'`; a 4th draw on the same brief class blocked
 * HONESTLY, and that honest block is the reference shape.
 *
 * ─────────────────────────────────────────────────────────────────
 * The seam, as it stood at CEE `41156fc9`
 * ─────────────────────────────────────────────────────────────────
 *   plot-client.ts:768   the typed-failure carve-out that sets `v2RunError`
 *                        fires ONLY when `response.ok` — i.e. only on 200.
 *   plot-client.ts:868   every other non-2xx (incl. 503) → PLoTError with
 *                        `v2RunError` NEVER set.
 *   run-analysis.ts:874  `isTypedFailedEnvelope` excludes status 422 and needs
 *                        `analysis_status === 'failed'`, so a 422 `blocked` AND
 *                        a 503 both fall through to `plot_error`.
 *   route-v2.ts:2526     `handler_failure` → `reply.code(500)`.
 *
 * ─────────────────────────────────────────────────────────────────
 * TWO DISPOSITIONS, TWO DIFFERENT USER QUESTIONS (trap 21)
 * ─────────────────────────────────────────────────────────────────
 * These must NOT share copy and must NOT share a branch, because they answer
 * different questions and a single predicate over both would be one name over
 * two concepts:
 *
 *   **PLoT 503** — "is the engine able to take this analysis right now?"  NO.
 *   Derived at PLoT `a5345a5e`: `resolveAdmissionForPlanning`
 *   (`compute-admission.ts:798`) refuses with `ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE`
 *   after ONE bounded `/health` refresh, and PLoT's own comment states the
 *   intent CEE was losing: *"503 is retryable, and the next request self-heals
 *   as soon as a refresh succeeds"* (`:749-753`). Its sibling is `BREAKER_OPEN`
 *   (`errors.ts:100`). Blame-free, recoverable, model untouched.
 *
 *   **PLoT 422 `blocked`** — "can the engine answer THIS model?"  NO, and here
 *   is what to change. Derived at PLoT `a5345a5e`: every 422 is a
 *   `buildBlockedResponse` (`run.ts:1644-1661`, `analysis_status: 'blocked'`)
 *   carrying `BLOCKER_CODES` critiques (`types/engine-v3.ts:811-838`). An
 *   honest blocked verdict about the user's model — NOT a retry promise.
 *
 * ─────────────────────────────────────────────────────────────────
 * WHY THE COPY MAY NOT BE SHARED WITH THE 429 EITHER
 * ─────────────────────────────────────────────────────────────────
 * The existing `analysis_engine_busy` copy says *"several analyses are running
 * at once"*. That is TRUE of a 429 (a concurrency limiter) and FALSE of a 503:
 * DIAGNOSIS §5.2 measured `A_hiring-3` failing with **nothing concurrent**, and
 * the 503's real trigger is an unreadable `/health` advertisement. Same
 * disposition (recoverable, retry chip), different cause — so the cause_kind is
 * reused and the COPY branches on the carried `downstream_http_status`.
 *
 * ─────────────────────────────────────────────────────────────────
 * HONEST BOUNDS — what must STILL be a visible 500 (trap 22b)
 * ─────────────────────────────────────────────────────────────────
 * DIAGNOSIS §7.1: it is NOT established which disposition caused the three
 * banked 500s. This fix must therefore be correct for BOTH — and must not
 * "close the gap" by inventing the mirror lie that every failure is retryable.
 * Pinned below: a PLoT 200 `failed` envelope, an untyped 422, and a PLoT 500
 * all stay fatal.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import type { V2RunError } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import { isRecoverableHandlerCause } from '../../../compose/recoverable-handler-causes.js';
import { composeHandlerFailureBody } from '../../../compose/handler-failure-responses.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEST_REQUEST_ID = 'req-typed-refusal';

// ---------------------------------------------------------------------------
// Fixtures — the EXACT bytes PLoT emits, derived at PLoT `a5345a5e`
// ---------------------------------------------------------------------------

/**
 * PLoT `run.ts:6061` + `compute-admission.ts:715-719`: HTTP **503**, body is a
 * `buildBlockedResponse` (so `analysis_status: 'blocked'`), `status_reason`
 * `'Analysis engine unavailable'`, one blocker critique whose code is
 * `ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE`.
 *
 * ⚠ TWO THINGS ARE ON THAT BODY AND NEITHER REACHES CEE, which is why the
 * fixture below looks so bare:
 *   - `status_reason: 'Analysis engine unavailable'` and the critique message —
 *     dropped, because plot-client's typed-failure carve-out is gated on
 *     `response.ok` (`:768`) and the non-422 branch reads only `message` +
 *     `retryable` (`:868-883`). That IS the observability defect; the bounded
 *     `downstreamErrorCode` is the narrow repair.
 *   - `retryable: false` (`run.ts:1653`) — PLoT's own defect, contradicting its
 *     documented rationale at `compute-admission.ts:749`. CEE's recoverability
 *     decision must never read it; it reaches only `orchestratorErrorOverride`.
 */
function makeAdmissionUnavailable503(): PLoTError {
  const err = new PLoTError(
    'PLoT run returned 503',
    503,
    'run',
    1464,
    '5518e447-51eb-460b-ad9b-d87aadf7111b',
  );
  // plot-client's non-422 branch does NOT set `v2RunError` (`:868-883`), which
  // is exactly why the handler could not see this was typed. The only signal
  // the client can carry is the bounded error CODE.
  err.downstreamErrorCode = 'ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE';
  return err;
}

/** PLoT `errors.ts:100` — the circuit breaker's 503 `error.v1`, no envelope. */
function makeBreakerOpen503(): PLoTError {
  const err = new PLoTError(
    'Service temporarily unavailable, please try again shortly',
    503,
    'run',
    12,
    'req-breaker',
  );
  err.downstreamErrorCode = 'BREAKER_OPEN';
  return err;
}

/**
 * PLoT `run.ts:5944` — a preflight 422 whose blocker is NOT the
 * missing-intervention one. `NO_PATH_TO_GOAL` is a real `BLOCKER_CODES` member
 * (`types/engine-v3.ts:820`).
 */
function make422Blocked(code: string, message: string, statusReason = 'Preflight validation failed'): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'blocked',
    status_reason: statusReason,
    critiques: [{ code, message }],
  };
  const err = new PLoTError(
    `PLoT run analysis blocked: ${statusReason}: ${message}`,
    422,
    'run',
    1449,
    '4efb59c0-4e5b-4b79-86df-3d48257e8fbb',
  );
  err.v2RunError = v2Err;
  return err;
}

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

// ===========================================================================
// ARM 1 — PLoT 503: the engine cannot take the analysis. Recoverable.
// ===========================================================================

describe('run_analysis — a PLoT 503 is ENGINE-UNAVAILABLE, not INTERNAL_ERROR', () => {
  it('RED-FIRST: the admission-unavailable 503 → analysis_engine_busy, recoverable 200', async () => {
    const input = makeAdmissionUnavailable503();
    // PRECONDITION PIN (trap 13b): assert the fixture really is the wire shape
    // this arm claims to be about — a 503 with NO typed envelope. Without this
    // the assertions below could pass on a fixture that had silently stopped
    // reproducing the seam.
    expect(input.status).toBe(503);
    expect(input.v2RunError).toBeUndefined();
    // And assert the OLD mapping is genuinely not recoverable, so a pass here
    // cannot be the recoverable-set trivially containing everything.
    expect(isRecoverableHandlerCause('plot_error')).toBe(false);

    const caught = await invokeAndCatch(() => input);

    expect(caught.name).toBe('HandlerInvocationFailedError');
    expect(caught.cause_kind).toBe('analysis_engine_busy');
    expect(caught.retryable).toBe(true);
    // The gate that turns this into a 200 rather than a 500.
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // FIX B — the trigger must be nameable from the details, so the NEXT shield
    // run can report the distribution the diagnosis could not.
    expect(caught.details.downstream_http_status).toBe(503);
    expect(caught.details.plot_error_code).toBe('ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE');
  });

  it('RED-FIRST: the BREAKER_OPEN 503 (error.v1, no envelope) → analysis_engine_busy', async () => {
    const input = makeBreakerOpen503();
    expect(input.status).toBe(503);
    expect(input.v2RunError).toBeUndefined();

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('analysis_engine_busy');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // The two 503 dispositions are DISTINGUISHABLE downstream — that is the
    // whole observability point. Same cause, different code.
    expect(caught.details.plot_error_code).toBe('BREAKER_OPEN');
    expect(caught.details.downstream_http_status).toBe(503);
  });

  it('the 503 copy does NOT claim concurrency — the 429 copy would be a false cause (trap 21)', () => {
    const compose = (downstreamStatus: number) =>
      composeHandlerFailureBody(
        new HandlerInvocationFailedError('PLoT returned error', {
          cause_kind: 'analysis_engine_busy',
          retryable: true,
          details: { handler_id: 'run_analysis', downstream_http_status: downstreamStatus },
        }),
      );

    // PRECONDITION PIN (trap 13b): the two branches must be reached with
    // DIFFERENT inputs and must produce DIFFERENT copy. Asserting only the 503
    // string would pass if both branches had been collapsed onto one wording,
    // so assert the DISCRIMINATION itself before asserting either side.
    const busy429 = compose(429);
    const unavailable503 = compose(503);
    expect(unavailable503.body.assistant_text).not.toBe(busy429.body.assistant_text);
    expect(unavailable503.template_id).not.toBe(busy429.template_id);

    // 429 is a concurrency limiter, so naming concurrency is TRUE there.
    expect(busy429.body.assistant_text).toContain('several analyses are running at once');
    // 503 is an admission/breaker state measured with NOTHING concurrent
    // (DIAGNOSIS §5.2), so the concurrency claim would be fabricated.
    expect(unavailable503.body.assistant_text).not.toContain('several analyses are running at once');
    expect(unavailable503.body.assistant_text).not.toContain('at once');
    // Both must still say the true, load-bearing thing: the model is fine.
    expect(busy429.body.assistant_text).toContain('Nothing is wrong with your model');
    expect(unavailable503.body.assistant_text).toContain('Nothing is wrong with your model');
    // Both offer a retry — the DISPOSITION is shared, only the cause differs.
    expect(unavailable503.chip_type).toBe('action');
    expect(busy429.chip_type).toBe('action');
  });
});

// ===========================================================================
// ARM 2 — PLoT 422 `blocked`: an honest verdict about the user's model.
// ===========================================================================

describe('run_analysis — a PLoT 422 `blocked` is an HONEST REFUSAL, not INTERNAL_ERROR', () => {
  /**
   * ⭐⭐ THE MEASURED TRIGGER. Settled at the Render logs on 2026-08-14
   * (`TRIGGER-SETTLED-LANE-F2.md`), which the diagnosis could not do — it was
   * credential-blocked and correctly said so (§7.1).
   *
   * All THREE banked 500s logged CEE `plot-client.ts:851` ("PLoT run 422 —
   * V2RunError", `status: 422`, `analysis_status: 'blocked'`), and PLoT logged
   * `event: 'duplicate_edge_conflict'` immediately before each — one directed
   * edge pair, `count: 2`, divergent on `strength.mean` + `strength.std`. So the
   * diagnosis's LEADING hypothesis (T1, a 503) is refuted and its disfavoured
   * one (T2) is confirmed 3/3, sharing one trigger.
   *
   * The fixture below is that shape, built from PLoT's send site at
   * `run.ts:6832-6839` — not from this lane's imagination (trap 16: a fixture you
   * wrote yourself is not evidence about the wire; this one is transcribed from
   * the producer's bytes and cross-checked against the logged conflict).
   */
  function makeMeasuredDuplicateEdge422(): PLoTError {
    return make422Blocked(
      'DUPLICATE_EDGE_CONFLICT',
      'Edges sha8:c1f82a62 -> sha8:12984236 (directed) appear 2 times with different values '
        + '(strength.mean, strength.std). Keep one edge per relationship, or merge the beliefs into a single edge.',
      'Conflicting duplicate edges',
    );
  }

  it('⭐ RED-FIRST, THE MEASURED CASE: the duplicate-edge 422 that 500d 3/12 on staging → analysis_blocked 200', async () => {
    const input = makeMeasuredDuplicateEdge422();
    // PRECONDITION PINS (trap 13b) — assert this fixture reproduces the SETTLED
    // wire shape, so a pass here is about the measured defect and not about some
    // adjacent 422 the fixture drifted into.
    expect(input.status).toBe(422);
    expect(input.v2RunError?.analysis_status).toBe('blocked');
    expect(input.v2RunError?.status_reason).toBe('Conflicting duplicate edges');
    expect(input.v2RunError?.critiques?.[0]?.code).toBe('DUPLICATE_EDGE_CONFLICT');

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('analysis_blocked');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    expect(caught.details.plot_primary_code).toBe('DUPLICATE_EDGE_CONFLICT');
    // CEE already HELD the right sentence for this code and threw it away with
    // the 500 (`handler-failure-responses.ts:421`). Assert it now ships, and
    // assert it by TEMPLATE ID as well as prose, so the binding survives a copy
    // edit (trap 19 — bind by identity, not by a value another branch matches).
    const composed = composeHandlerFailureBody(caught);
    expect(composed.template_id).toBe('analysis_blocked_duplicate_edge_conflict');
    expect(composed.body.assistant_text).toContain('Two connections in your model conflict');
    // A bare re-run reproduces the verdict byte for byte, so this must NOT be a
    // retry action — the honest chip asks the user to look at the model.
    expect(composed.chip_type).toBe('text_prompt');
    expect(caught.retryable).toBe(false);
    // The code IS known to CEE, so the unknown-code tripwire must stay quiet.
    expect(caught.details.plot_blocker_code_known).toBe(true);
  });

  it('RED-FIRST: a 422 blocked on NO_PATH_TO_GOAL → analysis_blocked, recoverable 200', async () => {
    const input = make422Blocked(
      'NO_PATH_TO_GOAL',
      "Option 'Hire two seniors' has no causal path to the goal.",
    );
    // PRECONDITION PINS (trap 13b) — this arm is about the GENERIC blocked
    // path, so prove the fixture does not qualify for the pre-existing
    // missing-intervention carve-out, and that it IS a typed blocked envelope.
    expect(input.status).toBe(422);
    expect(input.v2RunError?.analysis_status).toBe('blocked');
    expect(input.v2RunError?.critiques?.[0]?.code).not.toBe('EMPTY_INTERVENTIONS');
    expect(input.v2RunError?.critiques?.[0]?.message).not.toContain(
      'does not specify what it changes',
    );

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('analysis_blocked');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // The blocker code reaches the details, so the refusal is attributable.
    expect(caught.details.plot_primary_code).toBe('NO_PATH_TO_GOAL');
    expect(caught.details.downstream_http_status).toBe(422);
  });

  it('RED-FIRST: EMPTY_INTERVENTIONS is matched by CODE, so a PLoT REWORD cannot break it', async () => {
    // DIAGNOSIS §4: the existing recovery gate substring-matches PLoT's ENGLISH
    // PROSE, and exactly one blocker code of ~26 reaches the honest path that
    // way. This fixture keeps the real CODE but reworded prose and a reworded
    // `status_reason` — i.e. the shape a PLoT copy edit produces. Under the
    // prose-only gate it lands on `plot_error` → 500.
    const input = make422Blocked(
      'EMPTY_INTERVENTIONS',
      "Option 'Hire two seniors' has no interventions set.",
      'Model readiness check failed',
    );
    // PRECONDITION PIN: prove NEITHER prose gate can fire, so a pass here is
    // the CODE keying's doing and not the old path's.
    expect(input.v2RunError?.status_reason?.toLowerCase()).not.toContain('preflight validation');
    expect(input.v2RunError?.analysis_status).not.toBe('preflight_validation_failed');
    expect(input.v2RunError?.critiques?.[0]?.message?.toLowerCase()).not.toContain(
      'does not specify what it changes',
    );
    expect(input.v2RunError?.critiques?.[0]?.message?.toLowerCase()).not.toContain(
      'must define at least one intervention',
    );

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('options_not_configured');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // The option label still reaches the composer, so the chip stays specific.
    expect(caught.details.first_option_label).toBe('Hire two seniors');
  });

  it('the pre-existing PROSE path still works — the code keying ADDS, it does not replace', async () => {
    // Trap 12d: deriving a guard from a code list moves the risk onto the list.
    // Both gates are kept so a code PLoT renames still lands honestly via prose,
    // and reworded prose still lands honestly via the code. Neither is
    // load-bearing alone; this pin is the prose half.
    const input = make422Blocked(
      'SOME_FUTURE_RENAMED_CODE',
      "Option 'Keep hiring frozen' does not specify what it changes. Each option must define at least one intervention.",
      'Preflight validation failed',
    );
    expect(input.v2RunError?.critiques?.[0]?.code).not.toBe('EMPTY_INTERVENTIONS');

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('options_not_configured');
    expect(caught.details.first_option_label).toBe('Keep hiring frozen');
  });
});

// ===========================================================================
// ARM 3 — THE HONEST BOUNDS. These must STILL be visible 500s.
// ===========================================================================

describe('run_analysis — genuine breakage stays a VISIBLE 500 (the mirror lie is not shipped)', () => {
  it('SECOND ARM: a PLoT 200 `failed` envelope stays analysis_failed (fatal)', async () => {
    const caught = await invokeAndCatch(() => {
      const v2Err: V2RunError = {
        analysis_status: 'failed',
        status_reason: 'The analysis service returned an error (HTTP 500).',
        critiques: [{ code: 'ISL_ERROR', message: 'The analysis service returned an error (HTTP 500).' }],
      };
      const err = new PLoTError('PLoT run analysis failed', 200, 'run', 120, 'req-fatal');
      err.v2RunError = v2Err;
      return err;
    });

    expect(caught.cause_kind).toBe('analysis_failed');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
    // The ISL status is the one carried here — NOT PLoT's own 200.
    expect(caught.details.downstream_http_status).toBe(500);
  });

  it('SECOND ARM: a 422 with NO typed envelope stays plot_error (fatal) — not every 422 recovers', async () => {
    // plot-client `:864` only attaches `v2RunError` when the body parsed. A 422
    // with an unparseable body is NOT a typed refusal and must not be dressed
    // as one — that would be the mirror lie (trap 22b).
    const input = new PLoTError('PLoT run analysis blocked: Unknown analysis error', 422, 'run', 30, 'req-untyped');
    expect(input.v2RunError).toBeUndefined();

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('plot_error');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
  });

  it('SECOND ARM: a PLoT 500 stays plot_error (fatal) — 503 recovering does not mean 5xx recovers', async () => {
    const caught = await invokeAndCatch(
      () => new PLoTError('PLoT run returned 500', 500, 'run', 40, 'req-plot-500'),
    );

    expect(caught.cause_kind).toBe('plot_error');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
    // FIX B — but it is now ATTRIBUTABLE: the status reaches the details.
    expect(caught.details.downstream_http_status).toBe(500);
  });

  it('SECOND ARM: a 422 `failed` (not blocked) envelope stays fatal', async () => {
    // `blocked` is the only typed 422 disposition PLoT documents as an honest
    // verdict (`run.ts:1651`). A 422 claiming `failed` is off-contract and must
    // not be recovered.
    const input = make422Blocked('ISL_ERROR', 'engine error');
    (input.v2RunError as { analysis_status: string }).analysis_status = 'failed';
    expect(input.v2RunError?.analysis_status).toBe('failed');

    const caught = await invokeAndCatch(() => input);

    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
  });

  it('SECOND ARM: a 422 blocked carrying an INTERNAL-failure code stays plot_error (fatal)', async () => {
    // PLoT's own internal error is genuinely OUR breakage. Recovering it as "your
    // model is blocked" would blame the user for our failure — the precise
    // misattribution PLoT itself refuses when it picks 503 over 422
    // (`compute-admission.ts:745-751`). Off-contract by construction (PLoT's
    // outer catch returns 200 `failed`, DIAGNOSIS §9 premise 2), pinned anyway.
    const input = make422Blocked('PLOT_INTERNAL_ERROR', 'unhandled exception in run');
    // PRECONDITION PIN: this IS a typed blocked 422 — i.e. it satisfies every
    // condition of the recovering branch and is held back ONLY by its code. That
    // is what makes this a discrimination rather than a coincidence.
    expect(input.status).toBe(422);
    expect(input.v2RunError?.analysis_status).toBe('blocked');

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('plot_error');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(false);
  });

  it('TRIPWIRE: a blocked code CEE has no copy for still recovers, and is FLAGGED', async () => {
    // "Unknown codes fail VISIBLE" — visible in telemetry and on the wire, NOT a
    // 500 for the user. A 500 on a verdict PLoT deliberately typed is the
    // confident wrongness this P0 is, and would re-open it for the next code PLoT
    // adds. `DUPLICATE_EDGE_CONFLICT` was itself absent from PLoT's canonical
    // `BLOCKER_CODES`, so "the next unlisted code" is not hypothetical — it is
    // what happened.
    const input = make422Blocked('SOME_BLOCKER_CEE_HAS_NEVER_SEEN', 'a new PLoT blocker');

    const caught = await invokeAndCatch(() => input);

    expect(caught.cause_kind).toBe('analysis_blocked');
    expect(isRecoverableHandlerCause(caught.cause_kind)).toBe(true);
    // The tripwire — and it must DISCRIMINATE, so assert both polarities against
    // the known-code case above rather than only this one (trap 13b).
    expect(caught.details.plot_blocker_code_known).toBe(false);
    // Generic copy, honestly generic — no invented specifics.
    const composed = composeHandlerFailureBody(caught);
    expect(composed.template_id).toBe('analysis_blocked');
  });

  it('OBSERVABILITY: an unknown non-2xx carries its status so the trigger is nameable', async () => {
    // DIAGNOSIS §3's observability defect: the handler assembled the diagnostic
    // and the wire discarded it, which is the single reason the trigger could
    // not be named. Every fatal PLoT status is now attributable.
    const caught = await invokeAndCatch(
      () => new PLoTError('PLoT run returned 502', 502, 'run', 15, 'req-502'),
    );

    expect(caught.cause_kind).toBe('plot_error');
    expect(caught.details.downstream_http_status).toBe(502);
  });
});
