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
 * Binding is by exact `kind` and exact note identity throughout.
 */

import { describe, expect, it } from 'vitest';

import {
  INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE,
  INVESTIGATION_PRIORITY_INCOMPLETE_NOTE,
  analysisAssessedInformationValue,
  investigationPriorityFromEnrichment,
  investigationPriorityNote,
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

  it('the note the model receives says the science looked and found nothing separable', () => {
    const note = investigationPriorityNote(
      investigationPriorityFromEnrichment(FOUNDER_SESSION_ENRICHMENT),
    );
    expect(note).toBe(INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE);
    // The note must state what the analysis DID, or the model is left with the
    // influence ranking as the only ranking in the pack — which is how the
    // session actually went wrong. A bare prohibition is not enough.
    expect(note).toContain('DID estimate');
    expect(note).toContain('cleared the resolution of the run');
  });

  it('the note forbids the exact substitution the session made', () => {
    const note = INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE;
    expect(note).toContain('you may not turn that into an investigation ranking');
    expect(note).toContain('highest-value');
    // ...while still permitting the true half. Influence is a real fact the
    // user is entitled to; a note that banned it would be over-suppression and
    // would make the product less useful, not more honest.
    expect(note).toContain('You may still say which factors influence the result most');
  });

  it('the capture is treated as having assessed information value', () => {
    // The predicate the display formatter reads. `VOI_NOT_SCORED_NOTE` claims
    // "no value-of-information scores are available for this analysis"; on this
    // capture that sentence is false, and this is the boolean that says so.
    expect(
      analysisAssessedInformationValue(
        investigationPriorityFromEnrichment(FOUNDER_SESSION_ENRICHMENT),
      ),
    ).toBe(true);
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
      factorLabel: 'Trial-to-paid conversion',
    });
    const note = investigationPriorityNote(licenceFromEvppiGuidance(decision));
    expect(note).toContain('"Trial-to-paid conversion"');
    expect(note).toContain('name that factor and no other');
    // The granted state must ALSO forbid the substitution, because "name the
    // priority" and "do not name the biggest influence instead" are different
    // instructions and only the second closes the observed defect.
    expect(note).toContain('do not substitute whichever factor has the largest influence');
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
    expect(analysisAssessedInformationValue({ kind: 'not_assessed' })).toBe(false);
    expect(analysisAssessedInformationValue({ kind: 'below_resolution' })).toBe(true);
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
      expect(investigationPriorityNote(licence), reason).toBe(
        INVESTIGATION_PRIORITY_INCOMPLETE_NOTE,
      );
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

describe('investigationPriorityNote — not_assessed adds nothing, on purpose', () => {
  it('returns null so a pack with no EVPPI channel is byte-identical', () => {
    // Deliberate scope: `VOI_NOT_SCORED_NOTE` already covers this state with
    // the same prohibition, and a second sentence saying it would be a mirror.
    // The null also makes this lane auditable — no fixture without
    // `factor_evppi` can move.
    expect(investigationPriorityNote({ kind: 'not_assessed' })).toBeNull();
  });

  it('an ABSENT licence is not the same as a licence saying nothing was assessed', () => {
    expect(analysisAssessedInformationValue(null)).toBe(false);
    expect(analysisAssessedInformationValue(undefined)).toBe(false);
  });
});

describe('the notes carry no digits — the display projection admits none', () => {
  it('no note leaks a raw number', () => {
    const notes = [
      INVESTIGATION_PRIORITY_BELOW_RESOLUTION_NOTE,
      INVESTIGATION_PRIORITY_INCOMPLETE_NOTE,
      investigationPriorityNote({ kind: 'named', factorLabel: 'Churn rate' }) as string,
    ];
    for (const note of notes) {
      expect(note, note.slice(0, 40)).not.toMatch(/\d/);
    }
    // POSITIVE CONTROL for the digit probe: it must be able to SEE a digit,
    // otherwise the three assertions above pass by testing nothing (trap 13).
    expect('a note carrying 0.42').toMatch(/\d/);
  });
});
