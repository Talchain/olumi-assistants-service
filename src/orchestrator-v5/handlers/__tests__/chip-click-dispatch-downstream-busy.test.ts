/**
 * ROADMAP 2.202 fix ③, end-to-end at the dispatch seam: the chip-click
 * `run_analysis` path must return the graceful `handler_recovered` (route-v2 →
 * **200**) for a downstream 429, not `handler_failure` (→ 500 INTERNAL_ERROR).
 *
 * This is the outcome the tester actually experiences. `diagnosis-run-analysis-
 * 500s.md` §1 measured four staging failures on this exact path — every one a
 * 200-body typed failure envelope carrying `status_reason: "The analysis
 * service returned an error (HTTP 429)."` — all four rendered as
 * `chip_click_run_analysis_handler_failed`, `cause_kind: analysis_failed`,
 * HTTP 500.
 *
 * The REAL run_analysis handler is used over an injected PLoT client, so the
 * classification and the dispatch gating are proven together rather than
 * asserted separately and hoped to compose.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { log } from '../../../utils/telemetry.js';

// ROUND 2 (2.1353) — `commitDirectAnswer` and the prior-pending read are
// stubbed HERE, deliberately. Before this they were not, so the real commit hit
// an absent Supabase store, failed, and `commitPerformed` read `false` for an
// ENVIRONMENTAL reason rather than because the contract said so — the
// assertion below was pinning the harness, not the product.
const { commitDirectAnswerMock, priorPendingsMock } = vi.hoisted(() => ({
  commitDirectAnswerMock: vi.fn(),
  priorPendingsMock: vi.fn(),
}));

vi.mock('../../commit.js', async () => {
  const actual = await vi.importActual<typeof import('../../commit.js')>('../../commit.js');
  return { ...actual, commitDirectAnswer: commitDirectAnswerMock };
});

// `dispatchChipClickRunAnalysis` calls `buildTurnContext` unconditionally,
// which would hit Supabase. Same minimal stub the sibling recoverable suite
// uses; the registry + handler below are REAL.
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
      request_id: 'req-busy',
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
    loadMostRecentPendingActionsIntegrityStrict: priorPendingsMock,
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
const CAPTURED_429_STATUS_REASON = 'The analysis service returned an error (HTTP 429).';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
  });
}

function snapshot(): RunAnalysisScenarioSnapshot {
  const graph = { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 0.9 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 1.2 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function plotRejectingWith(err: () => PLoTError): PLoTClient {
  const run = vi.fn((..._args: [Record<string, unknown>, string, PLoTClientRunOpts | undefined]) =>
    Promise.reject<V2RunResponseEnvelope>(err()),
  );
  return { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
}

function realRegistry(plotClient: PLoTClient): HandlerRegistry {
  return createRegistry({
    scenarioReader: (() => Promise.resolve(snapshot())) as unknown as ScenarioReader,
    plotClient,
  });
}

/** The staging capture, byte-for-byte (diagnosis §1, request dfa7c743…). */
function capturedIsl429(): PLoTError {
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
  } as unknown as V2RunError;
  const err = new PLoTError(
    `PLoT run analysis failed: ${CAPTURED_429_STATUS_REASON}`,
    200,
    'run',
    179,
    'dfa7c743-d7ed-45db-b7fd-55735378d7c0',
  );
  (err as unknown as { v2RunError: V2RunError }).v2RunError = v2Err;
  return err;
}

function isl500(): PLoTError {
  const v2Err: V2RunError = {
    analysis_status: 'failed',
    status_reason: 'The analysis service returned an error (HTTP 500).',
    critiques: [{ code: 'ISL_CALL_FAILED', message: 'ISL analysis failed. Please try again.' }],
  } as unknown as V2RunError;
  const err = new PLoTError('PLoT run analysis failed', 200, 'run', 120, 'req-500');
  (err as unknown as { v2RunError: V2RunError }).v2RunError = v2Err;
  return err;
}

