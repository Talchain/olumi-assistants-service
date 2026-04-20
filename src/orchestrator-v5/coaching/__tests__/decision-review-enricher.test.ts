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
  return {
    'v5.brief': 'Decision brief about pricing strategy',
    results: [
      { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
    ],
    factor_sensitivity: [{ label: 'Price', direction: 'positive', elasticity: 0.2 }],
    robustness: { level: 'stable', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
  };
}

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
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when v5.brief is empty or missing', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const facts: readonly HandlerFact[] = [
      runAnalysisFact({ enrichment: { results: [] } }),
    ];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
    });
    expect(out).toBe(facts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when results is empty (no winner available)', async () => {
    const spy = vi.spyOn(invokeMod, 'invokeDecisionReview');
    const enrichment = { 'v5.brief': 'a brief', results: [] };
    const facts: readonly HandlerFact[] = [runAnalysisFact({ enrichment })];
    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: facts,
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: notAbortedSignal(),
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
    });

    expect(out).not.toBe(facts);
    expect(out).toHaveLength(1);
    const patched = out[0];
    expect(patched.fact_type).toBe('run_analysis');
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const enrichment = patched.result.enrichment as Record<string, unknown>;
    expect(enrichment['v5.brief']).toBe('Decision brief about pricing strategy');
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
    });

    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const patchedEnrichment = patched.result.enrichment as Record<string, unknown>;
    expect(patchedEnrichment.meta).toEqual({ seed_used: 42, n_samples: 1000, response_hash: 'abc' });
    expect(patchedEnrichment.review_cards).toEqual([{ id: 'card-1' }]);
    expect(patchedEnrichment.decision_review).toBeDefined();
  });
});
