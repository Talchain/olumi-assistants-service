import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import * as decomposeMod from '../../../cee/decision-review/decompose.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import * as turnDebugMod from '../../debug/turn-debug-store.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';
import { config, _resetConfigCache } from '../../../config/index.js';

/**
 * Fixture resolution returned alongside the mocked invoke result. Matches
 * what `getAdapterWithResolution('decision_review')` would produce when
 * routing via CEE_MODEL_DECISION_REVIEW → gpt-4.1 on openai. Kept here so
 * every mockResolvedValue site shares one canonical shape (audit follow-up
 * UU-16: resolution is now required on DecisionReviewInvokeResult).
 */
const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

function runAnalysisFact(overrides: {
  enrichment?: Record<string, unknown>;
  leading_option_id?: string | null;
} = {}): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: overrides.leading_option_id ?? 'opt-1',
      summary: 'Ran analysis',
      ...(overrides.enrichment !== undefined ? { enrichment: overrides.enrichment } : {}),
    },
  };
}

function minimalEnrichment(): Record<string, unknown> {
  // No `v5.brief` field here — brief now travels out-of-band through
  // EnrichDecisionReviewInput.brief to keep the handler fact enrichment a
  // verbatim pass-through of the PLoT envelope (handler-ownership invariant).
  return {
    results: [
      { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
    ],
    factor_sensitivity: [{ label: 'Price', direction: 'positive', elasticity: 0.2 }],
    robustness: { level: 'stable', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
  };
}

const DEFAULT_BRIEF = 'Decision brief about pricing strategy';

function notAbortedSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('enrichRunAnalysisWithDecisionReview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns facts unchanged when no run_analysis fact is present', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when enrichment is absent on the fact', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [runAnalysisFact()];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when brief is null', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: null,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when brief is the empty string', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: '',
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when results is empty (no winner available)', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const enrichment = { results: [] };
    const facts: readonly HandlerFact[] = [runAnalysisFact({ enrichment })];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('attaches decision_review to enrichment on a successful call', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: {
        narrative_summary: 'option A wins',
        story_headlines: ['A ahead'],
        robustness_explanation: 'stable',
        readiness_rationale: 'good',
        evidence_enhancements: [],
        bias_findings: [],
        key_assumptions: ['price is elastic'],
        decision_quality_prompts: ['what if churn doubles'],
      },
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 200,
      input_tokens: 100,
      output_tokens: 200,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });

    const fact = runAnalysisFact({ enrichment: minimalEnrichment() });
    const facts: readonly HandlerFact[] = [fact];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    expect(out).not.toBe(facts);
    expect(out).toHaveLength(1);
    const patched = out[0];
    expect(patched.fact_type).toBe('run_analysis');
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const enrichment = patched.result.enrichment as Record<string, unknown>;
    // Enrichment is a verbatim PLoT pass-through; V5 adds decision_review
    // only. No v5.brief in enrichment (brief travels out-of-band).
    expect(enrichment['v5.brief']).toBeUndefined();
    const dr = enrichment.decision_review as Record<string, unknown>;
    expect(dr.narrative_summary).toBe('option A wins');
    expect(dr.story_headlines).toEqual(['A ahead']);
  });

  it('returns facts unchanged when the LLM call fails (never throws)', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockRejectedValue(new Error('upstream 500'));
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
  });

  it('returns facts unchanged when shape extraction failed (output === null)', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: null,
      raw: 'not-json',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 50,
      input_tokens: 10,
      output_tokens: 5,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
  });

  it('returns facts unchanged when the 15s hard timeout fires (AbortError)', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockImplementation(async (_input, opts) => {
      // Resolve when caller aborts; simulates the adapter respecting signal.
      return await new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          reject(new Error('decision_review timeout'));
        });
      });
    });
    vi.useFakeTimers();
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const pending = enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    // Advance past the 15s DECISION_REVIEW_TIMEOUT_MS default.
    await vi.advanceTimersByTimeAsync(15_000);
    const out = await pending;
    expect(out).toBe(facts);
    vi.useRealTimers();
  });

  it('preserves unrelated enrichment keys from the PLoT envelope', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: {
        narrative_summary: 's',
        story_headlines: ['h'],
        robustness_explanation: 's',
        readiness_rationale: 's',
        evidence_enhancements: [],
        bias_findings: [],
        key_assumptions: ['a'],
        decision_quality_prompts: ['q'],
      },
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });

    const enrichment = {
      ...minimalEnrichment(),
      meta: { seed_used: 42, n_samples: 1000, response_hash: 'abc' },
      review_cards: [{ id: 'card-1' }],
    };
    const facts: readonly HandlerFact[] = [runAnalysisFact({ enrichment })];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const patchedEnrichment = patched.result.enrichment as Record<string, unknown>;
    expect(patchedEnrichment.meta).toEqual({ seed_used: 42, n_samples: 1000, response_hash: 'abc' });
    expect(patchedEnrichment.review_cards).toEqual([{ id: 'card-1' }]);
    expect(patchedEnrichment.decision_review).toBeDefined();
  });

  // Review feedback P1.2: produced_at is V5's timestamp and must not be
  // overridden by the LLM output even if a field with that name appears in
  // the payload. Regression guard against spread-order bugs.
  it('produced_at from V5 is retained when the LLM output includes its own produced_at', async () => {
    const hostileLlmOutput = {
      narrative_summary: 'option A wins',
      story_headlines: ['A ahead'],
      // An LLM that hallucinates this field should not be able to masquerade
      // as a trusted V5 timestamp. The spread in the enricher must place
      // V5's produced_at last so the payload field is overwritten.
      produced_at: '1970-01-01T00:00:00.000Z',
    };
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: hostileLlmOutput,
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });

    const before = Date.now();
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    const after = Date.now();

    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const dr = (patched.result.enrichment as Record<string, unknown>).decision_review as
      | Record<string, unknown>
      | undefined;
    expect(dr).toBeDefined();
    // Other payload fields pass through verbatim:
    expect(dr!.narrative_summary).toBe('option A wins');
    expect(dr!.story_headlines).toEqual(['A ahead']);
    // produced_at is a V5 timestamp, not the LLM's 1970 value:
    expect(typeof dr!.produced_at).toBe('string');
    const producedAtMs = Date.parse(dr!.produced_at as string);
    expect(producedAtMs).toBeGreaterThanOrEqual(before);
    expect(producedAtMs).toBeLessThanOrEqual(after);
    expect(dr!.produced_at).not.toBe('1970-01-01T00:00:00.000Z');
  });

  // V5 holistic audit UU-16: the enricher must call recordModelResolution
  // exactly once per invokeDecisionReview return (whether output is non-null
  // or null). Previously the decision_review site was ROUTED-NO-OBSERVABILITY
  // — the LLM call landed but its resolution never surfaced on the
  // `model_resolutions` dashboard. This regression guard locks in the fix.
  it('records model resolution on successful invoke', async () => {
    const recordSpy = vi.spyOn(turnDebugMod, 'recordModelResolution').mockImplementation(() => {});
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 100,
      input_tokens: 10,
      output_tokens: 20,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith('req-1', 'scen-a', MOCK_RESOLUTION);
  });

  it('records model resolution even when shape extraction failed (tokens spent)', async () => {
    const recordSpy = vi.spyOn(turnDebugMod, 'recordModelResolution').mockImplementation(() => {});
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: null,
      raw: 'not-json',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 50,
      input_tokens: 10,
      output_tokens: 5,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment() }),
    ];
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// V5 Phase 1 brief persistence — Defect B mutual-exclusion regression.
//
// Defect B's symptom was: `_meta.decision_brief_assembled === true` (the brief
// was assembled and present somewhere in the request lifecycle) co-occurring
// with `v5.decision_review.skipped` `reason: no_brief` for the same request.
// The two events should be mutually exclusive — if a brief is available, the
// enricher must not skip with `no_brief`.
//
// Pre-fix: turn-executor and chip-click-dispatch both passed `brief: null`
// to the enricher (one via an unpopulated option, one hardcoded), so even
// when the brief was assembled and persisted, the enricher saw null and
// skipped. Post-fix: both call sites read from canonical state, so this
// test pins the contract at the enricher boundary regardless of caller.
// ---------------------------------------------------------------------------

