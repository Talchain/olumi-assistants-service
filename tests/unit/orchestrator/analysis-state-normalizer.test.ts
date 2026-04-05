/**
 * normalizeAnalysisEnvelope — results repair and normalisation tests
 */

import { describe, it, expect } from "vitest";
import { normalizeAnalysisEnvelope } from "../../../src/orchestrator/analysis-state.js";
import type { V2RunResponseEnvelope } from "../../../src/orchestrator/types.js";

function makeEnvelope(overrides: Record<string, unknown> = {}): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc123' },
    analysis_status: 'completed',
    results: [
      { option_label: 'Option A', win_probability: 0.62 },
      { option_label: 'Option B', win_probability: 0.38 },
    ],
    robustness: { level: 'moderate' },
    factor_sensitivity: [
      { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 0.8, direction: 'positive' },
    ],
    ...overrides,
  } as V2RunResponseEnvelope;
}

// ============================================================================
// Task 2: results repair from option_comparison
// ============================================================================

describe('normalizeAnalysisEnvelope — results repair', () => {
  it('repairs missing results from top-level option_comparison', () => {
    const envelope = makeEnvelope({
      results: undefined,
      option_comparison: [
        { option_label: 'Option A', win_probability: 0.65 },
        { option_label: 'Option B', win_probability: 0.35 },
      ],
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(2);
    const first = result.results[0] as Record<string, unknown>;
    expect(first.option_label).toBe('Option A');
    expect(first.win_probability).toBe(0.65);
  });

  it('repairs { __circular: true } results from option_comparison', () => {
    const envelope = makeEnvelope({
      results: { __circular: true, type: 'object' },
      option_comparison: [
        { option_label: 'Option A', win_probability: 0.6 },
        { option_label: 'Option B', win_probability: 0.4 },
      ],
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(2);
  });

  it('repairs boolean true results from option_comparison', () => {
    const envelope = makeEnvelope({
      results: true,
      option_comparison: [
        { label: 'Option A', win_probability: 0.55 },
        { label: 'Option B', win_probability: 0.45 },
      ],
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(Array.isArray(result.results)).toBe(true);
    // Maps label → option_label
    const first = result.results[0] as Record<string, unknown>;
    expect(first.option_label).toBe('Option A');
  });

  it('sets results to empty array when neither results nor option_comparison available', () => {
    const envelope = makeEnvelope({
      results: { __circular: true },
      // no option_comparison
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('preserves valid results array (regression)', () => {
    const original = [
      { option_label: 'Option A', win_probability: 0.62 },
      { option_label: 'Option B', win_probability: 0.38 },
    ];
    const envelope = makeEnvelope({ results: original });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(result.results).toEqual(original);
  });

  it('sets results to empty array when results is null and no option_comparison', () => {
    const envelope = makeEnvelope({
      results: null,
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(Array.isArray(result.results)).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('infers analysis_status when repaired results have valid option data', () => {
    const envelope = makeEnvelope({
      analysis_status: undefined,
      results: { __circular: true },
      option_comparison: [
        { option_label: 'Option A', win_probability: 0.65 },
        { option_label: 'Option B', win_probability: 0.35 },
      ],
    });
    const result = normalizeAnalysisEnvelope(envelope);

    expect(result.analysis_status).toBe('completed');
  });
});
