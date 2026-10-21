/**
 * The licence that separates INFLUENCE from INFORMATION VALUE.
 *
 * What these tests are for, stated so a later reader does not mistake them for
 * "the switch has four arms":
 *
 *   1. THE FOUNDER'S ACTUAL ENRICHMENT IS THE ANCHOR. The first case drives the
 *      bytes the deployed product produced on 3 Sep 2026 through the real
 *      authority and asserts the licence WITHHOLDS. If that case ever passes
 *      for the wrong reason the whole module is decoration.
 *   2. EVERY REFUSAL REASON IS COVERED BY IDENTITY, not by a predicate another
 *      reason could satisfy (CLAUDE.md trap 19). The reasons come from the
 *      authority's own exported union, so a new reason cannot be silently
 *      absorbed.
 *   3. THE TWO NEGATIVE STATES STAY APART. `not_assessed` and
 *      `below_resolution` are different claims about the science and must never
 *      collapse into one another — that collapse is the defect one level up.
 *
 * Binding is by exact `kind` throughout. The model-facing notes and the
 * `hasFactorEvppiAssessment` predicate were deleted with their only consumer,
 * `formatAnalysisForContext` (Track 2 deletion 9); their rows went with them.
 */

import { describe, expect, it } from 'vitest';

import {
  investigationPriorityFromEnrichment,
  licenceFromEvppiGuidance,
  type InvestigationPriorityLicence,
} from '../investigation-priority.js';
import type { FactorEvppiPriorityGuidanceDecision } from '../select-factor-evppi.js';

/**
 * The exact `factor_evppi` + `inference_warnings` the deployed product emitted
 * in the 3 Sep founder session (scenario `7826c742`, CEE `f4c8f501`). Trimmed
 * to the two carriers the authority reads; the full capture is the acceptance
 * corpus at `tests/contract/fixtures/`.
 *
 * HISTORIC RECORD — do not edit these values to keep a test green
 * (CLAUDE.md trap 14b).
 */
const FOUNDER_SESSION_ENRICHMENT = {
  factor_evppi: [
    {
      factor_id: '26fbdff5',
      evppi: 1e-5,
      noise_floor: 2.2e-5,
      status: 'below_resolution',
      method: 'regression_evppi_v1',
    },
  ],
  inference_warnings: [
    { code: 'EDGE_E_VALUE_NON_FINITE_DROPPED', severity: 'info', message: 'x' },
    { code: 'ROOT_NODE_DEFAULT_VALUE', severity: 'info', message: 'y' },
    { code: 'GOAL_ANCESTOR_DATA_GAP', severity: 'info', message: 'z' },
  ],
  factor_sensitivity: [
    { factor_id: '16ec3d64', factor_label: 'ICP Clarity', influence_rank: 1, value_of_information: 0 },
    { factor_id: '26fbdff5', factor_label: 'Product gaps mediate churn', influence_rank: 2, value_of_information: 0 },
  ],
} as const;

describe('the 3 Sep founder enrichment — the capture this module exists for', () => {
  it('WITHHOLDS the priority: factors were assessed and none cleared resolution', () => {
    // ⭐ THE WHOLE DEFECT IN ONE ASSERTION. On these exact bytes the product
    // told the user that validating ICP clarity was "the single highest-value
    // check". ICP clarity is influence_rank 1 and carries no EVPPI row at all;
    // the one row present is below its own noise floor.
    const licence = investigationPriorityFromEnrichment(FOUNDER_SESSION_ENRICHMENT);
    expect(licence).toEqual<InvestigationPriorityLicence>({ kind: 'below_resolution' });
  });
});

describe('licenceFromEvppiGuidance — every producer verdict maps by identity', () => {
  it('a producer-named factor GRANTS the claim, carrying that exact label', () => {
    const decision: FactorEvppiPriorityGuidanceDecision = {
      outcome: 'selected',
      factorId: 'f1',
      factorLabel: 'Trial-to-paid conversion',
      specificAction: null,
    };
    expect(licenceFromEvppiGuidance(decision)).toEqual<InvestigationPriorityLicence>({
      kind: 'named',
      factorId: 'f1',
      factorLabel: 'Trial-to-paid conversion',
      specificAction: null,
    });
  });

  it('"absent" is NOT_ASSESSED and stays apart from below_resolution', () => {
    // These two must never collapse. "We did not look" and "we looked and
    // found nothing above the noise" license different sentences, and only the
    // second says the science has an answer.
    expect(
      licenceFromEvppiGuidance({ outcome: 'not_selected', reason: 'absent' }),
    ).toEqual<InvestigationPriorityLicence>({ kind: 'not_assessed' });
    expect(
      licenceFromEvppiGuidance({ outcome: 'not_selected', reason: 'all_below_resolution' }),
    ).toEqual<InvestigationPriorityLicence>({ kind: 'below_resolution' });
  });

  it('every UNTRUSTWORTHY-ranking reason resolves to incomplete, and none grants', () => {
    // Enumerated by identity. A reason that silently fell through to `named`
    // would let the product name a priority the producer refused to give.
    const untrustworthy = [
      'producer_partial',
      'transport_contract_mismatch',
      'warning_carrier_unreadable',
      'unreadable_before_priority',
      'duplicate_before_priority',
      'priority_not_eligible',
      'factor_sensitivity_absent',
      'factor_sensitivity_duplicate',
      'factor_label_unreadable',
    ] as const;
    for (const reason of untrustworthy) {
      const licence = licenceFromEvppiGuidance({ outcome: 'not_selected', reason });
      expect(licence, reason).toEqual<InvestigationPriorityLicence>({ kind: 'incomplete' });
    }
    expect(untrustworthy.length).toBe(9);
  });

  it('NON-VACUITY CONTROL: the mapping discriminates rather than answering one state', () => {
    // Trap 20's uniformity tell: a per-item probe that returns the same answer
    // for every item is reporting on itself. Four inputs, four distinct kinds.
    const kinds = new Set(
      [
        licenceFromEvppiGuidance({
          outcome: 'selected', factorId: 'f', factorLabel: 'L', specificAction: null,
        }),
        licenceFromEvppiGuidance({ outcome: 'not_selected', reason: 'absent' }),
        licenceFromEvppiGuidance({ outcome: 'not_selected', reason: 'all_below_resolution' }),
        licenceFromEvppiGuidance({ outcome: 'not_selected', reason: 'producer_partial' }),
      ].map((l) => l.kind),
    );
    expect(kinds).toEqual(new Set(['named', 'below_resolution', 'not_assessed', 'incomplete']));
  });
});
