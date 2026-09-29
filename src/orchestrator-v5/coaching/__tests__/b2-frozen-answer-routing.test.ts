/**
 * B2 convergence fixtures captured from five isolated staging guests on
 * CEE 53eb8d03554c3b92f324f7ebc40b25120aa1add2.
 *
 * The three failures are intentionally frozen verbatim.  The two controls are
 * the same successful answers from the same witness set: the fix must recover
 * the bad routes without suppressing source-bound analysis that already works.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCoachingDegradeResponse,
  buildSourceBoundAnalyticalRecovery,
  checkCoachingOutput,
  hasMutationProposalOnNonMutatingTurn,
} from '../coaching-output-postcheck.js';
import { buildAnalysisAbsentTemplate } from '../../tools/handlers/no-op-helpers.js';
import {
  isBoundedNonMutationAnalyticalRequest,
  selectBoundedNonMutationHandler,
} from '../../routing/mutation-warrant.js';
import type { CoachingStatePack } from '../../context/canonical-analysis-state.js';

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

const PRODUCT_GRAPH = {
  nodes: [
    { id: 'capacity', kind: 'factor', label: 'Team Capacity Consumed' },
    { id: 'delivery', kind: 'factor', label: 'Delivery Capacity' },
    { id: 'goal', kind: 'goal', label: 'Reach 1,500 paid teams' },
  ],
  edges: [
    { from: 'capacity', to: 'delivery' },
    { from: 'delivery', to: 'goal' },
  ],
};

const STATE_PACKS: ReadonlyArray<readonly [string, CoachingStatePack]> = [
  [
    'fresh',
    {
      analysis_present: true,
      freshness: 'fresh',
      readiness_status: 'ready',
      rerun_required: false,
      usable_for_prose: true,
      usable_for_chips: true,
      blocked: false,
      actionable_blocker_count: 0,
    },
  ],
  [
    'stale',
    {
      analysis_present: true,
      freshness: 'stale',
      readiness_status: 'ready',
      rerun_required: true,
      usable_for_prose: false,
      usable_for_chips: false,
      blocked: false,
      actionable_blocker_count: 0,
    },
  ],
  [
    'none',
    {
      analysis_present: false,
      freshness: 'none',
      readiness_status: 'needs_user_input',
      rerun_required: false,
      usable_for_prose: false,
      usable_for_chips: false,
      blocked: false,
      actionable_blocker_count: 1,
    },
  ],
  [
    'blocked',
    {
      analysis_present: true,
      freshness: 'fresh',
      readiness_status: 'blocked',
      rerun_required: false,
      usable_for_prose: false,
      usable_for_chips: false,
      blocked: true,
      actionable_blocker_count: 1,
    },
  ],
];

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

describe('B2 source-bound deterministic recovery', () => {
  it('answers the uncertainty prompt directly from the current blocker', () => {
    const text = buildSourceBoundAnalyticalRecovery({
      message: CRM_UNCERTAINTY,
      readiness: {
        status: 'needs_user_input',
        open_items: [
          {
            kind: 'option_needs_encoding',
            description:
              'choose the missing effect value for the HubSpot option on Sales Rep Productivity',
            option_label: 'replace our current CRM with HubSpot next quarter',
          },
        ],
      },
      graph: PRODUCT_GRAPH,
    });
    expect(text).toMatch(/^No\b/);
    expect(text).toContain('because');
    expect(text).toContain('Sales Rep Productivity');
    expect(text).not.toContain('at least two');
  });

  it('answers the causal challenge from the attested driver and model path', () => {
    const text = buildSourceBoundAnalyticalRecovery({
      message: PRODUCT_CHALLENGE,
      readiness: { status: 'ready', open_items: [] },
      analysis: {
        top_drivers: [
          { factor_label: 'Team Capacity Consumed', sensitivity_value: -0.61 },
        ],
        evidence_gaps: [],
      },
      graph: PRODUCT_GRAPH,
    });
    expect(text).toMatch(/^The strongest source-bound challenge is Team Capacity Consumed\b/);
    expect(text).toContain('because');
    expect(text).toContain('Team Capacity Consumed → Delivery Capacity → Reach 1,500 paid teams');
    expect(text).not.toMatch(/set(?:ting)?\s+"?Team Capacity Consumed"?\s+to\s+53%/i);
  });

  it('states the exact limitation and one useful next input when no carrier exists', () => {
    const text = buildSourceBoundAnalyticalRecovery({
      message: PRODUCT_CHALLENGE,
      readiness: { status: 'ready', open_items: [] },
      analysis: null,
      graph: { nodes: [], edges: [] },
    });
    expect(text).toMatch(/^I can(?:not|'t) give a source-bound causal challenge/i);
    expect(text).toContain('because');
    expect(text).toMatch(/tell me|provide/i);
  });

  it.each(STATE_PACKS)('serves the same source-bound recovery in %s state without an action', (_state, pack) => {
    const recovery =
      'No — this is exploratory because Sales Rep Productivity is unresolved.';
    expect(
      buildCoachingDegradeResponse(pack, { sourceBoundRecovery: recovery }),
    ).toEqual({ assistant_text: recovery, suggested_actions: [] });
  });
});

describe('B2 positive controls stay inside the existing safety cage', () => {
  const fresh: CoachingStatePack = {
    analysis_present: true,
    freshness: 'fresh' as const,
    readiness_status: 'ready',
    rerun_required: false,
    usable_for_prose: true,
    usable_for_chips: true,
    blocked: false,
    actionable_blocker_count: 0,
  };

  it('keeps the Q1 Renewal Rate causal answer', () => {
    const answer =
      'The Q1 renewal rate is the single most useful thing to find out next. ' +
      'Low renewals raise revenue loss from churn, which pulls directly against your burn reduction target, so this evidence matters whichever way you are leaning.';
    expect(checkCoachingOutput(answer, fresh)).toEqual({ safe: true });
  });

  it('keeps the Local Pipeline Conversion Rate limitation answer', () => {
    const answer =
      'No, not on its own. Local Pipeline Conversion Rate feeds New ARR Generated, so an unverified conversion assumption could flip which option is within the stated band. The current model does not numerically encode the first-year budget figures.';
    expect(checkCoachingOutput(answer, fresh)).toEqual({ safe: true });
  });

  it.each([
    'The model is unchanged so far. Tell me the specific factor, edge, option, or value to change, and I\'ll apply it directly.',
    'Nothing has been changed, but setting "Team Capacity Consumed" to 53% looks like it would help. Say the word and I will make it.',
  ])('rejects the observed mutation offer on a bounded analytical turn', (answer) => {
    expect(
      checkCoachingOutput(answer, fresh, { enforceNonMutationAnswer: true }),
    ).toEqual({
      safe: false,
      violation: 'mutation_proposal_on_non_mutating_question',
    });
    expect(hasMutationProposalOnNonMutatingTurn(answer)).toBe(true);
  });
});
