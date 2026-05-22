/**
 * Contract integration test: prove that `pickLatestRawRobustness(prior_facts)`
 * composes correctly with `tryPostAnalysisAdviceGate` so the raw fragile /
 * near-tie signals override a conflicting projected `robustness_band`.
 *
 * Why this exists alongside the per-helper unit tests
 * ---------------------------------------------------
 * The unit tests prove each helper does the right thing in isolation. They
 * do NOT prove the turn-executor call site is still threading the helper's
 * output into the gate input. A future refactor that drops the
 * `rawRobustness: pickLatestRawRobustness(context.prior_facts)` line in
 * `turn-executor.ts` would leave the unit tests passing while silently
 * regressing the override path in production. This test exercises the
 * helper → gate pipeline as a single contract so the override-on-conflict
 * behaviour survives any future refactor of the threading.
 *
 * Scope: helpers + gate composition only. Full `runTurnExecutor` integration
 * (Anthropic/PLoT mocks, request lifecycle, telemetry emission) is covered
 * by the dedicated turn-executor suites; reproducing that scaffolding here
 * would be disproportionate to the contract under test.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestRawRobustness } from '../pick-raw-robustness.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../../routing/post-analysis-advice-gate.js';

/**
 * Minimal HandlerFact builder — mirrors the shape `selectRunAnalysisFact`
 * and `pickLatestRawRobustness` actually parse. Anything beyond
 * `result.enrichment.robustness` is irrelevant to this contract.
 */
function runAnalysisFact(opts: {
  readonly id: string;
  readonly robustness?: Record<string, unknown>;
}): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (opts.robustness !== undefined) {
    enrichment.robustness = opts.robustness;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: opts.id,
      summary: `Run ${opts.id}`,
      win_probabilities: { 'opt-a': 0.55, 'opt-b': 0.45 },
      enrichment: Object.keys(enrichment).length > 0 ? enrichment : undefined,
    },
  };
}

describe('raw-robustness → gate integration (contract)', () => {
  // ── 1. Conflicting projection: raw `very_low` wins over projected `moderate` ─
  it('raw level=very_low overrides projected robustness_band=moderate (margin > 1pp)', () => {
    // Wide margin so the gate's own margin-based near-tie path does NOT
    // fire — the override has to come from the raw fragile signal alone.
    const priorFacts: readonly HandlerFact[] = [
      runAnalysisFact({
        id: 'opt-a',
        robustness: { level: 'very_low' },
      }),
    ];

    const rawRobustness = pickLatestRawRobustness(priorFacts);
    expect(rawRobustness).toEqual({
      level: 'very_low',
      near_tie_is_tie: false,
    });

    const analysis: AdviceGateAnalysis = {
      status: 'success',
      leading_option: { label: 'Hire One Tech Lead', probability: 0.55 },
      runner_up: { label: 'Hire Two Developers', probability: 0.45 },
      margin_pp: 10, // wide
      robustness_band: 'moderate', // confidently wrong projection
      top_drivers: [{ factor_label: 'Delivery risk', sensitivity_value: 0.45 }],
    };

    const out = tryPostAnalysisAdviceGate({
      message: 'Can you explain these analysis results to me?',
      analysis,
      freshness: 'fresh',
      rawRobustness,
    });

    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      // Raw fragile signal must surface as fragile-aware copy.
      expect(text).toMatch(/picture appears fragile/i);
      // Misleading projected band MUST NOT leak as a stability claim.
      expect(text).not.toContain('The robustness band is moderate');
      expect(text).not.toContain('The robustness band is stable');
    }
  });

  // ── 2. Raw `near_tie.is_tie=true` overrides margin-based non-tie verdict ─
  it('raw near_tie.is_tie=true overrides a margin-based "would not be a near-tie" projection', () => {
    const priorFacts: readonly HandlerFact[] = [
      runAnalysisFact({
        id: 'opt-a',
        robustness: { near_tie: { is_tie: true } },
      }),
    ];

    const rawRobustness = pickLatestRawRobustness(priorFacts);
    expect(rawRobustness?.near_tie_is_tie).toBe(true);

    const analysis: AdviceGateAnalysis = {
      status: 'success',
      leading_option: { label: 'A', probability: 0.515 },
      runner_up: { label: 'B', probability: 0.485 },
      margin_pp: 3.0, // would NOT trigger margin-based near-tie
      robustness_band: 'moderate',
      top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.4 }],
    };

    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis,
      freshness: 'fresh',
      rawRobustness,
    });

    expect(out.matched).toBe(true);
    if (out.matched) {
      const text = out.assistant_text;
      // Raw override drives the decision → generic "flagged as a near-tie"
      // wording (numerically true even when margin is wider than 1pp).
      expect(text).toMatch(/effectively tied/i);
      expect(text).toMatch(/flagged as a near[- ]tie/i);
      // Margin-based phrasing would be FALSE here (actual margin is 3pp).
      expect(text).not.toMatch(/one percentage point or less/i);
      expect(text).not.toContain('meaningful rather than marginal');
    }
  });

  // ── 3. No robustness signal → helper returns null → gate uses projection ─
  it('absent robustness signal → helper returns null, gate falls back to projection cleanly', () => {
    const priorFacts: readonly HandlerFact[] = [
      runAnalysisFact({ id: 'opt-a' }), // no enrichment.robustness
    ];

    const rawRobustness = pickLatestRawRobustness(priorFacts);
    expect(rawRobustness).toBeNull();

    const analysis: AdviceGateAnalysis = {
      status: 'success',
      leading_option: { label: 'A', probability: 0.62 },
      runner_up: { label: 'B', probability: 0.38 },
      margin_pp: 24, // wide lead — confident-path copy
      robustness_band: 'moderate',
      top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
    };

    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis,
      freshness: 'fresh',
      rawRobustness,
    });

    expect(out.matched).toBe(true);
    if (out.matched) {
      // Confident-path copy preserved when no raw override is available
      // — regression guard for the helper returning null cleanly.
      expect(out.assistant_text).toContain('meaningful rather than marginal');
      expect(out.assistant_text).toContain('The robustness band is moderate');
      expect(out.assistant_text).not.toMatch(/picture appears fragile/i);
    }
  });

  // ── 4. Empty prior_facts → null helper output, no override, projection wins ─
  it('empty prior_facts → helper null → gate projection unchanged', () => {
    const rawRobustness = pickLatestRawRobustness([]);
    expect(rawRobustness).toBeNull();

    const analysis: AdviceGateAnalysis = {
      status: 'success',
      leading_option: { label: 'A', probability: 0.62 },
      runner_up: { label: 'B', probability: 0.38 },
      margin_pp: 24,
      robustness_band: 'stable',
      top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
    };

    const out = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis,
      freshness: 'fresh',
      rawRobustness,
    });

    expect(out.matched).toBe(true);
    if (out.matched) {
      expect(out.assistant_text).toContain('meaningful rather than marginal');
      expect(out.assistant_text).toContain('The robustness band is stable');
    }
  });
});