let warnSpy: ReturnType<typeof vi.spyOn> | undefined;
let errorSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  commitDirectAnswerMock.mockReset();
  // The real chokepoint RETURNS the response it committed: the SAME object on
  // the untouched fast path, an AMENDED copy when it attached the F-HELD lapse
  // notice or suppressed competing run_analysis chips. `response: {}` misstated
  // that contract, and the dispatcher now CONSUMES the returned value, so the
  // stub has to echo (CLAUDE.md trap 12 — a stub is a hand-maintained mirror).
  commitDirectAnswerMock.mockImplementation(async (r: unknown) => ({
    response: r,
    performed: true,
    persisted_row_id: 'row-busy',
    graphPersisted: false,
  }));
  priorPendingsMock.mockReset();
  priorPendingsMock.mockResolvedValue([]);
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
  vi.restoreAllMocks();
});

describe('chip-click run_analysis — downstream 429 recovers as BUSY (200), not 500', () => {
  it('RED-FIRST: the captured ISL-429 envelope → handler_recovered, cause analysis_engine_busy', async () => {
    const plot = plotRejectingWith(capturedIsl429);
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-busy-429',
      handlerRegistry: realRegistry(plot),
    });

    expect(out.outcome).toBe('handler_recovered');
    if (out.outcome !== 'handler_recovered') throw new Error('unreachable');
    expect(out.causeKind).toBe('analysis_engine_busy');
    // PLoT was genuinely reached — this is the real failure path, not a
    // short-circuit before the call.
    expect((plot.run as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('the recovered body tells the truth: engine busy + a retry affordance, no false success', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-busy-body',
      handlerRegistry: realRegistry(plotRejectingWith(capturedIsl429)),
    });
    if (out.outcome !== 'handler_recovered') throw new Error(`got ${out.outcome}`);

    const text = out.response.assistant_text ?? '';
    expect(text.toLowerCase()).toContain('busy');
    // Never claim the analysis ran.
    expect(text.toLowerCase()).not.toContain('analysis is ready');
    expect(out.response.suggested_actions?.length ?? 0).toBeGreaterThan(0);
    expect(out.response.suggested_actions?.[0]?.action_type).toBe('run_analysis');
    // ⚠ CONTRACT CHANGED — ROADMAP 2.1353 round 2. This line asserted `false`,
    // and it was GREEN FOR AN ENVIRONMENTAL REASON: this suite did not mock
    // `commit.js`, so the real `commitDirectAnswer` failed against an absent
    // store. `analysis_engine_busy` is on RECOVERABLE_HANDLER_CAUSES, and a
    // recovered turn that produced a user-visible answer MUST be written to
    // conversation history — the whole point of 2.1353. Corrected at source
    // rather than baselined: with the commit stubbed, the contract is what the
    // assertion now reads.
    expect(out.commitPerformed).toBe(true);
    // …and it must not have wiped the prior row's pendings on its way through.
    const meta = (commitDirectAnswerMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(meta.priorPendingActions, 'a commit with no priors threaded wipes live holds').toBeDefined();
    // No refusal FACT, though: a busy engine is not evidence about the model.
    expect((meta.handler_facts as unknown[]).length).toBe(0);
    // ⚠ CONTRACT CHANGED — ROADMAP 2.1085 (root 2.1041) / golden-journey EXT-2. Was
    // `toBeUndefined()`. A busy engine is still a REFUSED analyse turn, and it
    // took the same silent exit as the mixed-scale refusal: 200, honest prose,
    // no machine-readable state. It now reports the typed refusal, named by
    // its own cause.
    expect(out.analysisReady).toBeDefined();
    expect(out.analysisReady.status).toBe('blocked');
    expect(out.analysisReady.blocked_reason).toBe('analysis_engine_busy');
  });

  it('SECOND ARM: a downstream 500 still returns handler_failure (→ 500) — genuine breakage stays visible', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-busy-500',
      handlerRegistry: realRegistry(plotRejectingWith(isl500)),
    });

    expect(out.outcome).toBe('handler_failure');
    if (out.outcome !== 'handler_failure') throw new Error('unreachable');
    expect(out.causeKind).toBe('analysis_failed');
  });
});