import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';

describe('Defect B mutual-exclusion: brief present ⇒ no `no_brief` skip', () => {
  let events: Array<{ name: string; data: Record<string, unknown> }>;
  beforeEach(() => {
    // Restore between tests so the success-path spy from one case doesn't
    // bleed into the negative-path cases that assert the spy was NOT called.
    vi.restoreAllMocks();
    events = [];
    setTestSink((name, data) => events.push({ name, data }));
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  it('non-empty brief + valid run_analysis fact ⇒ enricher does NOT emit v5.decision_review.skipped no_brief', async () => {
    // Provide a winning invoke result so the enricher takes the success
    // path (not no_winner skip). The headline assertion is on the absence
    // of the `no_brief` skip event for this request_id.
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    spy.mockResolvedValue({
      output: {
        winner: { option_id: 'opt-1', option_label: 'Option A' },
        rationale: 'because',
      },
      meta: { duration_ms: 5, brief_hash: 'h', model: 'gpt-4.1', kept_node_count: 0, kept_edge_count: 0 },
      resolution: MOCK_RESOLUTION,
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-defect-b-mux',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: 'a real persisted brief',
    });

    // Mutual exclusion: when brief is non-empty, NO no_brief skip event
    // fires for this request.
    const skipEvents = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewSkipped &&
        e.data.request_id === 'req-defect-b-mux',
    );
    const noBriefSkips = skipEvents.filter((e) => e.data.reason === 'no_brief');
    expect(noBriefSkips).toHaveLength(0);

    // Sanity check on the contract: the invoke happened (because the
    // brief and enrichment were both present), so the enricher took the
    // happy path — not any other skip path.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('null brief + valid run_analysis fact ⇒ enricher EMITS v5.decision_review.skipped no_brief (negative case)', async () => {
    // The other half of the mutual exclusion: when brief IS null, the
    // skip event MUST fire. Without this assertion the regression test
    // could pass by accident (e.g. if telemetry stopped emitting).
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-no-brief-skip',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: null,
    });

    const noBriefSkips = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewSkipped &&
        e.data.request_id === 'req-no-brief-skip' &&
        e.data.reason === 'no_brief',
    );
    expect(noBriefSkips).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('empty-string brief ⇒ no_brief skip fires (treats empty as absent)', async () => {
    // Defence-in-depth: app-side normaliseBriefText collapses empty
    // strings to undefined before they reach the enricher, but if a
    // future caller bypasses normalisation, the enricher must still
    // treat empty as absent (the existing `!input.brief || input.brief.length === 0`
    // guard). Pin that semantic here.
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: minimalEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-empty-brief',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: '',
    });

    const noBriefSkips = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewSkipped &&
        e.data.request_id === 'req-empty-brief' &&
        e.data.reason === 'no_brief',
    );
    expect(noBriefSkips).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 3A fix (2026-05-17): input adapter accepts current PLoT V2 shapes.
//
// `enrichment.results` was the only source the enricher knew how to read.
// The current PLoT V2 envelope (verified on staging scenario
// `22c9e91b-6200-40fc-9556-16a5e643294a` against build `2e6e0be`) does NOT
// populate `enrichment.results`; option-level data lives under
// `enrichment.option_comparison` and `enrichment.decision_brief.options`.
//
// The fallback order is: `results` → `option_comparison` → `decision_brief.options`.
// All three cases must select the winner by `leading_option_id`. When that
// ID is absent from the chosen source, the enricher MUST skip `no_winner`
// rather than fall back to "highest probability in the envelope" (which
// would invent a winner whenever the declared leader is mismatched).
// ---------------------------------------------------------------------------

describe('readResultsArray + selectWinner — input adapter fallback chain', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Realistic option_comparison fixture mirroring staging shape: entries
   * carry BOTH `id` and `option_id`, BOTH `label` and `option_label`, plus
   * nested `outcome.{mean,p10,p50,p90,std,n_samples,validity_ratio,
   * n_valid_samples}` and a flat `win_probability`. `projectOptionAsWinner`
   * is already shape-tolerant so any subset of these fields is enough.
   */
  function staging_option_comparison(): Array<Record<string, unknown>> {
    return [
      {
        id: 'opt_local_hire',
        option_id: 'opt_local_hire',
        label: 'Hire Two Senior Engineers Locally',
        option_label: 'Hire Two Senior Engineers Locally',
        status: 'computed',
        outcome: { mean: 0.04, p10: -0.17, p50: 0.05, p90: 0.23 },
        win_probability: 0.163,
      },
      {
        id: 'opt_offshore',
        option_id: 'opt_offshore',
        label: 'Engage Offshore Partner',
        option_label: 'Engage Offshore Partner',
        status: 'computed',
        outcome: { mean: 0.10, p10: -0.06, p50: 0.11, p90: 0.23 },
        win_probability: 0.722,
      },
      {
        id: 'opt_status_quo',
        option_id: 'opt_status_quo',
        label: 'Continue with Current Team (Status Quo)',
        option_label: 'Continue with Current Team (Status Quo)',
        status: 'computed',
        outcome: { mean: 0.02, p10: -0.06, p50: 0.03, p90: 0.09 },
        win_probability: 0.114,
      },
    ];
  }

  /**
   * Realistic decision_brief.options fixture mirroring staging shape:
   * leaner than option_comparison — just `option_id`, `label`,
   * `win_probability`, and `rank`. No nested `outcome`. `selectWinner`
   * + `projectOptionAsWinner` must still produce a winner.
   */
  function staging_decision_brief_options(): Array<Record<string, unknown>> {
    return [
      { rank: 1, option_id: 'opt_offshore', label: 'Engage Offshore Partner', win_probability: 0.722 },
      { rank: 2, option_id: 'opt_local_hire', label: 'Hire Two Senior Engineers Locally', win_probability: 0.163 },
      { rank: 3, option_id: 'opt_status_quo', label: 'Continue with Current Team (Status Quo)', win_probability: 0.114 },
    ];
  }

  // Test 1: legacy enrichment.results shape still works (regression guard).
  it('source 1: enrichment.results — legacy shape still selects the leading_option_id winner', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt-2',
      enrichment: {
        results: [
          { option_id: 'opt-1', option_label: 'A', win_probability: 0.3 },
          { option_id: 'opt-2', option_label: 'B', win_probability: 0.7 },
        ],
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-legacy',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.winner.id).toBe('opt-2');
    expect(callArg.winner.label).toBe('B');
    expect(callArg.winner.win_probability).toBeCloseTo(0.7);
  });

  // Test 2: enrichment.option_comparison fallback.
  it('source 2: enrichment.option_comparison — selects the leading_option_id winner with full label + win_probability', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // NO enrichment.results — pure option_comparison source.
        option_comparison: staging_option_comparison(),
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-option-comparison',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.winner.id).toBe('opt_offshore');
    expect(callArg.winner.label).toBe('Engage Offshore Partner');
    expect(callArg.winner.win_probability).toBeCloseTo(0.722);
    // outcome.mean nested path is also picked up.
    expect(callArg.winner.outcome_mean).toBeCloseTo(0.10);
    // Runner-up resolves correctly (next-highest after the winner is filtered out).
    expect(callArg.runner_up?.id).toBe('opt_local_hire');
  });

  // Test 3: enrichment.decision_brief.options fallback.
  it('source 3: enrichment.decision_brief.options — leaner shape still selects the leading_option_id winner', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // NO results, NO option_comparison — last-fallback source only.
        decision_brief: { options: staging_decision_brief_options() },
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-brief-options',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.winner.id).toBe('opt_offshore');
    expect(callArg.winner.label).toBe('Engage Offshore Partner');
    expect(callArg.winner.win_probability).toBeCloseTo(0.722);
    // No outcome.mean in this shape — adapter must not invent one.
    expect(callArg.winner.outcome_mean).toBeUndefined();
  });

  // Test 4: all three sources missing → skip `no_winner`.
  it('skip path: all three result sources missing → enricher returns input unchanged and emits no_winner', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // None of results / option_comparison / decision_brief.options present.
        factor_sensitivity: [],
        graph: { nodes: [], edges: [] },
      },
    });
    const facts: readonly HandlerFact[] = [fact];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-all-missing',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  // Test 5: tightening — sources exist but don't contain leading_option_id.
  it('skip path: sources exist but leading_option_id mismatches every entry → skip no_winner (no winner inventing)', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const fact = runAnalysisFact({
      // Declared leader is NOT in the option_comparison list.
      leading_option_id: 'opt_ghost',
      enrichment: {
        option_comparison: staging_option_comparison(),
        graph: { nodes: [], edges: [] },
      },
    });
    const facts: readonly HandlerFact[] = [fact];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-mismatch',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  // Test 5b (review feedback 2026-05-17): cross-source walker — the
  // adapter must NOT stop at the first non-empty source. If
  // `enrichment.results` is non-empty but does not contain the
  // declared leader, the adapter must continue to
  // `enrichment.option_comparison` (and then to
  // `decision_brief.options`) and honour PLoT's declared winner from
  // whichever source carries it. Catches the regression "stale legacy
  // `results` arrays silently mask the live envelope's correct data".
  it('cross-source walker: leader missing from results but present in option_comparison → adapter walks to it', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // results is non-empty but does NOT contain the declared leader.
        results: [
          { option_id: 'opt_stale_a', option_label: 'Stale A', win_probability: 0.6 },
          { option_id: 'opt_stale_b', option_label: 'Stale B', win_probability: 0.4 },
        ],
        // option_comparison DOES contain the declared leader.
        option_comparison: staging_option_comparison(),
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-cross-walk',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    // Winner came from option_comparison (matched by ID), not from
    // results (which contained different IDs).
    expect(callArg.winner.id).toBe('opt_offshore');
    expect(callArg.winner.label).toBe('Engage Offshore Partner');
    expect(callArg.winner.win_probability).toBeCloseTo(0.722);
    // Runner-up is selected from the SAME source as the winner
    // (option_comparison) — never from the rejected `results` source —
    // so margin calculation stays consistent within a single shape.
    expect(callArg.runner_up?.id).toBe('opt_local_hire');
  });

  // Test 5c: cross-source walker — leader only present in
  // decision_brief.options (skipped through both prior sources).
  it('cross-source walker: leader missing from results AND option_comparison but present in decision_brief.options → adapter walks to it', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // Neither results nor option_comparison contain the declared leader.
        results: [
          { option_id: 'opt_stale', option_label: 'Stale', win_probability: 0.5 },
        ],
        option_comparison: [
          {
            id: 'opt_unrelated', option_id: 'opt_unrelated',
            label: 'Unrelated', option_label: 'Unrelated',
            status: 'computed', outcome: { mean: 0.1 }, win_probability: 0.5,
          },
        ],
        // Only decision_brief.options contains the declared leader.
        decision_brief: { options: staging_decision_brief_options() },
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-cross-walk-final',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    expect(callArg.winner.id).toBe('opt_offshore');
    expect(callArg.winner.label).toBe('Engage Offshore Partner');
    expect(callArg.winner.win_probability).toBeCloseTo(0.722);
  });

  // Test 5d: cross-source walker — declared leader is in the CURRENT
  // `option_comparison` (priority source since the decompose-hardening
  // lane's current-first reorder), so the walker stops there without
  // consulting the later legacy source.
  it('cross-source walker: leader present in option_comparison → adapter uses it without consulting later sources', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: { narrative_summary: 'ok' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 10,
      input_tokens: 1, output_tokens: 1, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_current_match',
      enrichment: {
        option_comparison: [
          { option_id: 'opt_current_match', option_label: 'Current Match', win_probability: 0.6, outcome: { mean: 0.2 } },
          { option_id: 'opt_current_other', option_label: 'Current Other', win_probability: 0.4, outcome: { mean: 0.1 } },
        ],
        // Legacy `results` also contains an entry with the same ID but a
        // DIFFERENT label. Priority must win → label from option_comparison,
        // not from the legacy source (this is the #437 winner-source
        // alignment: the winner reads the SAME envelope the prompt's
        // option_comparison slice reads).
        results: [
          {
            id: 'opt_current_match', option_id: 'opt_current_match',
            label: 'WRONG: should NOT be picked from here',
            option_label: 'WRONG: should NOT be picked from here',
            status: 'computed', outcome_mean: 0.1, win_probability: 0.99,
          },
        ],
        graph: { nodes: [], edges: [] },
      },
    });
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-priority',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0];
    // Winner came from `option_comparison` (priority) — label proves it; the
    // legacy entry with a deliberately-wrong label was NOT consulted because
    // the priority source matched first.
    expect(callArg.winner.id).toBe('opt_current_match');
    expect(callArg.winner.label).toBe('Current Match');
    expect(callArg.winner.win_probability).toBeCloseTo(0.6);
  });

  // Test 5e: hardened "all-sources mismatch" — verify the
  // `no_winner` skip ONLY fires when no source carries the leader.
  it('cross-source walker: leader missing from ALL three sources → skip no_winner', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const fact = runAnalysisFact({
      leading_option_id: 'opt_ghost',
      enrichment: {
        results: [{ option_id: 'opt_a', option_label: 'A', win_probability: 0.5 }],
        option_comparison: staging_option_comparison(),
        decision_brief: { options: staging_decision_brief_options() },
        graph: { nodes: [], edges: [] },
      },
    });
    const facts: readonly HandlerFact[] = [fact];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-all-mismatch',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  // Test 6: realistic staging-shaped fact (mirrors scenario 22c9e91b…)
  // attaches decision_review when the LLM/invoke layer is mocked.
  it('staging-shape fixture (scenario 22c9e91b…) attaches decision_review when LLM is mocked', async () => {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: {
        narrative_summary: 'Engage Offshore Partner leads on the current evidence.',
        story_headlines: { opt_offshore: 'A clear leader' },
        robustness_explanation: { summary: 'stable', primary_risk: null },
        readiness_rationale: 'ready',
        evidence_enhancements: {},
        bias_findings: [],
        key_assumptions: [],
        decision_quality_prompts: [],
      },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 50,
      input_tokens: 100, output_tokens: 200, prompt_version: 'v1', resolution: MOCK_RESOLUTION,
    });
    const fact = runAnalysisFact({
      leading_option_id: 'opt_offshore',
      enrichment: {
        // Mirrors what we observed on staging:
        //   - NO `results` key
        //   - option_comparison + decision_brief.options both populated
        //   - graph_hash_at_run is on fact.result, not in enrichment
        option_comparison: staging_option_comparison(),
        decision_brief: { options: staging_decision_brief_options() },
        graph: { nodes: [], edges: [] },
        factor_sensitivity: [
          { factor_id: 'fac_team_size', confidence: 0.375 },
        ],
        robustness: { level: 'moderate', fragile_edges: [] },
      },
    });
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [fact],
      requestId: 'req-staging-shape',
      scenarioId: 'scen-22c9e91b',
      signal: notAbortedSignal(),
      brief: 'We are weighing three options for scaling delivery.',
    });
    expect(out).not.toBe([fact]);
    expect(out).toHaveLength(1);
    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const enrichment = patched.result.enrichment as Record<string, unknown>;
    const dr = enrichment.decision_review as Record<string, unknown>;
    expect(dr).toBeDefined();
    expect(dr.narrative_summary).toBe(
      'Engage Offshore Partner leads on the current evidence.',
    );
    // Round-trip integrity: option_comparison source was preserved verbatim
    // (enricher is a pure passthrough other than attaching decision_review).
    expect((enrichment.option_comparison as unknown[]).length).toBe(3);
    // The decision_brief subtree also preserved.
    expect(((enrichment.decision_brief as Record<string, unknown>).options as unknown[]).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 3A content-thinness diagnostic (F1, 2026-05-18).
//
// The V5DecisionReviewCompleted event lets operators discriminate between
// (a) sparse PLoT envelope → empty Phase 3 blocks (input-side gap) vs
// (b) dense PLoT envelope → over-filtered LLM output (output-side gap).
//
// Contract (privacy-critical):
//  - `request_id` and `scenario_id` are strings (routing keys, present
//    on every decision_review event for correlation).
//  - Every NON-ROUTING field in the event payload is a finite number or
//    boolean. No other strings, no arrays, no nested objects.
//  - No prose, no graph labels, no raw IDs (beyond routing), no scenario
//    text, no decision_review content of any kind.
//
// These tests pin every part of that contract so a future regression
// (e.g. someone adding `narrative_summary` to the payload "for debugging")
// fails immediately.
// ---------------------------------------------------------------------------

describe('V5DecisionReviewCompleted — Phase 3A density telemetry', () => {
  let events: Array<{ name: string; data: Record<string, unknown> }>;
  beforeEach(() => {
    vi.restoreAllMocks();
    events = [];
    setTestSink((name, data) => events.push({ name, data }));
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  function findCompleted(requestId: string): Record<string, unknown> | null {
    const match = events.find(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewCompleted &&
        e.data.request_id === requestId,
    );
    return match ? match.data : null;
  }

  /**
   * Realistic envelope that exercises every input-density field at non-zero:
   * a 2-node / 1-edge graph; factor_sensitivity with one entry that has
   * confidence and one that doesn't; one fragile edge; populated results,
   * option_comparison, and decision_brief.options.
   */
  function denseEnrichment(): Record<string, unknown> {
    return {
      results: [
        { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      ],
      option_comparison: [
        { option_id: 'opt-1', label: 'Option A', win_probability: 0.7 },
        { option_id: 'opt-2', label: 'Option B', win_probability: 0.3 },
      ],
      decision_brief: {
        options: [
          { option_id: 'opt-1', label: 'Option A', win_probability: 0.7, rank: 1 },
          { option_id: 'opt-2', label: 'Option B', win_probability: 0.3, rank: 2 },
          { option_id: 'opt-3', label: 'Option C', win_probability: 0.0, rank: 3 },
        ],
      },
      factor_sensitivity: [
        { factor_id: 'f1', elasticity: 0.4, confidence: 0.8 },
        { factor_id: 'f2', elasticity: 0.2 }, // no confidence
      ],
      robustness: {
        level: 'stable',
        fragile_edges: [{ from_node_id: 'a', to_node_id: 'b', switch_probability: 0.1 }],
      },
      graph: {
        nodes: [
          { id: 'a', label: 'A', kind: 'factor' },
          { id: 'b', label: 'B', kind: 'option' },
        ],
        edges: [{ id: 'e1', from_node_id: 'a', to_node_id: 'b' }],
      },
    };
  }

  /**
   * Realistic dense LLM output mirroring the v11 prompt's documented shape.
   * Includes strings (which must be reported as `.length` only — never
   * exfiltrated as prose), object maps, and arrays.
   */
  function denseOutput(): Record<string, unknown> {
    return {
      winner: { option_id: 'opt-1', option_label: 'Option A' },
      runner_up: { option_id: 'opt-2', option_label: 'Option B' },
      narrative_summary: 'Option A leads with a 70% win probability driven by factor A.',
      // Live shape per the served prompt contract (defaults.ts OUTPUT_SCHEMA):
      // story_headlines is a Record<option_id, string>, never an array.
      story_headlines: { 'opt-1': 'Headline one', 'opt-2': 'Headline two' },
      robustness_explanation: {
        summary: 'The result is reasonably stable but watch factor B.',
        primary_risk: 'Factor B reversal',
        stability_factors: ['Factor A momentum', 'Strong market timing'],
        fragility_factors: ['Factor B reversal'],
      },
      readiness_rationale: 'Adequate evidence on top drivers.',
      evidence_enhancements: {
        f1: {
          specific_action: 'Run customer survey on factor A.',
          rationale: 'Confidence still bounded.',
          evidence_type: 'customer_research',
          decision_hygiene: 'Estimate the answer before looking at data.',
        },
        f2: {
          specific_action: 'Pull historical conversion data.',
          rationale: 'Sparse historical baseline.',
          evidence_type: 'internal_data',
          decision_hygiene: 'Assign someone to argue the opposite assumption.',
        },
      },
      scenario_contexts: {
        e1: {
          trigger_description: 'If factor A weakens...',
          consequence: '...then Option B overtakes Option A.',
        },
      },
      flip_thresholds: [
        {
          factor_id: 'f1',
          factor_label: 'Factor A',
          current_display: '0.4',
          flip_display: '0.2',
          narrative: 'If Factor A moves from 0.4 to 0.2 the result changes.',
        },
      ],
      bias_findings: [
        {
          bias_type: 'anchoring',
          description: 'Anchored on first estimate.',
          grounding: 'critique 1',
        },
      ],
      key_assumptions: ['Market growth holds.', 'Capacity scales linearly.'],
      decision_quality_prompts: ['What would change your mind?'],
      pre_mortem: { summary: 'If this fails...', grounded_in: [] },
      framing_check: { issue: null },
    };
  }

  function mockInvokeReturning(output: Record<string, unknown> | null): void {
    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output,
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 10,
      input_tokens: 1,
      output_tokens: 1,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    });
  }

  it('emits V5DecisionReviewCompleted on successful invocation with input + output density', async () => {
    mockInvokeReturning(denseOutput());

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-dense',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-completed-dense');
    expect(data).not.toBeNull();
    // Input density assertions
    expect(data!.enrichment_has_graph).toBe(true);
    expect(data!.enrichment_graph_node_count).toBe(2);
    expect(data!.enrichment_graph_edge_count).toBe(1);
    expect(data!.enrichment_factor_sensitivity_count).toBe(2);
    expect(data!.enrichment_factor_sensitivity_with_confidence_count).toBe(1);
    expect(data!.enrichment_robustness_fragile_edges_count).toBe(1);
    expect(data!.enrichment_results_count).toBe(1);
    expect(data!.enrichment_option_comparison_count).toBe(2);
    expect(data!.enrichment_decision_brief_options_count).toBe(3);
    // Output density assertions
    expect(data!.output_narrative_summary_length).toBeGreaterThan(0);
    expect(data!.output_robustness_explanation_summary_length).toBeGreaterThan(0);
    expect(data!.output_robustness_stability_factors_count).toBe(2);
    expect(data!.output_robustness_fragility_factors_count).toBe(1);
    expect(data!.output_evidence_enhancements_count).toBe(2);
    // Both entries in denseOutput() have non-empty specific_action,
    // rationale, AND decision_hygiene, so both are composer-usable.
    expect(data!.output_evidence_enhancements_usable_count).toBe(2);
    expect(data!.output_scenario_contexts_count).toBe(1);
    expect(data!.output_flip_thresholds_count).toBe(1);
    expect(data!.output_bias_findings_count).toBe(1);
    expect(data!.output_key_assumptions_count).toBe(2);
    expect(data!.output_story_headlines_count).toBe(2);
    expect(data!.output_decision_quality_prompts_count).toBe(1);
    expect(data!.output_has_pre_mortem).toBe(true);
    expect(data!.output_has_framing_check).toBe(true);
    // duration_ms must be present and a finite number
    expect(typeof data!.duration_ms).toBe('number');
    expect(Number.isFinite(data!.duration_ms as number)).toBe(true);
  });

  it('safely reports zero for every missing / empty input + output field', async () => {
    mockInvokeReturning({
      winner: { option_id: 'opt-1', option_label: 'Option A' },
      // No narrative_summary, no robustness_explanation, no evidence_enhancements,
      // no scenario_contexts, no flip_thresholds, no bias_findings,
      // no key_assumptions, no story_headlines, no decision_quality_prompts,
      // no pre_mortem, no framing_check.
    });

    // Minimal enrichment: only the results array needed to clear `no_winner`
    // — every other field absent.
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({
        enrichment: {
          results: [{ option_id: 'opt-1', option_label: 'Option A', win_probability: 1 }],
        },
        leading_option_id: 'opt-1',
      }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-empty',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-completed-empty');
    expect(data).not.toBeNull();
    expect(data!.enrichment_has_graph).toBe(false);
    expect(data!.enrichment_graph_node_count).toBe(0);
    expect(data!.enrichment_graph_edge_count).toBe(0);
    expect(data!.enrichment_factor_sensitivity_count).toBe(0);
    expect(data!.enrichment_factor_sensitivity_with_confidence_count).toBe(0);
    expect(data!.enrichment_robustness_fragile_edges_count).toBe(0);
    expect(data!.enrichment_results_count).toBe(1);
    expect(data!.enrichment_option_comparison_count).toBe(0);
    expect(data!.enrichment_decision_brief_options_count).toBe(0);
    expect(data!.output_narrative_summary_length).toBe(0);
    expect(data!.output_robustness_explanation_summary_length).toBe(0);
    expect(data!.output_robustness_stability_factors_count).toBe(0);
    expect(data!.output_robustness_fragility_factors_count).toBe(0);
    expect(data!.output_evidence_enhancements_count).toBe(0);
    expect(data!.output_evidence_enhancements_usable_count).toBe(0);
    expect(data!.output_scenario_contexts_count).toBe(0);
    expect(data!.output_flip_thresholds_count).toBe(0);
    expect(data!.output_bias_findings_count).toBe(0);
    expect(data!.output_key_assumptions_count).toBe(0);
    expect(data!.output_story_headlines_count).toBe(0);
    expect(data!.output_decision_quality_prompts_count).toBe(0);
    expect(data!.output_has_pre_mortem).toBe(false);
    expect(data!.output_has_framing_check).toBe(false);
  });

  // ==========================================================================
  // ROADMAP 1.78 residual — output_story_headlines_count map-shape mis-count.
  //
  // The served prompt contract (defaults.ts OUTPUT_SCHEMA) emits
  // story_headlines as a Record<option_id, string>, but the density helper
  // counted it via Array.isArray — so output_story_headlines_count was
  // permanently 0 on every live turn while headlines actually shipped
  // (proven live 2026-07-16: wire had 3 headlines, telemetry logged 0).
  // ==========================================================================

  it('counts MAP-shaped story_headlines (real staging capture: 4 headlines, not 0)', async () => {
    // REAL staging capture: the persisted coaching payload carries
    // story_headlines in exactly the live map shape keyed by option_id.
    // Provenance: tests/fixtures/cross-service/*.metadata.json. Never hand-edit.
    const here = dirname(fileURLToPath(import.meta.url));
    const fixturePath = join(
      here, '..', '..', '..', '..',
      'tests', 'fixtures', 'cross-service', 'v5-turn.run-analysis.staging.json',
    );
    const turn = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
      blocks: Array<Record<string, unknown>>;
    };
    const block = turn.blocks.find((b) => b.type === 'analysis_result');
    if (!block) throw new Error('fixture: no analysis_result block');
    const coaching = (block.enrichment as Record<string, unknown>)
      .m1_coaching as Record<string, unknown>;
    const fixtureHeadlines = coaching.story_headlines as Record<string, string>;

    // Pin the fixture facts this test's proof rests on: the live shape is a
    // plain object keyed by option_id (NOT an array) with 4 entries.
    expect(Array.isArray(fixtureHeadlines)).toBe(false);
    expect(typeof fixtureHeadlines).toBe('object');
    expect(Object.keys(fixtureHeadlines)).toHaveLength(4);

    mockInvokeReturning({
      winner: { option_id: 'opt-1', option_label: 'Option A' },
      story_headlines: fixtureHeadlines,
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-headlines-map',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-headlines-map');
    expect(data).not.toBeNull();
    // THE BUG: this read 0 on the live path while 4 headlines shipped.
    expect(data!.output_story_headlines_count).toBe(4);
  });

  it('still counts legacy ARRAY-shaped story_headlines (shape tolerance preserved)', async () => {
    mockInvokeReturning({
      winner: { option_id: 'opt-1', option_label: 'Option A' },
      story_headlines: ['h1', 'h2', 'h3'],
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-headlines-array',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-headlines-array');
    expect(data).not.toBeNull();
    expect(data!.output_story_headlines_count).toBe(3);
  });

  it('never includes prose, labels, raw IDs, or any string content in the payload', async () => {
    // Output and enrichment carry obvious user-prose / label / ID markers
    // we can pattern-match for. If any of these strings appears anywhere
    // in the event payload (recursively serialised), the privacy contract
    // is broken.
    const proseMarker = 'SENSITIVE_USER_PROSE_DO_NOT_LOG';
    const labelMarker = 'NODE_LABEL_DO_NOT_LOG';
    const idMarker = 'FACTOR_ID_DO_NOT_LOG';
    const briefMarker = 'BRIEF_TEXT_DO_NOT_LOG';

    mockInvokeReturning({
      winner: { option_id: idMarker, option_label: labelMarker },
      narrative_summary: proseMarker,
      robustness_explanation: { summary: proseMarker },
      evidence_enhancements: {
        [idMarker]: {
          specific_action: proseMarker,
          rationale: proseMarker,
          decision_hygiene: proseMarker,
        },
      },
      scenario_contexts: { [idMarker]: { trigger_description: proseMarker } },
      key_assumptions: [proseMarker],
      story_headlines: [proseMarker],
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({
        enrichment: {
          results: [{ option_id: idMarker, option_label: labelMarker, win_probability: 1 }],
          graph: {
            nodes: [{ id: idMarker, label: labelMarker, kind: 'factor' }],
            edges: [],
          },
          factor_sensitivity: [{ factor_id: idMarker, confidence: 0.5 }],
        },
        leading_option_id: idMarker,
      }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-privacy',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: briefMarker,
    });

    const data = findCompleted('req-completed-privacy');
    expect(data).not.toBeNull();
    const serialised = JSON.stringify(data);
    expect(serialised).not.toContain(proseMarker);
    expect(serialised).not.toContain(labelMarker);
    expect(serialised).not.toContain(idMarker);
    expect(serialised).not.toContain(briefMarker);

    // Defence-in-depth: every non-{request_id, scenario_id} value MUST be a
    // finite number or boolean. The two ID fields are routing-only and were
    // already present on the existing skipped/failed/invoked events.
    for (const [key, value] of Object.entries(data!)) {
      if (key === 'request_id' || key === 'scenario_id') continue;
      const isNumber = typeof value === 'number' && Number.isFinite(value);
      const isBoolean = typeof value === 'boolean';
      expect(isNumber || isBoolean, `field ${key} must be a finite number or boolean, got ${typeof value}`).toBe(true);
    }
  });

  it('enrichment_has_graph reports false for an object missing nodes[]/edges[] arrays', async () => {
    // Tightened predicate (post-review): `has_graph` reports the
    // consumer-usable shape, not just "graph is an object". A
    // `{nodes: 'oops', edges: null}` shape — structurally an object but
    // not what buildGraphNodeLookup can consume — reports false, matching
    // the composer fail-closed semantic. Without this tightening,
    // operators would see `has_graph: true` on a turn where every
    // graph-ref block dropped anyway, masking the real Gap 1 signal.
    mockInvokeReturning(denseOutput());

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({
        enrichment: {
          results: [{ option_id: 'opt-1', option_label: 'Option A', win_probability: 1 }],
          // Pathological graph: object present, but nodes is a string and
          // edges is null. buildGraphNodeLookup cannot consume this.
          graph: { nodes: 'oops', edges: null },
        },
        leading_option_id: 'opt-1',
      }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-has-graph-strict',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-has-graph-strict');
    expect(data).not.toBeNull();
    expect(data!.enrichment_has_graph).toBe(false);
    expect(data!.enrichment_graph_node_count).toBe(0);
    expect(data!.enrichment_graph_edge_count).toBe(0);
  });

  it('evidence_enhancements_usable_count drops stub entries the composer would reject (including whitespace-only)', async () => {
    // The composer's prose-validation gate at phase3-blocks.ts:469-486
    // calls `.trim()` on `specific_action`, `rationale`, and
    // `decision_hygiene` before length-checking, so a whitespace-only
    // string like "   " is treated as empty. The usable count must
    // apply the SAME trim — without it, dashboards would report
    // composer-droppable stubs as usable. This fixture covers every
    // drop mode the composer recognises:
    //   - empty string
    //   - missing field entirely
    //   - whitespace-only string (the trim-mirror case)
    //   - non-record value
    mockInvokeReturning({
      winner: { option_id: 'opt-1', option_label: 'Option A' },
      evidence_enhancements: {
        good: {
          specific_action: 'Run customer survey.',
          rationale: 'Confidence still bounded.',
          decision_hygiene: 'Estimate first.',
        },
        // Stub 1: empty specific_action
        stub_specific_empty: {
          specific_action: '',
          rationale: 'has rationale',
          decision_hygiene: 'has hygiene',
        },
        // Stub 2: missing rationale entirely
        stub_rationale_missing: {
          specific_action: 'has action',
          decision_hygiene: 'has hygiene',
        },
        // Stub 3: empty decision_hygiene
        stub_hygiene_empty: {
          specific_action: 'has action',
          rationale: 'has rationale',
          decision_hygiene: '',
        },
        // Stub 4: whitespace-only specific_action — the composer trims
        // before length-checking, so the block drops. The usable count
        // MUST match this behaviour or it will over-report.
        stub_whitespace_specific: {
          specific_action: '   ',
          rationale: 'has rationale',
          decision_hygiene: 'has hygiene',
        },
        // Stub 5: whitespace-only rationale (tabs + newlines + spaces)
        stub_whitespace_rationale: {
          specific_action: 'has action',
          rationale: '\t\n  \r\n',
          decision_hygiene: 'has hygiene',
        },
        // Stub 6: whitespace-only decision_hygiene
        stub_whitespace_hygiene: {
          specific_action: 'has action',
          rationale: 'has rationale',
          decision_hygiene: ' ',
        },
        // Stub 7: not even a record
        stub_garbage: 'not an object',
      },
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({
        enrichment: {
          results: [{ option_id: 'opt-1', option_label: 'Option A', win_probability: 1 }],
        },
        leading_option_id: 'opt-1',
      }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-usable-count',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-usable-count');
    expect(data).not.toBeNull();
    // Raw count counts every key including all 7 stubs and the good one.
    expect(data!.output_evidence_enhancements_count).toBe(8);
    // Usable count picks out only the single fully-populated entry.
    // Every whitespace-only and empty/missing-field case is excluded,
    // matching the composer's trim-then-length-check gate.
    expect(data!.output_evidence_enhancements_usable_count).toBe(1);
  });

  it('duration_ms reflects time through attach, not shape extraction (regression for emit-ordering fix)', async () => {
    // Pairs with the emit-ordering fix and the doc clarification that
    // duration_ms measures the full invoked → emit window. If a future
    // refactor moves the duration computation back to payload-
    // construction time (i.e. before sanitiseEnrichment), sanitise +
    // attach latency would be silently excluded from the figure and
    // latency dashboards would understate true success-path cost.
    //
    // We control Date.now() so the test is deterministic: startedAt is
    // captured at the first call, the sanitise spy advances the clock by
    // a known amount, and duration_ms must reflect that advance.
    mockInvokeReturning(denseOutput());

    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const sanitiseMod = await import('../../compose/sanitise-enrichment.js');
    const originalSanitise = sanitiseMod.sanitiseEnrichment;
    vi.spyOn(sanitiseMod, 'sanitiseEnrichment').mockImplementation((arg) => {
      // Simulate 42ms of sanitise + attach work between startedAt and
      // the deferred emit site below.
      now += 42;
      return originalSanitise(arg);
    });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];
    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-duration-through-attach',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-duration-through-attach');
    expect(data).not.toBeNull();
    // The 42ms sanitise advance MUST be visible in the reported figure.
    // A pre-fix implementation would report 0 (or a value strictly less
    // than 42) because duration was computed before the sanitise spy
    // ran.
    expect(data!.duration_ms).toBeGreaterThanOrEqual(42);
  });

  it('completed payload contains no string values except request_id and scenario_id (type contract)', async () => {
    // Narrow regression assertion: the privacy test above checks for
    // marker leakage in a poisoned-input scenario, but it would not catch
    // a "benign-looking" regression such as someone adding a literal
    // `status: 'ok'` or `model: 'gpt-4.1'` to the payload. This test runs
    // against the realistic dense fixture and asserts the type contract
    // exhaustively: every field is either the request_id / scenario_id
    // routing pair (strings, allowed) OR a finite number / boolean. No
    // other string values are permitted, ever.
    mockInvokeReturning(denseOutput());

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-type-contract',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const data = findCompleted('req-completed-type-contract');
    expect(data).not.toBeNull();

    const stringFields: string[] = [];
    for (const [key, value] of Object.entries(data!)) {
      if (typeof value === 'string') stringFields.push(key);
    }
    expect(stringFields.sort()).toEqual(['request_id', 'scenario_id']);
  });

  it('does not fire when the enricher skips (no_brief)', async () => {
    // Skip-path safety: the completed event is strictly a success-path
    // signal. A precondition skip MUST NOT emit it — otherwise dashboards
    // would double-count attempts.
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-noskip-on-skip',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: null,
    });

    expect(spy).not.toHaveBeenCalled();
    const completed = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewCompleted &&
        e.data.request_id === 'req-completed-noskip-on-skip',
    );
    expect(completed).toHaveLength(0);

    // The existing skip event should still fire — proving the skip path
    // contract is preserved.
    const skipped = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewSkipped &&
        e.data.request_id === 'req-completed-noskip-on-skip',
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0].data.reason).toBe('no_brief');
  });

  it('mutual exclusion: a post-extraction throw produces `failed` but NOT `completed`', async () => {
    // Regression guard for the emit-ordering fix. Before the move,
    // V5DecisionReviewCompleted was emitted immediately after shape
    // extraction succeeded — if `sanitiseEnrichment` (or anything between
    // extraction and `return next;`) threw, the catch block would also
    // fire `V5DecisionReviewFailed`, producing both events for one
    // invocation. The emit is now deferred until after the attach, so
    // the two events MUST be mutually exclusive on every code path.
    mockInvokeReturning(denseOutput());

    // Force sanitiseEnrichment to throw after the LLM call returns. We
    // re-import the module dynamically and overwrite the export so the
    // enricher's bound reference picks it up via the module object.
    const sanitiseMod = await import('../../compose/sanitise-enrichment.js');
    const spy = vi
      .spyOn(sanitiseMod, 'sanitiseEnrichment')
      .mockImplementation(() => {
        throw new Error('induced sanitise failure');
      });

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-mutex',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const completed = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewCompleted &&
        e.data.request_id === 'req-completed-mutex',
    );
    const failed = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewFailed &&
        e.data.request_id === 'req-completed-mutex',
    );
    expect(completed).toHaveLength(0);
    expect(failed).toHaveLength(1);
    expect(failed[0].data.reason).toBe('induced sanitise failure');
  });

  it('does not fire when the enricher fails (shape_extraction_failed)', async () => {
    // Failure-path safety: the completed event is strictly a success-path
    // signal. A shape-failure MUST emit `failed` but NOT `completed`.
    mockInvokeReturning(null);

    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: denseEnrichment(), leading_option_id: 'opt-1' }),
    ];

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-completed-noemit-on-fail',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    const completed = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewCompleted &&
        e.data.request_id === 'req-completed-noemit-on-fail',
    );
    expect(completed).toHaveLength(0);

    const failed = events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewFailed &&
        e.data.request_id === 'req-completed-noemit-on-fail',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].data.reason).toBe('shape_extraction_failed');
  });
});

