/**
 * ⭐ THE LEAD LADDER (Science d5 #87 6008575410 + 6008589328 + 6009457056; WORDING c6 lease 6009413360).
 *
 * The headline's share is a per-run ranking on the goal's QUANTITY, so the lead names that quantity and never "your goal"
 * (since 6 Oct "your goal" reads as the target). One ladder, label first:
 *   1. the goal has a unit → "{X} gave the {highest|lowest} {quantity} in N% of runs of this model";
 *   2. the label opens with an aim verb and the goal has a unit → the verb is stripped, then rung 1;
 *   3. otherwise → "{X} was supported by N% of runs of this model".
 * The number-free form states the plurality, so only a LICENSED floor keeps it; a low plurality states its share and a
 * near tie names no option.
 *
 * d5's mutants are rows here: "lowest reduce churn" → RED; "highest" on a minimise Run → RED; "your goal" in the lead
 * → RED; a near tie naming one option → RED.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  isAllowedRunAnalysisAssistantText,
  MAX_HEADLINE_CHARS,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';
import { resolveLeadQuantity } from '../lead-quantity.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

type Json = Record<string, unknown>;
const X = 'Raise to £59';
const records = (...ps: number[]): Json[] =>
  ps.map((p, i) => ({ option_id: `opt_${i}`, option_label: i === 0 ? X : `Option ${String.fromCharCode(66 + i)}`, win_probability: p }));
const headline = (rs: Json[], extra: Partial<AnalysisResultHeadlineInput> = {}, label = X): string | null =>
  buildAnalysisResultHeadline({
    enrichment: { results: rs.map((r, i) => (i === 0 ? { ...r, option_label: label } : r)) },
    leading_option_id: 'opt_0',
    status_kind: 'ok',
    ...extra,
  });
/** Case D (margin only): a clean, licensed lead. */
const caseD = (extra: Partial<AnalysisResultHeadlineInput> = {}) => headline(records(0.62, 0.38), extra);

describe("d5's rows: the rung each goal takes", () => {
  it.each([
    ['MRR, a quantity', { goal_label: 'Monthly recurring revenue', goal_unit: '£' }, `${X} gave the highest monthly recurring revenue in 62% of runs of this model.`],
    ['an acronym keeps its capitals', { goal_label: 'MRR', goal_unit: '£' }, `${X} gave the highest MRR in 62% of runs of this model.`],
    ['"Reduce churn" (%) on a Run that sent minimise: the verb stripped', { minimised_goal_label: 'Reduce churn', goal_unit: '%' }, `${X} gave the lowest churn in 62% of runs of this model.`],
    ['"Improve our retention rate" (%): the verb and determiner stripped', { goal_label: 'Improve our retention rate', goal_unit: '%' }, `${X} gave the highest retention rate in 62% of runs of this model.`],
    ['"Successful launch": no unit → rung 3', { goal_label: 'Successful launch' }, `${X} was supported by 62% of runs of this model.`],
    ['a direction word left inside the quantity → rung 3', { minimised_goal_label: 'Churn reduction', goal_unit: '%' }, `${X} was supported by 62% of runs of this model.`],
    ['no goal data at all → rung 3', {}, `${X} was supported by 62% of runs of this model.`],
  ] as const)('%s', (_why, extra, expected) => {
    const text = caseD(extra as Partial<AnalysisResultHeadlineInput>);
    expect(text).toBe(expected);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
    expect(textNamesLeadingOption(text!)).toBe(true);
  });
});

