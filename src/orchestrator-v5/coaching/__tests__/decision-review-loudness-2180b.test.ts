/**
 * ROADMAP 2.180-B — (1) the budget BITES at the old value, (2) the loss is LOUD.
 *
 * Two claims, both runtime, both mutation-checked:
 *
 *   1. A review that needs longer than the OLD 22,000 ms budget now SURVIVES.
 *      The fixture's latency is derived from the frozen measurement, not
 *      hand-picked, and it is lost under the old budget and enriched under the
 *      new one. That is what makes this a pin rather than a restatement.
 *
 *   2. `v5.decision_review_degraded` FIRES on the internal loss paths.
 *      Before this lane it had exactly ONE production emit site — the
 *      turn-executor's outer catch, reached only when the enricher RETHROWS —
 *      and the enricher rethrows only on an OUTER turn-budget abort. So the
 *      event literally named "degraded" could not fire for the dominant
 *      degradation. That silence was pinned as correct by
 *      `decision-review-resilience-verification.test.ts`; that assertion is
 *      inverted by this lane and its comment rewritten.
 *
 * TRAP 13 — every absence assertion here has a PRESENCE to see. The suite emits
 * a real degraded event in the timeout case through the SAME sink used by the
 * "no degraded on the happy path" case, so a sink that could not observe the
 * event would fail loudly instead of passing vacuously.
 *
 * TRAP 12 — this file does NOT `vi.mock('../../../config/timeouts.js')`. The
 * budget is the thing under test; a mock factory would replace it and the pins
 * would measure the mock forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { DECISION_REVIEW_TIMEOUT_MS } from '../../../config/timeouts.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';

/** The budget in force before 2.180-B. The fixture below must beat it. */
const OLD_BUDGET_MS = 22_000;

/**
 * The latency the biting fixture simulates. DERIVED: the slowest COMPLETED call
 * in the frozen 27-30 Jul sample (19,802 ms) scaled by the p95-to-max ratio
 * observed in that same sample — i.e. one more step into the tail than the
 * sample could show, because the sample was censored at OLD_BUDGET_MS and
 * cannot show anything beyond it. Lands at ~24.9 s: comfortably past the old
 * wall, comfortably inside the new budget.
 */
const TAIL_LATENCY_MS = Math.ceil(19_802 * (19_802 / 15_766)); // 24_872

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

function okOutput() {
  return {
    narrative_summary: 's',
    story_headlines: ['h'],
    robustness_explanation: 's',
    readiness_rationale: 's',
    evidence_enhancements: [],
    bias_findings: [],
    key_assumptions: ['a'],
    decision_quality_prompts: ['q'],
  };
}

function okResult() {
  return {
    output: okOutput(),
    raw: '{}',
    model: 'gpt-4.1',
    provider: 'openai',
    llm_latency_ms: TAIL_LATENCY_MS,
    input_tokens: 9_807,
    output_tokens: 972,
    prompt_version: 'v15',
    resolution: MOCK_RESOLUTION,
  };
}

function runAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      enrichment: {
        results: [
          { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
          { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
        ],
        factor_sensitivity: [{ label: 'Price', direction: 'positive', elasticity: 0.2 }],
        robustness: { level: 'stable', fragile_edges: [] },
        graph: { nodes: [], edges: [] },
      },
    },
  };
}

const BRIEF = 'Decision brief about pricing strategy';

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const degraded = () => events.filter((e) => e.event === 'v5.decision_review_degraded');

/**
 * Drive the enricher with an `invokeDecisionReview` that takes `latencyMs` of
 * simulated wall-clock, honouring the abort signal exactly as the real adapter
 * does. Fake timers make it deterministic and load-independent — no sleeps, so
 * a starved CI worker cannot flake it.
 */
async function runWithLatency(latencyMs: number): Promise<readonly HandlerFact[]> {
  vi.spyOn(invokeMod, 'invokeDecisionReview').mockImplementation(async (_input, opts) => {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(okResult() as never), latencyMs);
      opts.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('OpenAI chat aborted by external signal'));
      });
    });
  });
  vi.useFakeTimers();
  const facts: readonly HandlerFact[] = [runAnalysisFact()];
  const pending = enrichRunAnalysisWithDecisionReview({
    handlerFacts: facts,
    requestId: 'req-2180b',
    scenarioId: 'scen-a',
    signal: new AbortController().signal,
    brief: BRIEF,
  });
  // Advance past whichever comes first — the simulated call or the hard budget.
  await vi.advanceTimersByTimeAsync(Math.max(latencyMs, DECISION_REVIEW_TIMEOUT_MS) + 1);
  return await pending;
}

