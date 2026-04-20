import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';

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
});