describe("d5's mutants", () => {
  it('"lowest reduce churn" never: the aim verb is stripped, not carried', () => {
    expect(caseD({ minimised_goal_label: 'Reduce churn', goal_unit: '%' })).not.toMatch(/reduce/i);
  });
  it('"highest" never on a Run that sent minimise', () => {
    expect(caseD({ minimised_goal_label: 'Monthly cancellations', goal_unit: 'cancellations/month' })).not.toMatch(/highest/);
    expect(caseD({ minimised_goal_label: 'Monthly cancellations', goal_unit: 'cancellations/month' })).toMatch(/gave the lowest monthly cancellations/);
  });
  it.each([
    ['rung 1', { goal_label: 'Monthly recurring revenue', goal_unit: '£' }],
    ['rung 1, minimise', { minimised_goal_label: 'Reduce churn', goal_unit: '%' }],
    ['rung 3', {}],
  ] as const)('"your goal" never in the lead (%s)', (_n, extra) => {
    expect(caseD(extra as Partial<AnalysisResultHeadlineInput>)).not.toMatch(/your goal|scored highest|came out lowest/);
  });
});

describe('the resolver, alone', () => {
  it.each([
    ['', '£'], ['Reduce', '%'], ['m'.repeat(49), '£'], ['fac_monthly_revenue', '£'], ['Keep costs stable', '£'],
  ])('"%s" → rung 3', (goalLabel, goalUnit) => {
    expect(resolveLeadQuantity({ goalLabel, goalUnit, minimised: false })).toBeNull();
  });
  it('a quantity of exactly the budget rides', () => {
    expect(resolveLeadQuantity({ goalLabel: 'm'.repeat(48), goalUnit: '£', minimised: false })?.quantity).toBe('m'.repeat(48));
  });
});

describe('Case E (d5 #87 6009457056): the floor states the plurality only where it is licensed', () => {
  it('a LOW plurality (35%, 10 points clear, no driver or fragility) states its share — no "most"', () => {
    const text = headline(records(0.35, 0.25, 0.2, 0.2));
    expect(text).toBe(`${X} was supported by 35% of runs of this model.`);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
  it.each([[[0.31, 0.29, 0.22, 0.18]], [[0.39, 0.36, 0.25]], [[0.39, 0.36]], [[0.33, 0.31, 0.03, 0.03, 0.3]]])(
    'a NEAR TIE below 40%% (%j) names no option',
    (ps) => {
      const text = headline(records(...ps));
      expect(text === null || !text.includes(X)).toBe(true);
      expect(text ?? '').not.toMatch(/the most runs/);
    },
  );
  it('a LICENSED lead shed to the floor on length keeps "the most runs"', () => {
    // Size the label so the numbered Case D sentence is one over its cap: it then sheds to the floor's plain form.
    const numbered = (l: string) => `${l} was supported by 62% of runs of this model.`;
    const leadCap = MAX_HEADLINE_CHARS + ('was supported by'.length - 35);
    const label = `Option ${'L'.repeat(leadCap + 1 - numbered('').length - 'Option '.length)}`;
    expect(numbered(label).length).toBe(leadCap + 1);
    const text = headline(records(0.62, 0.38), {}, label);
    expect(text).toBe(`${label} was supported by the most runs of this model.`);
    expect(describeAnalysisHeadline({ enrichment: { results: records(0.62, 0.38).map((r, i) => (i === 0 ? { ...r, option_label: label } : r)) }, leading_option_id: 'opt_0', status_kind: 'ok' }).case).toBe('E');
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });
});

describe('the cage', () => {
  const DIRECTION_ASSUMED = ' In this model I’ve assumed a higher value is better for your goal.';
  it('"lowest" beside a sentence that says the direction was ASSUMED is rejected; "highest" there is admitted', () => {
    expect(isAllowedRunAnalysisAssistantText(`${X} gave the lowest churn in 62% of runs of this model.${DIRECTION_ASSUMED}`)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`${X} gave the highest churn in 62% of runs of this model.${DIRECTION_ASSUMED}`)).toBe(true);
  });
  it('the retired goal-framed lead is no longer admitted', () => {
    expect(isAllowedRunAnalysisAssistantText(`${X} scored highest against your goal in 62% of runs of this model.`)).toBe(false);
  });
});
