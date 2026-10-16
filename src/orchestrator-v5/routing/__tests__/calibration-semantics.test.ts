/**
 * `calibration-semantics` — the ONE deterministic probability layer.
 *
 * TWO KINDS OF GUARD, SHIPPED TOGETHER (CLAUDE.md trap 12d):
 *
 *  A. DERIVED — every routing phrase resolves to the identical number the
 *     canonical `CERTAINTY_TERMS` map holds, and the threshold-marker list
 *     is a proven SUPERSET of CQE's two comparator alternations. These
 *     catch DRIFT between copies. They are structurally blind to a term
 *     that is missing from BOTH sides.
 *
 *  B. A HAND-WRITTEN CORPUS — real sentences, including the ones CQE
 *     measurably cannot see. This is the only guard that can notice a list
 *     is SHORT. Deleting either kind leaves a defect class unobserved.
 */
import { describe,expect,it } from 'vitest';


import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import {
COMPARATOR_ATLEAST_SOURCE,
COMPARATOR_ATMOST_SOURCE,
} from '../../context/cqe/rules.js';



// ---------------------------------------------------------------------------
// A. DERIVED GUARDS
// ---------------------------------------------------------------------------


describe('DERIVED: the threshold-marker list is a SUPERSET of CQE comparator grammar', () => {
  const cqeAlternatives = [
    ...COMPARATOR_ATMOST_SOURCE.split('|'),
    ...COMPARATOR_ATLEAST_SOURCE.split('|'),
  ];

  it('CQE has alternatives to check (positive control for the assertion below)', () => {
    expect(cqeAlternatives.length).toBeGreaterThan(8);
  });


});

// ---------------------------------------------------------------------------
// B. THE HAND-WRITTEN CORPUS — what derivation cannot see
// ---------------------------------------------------------------------------
describe('CORPUS: threshold markers CQE measurably cannot see', () => {
  it('MEASURES the gap rather than asserting it: CQE sets a comparator for "under" and NOT for "below"', () => {
    // This is the root cause of the witnessed defect, pinned as a fact
    // rather than as prose. If CQE's lexicon is fixed later this test REDs
    // and the note above it must be rewritten — which is the correct
    // outcome, not a nuisance.
    const withUnder = extractQuantities('monthly churn staying under 3%');
    const withBelow = extractQuantities('monthly churn staying below 3%');
    expect(withUnder[0]?.comparator).toBe('at_most');
    expect(withBelow[0]?.comparator).toBeNull();
    // ...and BOTH carry the same number, which is why the sentence with
    // "below" looked to routing exactly like an explicit value.
    expect(withUnder[0]?.value).toBe(0.03);
    expect(withBelow[0]?.value).toBe(0.03);
  });






});



// ---------------------------------------------------------------------------
// THE CLASSIFICATION THE WHOLE DEFECT TURNS ON
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// ROADMAP 2.627 — WHICH CLASSIFICATIONS MAY BECOME A POINT VALUE
//
// The end-to-end proof lives in `__tests__/calibration-consent-boundary.test.ts`
// (it REPLAYS every offered chip and asserts at the persistence boundary,
// because the defect was reachable by clicking, not only by reading). These
// are the unit-level statements of the same rule, at the one place that
// decides it.
// ---------------------------------------------------------------------------
