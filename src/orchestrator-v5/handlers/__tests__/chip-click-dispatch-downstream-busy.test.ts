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
    // No analysis ran and no graph mutated.
    expect(out.commitPerformed).toBe(false);
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
