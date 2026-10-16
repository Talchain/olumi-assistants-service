/**
 * B2 convergence fixtures captured from five isolated staging guests on
 * CEE 53eb8d03554c3b92f324f7ebc40b25120aa1add2.
 *
 * The three failures are intentionally frozen verbatim.  The two controls are
 * the same successful answers from the same witness set: the fix must recover
 * the bad routes without suppressing source-bound analysis that already works.
 */
import { describe,expect,it } from 'vitest';


import {
isBoundedNonMutationAnalyticalRequest,
selectBoundedNonMutationHandler,
} from '../../routing/mutation-warrant.js';
import { buildAnalysisAbsentTemplate } from '../../tools/handlers/no-op-helpers.js';

const CRM_UNCERTAINTY =
  "I don't know what value to use. We have no reliable adoption data yet. What is the safest way to proceed?";
const CRM_NO_CHANGE =
  'I do not know the Sales Rep Adoption Rate or CRM Feature Fit for B2B Sales. Is it safe to run analysis anyway? Answer directly first and do not change the model.';
const PRODUCT_CHALLENGE =
  'Challenge the 53% result directly: what is the strongest reason it could be misleading? Refer specifically to Team Capacity Consumed and unknown willingness to pay, and explain the causal path. Do not change the model.';

const BURN_CONTROL_PROMPT =
  'Answer directly first: which single missing fact should we gather next, and why? Refer specifically to Q1 Renewal Rate and explain the causal path. Do not change the model.';
const GEO_CONTROL_PROMPT =
  'Answer directly: does an 86% result justify acting despite unknown Local Pipeline Conversion Rate? Name the strongest challenge and state which first-year budget or hub-cost figures were excluded from the numerical model. Do not change the model.';

const TWO_OPTION_BLOCKED_READINESS = {
  status: 'needs_user_input',
  options: [
    { option_id: 'replace', label: 'replace our current CRM with HubSpot next quarter', status: 'ready' },
    { option_id: 'keep', label: 'keep what we have', status: 'ready' },
  ],
  blockers: [
    {
      option_id: 'replace',
      option_label: 'replace our current CRM with HubSpot next quarter',
      factor_id: 'productivity',
      factor_label: 'Sales Rep Productivity',
      blocker_type: 'missing_value',
      suggested_action: 'add_value',
    },
  ],
} as const;





describe('B2 frozen intent fixtures', () => {
  it.each([CRM_UNCERTAINTY, CRM_NO_CHANGE, PRODUCT_CHALLENGE])(
    'recognises a non-mutating analytical request: %s',
    (message) => {
      expect(isBoundedNonMutationAnalyticalRequest(message)).toBe(true);
    },
  );

  it.each([BURN_CONTROL_PROMPT, GEO_CONTROL_PROMPT])(
    'recognises the positive-control request without changing its answer: %s',
    (message) => {
      expect(isBoundedNonMutationAnalyticalRequest(message)).toBe(true);
    },
  );

  it('does not steal an explicit edit merely because its scope says not to change anything else', () => {
    expect(
      isBoundedNonMutationAnalyticalRequest(
        'Set Sales Rep Adoption Rate to 0.7 and do not change anything else.',
      ),
    ).toBe(false);
  });

  it('uses structure before analysis and results after analysis without widening to mutation', () => {
    expect(selectBoundedNonMutationHandler(CRM_UNCERTAINTY, false)).toBe(
      'explain_from_structure',
    );
    expect(selectBoundedNonMutationHandler(CRM_UNCERTAINTY, true)).toBe('explain_results');
    expect(
      selectBoundedNonMutationHandler(
        'Set Sales Rep Adoption Rate to 0.7 and do not change anything else.',
        true,
      ),
    ).toBeNull();
  });
});

describe('B2 readiness recovery reads canonical blocker facts', () => {
  it('retains the option-count fact when the independent count is one', () => {
    const text = buildAnalysisAbsentTemplate(1, 'needs_user_input');
    expect(text).toContain('analysis needs at least two to compare');
  });

  it('does not project needs_user_input as an option-count claim when two options exist', () => {
    const text = buildAnalysisAbsentTemplate(
      2,
      TWO_OPTION_BLOCKED_READINESS.status,
      [],
      TWO_OPTION_BLOCKED_READINESS,
    );
    expect(text).toContain('Sales Rep Productivity');
    expect(text).not.toContain('analysis needs at least two to compare');
  });
});
