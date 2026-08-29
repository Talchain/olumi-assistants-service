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
const { budgetHolder, commitDirectAnswerMock, priorPendingsMock } = vi.hoisted(() => ({
  budgetHolder: { turnMs: 30000 },
  commitDirectAnswerMock: vi.fn(),
  // ROUND 2 — the recovered commit now reads the prior turn's pendings before
  // it writes, so this must be stubbed or every commit in this file fails
  // closed against an absent Supabase store.
  priorPendingsMock: vi.fn(),
}));

vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return { ...actual, commitDirectAnswer: commitDirectAnswerMock };
});

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
    loadMostRecentPendingActionsIntegrityStrict: priorPendingsMock,
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
  priorPendingsMock.mockReset();
  priorPendingsMock.mockResolvedValue([]);
  commitDirectAnswerMock.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-refusal',
    graphPersisted: false,
  });
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

    // ⚠ CONTRACT CHANGED — ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2. This
    // assertion read `expect(out.analysisReady).toBeUndefined()` and it was
    // PINNING THE DEFECT: on staging (2026-08-13) the post-add-option analyse
    // chip therefore shipped a 200 with no `analysis_ready` key at all, so the
    // run was neither admitted nor typed-blocked and no consumer could act on
    // it. The recovered outcome now carries the TYPED REFUSAL. Corrected at
    // source rather than absorbed into a baseline.
    expect(out.analysisReady).toBeDefined();
    expect(out.analysisReady.status).toBe('blocked');
    expect(out.analysisReady.blocked_reason).toBe('options_not_configured');
    // ⚠⚠ CONTRACT CHANGED AGAIN — ROADMAP 2.1353, and this assertion was PINNING
    // THE DEFECT exactly as its neighbour above once did. It read
    //   `// Still no commit and still no graph mutation — that half is unchanged.`
    //   `expect(out.commitPerformed).toBe(false);`
    // and it was pinning the SECOND half of a conflation: ONE predicate
    // (`isAnalysisRefusalContinuityCause`) decided both "does this refusal
    // acquire durable analysis-refusal continuity?" and "should this TURN be
    // written to conversation history?" — two different questions (CLAUDE.md
    // trap 21). So 7 of the 9 RECOVERABLE_HANDLER_CAUSES answered the user and
    // left NO TURN ROW, `options_not_configured` among them — whose copy is
    // "Tell me what {option} changes and I'll write it into the model", the
    // deployed post-add-option case. It solicits a reply and recorded nothing.
    // The turn row is now written for every recovered cause; the refusal FACT
    // still rides only on a continuity cause (asserted below). Corrected at
    // source rather than absorbed into a baseline.
    expect(out.commitPerformed).toBe(true);
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
    // No recovery side effects on the aborted path — parity with TurnExecutor's
    // no-recovery-side-effects contract: the helper returns BEFORE composing a
    // body or emitting recovery telemetry. Pins against a future regression that
    // moves the emit ahead of the abort gate.
    expect(events.find((e) => e.event === 'v5.recovery_response')).toBeUndefined();
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

