/**
 * Unit tests for `pickLatestFlipSummary`.
 *
 * Contract: read `enrichment.flip_thresholds` from the SAME run_analysis fact
 * the freshness/projection layer selects (canonical `selectRunAnalysisFact`),
 * summarise it, and return `null` when there is no usable flip evidence so the
 * what_would_flip composer falls back to its pre-flip behaviour verbatim.
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { pickLatestFlipSummary } from '../pick-flip-summary.js';

function runAnalysisFact(opts: {
  readonly id: string;
  readonly computed_at?: string;
  readonly flip_thresholds?: unknown;
}): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (opts.flip_thresholds !== undefined) {
    enrichment.flip_thresholds = opts.flip_thresholds;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
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

describe('pickLatestFlipSummary', () => {
  it('returns null for empty prior_facts', () => {
    expect(pickLatestFlipSummary([])).toBeNull();
  });

  it('returns null when no run_analysis fact is present', () => {
    const facts = [
      { fact_type: 'edit_graph', fact_version: 1, noop: false, result: {} } as unknown as HandlerFact,
    ];
    expect(pickLatestFlipSummary(facts)).toBeNull();
  });

  it('returns null when enrichment has no flip_thresholds (summary "none")', () => {
    expect(pickLatestFlipSummary([runAnalysisFact({ id: 'opt-a' })])).toBeNull();
  });

  it('summarises the no-practical-flip staging shape (flip_value null + no_effect + margin movement none)', () => {
    const fact = runAnalysisFact({
      id: 'opt-a',
      flip_thresholds: [
        {
          factor_id: 'fac_hiring_cost',
          factor_label: 'Hiring and Salary Cost',
          flip_value: null,
          flip_reason: 'no_effect_within_bounds',
          margin_sensitivity: { movement: 'none', strongest_delta_abs: null },
        },
      ],
    });
    const out = pickLatestFlipSummary([fact]);
    expect(out).not.toBeNull();
    expect(out!.overall_status).toBe('no_practical_flip');
    expect(out!.margin_supports_flip).toBe(false);
    expect(out!.entries[0].factor_label).toBe('Hiring and Salary Cost');
  });

  it('reads from the newest successful fact when multiple are present', () => {
    const newer = runAnalysisFact({
      id: 'opt-newer',
      computed_at: '2026-05-22T12:00:00Z',
      flip_thresholds: [
        { factor_id: 'f', factor_label: 'F', flip_value: 0.5, margin_sensitivity: { movement: 'flipped' } },
      ],
    });
    const older = runAnalysisFact({
      id: 'opt-older',
      computed_at: '2026-05-20T12:00:00Z',
      flip_thresholds: [
        { factor_id: 'g', factor_label: 'G', flip_value: null, flip_reason: 'no_effect_within_bounds' },
      ],
    });
    const out = pickLatestFlipSummary([newer, older]);
    expect(out).not.toBeNull();
    expect(out!.overall_status).toBe('concrete'); // from the NEWER fact
  });
});
