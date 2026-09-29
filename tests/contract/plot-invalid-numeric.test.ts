/**
 * V5 Phase 2 workstream E — PLoT response numeric integrity guard.
 *
 * Acceptance tests for the comprehensive NaN/Infinity ingress guard. The
 * walker is structural: every numeric field anywhere in the envelope is
 * inspected, not a fixed allowlist. These tests pin the structural
 * coverage by injecting non-finite values into representative fields
 * (top-level, per-option, factor sensitivity, robustness, percentiles,
 * flip thresholds) and asserting the walker finds each one with the
 * correct path.
 *
 * Run-level integration tests (handler throws, telemetry emits) live
 * alongside in the run-analysis test suite — these are pure walker
 * acceptance tests so the fail-fast contract is independently verified.
 */

import { describe, it, expect } from 'vitest';

import {
  findFirstInvalidNumeric,
  type InvalidNumericFinding,
} from '../../src/orchestrator-v5/tools/handlers/numeric-integrity.js';

// ─── helpers ──────────────────────────────────────────────────────────────

function expectFound(
  result: InvalidNumericFinding | null,
  path: string,
  repr: InvalidNumericFinding['value_repr'],
): void {
  expect(result).not.toBeNull();
  expect(result!.path).toBe(path);
  expect(result!.value_repr).toBe(repr);
}

// ─── walker — finite cases ────────────────────────────────────────────────

describe('findFirstInvalidNumeric — clean responses', () => {
  it('returns null for a fully finite envelope', () => {
    const envelope = {
      meta: { seed_used: 1, n_samples: 1000, response_hash: 'abc' },
      results: [
        { option_label: 'A', win_probability: 0.6, outcome: { mean: 1.2, p10: 0.5, p90: 2.1 } },
        { option_label: 'B', win_probability: 0.4, outcome: { mean: 0.9, p10: 0.3, p90: 1.5 } },
      ],
      factor_sensitivity: [
        { factor_label: 'cost', elasticity: 0.3, confidence: 0.8, value: 0.25 },
      ],
      robustness: { level: 'high', recommendation_stability: 0.92, overall_confidence: 0.85 },
      margin_pp: 20,
      evpi: 0.04,
    };
    expect(findFirstInvalidNumeric(envelope)).toBeNull();
  });

  it('returns null for nulls, undefineds, strings, booleans', () => {
    const envelope = {
      results: null,
      factor_sensitivity: undefined,
      meta: { seed_used: 1, n_samples: 100, response_hash: 'h', some_string: 'x', some_flag: true },
    };
    expect(findFirstInvalidNumeric(envelope)).toBeNull();
  });

  it('returns null for an empty envelope', () => {
    expect(findFirstInvalidNumeric({})).toBeNull();
    expect(findFirstInvalidNumeric([])).toBeNull();
    expect(findFirstInvalidNumeric(null)).toBeNull();
    expect(findFirstInvalidNumeric(undefined)).toBeNull();
  });
});

// ─── walker — non-finite cases ────────────────────────────────────────────

