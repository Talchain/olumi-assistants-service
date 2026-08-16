import { describe, expect, it } from 'vitest';

import {
  pickLatestFactorEvppiPriority,
  pickLatestFactorEvppiPriorityGuidance,
  readFactorEvppiPriorityAction,
  selectFactorEvppiPriority,
  selectFactorEvppiPriorityGuidance,
} from '../select-factor-evppi.js';

function row(
  factorId: string,
  evppi: number,
  status: 'resolved' | 'below_resolution',
): Record<string, unknown> {
  return {
    factor_id: factorId,
    evppi,
    status,
    units: 'outcome',
    noise_floor: 0.01,
    method: 'regression_evppi_v1',
  };
}

describe('selectFactorEvppiPriority', () => {
  it('selects the first resolved row in producer order without carrying a magnitude', () => {
    const decision = selectFactorEvppiPriority({
      factor_evppi: [
        row('fac_below', 0.9, 'below_resolution'),
        row('fac_first', 0.4, 'resolved'),
        row('fac_second', 0.8, 'resolved'),
      ],
    });

    expect(decision).toStrictEqual({ outcome: 'selected', factorId: 'fac_first' });
    expect(JSON.stringify(decision)).not.toMatch(/0\.4|0\.8|0\.9|evppi|noise_floor/);
  });

  it('preserves a deliberately mis-sorted producer order instead of re-ranking values', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          row('fac_wire_first', 0.1, 'resolved'),
          row('fac_larger_later', 0.9, 'resolved'),
        ],
      }),
    ).toStrictEqual({ outcome: 'selected', factorId: 'fac_wire_first' });
  });

  it('trusts a resolved zero on the rounded wire instead of re-deriving the producer floor verdict', () => {
    // ISL compares the unrounded estimate with the unrounded permutation floor,
    // then rounds both audit values for transport. Real captured rows can
    // therefore be status=resolved while emitted evppi/noise_floor are both 0.
    // Requiring evppi > 0 here would contradict the producer and darken the
    // only currently captured resolved cases.
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [row('fac_rounding_boundary', 0, 'resolved')],
      }),
    ).toStrictEqual({ outcome: 'selected', factorId: 'fac_rounding_boundary' });
  });

  it('returns all_below_resolution without treating below-resolution as zero', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          row('fac_a', 0.2, 'below_resolution'),
          row('fac_b', 0, 'below_resolution'),
        ],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'all_below_resolution' });
  });

  it('refuses a partial producer ranking instead of promoting the first surviving estimate', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          row('fac_surviving_first', 0.5, 'resolved'),
          row('fac_surviving_second', 0.4, 'resolved'),
        ],
        inference_warnings: [
          {
            code: 'FACTOR_EVPPI_PARTIAL',
            field: 'factor_evppi',
            detail: { failed_factor_ids: ['fac_unassessed'] },
          },
        ],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'producer_partial' });
  });

  it('does not infer partiality from unrelated producer warnings', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [row('fac_first', 0.5, 'resolved')],
        inference_warnings: [{ code: 'SOME_OTHER_WARNING' }],
      }),
    ).toStrictEqual({ outcome: 'selected', factorId: 'fac_first' });
  });

  it('refuses a ranking whose transport contract may have withheld an earlier row', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [row('fac_surviving_first', 0.5, 'resolved')],
        inference_warnings: [
          {
            code: 'ENRICHMENT_CONTRACT_MISMATCH',
          },
        ],
      }),
    ).toStrictEqual({
      outcome: 'not_selected',
      reason: 'transport_contract_mismatch',
    });
  });

  it.each([
    ['non-array warning carrier', { code: 'FACTOR_EVPPI_PARTIAL' }],
    ['non-object warning entry', ['FACTOR_EVPPI_PARTIAL']],
    ['warning entry without a code', [{ message: 'one estimator failed' }]],
  ])('fails closed on a %s', (_name, inferenceWarnings) => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [row('fac_surviving_first', 0.5, 'resolved')],
        inference_warnings: inferenceWarnings,
      }),
    ).toStrictEqual({
      outcome: 'not_selected',
      reason: 'warning_carrier_unreadable',
    });
  });

  it.each([
    ['missing enrichment', undefined],
    ['missing rows', {}],
    ['null rows', { factor_evppi: null }],
    ['empty rows', { factor_evppi: [] }],
    ['non-array rows', { factor_evppi: { factor_id: 'fac_a' } }],
  ])('returns absent for %s', (_name, enrichment) => {
    expect(selectFactorEvppiPriority(enrichment)).toStrictEqual({
      outcome: 'not_selected',
      reason: 'absent',
    });
  });

  it.each([
    ['missing evppi', { factor_id: 'fac_bad', status: 'resolved' }],
    ['non-finite evppi', { factor_id: 'fac_bad', evppi: Number.POSITIVE_INFINITY, status: 'resolved' }],
    ['unknown status', { factor_id: 'fac_bad', evppi: 0.5, status: 'partial' }],
    ['empty id', { factor_id: '', evppi: 0.5, status: 'resolved' }],
    ['non-object row', 'fac_bad'],
  ])('fails closed instead of promoting row two when row one has %s', (_name, malformed) => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [malformed, row('fac_second', 0.4, 'resolved')],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'unreadable_before_priority' });
  });

  it('fails closed on a duplicate before the first resolved row', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          row('fac_a', 0.5, 'below_resolution'),
          row('fac_a', 0.4, 'resolved'),
          row('fac_b', 0.3, 'resolved'),
        ],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'duplicate_before_priority' });
  });

  it.each([
    ['malformed', { factor_id: 'fac_bad', status: 'resolved' }],
    ['negative', row('fac_negative', -0.01, 'resolved')],
    ['non-finite', row('fac_infinite', Number.POSITIVE_INFINITY, 'resolved')],
  ])('refuses a %s trailing row after an otherwise valid priority', (_name, trailing) => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [row('fac_priority', 0.5, 'resolved'), trailing],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'unreadable_before_priority' });
  });

  it('refuses a trailing duplicate after an otherwise valid priority', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          row('fac_priority', 0.5, 'resolved'),
          row('fac_priority', 0.4, 'below_resolution'),
        ],
      }),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'duplicate_before_priority' });
  });

  it('does not promote row two when the producer priority is not eligible', () => {
    expect(
      selectFactorEvppiPriority(
        {
          factor_evppi: [
            row('fac_priority', 0.9, 'resolved'),
            row('fac_second', 0.5, 'resolved'),
          ],
        },
        { eligibleFactorIds: new Set(['fac_second']) },
      ),
    ).toStrictEqual({ outcome: 'not_selected', reason: 'priority_not_eligible' });
  });

  it('ignores unread audit legs because they can neither rank nor reach output', () => {
    expect(
      selectFactorEvppiPriority({
        factor_evppi: [
          {
            ...row('fac_a', 0.5, 'resolved'),
            units: 7,
            noise_floor: 'unknown',
            method: false,
          },
        ],
      }),
    ).toStrictEqual({ outcome: 'selected', factorId: 'fac_a' });
  });

  it('joins only the selected factor to a specific action and never promotes object order', () => {
    const review = {
      evidence_enhancements: {
        fac_llm_first: { specific_action: 'Do not select this action.' },
        fac_producer_first: { specific_action: 'Collect the matched cohort data.' },
      },
    };
    expect(
      readFactorEvppiPriorityAction(review, {
        outcome: 'selected',
        factorId: 'fac_producer_first',
      }),
    ).toBe('Collect the matched cohort data.');
    expect(
      readFactorEvppiPriorityAction(review, {
        outcome: 'not_selected',
        reason: 'producer_partial',
      }),
    ).toBeNull();
    expect(
      readFactorEvppiPriorityAction(review, {
        outcome: 'selected',
        factorId: 'fac_missing',
      }),
    ).toBeNull();
  });

  it.each([
    ['raw entity id', 'Inspect fac_private_signal before relying on it.'],
    ['raw probability decimal', 'Compare cohorts at 0.73 confidence.'],
    ['forbidden directive', 'You should choose the enterprise option.'],
    ['engine jargon', "Inspect Node 'fac_private_signal' before analysis."],
    ['control character', 'Compare the cohorts.\nThen interview customers.'],
    ['bidi formatting', 'Compare the cohorts.\u2066'],
  ])('drops an unsafe optional action carrying %s', (_name, specificAction) => {
    expect(
      readFactorEvppiPriorityAction(
        { evidence_enhancements: { fac_priority: { specific_action: specificAction } } },
        { outcome: 'selected', factorId: 'fac_priority' },
      ),
    ).toBeNull();
  });

  it('does not mistake an ordinary hyphenated phrase for an entity id', () => {
    expect(
      readFactorEvppiPriorityAction(
        {
          evidence_enhancements: {
            fac_priority: { specific_action: 'Compare risk-adjusted scenarios.' },
          },
        },
        { outcome: 'selected', factorId: 'fac_priority' },
      ),
    ).toBe('Compare risk-adjusted scenarios.');
  });

  it('keeps selected factor guidance while dropping an unsafe optional action', () => {
    expect(
      selectFactorEvppiPriorityGuidance({
        factor_evppi: [row('fac_priority', 0.3, 'resolved')],
        factor_sensitivity: [
          { factor_id: 'fac_priority', factor_label: 'Delivery reliability' },
        ],
        decision_review: {
          evidence_enhancements: {
            fac_priority: { specific_action: 'Inspect fac_private_signal.' },
          },
        },
      }),
    ).toStrictEqual({
      outcome: 'selected',
      factorId: 'fac_priority',
      factorLabel: 'Delivery reliability',
      specificAction: null,
    });
  });

  it('joins the selected factor to its exact PLoT label when decision review is absent', () => {
    expect(
      selectFactorEvppiPriorityGuidance({
        factor_evppi: [row('fac_priority', 0, 'resolved')],
        factor_sensitivity: [
          { factor_id: 'fac_priority', factor_label: 'Customer retention' },
        ],
      }),
    ).toStrictEqual({
      outcome: 'selected',
      factorId: 'fac_priority',
      factorLabel: 'Customer retention',
      specificAction: null,
    });
  });

  it('carries only the selected-factor review action as an optional enrichment', () => {
    expect(
      selectFactorEvppiPriorityGuidance({
        factor_evppi: [row('fac_priority', 0.3, 'resolved')],
        factor_sensitivity: [
          { factor_id: 'fac_priority', label: 'Delivery reliability' },
        ],
        decision_review: {
          evidence_enhancements: {
            fac_other: { specific_action: 'Wrong action.' },
            fac_priority: { specific_action: 'Compare incident cohorts.' },
          },
        },
      }),
    ).toStrictEqual({
      outcome: 'selected',
      factorId: 'fac_priority',
      factorLabel: 'Delivery reliability',
      specificAction: 'Compare incident cohorts.',
    });
  });

  it.each([
    ['missing label carrier', []],
    ['duplicate identity', [
      { factor_id: 'fac_priority', factor_label: 'Demand' },
      { factor_id: 'fac_priority', factor_label: 'Demand' },
    ]],
    ['raw id label', [{ factor_id: 'fac_priority', factor_label: 'fac_priority' }]],
    ['different raw id label', [{ factor_id: 'fac_priority', factor_label: 'factor_other' }]],
    ['embedded raw id label', [{ factor_id: 'fac_priority', factor_label: 'Review fac_other_signal' }]],
    ['control character label', [{ factor_id: 'fac_priority', factor_label: 'Demand\u0000forecast' }]],
    ['C1 control label', [{ factor_id: 'fac_priority', factor_label: 'Demand\u0085forecast' }]],
    ['Arabic bidi mark label', [{ factor_id: 'fac_priority', factor_label: 'Demand\u061cforecast' }]],
    ['bidi isolate label', [{ factor_id: 'fac_priority', factor_label: 'Demand\u2066forecast' }]],
    ['zero-width no-break label', [{ factor_id: 'fac_priority', factor_label: 'Demand\ufeffforecast' }]],
    ['overlong label', [{ factor_id: 'fac_priority', factor_label: 'D'.repeat(161) }]],
    ['conflicting label fields', [{
      factor_id: 'fac_priority', factor_label: 'Demand', label: 'Supply',
    }]],
  ])('fails closed on %s', (_name, factorSensitivity) => {
    expect(
      selectFactorEvppiPriorityGuidance({
        factor_evppi: [row('fac_priority', 0.3, 'resolved')],
        factor_sensitivity: factorSensitivity,
      }).outcome,
    ).toBe('not_selected');
  });

  it('reads priority from the canonical newest successful run-analysis fact', () => {
    const makeFact = (factorId: string, computedAt: string) => ({
      fact_type: 'run_analysis' as const,
      fact_version: 1 as const,
      noop: false as const,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: 'opt_a',
        win_probabilities: { opt_a: 0.6 },
        summary: 'done',
        computed_at: computedAt,
        enrichment: { factor_evppi: [row(factorId, 0.1, 'resolved')] },
      },
    });
    expect(
      pickLatestFactorEvppiPriority([
        makeFact('fac_older', '2026-08-16T00:00:00.000Z'),
        makeFact('fac_newest', '2026-08-16T01:00:00.000Z'),
      ]),
    ).toStrictEqual({ outcome: 'selected', factorId: 'fac_newest' });
  });

  it('reads guidance from the same canonical newest successful fact', () => {
    const makeFact = (factorId: string, factorLabel: string, computedAt: string) => ({
      fact_type: 'run_analysis' as const,
      fact_version: 1 as const,
      noop: false as const,
      result: {
        scenario_id: '00000000-0000-4000-8000-000000000001',
        leading_option_id: 'opt_a',
        win_probabilities: { opt_a: 0.6 },
        summary: 'done',
        computed_at: computedAt,
        enrichment: {
          factor_evppi: [row(factorId, 0.1, 'resolved')],
          factor_sensitivity: [{ factor_id: factorId, factor_label: factorLabel }],
        },
      },
    });
    expect(
      pickLatestFactorEvppiPriorityGuidance([
        makeFact('fac_older', 'Old evidence', '2026-08-16T00:00:00.000Z'),
        makeFact('fac_newest', 'Current evidence', '2026-08-16T01:00:00.000Z'),
      ]),
    ).toStrictEqual({
      outcome: 'selected',
      factorId: 'fac_newest',
      factorLabel: 'Current evidence',
      specificAction: null,
    });
  });
});