describe('2.180-B — the raised budget BITES', () => {
  it('the fixture is genuinely past the OLD wall (guards against a vacuous pin)', () => {
    // If this ever stops holding, the test below proves nothing: it would be
    // asserting that a call the old budget already covered still completes.
    expect(TAIL_LATENCY_MS).toBeGreaterThan(OLD_BUDGET_MS);
    expect(TAIL_LATENCY_MS).toBeLessThan(DECISION_REVIEW_TIMEOUT_MS);
  });

  it('a tail-latency review SURVIVES and is attached to the fact', async () => {
    const out = await runWithLatency(TAIL_LATENCY_MS);
    const enrichment = (out[0] as HandlerFact & {
      result: { enrichment: Record<string, unknown> };
    }).result.enrichment;
    expect(enrichment.decision_review).toBeDefined();
    // ...and nothing was reported as degraded, because nothing was lost.
    expect(degraded()).toHaveLength(0);
  });

  it('a review past the NEW budget is still cut — the budget is a budget, not a removal', async () => {
    const facts: readonly HandlerFact[] = [runAnalysisFact()];
    const out = await runWithLatency(DECISION_REVIEW_TIMEOUT_MS + 5_000);
    expect(out[0]).toEqual(facts[0]);
    expect(degraded()).toHaveLength(1);
  });
});

describe('2.180-B — the loss is LOUD', () => {
  it('the internal hard-budget abort FIRES v5.decision_review_degraded', async () => {
    await runWithLatency(DECISION_REVIEW_TIMEOUT_MS + 5_000);

    const ev = degraded();
    expect(ev).toHaveLength(1);
    const data = ev[0]!.data;
    expect(data.reason).toBe('timeout');
    expect(data.request_id).toBe('req-2180b');
    expect(data.scenario_id).toBe('scen-a');
    // The budget it was measured against travels WITH the elapsed time, so
    // "how close to the wall are we" is answerable from one event.
    expect(data.budget_ms).toBe(DECISION_REVIEW_TIMEOUT_MS);
    expect(data.elapsed_ms).toBeGreaterThanOrEqual(DECISION_REVIEW_TIMEOUT_MS);
    // Derived from OUR timer, never from the adapter's error text — note the
    // mock rejects with the real "OpenAI chat aborted by external signal"
    // string, so a string-matching implementation would pass this by accident
    // and fail the upstream_error case below.
    expect(data.timed_out).toBe(true);
  });

  it('an upstream failure is reported as upstream_error, NOT as a timeout', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockRejectedValue(
      // Deliberately the SAME message the abort path produces. Only a
      // timer-derived flag can tell these two apart.
      new Error('OpenAI chat aborted by external signal'),
    );
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact()],
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: BRIEF,
    });

    const ev = degraded();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.reason).toBe('upstream_error');
    expect(ev[0]!.data.timed_out).toBe(false);
    expect(ev[0]!.data.budget_ms).toBe(DECISION_REVIEW_TIMEOUT_MS);
  });

  it('a returned-but-unparseable output FIRES it too (shape_extraction_failed)', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      ...okResult(),
      output: null,
    } as never);
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact()],
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: BRIEF,
    });

    const ev = degraded();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data.reason).toBe('shape_extraction_failed');
    expect(ev[0]!.data.timed_out).toBe(false);
  });

  it('POSITIVE CONTROL — the happy path emits NO degraded event', async () => {
    // The sink demonstrably CAN see this event (every case above proves it), so
    // this absence assertion is not vacuous.
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue(okResult() as never);
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact()],
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: BRIEF,
    });

    const enrichment = (out[0] as HandlerFact & {
      result: { enrichment: Record<string, unknown> };
    }).result.enrichment;
    expect(enrichment.decision_review).toBeDefined();
    expect(degraded()).toHaveLength(0);
  });

  it('a SKIP is not a degrade — nothing was attempted, nothing was lost', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact()],
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: null, // -> no_brief skip
    });
    expect(spy).not.toHaveBeenCalled();
    expect(degraded()).toHaveLength(0);
    expect(events.some((e) => e.event === 'v5.decision_review.skipped')).toBe(true);
  });

  it('the OUTER turn-budget abort RETHROWS and does not report a degrade', async () => {
    // That turn fails wholesale (TURN_BUDGET_EXCEEDED); it is not a graceful
    // degradation, and the executor — not the enricher — owns it. Unchanged by
    // this lane, pinned so it stays unchanged.
    const outer = new AbortController();
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockImplementation(async (_i, opts) => {
      return await new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const pending = enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact()],
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: outer.signal,
      brief: BRIEF,
    });
    outer.abort(new Error('turn budget exceeded'));
    await expect(pending).rejects.toThrow();

    expect(degraded()).toHaveLength(0);
    const failed = events.filter((e) => e.event === 'v5.decision_review.failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.data.reason).toBe('outer_turn_budget_aborted');
  });

  it('degrading still returns the facts UNCHANGED — loudness did not change behaviour', async () => {
    const facts: readonly HandlerFact[] = [runAnalysisFact()];
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockRejectedValue(new Error('boom'));
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-2180b',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: BRIEF,
    });
    expect(out).toBe(facts);
    // ...and the pre-existing `.failed` event is still emitted alongside the
    // new one: this lane ADDED an alarm, it did not replace the record.
    expect(events.filter((e) => e.event === 'v5.decision_review.failed')).toHaveLength(1);
    expect(degraded()).toHaveLength(1);
  });
});
