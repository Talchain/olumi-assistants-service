/**
 * Unit tests for `pickLatestRawRobustness`.
 *
 * Contract: read `enrichment.robustness.level` (lower-cased, trimmed)
 * and `enrichment.robustness.near_tie.is_tie === true` from the SAME
 * run_analysis fact the freshness/projection layer selects (canonical
 * `selectRunAnalysisFact`). Returns null when no usable signal is
 * reachable. The post-analysis advice gate consumes these to keep
 * user-facing copy honest on near-tie / fragile results even when the
 * projection has canonicalised the band.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestRawRobustness } from '../pick-raw-robustness.js';

function runAnalysisFact(opts: {
  readonly id: string;
  readonly computed_at?: string;
  readonly robustness?: Record<string, unknown> | null;
  readonly noop?: boolean;
}): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (opts.robustness !== undefined) {
    enrichment.robustness = opts.robustness;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: opts.noop ?? false,
    result: {
      scenario_id: '00000000-0000-4000-8000-000000000001',
      leading_option_id: opts.id,
      summary: `Run ${opts.id}`,
      win_probabilities: { 'opt-a': 0.6, 'opt-b': 0.4 },
      ...(opts.computed_at !== undefined ? { computed_at: opts.computed_at } : {}),
      enrichment: Object.keys(enrichment).length > 0 ? enrichment : undefined,
    },
  };
}

describe('pickLatestRawRobustness', () => {
  it('returns null for an empty prior_facts array', () => {
    expect(pickLatestRawRobustness([])).toBeNull();
  });

  it('returns null when no run_analysis fact is present', () => {
    const facts = [
      { fact_type: 'edit_graph', fact_version: 1, noop: false, result: {} } as unknown as HandlerFact,
    ];
    expect(pickLatestRawRobustness(facts)).toBeNull();
  });

  it('returns null when enrichment.robustness is absent', () => {
    const fact = runAnalysisFact({ id: 'opt-a' });
    expect(pickLatestRawRobustness([fact])).toBeNull();
  });

  it('returns null when enrichment.robustness is empty (no level, no near_tie)', () => {
    const fact = runAnalysisFact({ id: 'opt-a', robustness: {} });
    expect(pickLatestRawRobustness([fact])).toBeNull();
  });

  it('returns lower-cased trimmed level when present', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { level: '  VERY_LOW  ' },
    });
    expect(pickLatestRawRobustness([fact])).toEqual({
      level: 'very_low',
      near_tie_is_tie: false,
    });
  });

  it('returns near_tie_is_tie=true when enrichment.robustness.near_tie.is_tie === true', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { near_tie: { is_tie: true } },
    });
    expect(pickLatestRawRobustness([fact])).toEqual({
      level: null,
      near_tie_is_tie: true,
    });
  });

  it('returns both signals together when both are present', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { level: 'fragile', near_tie: { is_tie: true } },
    });
    expect(pickLatestRawRobustness([fact])).toEqual({
      level: 'fragile',
      near_tie_is_tie: true,
    });
  });

  it('treats non-true near_tie.is_tie as false (string "true" not coerced)', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { level: 'moderate', near_tie: { is_tie: 'true' as unknown as boolean } },
    });
    expect(pickLatestRawRobustness([fact])).toEqual({
      level: 'moderate',
      near_tie_is_tie: false,
    });
  });

  it('returns null when level is an empty/whitespace string AND no near_tie', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { level: '   ' },
    });
    expect(pickLatestRawRobustness([fact])).toBeNull();
  });

  it('reads from the latest (newest) successful fact when multiple are present', () => {
    // Newest-first ordering (the loader convention).
    const newer = runAnalysisFact({
      id: 'opt-newer',
      computed_at: '2026-05-22T12:00:00Z',
      robustness: { level: 'very_low' },
    });
    const older = runAnalysisFact({
      id: 'opt-older',
      computed_at: '2026-05-20T12:00:00Z',
      robustness: { level: 'stable' },
    });
    const out = pickLatestRawRobustness([newer, older]);
    expect(out).not.toBeNull();
    expect(out!.level).toBe('very_low');
  });

  it('ignores malformed robustness (string instead of object)', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: 'not an object' as unknown as Record<string, unknown>,
    });
    expect(pickLatestRawRobustness([fact])).toBeNull();
  });

  it('ignores malformed enrichment.robustness.near_tie (string instead of object)', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      robustness: { level: 'moderate', near_tie: 'yes' as unknown as Record<string, unknown> },
    });
    expect(pickLatestRawRobustness([fact])).toEqual({
      level: 'moderate',
      near_tie_is_tie: false,
    });
  });
});
