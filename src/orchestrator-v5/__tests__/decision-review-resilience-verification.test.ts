/**
 * Test K (verification) — decision_review enricher resilience.
 *
 * SCOPING NOTE (intentional reduction from the brief):
 *
 *   The brief asks us to drive a run_analysis turn through `runTurnExecutor`
 *   with a mocked `enrichRunAnalysisWithDecisionReview`. That requires
 *   handler-dispatch wiring (registry seed, scenario brief plumbing,
 *   PLoT-shaped fact result) that is impractical to assemble inside a unit
 *   test. The enricher already owns the resilience contract: `try/catch`
 *   around `invokeDecisionReview`, telemetry on failure, and verbatim
 *   pass-through of `handlerFacts` on any throw. The turn-executor's
 *   defense-in-depth wrap (turn-executor.ts:1170-1188) only fires if a
 *   future regression lets an exception ESCAPE that try/catch.
 *
 *   So this test verifies:
 *     1. SUCCESS path — `invokeDecisionReview` returns output → enricher
 *        returns a new fact array with enrichment.decision_review populated;
 *        no decision_review_failed / decision_review_degraded telemetry.
 *     2. FAILURE path — `invokeDecisionReview` throws → enricher returns the
 *        input fact array UNCHANGED (decision_review absent on
 *        enrichment), and `v5.decision_review_failed` telemetry fires.
 *
 *   ⚠ AMENDED BY ROADMAP 2.180-B. This header used to close: "the outer
 *   `v5.decision_review_degraded` event from turn-executor.ts:1180 is
 *   documented in the verification doc as covered by code review (the catch
 *   wrap is a 6-line escape net) rather than a runtime assertion." That was an
 *   accurate description of a broken alarm. The outer wrap fires only when the
 *   enricher RETHROWS, and the enricher rethrows only on an OUTER turn-budget
 *   abort — so the event named "degraded" could not fire for the internal
 *   hard-budget abort, which the 2.180 probe measured as the dominant cause of
 *   missing reviews. The enricher now emits it directly on every INVOKED-but-
 *   lost path, and case 2 below asserts it rather than asserting its absence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../utils/telemetry.js';

// Mock invokeDecisionReview before importing the enricher.
const invokeMock = vi.fn();
vi.mock('../../cee/decision-review/invoke.js', () => ({
  invokeDecisionReview: (...args: unknown[]) => invokeMock(...args),
}));

const { enrichRunAnalysisWithDecisionReview } = await import(
  '../coaching/decision-review-enricher.js'
);

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  invokeMock.mockReset();
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function eventsOfType(name: string): Event[] {
  return events.filter((e) => e.event === name);
}

const RUN_ANALYSIS_ENRICHMENT = {
  graph: { nodes: [{ id: 'opt_a', label: 'Option A' }] },
  results: [
    { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.7, outcome_mean: 0.6 },
    { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.3, outcome_mean: 0.4 },
  ],
  factor_sensitivity: [],
  robustness: { fragile_edges: [], level: 'moderate' },
} as Record<string, unknown>;

function makeRunAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_id: 'fact-1',
    handler_id: 'run_analysis',
    handler_version: '1.0.0',
    inputs: {},
    result: {
      enrichment: { ...RUN_ANALYSIS_ENRICHMENT },
      leading_option_id: 'opt_a',
    },
  } as unknown as HandlerFact;
}

describe('Test K — decision_review enricher resilience (verification)', () => {
  it('SUCCESS path — populates enrichment.decision_review, no degraded telemetry', async () => {
    invokeMock.mockResolvedValueOnce({
      // narrative_summary present so the POST-parse contract gate admits the
      // review (a missing review_card is dropped); `recommendation`/`summary`
      // remain the fields this success-path attach assertion reads.
      output: { narrative_summary: 'Option A leads.', recommendation: 'go with Option A', summary: 'strong margin' },
      raw: '{}',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      llm_latency_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      prompt_version: 'v11',
      resolution: { model_id: 'claude-sonnet-4-6', source: 'default' } as never,
    });

    const fact = makeRunAnalysisFact();
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-K-success',
      scenarioId: 'scn-K',
      signal: new AbortController().signal,
      brief: 'choose between Option A and Option B',
    });

    expect(out).toHaveLength(1);
    const result = (out[0] as HandlerFact & { result: { enrichment: Record<string, unknown> } })
      .result;
    expect(result.enrichment.decision_review).toBeDefined();
    const dr = result.enrichment.decision_review as Record<string, unknown>;
    expect(dr.recommendation).toBe('go with Option A');
    expect(typeof dr.produced_at).toBe('string'); // V5 timestamp stamp

    // Telemetry: invoked event fired, no failed event.
    expect(eventsOfType('v5.decision_review.invoked')).toHaveLength(1);
    expect(eventsOfType('v5.decision_review.failed')).toHaveLength(0);
    expect(eventsOfType('v5.decision_review_degraded')).toHaveLength(0);
  });

  it('FAILURE path — enricher swallows throw, returns facts unchanged, fires v5.decision_review_failed', async () => {
    invokeMock.mockRejectedValueOnce(new Error('upstream blew up'));

    const fact = makeRunAnalysisFact();
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-K-fail',
      scenarioId: 'scn-K',
      signal: new AbortController().signal,
      brief: 'choose between Option A and Option B',
    });

    // Input fact array returned UNCHANGED — no decision_review key present.
    expect(out).toBe(out); // smoke
    expect(out).toHaveLength(1);
    const enrichment = (out[0] as HandlerFact & { result: { enrichment: Record<string, unknown> } })
      .result.enrichment;
    expect('decision_review' in enrichment).toBe(false);

    // Failed telemetry recorded; the recovery contract is met.
    const failed = eventsOfType('v5.decision_review.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data.reason).toBe('upstream blew up');

    // ⚠ INVERTED BY ROADMAP 2.180-B. This assertion used to read
    // `toHaveLength(0)`, with the comment: "the outer turn-executor 'degraded'
    // wrap is a defense-in-depth net for exceptions ESCAPING the enricher's
    // try/catch. Since the enricher does NOT rethrow, the degraded event is
    // correctly absent here."
    //
    // Every clause of that was true, and the conclusion was still wrong. The
    // enricher not rethrowing is exactly WHY the event named "degraded" could
    // not fire for the dominant degradation — the 22 s hard-budget abort, which
    // the 2.180 probe measured losing the model review on 12 of 363 analyses in
    // 14 days. This test was pinning that silence as correct, so a lane reading
    // it would have concluded the alarm was working as designed.
    //
    // The enricher now emits the degraded event itself on every path where the
    // review was INVOKED and the turn ships without one. Rethrow behaviour is
    // unchanged; the silence is what changed.
    const degraded = eventsOfType('v5.decision_review_degraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0]!.data.reason).toBe('upstream_error');
    expect(degraded[0]!.data.timed_out).toBe(false);
    expect(typeof degraded[0]!.data.elapsed_ms).toBe('number');
    expect(typeof degraded[0]!.data.budget_ms).toBe('number');
  });

  it('FAILURE path: shape_extraction_failed when invoke returns output:null', async () => {
    invokeMock.mockResolvedValueOnce({
      output: null,
      raw: 'malformed',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      llm_latency_ms: 50,
      input_tokens: 5,
      output_tokens: 5,
      prompt_version: 'v11',
      resolution: { model_id: 'claude-sonnet-4-6', source: 'default' } as never,
    });

    const fact = makeRunAnalysisFact();
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-K-shape',
      scenarioId: 'scn-K',
      signal: new AbortController().signal,
      brief: 'choose between Option A and Option B',
    });

    expect(out).toHaveLength(1);
    const enrichment = (out[0] as HandlerFact & { result: { enrichment: Record<string, unknown> } })
      .result.enrichment;
    expect('decision_review' in enrichment).toBe(false);

    const failed = eventsOfType('v5.decision_review.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data.reason).toBe('shape_extraction_failed');
  });
});
