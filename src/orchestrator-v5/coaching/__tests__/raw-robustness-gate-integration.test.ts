/**
 * Two layers covering the rawRobustness override path:
 *
 *   1. Helper → gate contract: prove `pickLatestRawRobustness(prior_facts)`
 *      composes correctly with `tryPostAnalysisAdviceGate` so the raw
 *      fragile / near-tie signals override a conflicting projected band.
 *      These tests call the helpers directly — they do NOT prove the
 *      turn-executor call site still threads the helper's output into
 *      the gate input.
 *
 *   2. Turn-executor call-site wiring: a separate `describe` reads the
 *      source of `turn-executor.ts` and asserts the literal wiring
 *      expression is present. Fails immediately if the
 *      `rawRobustness: pickLatestRawRobustness(context.prior_facts)`
 *      line is removed — exactly the silent regression the contract
 *      tests above cannot catch. A full `runTurnExecutor` mock harness
 *      would be disproportionate to the wiring under test; the source-
 *      level assertion is the lightest test that fails for the specific
 *      refactor we care about.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
      // Raw override drives the decision → generic "the analysis treats
      // them as a near-tie" wording (numerically true even when margin
      // is wider than 1pp).
      expect(text).toMatch(/effectively tied/i);
      expect(text).toMatch(/the analysis treats .+ as a near[- ]tie/i);
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

// =========================================================================
// Turn-executor call-site wiring assertion.
//
// The contract tests above do NOT catch a regression where someone
// removes the `rawRobustness: pickLatestRawRobustness(context.prior_facts)`
// line from `turn-executor.ts`. This source-level assertion does. It is
// deliberately literal — a future formatting change that splits the
// expression across lines or renames the parameter would also break it,
// at which point the maintainer must either restore the literal form or
// update this assertion (a one-line, deliberate change, never silent).
// =========================================================================
describe('turn-executor call-site — rawRobustness wiring', () => {
  it('threads pickLatestRawRobustness(context.prior_facts) into the gate input', async () => {
    // __dirname-equivalent for ESM. Resolve to the worktree's
    // turn-executor.ts regardless of where vitest is invoked from.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const turnExecutorPath = path.resolve(here, '../../turn-executor.ts');
    const source = await readFile(turnExecutorPath, 'utf8');

    // Per-line, comment-stripped scan so a commented-out wiring line
    // never satisfies the assertion. We match against ACTIVE source
    // lines only — line-leading `//` comments are filtered out.
    const activeLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('//'));

    // The import must be present — otherwise the wiring expression below
    // would not even compile, but pinning it here makes the dependency
    // explicit at the test layer.
    const importLine = activeLines.find((line) =>
      /import\s*\{\s*pickLatestRawRobustness\s*\}\s*from\s*['"]\.\/coaching\/pick-raw-robustness\.js['"]/.test(line),
    );
    expect(importLine, 'pickLatestRawRobustness import missing from turn-executor.ts').toBeDefined();

    // The literal wiring expression on a non-comment line. If any of
    // these tokens is changed (key renamed, helper renamed, argument
    // swapped, or the line commented out), this assertion fails —
    // making the change deliberate.
    const wiringLine = activeLines.find((line) =>
      /rawRobustness\s*:\s*pickLatestRawRobustness\s*\(\s*context\.prior_facts\s*\)/.test(line),
    );
    expect(
      wiringLine,
      'rawRobustness: pickLatestRawRobustness(context.prior_facts) wiring missing from turn-executor.ts',
    ).toBeDefined();
  });
});
