/**
 * Minimal claim-safety guards for the V5 context-reliability lane.
 *
 * Scope (NOT the full Brief 5 cage): prove that the context/coaching
 * consumers of OPTIONAL analysis fields
 *   (a) keep missing fields MISSING (null / [] / 'unknown'), never coerced to a
 *       fabricated zero or a fabricated "present" value, and
 *   (b) never REHYDRATE unavailable confidence / robustness / EVPI / E-value /
 *       sensitivity fields from internal carriers (`_meta`, downstream_calls)
 *       into the projection prose consumes.
 *
 * The two `?? 0` sites the audit surfaced
 *   (analysis-result-headline.ts switch_probability, decision-review-enricher
 *    win_probability) run at run_analysis time (fresh by construction) and use
 * the 0 only as a ranking/projection sentinel, never as a surfaced claim — so
 * they get regression COVERAGE here, not a code change.
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { buildAnalysisFromPriorFacts } from '../../context/analysis-fallback.js';
import { buildAnalysisResultHeadline } from '../analysis-result-headline.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function mkFact(enrichment: Record<string, unknown>, opts: {
  leading?: string | null;
  winProbabilities?: Record<string, number>;
} = {}): RunAnalysisHandlerFact {
  const result: Record<string, unknown> = {
    scenario_id: SCENARIO_ID,
    leading_option_id: opts.leading ?? 'opt_a',
    summary: 'Ran analysis.',
    enrichment,
  };
  if (opts.winProbabilities !== undefined) result.win_probabilities = opts.winProbabilities;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result,
  } as unknown as RunAnalysisHandlerFact;
}

describe('claim-safety — missing optional analysis fields stay missing (not zero)', () => {
  it('projection with no drivers/robustness/2nd-option → [] / unknown / null margin, NOT zero', () => {
    // Minimal enrichment: a single option, no factor_sensitivity, no robustness.
    const fact = mkFact(
      {},
      { leading: 'opt_a', winProbabilities: { opt_a: 0.62 } },
    );
    const summary = buildAnalysisFromPriorFacts([fact as HandlerFact]);
    expect(summary).not.toBeNull();
    // Drivers absent → empty array, NOT a fabricated driver.
    expect(summary!.top_drivers).toEqual([]);
    // Robustness absent → honest 'unknown', NOT a fabricated band.
    expect(summary!.robustness_level).toBe('unknown');
    // Single option → margin is null (missing), NOT 0.
    expect(summary!.margin).toBeNull();
    expect(summary!.margin_pp).toBeNull();
  });

  it('margin is a real null for a single-option result (missing ≠ 0pp lead)', () => {
    const fact = mkFact({}, { leading: 'opt_only', winProbabilities: { opt_only: 0.9 } });
    const summary = buildAnalysisFromPriorFacts([fact as HandlerFact]);
    expect(summary!.margin_pp).toBeNull();
    expect(summary!.margin_pp).not.toBe(0);
  });
});

describe('claim-safety — no rehydration from internal carriers', () => {
  it('does NOT rehydrate drivers/robustness from a stripped _meta carrier', () => {
    // Top-level science fields are absent/empty, but populated copies are buried
    // in the internal `_meta` carrier (which egress strips). The projection must
    // NOT pull them up — drivers stay [], robustness stays 'unknown'.
    const fact = mkFact(
      {
        // empty top-level — nothing claim-usable here
        factor_sensitivity: [],
        robustness: {},
        edge_e_values: [],
        inference_warnings: [],
        _meta: {
          payloads: {
            isl_response: {
              factor_sensitivity: [{ factor_id: 'fac_secret', confidence: 0.9 }],
              robustness: { robustness_level: 'high', fragile_edges: [{ edge_id: 'e1', switch_probability: 0.8 }] },
              edge_e_values: [{ edge_id: 'e1', e_value: 3.2 }],
              inference_warnings: [{ code: 'below_resolution', text: 'secret warning' }],
            },
          },
        },
      },
      { leading: 'opt_a', winProbabilities: { opt_a: 0.55, opt_b: 0.45 } },
    );
    const summary = buildAnalysisFromPriorFacts([fact as HandlerFact]);
    expect(summary).not.toBeNull();
    // The internal _meta copies are NOT surfaced.
    expect(summary!.top_drivers).toEqual([]);
    expect(summary!.robustness_level).toBe('unknown');
    const json = JSON.stringify(summary);
    expect(json).not.toContain('fac_secret');
    expect(json).not.toContain('secret warning');
    expect(json).not.toContain('e_value');
  });
});

describe('claim-safety — the `?? 0` audit sites do not fabricate a surfaced claim', () => {
  it('headline: a fragile edge missing switch_probability does not crash or fabricate a "0" claim', () => {
    // The `?? 0` at analysis-result-headline.ts is a RANKING sentinel for
    // picking the most-fragile edge label; it must never surface as a "0%" claim.
    const fact = {
      enrichment: {
        option_comparison: [
          { option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 },
          { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.3 },
        ],
        robustness: {
          robustness_level: 'low',
          // fragile edge WITHOUT switch_probability — exercises the `?? 0` site.
          fragile_edges: [{ edge_id: 'e1', from_label: 'Cost', to_label: 'Goal' }],
        },
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok' as const,
    };
    const headline = buildAnalysisResultHeadline(fact);
    // Either a safe string or null — never a throw.
    expect(headline === null || typeof headline === 'string').toBe(true);
    if (typeof headline === 'string') {
      // No fabricated zero-probability claim leaked into user-facing prose.
      //
      // ⚠ BOUND BY IDENTITY, NOT BY SUBSTRING. This assertion read
      // `not.toContain('0%')` until the headline began stating the leader's own
      // win probability — at which point a perfectly honest "70%" failed it,
      // because "0%" is a substring of "70%". The assertion had always been a
      // value predicate another string could satisfy (CLAUDE.md trap 19); it
      // simply had no counter-example until now. Anchored on the word boundary
      // so it catches the fabricated zero it was written for and nothing else.
      expect(headline).not.toMatch(/(?<!\d)0%/);
      expect(headline).not.toMatch(/\b0(\.0+)?\s*%/);
    }
  });
});