/**
 * ROADMAP 1.77 (B1) — CEE_DECISION_REVIEW_DECOMPOSE flag branch at the
 * enricher. The dedicated flag selects monolith-vs-decomposed; flag-off is
 * byte-identical to today (the enricher invokes the gpt-4.1 monolith and never
 * touches the decomposed composer). This is the integration-level proof of
 * 07-REVIEW R4.
 */
describe('enricher — CEE_DECISION_REVIEW_DECOMPOSE flag branch (B1)', () => {
  const RESULT = {
    output: { narrative_summary: 'x', story_headlines: { 'opt-1': 'a' } },
    raw: '{}',
    model: 'm',
    provider: 'p',
    llm_latency_ms: 1,
    input_tokens: 1,
    output_tokens: 1,
    prompt_version: 'v',
    resolution: MOCK_RESOLUTION,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('flag OFF (default) → invokes the MONOLITH, never the decomposed composer', async () => {
    expect(config.cee.decisionReviewDecompose).toBe(false);
    const monolith = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue(RESULT);
    const decomposed = vi
      .spyOn(decomposeMod, 'invokeDecomposedDecisionReview')
      .mockResolvedValue(RESULT);

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact({ enrichment: minimalEnrichment(), leading_option_id: 'opt-1' })],
      requestId: 'req-flag-off',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    expect(monolith).toHaveBeenCalledTimes(1);
    expect(decomposed).not.toHaveBeenCalled();
  });

  it('flag ON → invokes the DECOMPOSED composer, not the monolith directly', async () => {
    vi.stubEnv('CEE_DECISION_REVIEW_DECOMPOSE', 'true');
    _resetConfigCache();
    expect(config.cee.decisionReviewDecompose).toBe(true);

    const monolith = vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue(RESULT);
    const decomposed = vi
      .spyOn(decomposeMod, 'invokeDecomposedDecisionReview')
      .mockResolvedValue(RESULT);

    await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact({ enrichment: minimalEnrichment(), leading_option_id: 'opt-1' })],
      requestId: 'req-flag-on',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
      brief: DEFAULT_BRIEF,
    });

    expect(decomposed).toHaveBeenCalledTimes(1);
    expect(monolith).not.toHaveBeenCalled();
  });
});