describe('findFirstInvalidNumeric — coverage of brief field set', () => {
  it('rejects NaN in top-level win_probability (per-option)', () => {
    const envelope = {
      results: [{ option_label: 'A', win_probability: Number.NaN }],
    };
    expectFound(findFirstInvalidNumeric(envelope), 'results[0].win_probability', 'NaN');
  });

  it('rejects Infinity in factor_sensitivity[*].value', () => {
    const envelope = {
      results: [{ option_label: 'A', win_probability: 0.6 }],
      factor_sensitivity: [
        { factor_label: 'cost', elasticity: 0.3 },
        { factor_label: 'time', value: Number.POSITIVE_INFINITY },
      ],
    };
    expectFound(findFirstInvalidNumeric(envelope), 'factor_sensitivity[1].value', 'Infinity');
  });

  it('rejects NaN in factor_sensitivity[*].elasticity', () => {
    const envelope = {
      factor_sensitivity: [{ factor_label: 'cost', elasticity: Number.NaN }],
    };
    expectFound(findFirstInvalidNumeric(envelope), 'factor_sensitivity[0].elasticity', 'NaN');
  });

  it('rejects NaN in factor_sensitivity[*].confidence', () => {
    const envelope = {
      factor_sensitivity: [{ factor_label: 'cost', elasticity: 0.3, confidence: Number.NaN }],
    };
    expectFound(
      findFirstInvalidNumeric(envelope),
      'factor_sensitivity[0].confidence',
      'NaN',
    );
  });

  it('rejects -Infinity in margin_pp', () => {
    const envelope = { margin_pp: Number.NEGATIVE_INFINITY };
    expectFound(findFirstInvalidNumeric(envelope), 'margin_pp', '-Infinity');
  });

  it('rejects NaN in evpi', () => {
    const envelope = { evpi: Number.NaN };
    expectFound(findFirstInvalidNumeric(envelope), 'evpi', 'NaN');
  });

  it('rejects NaN in option outcome percentiles (p10/p90/mean)', () => {
    const envelope = {
      results: [
        {
          option_label: 'A',
          win_probability: 0.5,
          outcome: { mean: 1.0, p10: Number.NaN, p90: 2.0 },
        },
      ],
    };
    expectFound(findFirstInvalidNumeric(envelope), 'results[0].outcome.p10', 'NaN');
  });

  it('rejects Infinity in robustness.recommendation_stability', () => {
    const envelope = {
      robustness: { level: 'high', recommendation_stability: Number.POSITIVE_INFINITY },
    };
    expectFound(
      findFirstInvalidNumeric(envelope),
      'robustness.recommendation_stability',
      'Infinity',
    );
  });

  it('rejects NaN in robustness.overall_confidence', () => {
    const envelope = {
      robustness: { level: 'mid', overall_confidence: Number.NaN },
    };
    expectFound(findFirstInvalidNumeric(envelope), 'robustness.overall_confidence', 'NaN');
  });

  it('rejects NaN in flip-threshold values nested under per-option factor_sensitivity', () => {
    const envelope = {
      results: [
        {
          option_label: 'A',
          win_probability: 0.5,
          factor_sensitivity: [
            {
              factor_id: 'f1',
              flip_threshold: { current_value: 100, flip_value: Number.NaN },
            },
          ],
        },
      ],
    };
    expectFound(
      findFirstInvalidNumeric(envelope),
      'results[0].factor_sensitivity[0].flip_threshold.flip_value',
      'NaN',
    );
  });

  it('rejects -Infinity in option_comparison shape (alt PLoT response shape)', () => {
    const envelope = {
      option_comparison: [
        { option_label: 'A', win_probability: 0.5 },
        { option_label: 'B', win_probability: Number.NEGATIVE_INFINITY },
      ],
    };
    expectFound(
      findFirstInvalidNumeric(envelope),
      'option_comparison[1].win_probability',
      '-Infinity',
    );
  });

  it('fails fast on the first non-finite value (does not report the second)', () => {
    const envelope = {
      results: [
        { option_label: 'A', win_probability: Number.NaN },
        { option_label: 'B', win_probability: Number.POSITIVE_INFINITY },
      ],
    };
    expectFound(findFirstInvalidNumeric(envelope), 'results[0].win_probability', 'NaN');
  });
});

// ─── walker — defensive cases ─────────────────────────────────────────────

describe('findFirstInvalidNumeric — defensive', () => {
  it('handles deeply nested envelopes without stack overflow', () => {
    let envelope: Record<string, unknown> = { value: Number.NaN };
    for (let i = 0; i < 8; i += 1) {
      envelope = { nested: envelope };
    }
    const result = findFirstInvalidNumeric(envelope);
    expect(result).not.toBeNull();
    expect(result!.value_repr).toBe('NaN');
  });

  it('caps recursion at MAX_DEPTH (16) — does not throw on pathological depth', () => {
    let envelope: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 50; i += 1) {
      envelope = { wrap: envelope };
    }
    expect(() => findFirstInvalidNumeric(envelope)).not.toThrow();
  });
});