// ══════════════════════════════════════════════════════════════════════════
// ⭐⭐ ROADMAP 2.1353 — THE PRODUCT ASKS A QUESTION AND DOES NOT REMEMBER
// ASKING IT (the sixth exit, on a different mechanism from the other five).
//
// ROADMAP 2.1352 (CEE #1213) fixed one instance of this class at a route-level
// `sendFinalised200` exit; that lane enumerated all 23 such exits and found its
// instance was one of six. Four of the others are route-level and are pinned in
// `tests/integration/orchestrator/route-v2-*-persists-question.test.ts`. THIS
// one is different: the chip-click path DOES reach `commitDirectAnswer` — it
// was simply gated on a predicate that answers a different question.
//
//   Q1  "Does this refusal acquire ANALYSIS-REFUSAL CONTINUITY?" — a durable
//       non-result `run_analysis` fact, so the freshness/canonical selectors
//       carry the refused attempt forward. Correctly narrow: only a
//       science/readiness refusal is evidence about the MODEL.
//   Q2  "Should this TURN be written to conversation history?" — true of EVERY
//       turn that produced a user-visible answer.
//
// `isAnalysisRefusalContinuityCause` answered both, so 7 of the 9 recoverable
// causes shipped HTTP 200 with a composed reply and no row. The user-visible
// one is `options_not_configured`, whose copy is ask-shaped.
//
// ⚠ ASSERTING THE WRITE, NOT THE RESPONSE. Every case below reads
// `commitDirectAnswerMock`'s ARGUMENT. The suite above asserts the response
// body and `commitPerformed`, and `commitPerformed` is precisely the field the
// conflation made untrustworthy — so a response-shaped or flag-shaped assertion
// could not have seen this.
// ══════════════════════════════════════════════════════════════════════════
describe('chip-click run_analysis — a recovered turn must be REMEMBERED (2.1353)', () => {
  // ⚠ THE FILE-LEVEL `beforeEach` SETS THIS MOCK'S RESOLUTION BUT NEVER CLEARS
  // ITS CALL LOG, and the RED-first run caught the consequence in this very
  // block: `WRITES A TURN ROW` read `expected 2 to be 1`, and the
  // no-refusal-fact case read a fact that belonged to a PREVIOUS test's commit.
  // Call-count and first-call assertions across a shared spy are worthless
  // without this — the numbers were about the file, not the case.
  beforeEach(() => {
    commitDirectAnswerMock.mockClear();
  });

  /** The single metadata object handed to `commitDirectAnswer`, if any. */
  function commitMetadata(): Record<string, unknown> | undefined {
    expect(
      commitDirectAnswerMock.mock.calls.length,
      'exactly one commit is expected on this turn; a different count means the assertion below ' +
        'would be reading some other call',
    ).toBe(1);
    const call = commitDirectAnswerMock.mock.calls[0] as unknown[] | undefined;
    return call?.[1] as Record<string, unknown> | undefined;
  }

  it('options_not_configured (the deployed post-add-option ask) WRITES A TURN ROW', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-onc',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    expect(out.outcome).toBe('handler_recovered');
    expect(
      commitDirectAnswerMock.mock.calls.length,
      'the reply says "Tell me what {option} changes and I\'ll write it into the model" and then ' +
        'recorded nothing — so the answer arrives at a model with no memory of the request',
    ).toBe(1);
  });

  it("the written row carries the user's message, so the next turn can project it", async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-msg',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    const meta = commitMetadata();
    expect(meta, 'no commit at all — see the previous case').toBeDefined();
    expect(meta!.scenario_id).toBe(SCENARIO_ID);
    expect(meta!.turn_id).toBe(TURN_ID);
    // ⚠ `userMessage` is the WRITE OBJECT's field; `user_message` is the COLUMN
    // the store maps it to. Asserting the column name here manufactures a false
    // RED against correct code.
    expect(meta!.userMessage).toBe('Run the analysis.');
  });

  // ─── THE DISCRIMINATION: the two questions stay apart ────────────────────
  // The fix must NOT be "widen the continuity set". A refusal fact is durable
  // evidence that the MODEL was refused, and writing one for an args failure or
  // an engine-busy retry would corrupt the freshness selectors that read it.
  it('a NON-continuity recovered cause commits the turn but writes NO refusal fact', async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-nofact',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    const meta = commitMetadata();
    expect(meta, 'no commit at all').toBeDefined();
    expect(
      meta!.handler_facts,
      'options_not_configured is not a science/readiness refusal — a durable refusal fact here ' +
        'would be evidence about the model that the model never produced',
    ).toEqual([]);
  });

  it('OPPOSITE DIRECTION — a CONTINUITY cause still writes its refusal fact (unchanged)', async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-fact',
      handlerRegistry: registryThrowing('analysis_not_ready'),
    });
    const meta = commitMetadata();
    expect(meta, 'no commit at all').toBeDefined();
    const facts = meta!.handler_facts as ReadonlyArray<Record<string, unknown>>;
    expect(
      facts.length,
      'analysis_not_ready IS a science/readiness refusal and its continuity marker must survive ' +
        'this change untouched',
    ).toBe(1);
    expect(facts[0]!.fact_type).toBe('run_analysis');
    expect(
      ((facts[0]!.result as Record<string, unknown>).enrichment as Record<string, unknown>)
        .analysis_status,
    ).toBe('refused');
  });

  // ─── EVERY RECOVERED CAUSE, not just the one that motivated the row ──────
  it('EVERY RECOVERABLE_HANDLER_CAUSES cause now leaves a turn row (7 of 9 previously did not)', async () => {
    for (const cause of RECOVERABLE_HANDLER_CAUSES) {
      commitDirectAnswerMock.mockClear();
      const out = await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-2-1353-${cause}`,
        handlerRegistry: registryThrowing(cause),
      });
      expect(out.outcome, `${cause} should still map to handler_recovered`).toBe(
        'handler_recovered',
      );
      expect(
        commitDirectAnswerMock.mock.calls.length,
        `${cause} produced a user-visible answer and left no trace of the turn`,
      ).toBe(1);
    }
  });

  // ─── THE FAILURE MODE, in BOTH directions ───────────────────────────────
  // A failed commit must not convert a working 200 into a 500 for a cause that
  // only loses this turn's memory — but it must STILL escalate for a continuity
  // cause, where the loss is durable evidence the freshness selectors depend on.
  it('a commit FAILURE on a non-continuity cause degrades gracefully (still a 200-shaped recovery)', async () => {
    commitDirectAnswerMock.mockRejectedValueOnce(new Error('commit exploded'));
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-failsoft',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    expect(
      out.outcome,
      'losing this question’s memory is strictly less than the user loses today — a memory fix ' +
        'must not become capable of BREAKING a turn that works',
    ).toBe('handler_recovered');
    if (out.outcome !== 'handler_recovered') throw new Error('unreachable');
    expect(out.commitPerformed).toBe(false);
  });

  it('OPPOSITE DIRECTION — a commit FAILURE on a CONTINUITY cause still escalates to commit_failed', async () => {
    commitDirectAnswerMock.mockRejectedValueOnce(new Error('commit exploded'));
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-2-1353-failhard',
      handlerRegistry: registryThrowing('analysis_not_ready'),
    });
    expect(
      out.outcome,
      'a failed commit on a continuity refusal loses DURABLE EVIDENCE the freshness selectors ' +
        'depend on, and that escalation must survive this change',
    ).toBe('commit_failed');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ⭐⭐ ROUND 2 — THE REGRESSION 2.1353 WOULD OTHERWISE HAVE INTRODUCED.
//
// Committing these turns is only HALF a fix. `commit.ts` reads
// `metadata.priorPendingActions ?? []` (:1116/:1164) and writes the carry-
// forward result into the NEW row's `pending_actions` (:1377); the store then
// reads the NEWEST ROW ONLY (`supabase-store.ts` :2272-2277, `.limit(1)`).
//
// So a commit that threads no priors does not merely "carry nothing" — it
// lands an authoritative row with an EMPTY pendings list and the user's live
// consent hold is gone, with no lapse notice (that notice is built by the
// carry-forward pass, which never ran). Before 2.1353 these seven causes wrote
// NO ROW AT ALL, so the hold survived on the previous row: the memory fix
// would have made them strictly WORSE, inverting this lane's own ordering —
// LOSING THE USER'S PROPOSAL ≫ LOSING THE MEMORY.
//
// ⚠ EVERY CASE BINDS BY IDENTITY (the hold's `id`), never by list length: a
// length assertion would pass on a carried list containing some OTHER pending.
// ══════════════════════════════════════════════════════════════════════════
describe('chip-click run_analysis — a recovered turn must not WIPE a live hold (2.1353 round 2)', () => {
  const HOLD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  /** A live consent hold sitting on the prior turn's authoritative row. */
  function livePriorHold() {
    return {
      id: HOLD_ID,
      scenario_id: SCENARIO_ID,
      chip_id: 'chip-apply-proposed',
      action: {
        kind: 'apply_proposed_change',
        proposal_ref: 'prop-1',
        public_label: 'Raise price to 1.2',
      },
      preconditions: { graph_hash: 'h-prior' },
      expires_at_turn_count: 3,
      expires_at_iso: new Date(Date.now() + 3_600_000).toISOString(),
      emitted_at_iso: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    commitDirectAnswerMock.mockClear();
    priorPendingsMock.mockReset();
    priorPendingsMock.mockResolvedValue([livePriorHold()]);
  });

  function soleCommitMetadata(): Record<string, unknown> {
    expect(
      commitDirectAnswerMock.mock.calls.length,
      'exactly one commit is expected on this turn',
    ).toBe(1);
    return (commitDirectAnswerMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
  }

  it('RED-FIRST: a NON-continuity recovered cause threads the live hold through the commit, so the new newest row cannot wipe it', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-r2-onc-priors',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    expect(out.outcome).toBe('handler_recovered');

    // PRECONDITION PINNED IN-TEST: the read this turn depends on actually
    // returned a hold. Without this the assertion below could pass vacuously
    // against a stub that silently stopped returning anything.
    expect(priorPendingsMock.mock.calls.length, 'the prior-pending read must have run').toBe(1);

    const meta = soleCommitMetadata();
    const priors = meta.priorPendingActions as Array<{ id?: string }> | undefined;
    expect(
      priors,
      'no priors threaded ⟹ commit.ts carries forward [] ⟹ the newest row lands with an EMPTY ' +
        'pendings list and the live hold is silently gone',
    ).toBeDefined();
    expect((priors ?? []).map((p) => p.id)).toContain(HOLD_ID);
  });

  it('OPPOSITE DIRECTION — a CONTINUITY cause threads the same hold (the split is about the FACT, never about the priors)', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-r2-continuity-priors',
      handlerRegistry: registryThrowing('analysis_not_ready'),
    });
    expect(out.outcome).toBe('handler_recovered');
    const meta = soleCommitMetadata();
    expect((meta.priorPendingActions as Array<{ id?: string }>).map((p) => p.id)).toContain(HOLD_ID);
    // …and the refusal fact still rides only on a continuity cause.
    expect((meta.handler_facts as unknown[]).length).toBe(1);
  });

  it('FAIL-CLOSED — an unreadable prior-pending state aborts the commit entirely on a non-continuity cause (the user keeps the proposal, loses only the memory)', async () => {
    priorPendingsMock.mockRejectedValue(new Error('session read failed'));
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-r2-read-fail-onc',
      handlerRegistry: registryThrowing('options_not_configured'),
    });
    expect(out.outcome).toBe('handler_recovered');
    expect(out.commitPerformed).toBe(false);
    expect(
      commitDirectAnswerMock.mock.calls.length,
      'committing without the priors would wipe the live hold — worse than writing no row',
    ).toBe(0);
  });

  it('FAIL-CLOSED, OPPOSITE ARM — the same unreadable state on a CONTINUITY cause escalates to commit_failed (the durable refusal fact is equally absent either way)', async () => {
    priorPendingsMock.mockRejectedValue(new Error('session read failed'));
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-r2-read-fail-continuity',
      handlerRegistry: registryThrowing('analysis_blocked'),
    });
    expect(out.outcome).toBe('commit_failed');
    expect(commitDirectAnswerMock.mock.calls.length).toBe(0);
  });

  it('EVERY recoverable cause that commits threads the priors — none of the nine is a wipe sharer', async () => {
    for (const cause of RECOVERABLE_HANDLER_CAUSES) {
      commitDirectAnswerMock.mockClear();
      priorPendingsMock.mockReset();
      priorPendingsMock.mockResolvedValue([livePriorHold()]);
      await dispatchChipClickRunAnalysis({
        payload: payload(),
        requestId: `req-r2-all-${cause}`,
        handlerRegistry: registryThrowing(cause),
      });
      const meta = (commitDirectAnswerMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
      const priors = meta.priorPendingActions as Array<{ id?: string }> | undefined;
      expect(priors, `cause ${cause} committed with NO priors threaded — it wipes live holds`).toBeDefined();
      expect(
        (priors ?? []).map((p) => p.id),
        `cause ${cause} committed without threading the prior hold`,
      ).toContain(HOLD_ID);
    }
  });
});
