/**
 * RT-10 B′ (DL e8 condition 1; Science d5's words): a Run that SENT minimise leads with "{option} came out lowest for
 * {goal} in N% of runs of this model" — the statistic ISL computed at that direction, said in the goal's own words.
 *
 * WHAT THIS FILE PINS (the headline builder only; the served rt10b Run 2 through the real handler is pinned in
 * `tools/handlers/__tests__/bprime-run-own-direction.test.ts`):
 *   L1  LEADER PERMISSION IS UNMOVED: at every `leadCap` site and every number-free shed site, AT the cap and 5 OVER,
 *       the minimise input gives the same descriptor (case, reason) and the same null-ness as the input without it.
 *       Measuring either cap without the minimise adjustment turns a row RED.
 *   L2  The words: the lead and its shed form, with the goal's label; admitted at egress; seen by the leader detectors
 *       (`textNamesLeadingOption`, so a withheld leader cannot leave through the new verb).
 *   L3  Where it never rides: a frame that says the direction was ASSUMED; a label that states an aim, is too long, or
 *       fails the content defences; no label (a Run that did not send minimise).
 *   L4  The cage: the minimise lead beside a direction-assumed sentence is REJECTED; beside the untested one, admitted.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  isAllowedRunAnalysisAssistantText,
  MAX_HEADLINE_CHARS,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

type Json = Record<string, unknown>;
const T2 = JSON.parse(readFileSync(new URL('./fixtures/t2-c1ddb50.analysis-result-block.trimmed.json', import.meta.url), 'utf8')) as { blocks: Json[] };
/** PLoT's served warning ENTRIES (c1ddb50), spelled as the wire spells their codes. */
const SERVED_WARNINGS = ((T2.blocks[0]!['enrichment'] as Json)['inference_warnings'] as Json[]);
const warningFor = (code: string): Json => SERVED_WARNINGS.find((w) => w['code'] === code)!;

const GOAL = 'monthly cancellations';
const GOAL_FRAMED = 'scored highest against your goal in';
const PLAIN = 'scored highest in this model';
const MIN_LEAD = `came out lowest for ${GOAL} in`;
const MIN_PLAIN = `came out lowest for ${GOAL} in this model`;
const DISCLOSURE = ' The model could not test whether any option reaches your goal.';
const DIRECTION_ASSUMED = ' In this model I’ve assumed a higher value is better for your goal.';

const PROVISIONAL_HIRING = ', but treat this as provisional: the result is sensitive to Hiring and Salary Cost.';
const DRIVER_TECH_LEAD = ' because Technical Leadership in Place is the strongest driver.';
const PROVISIONAL_LAUNCH = ', but treat this as provisional: the result is sensitive to Launch Timing.';

interface Site {
  readonly site: string;
  /** The goal-framed candidate the site measures. */
  readonly candidate: (label: string) => string;
  readonly records: (label: string) => Json[];
  readonly extra?: Json;
}
const two = (l: string, a: number, b: number, bLabel = 'Option B'): Json[] => [
  { option_id: 'opt_a', option_label: l, win_probability: a },
  { option_id: 'opt_b', option_label: bLabel, win_probability: b },
];
/** The eight `leadCap` sites (the same table as analysis-result-headline-untestable-goal.test.ts's F2). */
const LEAD_CAP_SITES: readonly Site[] = [
  { site: 'Case A', candidate: (l) => `${l} ${GOAL_FRAMED} 62% of runs of this model${PROVISIONAL_HIRING}`, records: (l) => two(l, 0.62, 0.38, 'Defer Hiring'),
    extra: { robustness: { level: 'moderate', fragile_edges: [{ from_label: 'Hiring and Salary Cost', to_label: 'Outcome', switch_probability: 0.45 }] } } },
  { site: 'Case B with margin', candidate: (l) => `${l} ${GOAL_FRAMED} 62% of runs of this model${DRIVER_TECH_LEAD}`, records: (l) => two(l, 0.62, 0.38, 'Defer Hiring'),
    extra: { factor_sensitivity: [{ label: 'Technical Leadership in Place', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }], robustness: { level: 'moderate' } } },
  { site: 'Case D, margin', candidate: (l) => `${l} ${GOAL_FRAMED} 62% of runs of this model.`, records: (l) => two(l, 0.62, 0.38) },
  { site: 'Case D, single option', candidate: (l) => `${l} ${GOAL_FRAMED} 62% of runs of this model. Run the follow-up checks before treating this as final.`,
    records: (l) => [{ option_id: 'opt_a', option_label: l, win_probability: 0.62 }] },
  { site: 'NT override >= 0.40', candidate: (l) => `${l} ${GOAL_FRAMED} 55% of runs of this model, but the analysis treats this as a close call.`,
    records: (l) => two(l, 0.55, 0.45), extra: { robustness: { near_tie: { is_tie: true } } } },
  { site: 'NT close', candidate: (l) => `${l} ${GOAL_FRAMED} 45% of runs of this model, but the options are close.`, records: (l) => two(l, 0.45, 0.42) },
  { site: 'NT override < 0.40', candidate: (l) => `${l} ${GOAL_FRAMED} 38% of runs of this model, but the analysis treats this as a close call.`,
    records: (l) => [...two(l, 0.38, 0.32), { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.3 }], extra: { robustness: { near_tie: { is_tie: true } } } },
  { site: 'SC soft confidence, margin', candidate: (l) => `${l} ${GOAL_FRAMED} 33% of runs of this model${PROVISIONAL_LAUNCH}`,
    records: (l) => [...two(l, 0.33, 0.25), { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.22 }, { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.2 }],
    extra: { factor_sensitivity: [{ label: 'Launch Timing', elasticity: 0.6, confidence: 0.8, influence_score: 0.6 }] } },
];
/** The number-free shed sites (`plainCap`): reached when the margin sentence cannot fit at all. */
const PLAIN_SITES: readonly Site[] = [
  { site: 'Case E (D margin shed)', candidate: (l) => `${l} ${PLAIN}.`, records: (l) => two(l, 0.62, 0.38) },
  { site: 'Case C (A shed)', candidate: (l) => `${l} ${PLAIN}${PROVISIONAL_HIRING}`, records: LEAD_CAP_SITES[0]!.records, extra: LEAD_CAP_SITES[0]!.extra },
  { site: 'Case B (no margin)', candidate: (l) => `${l} ${PLAIN}${DRIVER_TECH_LEAD}`, records: LEAD_CAP_SITES[1]!.records, extra: LEAD_CAP_SITES[1]!.extra },
];

const labelFor = (site: Site, target: number): string => {
  const label = `Option ${'L'.repeat(target - site.candidate('').length - 'Option '.length)}`;
  expect(site.candidate(label).length).toBe(target);
  return label;
};
const inputs = (site: Site, label: string, extra: Partial<AnalysisResultHeadlineInput> = {}, warnings: Json[] = []) => {
  const enrichment: Json = { results: site.records(label), ...(site.extra ?? {}), ...(warnings.length > 0 ? { inference_warnings: warnings } : {}) };
  const base: AnalysisResultHeadlineInput = { enrichment, leading_option_id: 'opt_a', status_kind: 'ok', ...extra };
  return { clean: base, minimised: { ...base, minimised_goal_label: GOAL } };
};
const toMinimise = (text: string): string => text.replace(GOAL_FRAMED, MIN_LEAD).replace(PLAIN, MIN_PLAIN);

describe('L1 — the minimise lead never moves the leader permission', () => {
  for (const site of [...LEAD_CAP_SITES, ...PLAIN_SITES]) {
    it(`${site.site}: AT the cap, the same descriptor; the minimise text is the goal-framed one in the minimise words`, () => {
      const label = labelFor(site, MAX_HEADLINE_CHARS);
      const { clean, minimised } = inputs(site, label);
      const cleanText = buildAnalysisResultHeadline(clean);
      expect(cleanText).toBe(site.candidate(label));
      expect(describeAnalysisHeadline(minimised)).toEqual(describeAnalysisHeadline(clean));
      const text = buildAnalysisResultHeadline(minimised);
      expect(text).toBe(toMinimise(cleanText!));
      expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
      expect(textNamesLeadingOption(text!)).toBe(true);
    });

    it(`${site.site}: 5 OVER the cap, the same outcome and case, in the minimise words`, () => {
      const label = labelFor(site, MAX_HEADLINE_CHARS + 5);
      const { clean, minimised } = inputs(site, label);
      const cleanText = buildAnalysisResultHeadline(clean);
      expect(describeAnalysisHeadline(minimised)).toEqual(describeAnalysisHeadline(clean));
      expect(buildAnalysisResultHeadline(minimised)).toBe(cleanText === null ? null : toMinimise(cleanText));
    });
  }
});

describe('L2/L3 — the words, and where they never ride', () => {
  const site = LEAD_CAP_SITES[2]!; // Case D, margin
  const at = (extra: Partial<AnalysisResultHeadlineInput>, warnings: Json[] = []): string | null =>
    buildAnalysisResultHeadline({ ...inputs(site, '15% Loyalty Discount', {}, warnings).clean, ...extra });

  it('the served instance: "15% Loyalty Discount came out lowest for monthly cancellations in 62% of runs of this model."', () => {
    expect(at({ minimised_goal_label: GOAL })).toBe('15% Loyalty Discount came out lowest for monthly cancellations in 62% of runs of this model.');
  });

  it('CONTRAST: no label (the Run did not send minimise) → the goal-framed lead, unchanged', () => {
    expect(at({})).toBe('15% Loyalty Discount scored highest against your goal in 62% of runs of this model.');
  });

  it('beside the untested sentence (the target could not be tested) the minimise lead rides, and the cage admits it', () => {
    const text = at({ minimised_goal_label: GOAL }, [warningFor('GOAL_THRESHOLD_NOT_CONVERTIBLE')]);
    expect(text).toBe(`15% Loyalty Discount came out lowest for monthly cancellations in 62% of runs of this model.${DISCLOSURE}`);
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
  });

  it('never beside a sentence that says the direction was ASSUMED: the lead is the one this module emitted before', () => {
    const text = at({ minimised_goal_label: GOAL }, [warningFor('GOAL_DIRECTION_UNATTESTED')]);
    expect(text).not.toMatch(/came out lowest/);
    expect(text).toBe(at({}, [warningFor('GOAL_DIRECTION_UNATTESTED')]));
  });

  it.each([
    ['states an aim, not the quantity', 'Reduce monthly cancellations'],
    ['longer than the budget (49 characters)', 'm'.repeat(49)],
    ['fails the content defences (an internal id)', 'fac_monthly_cancellations'],
    ['empty', '  '],
  ])('a goal label that %s → the goal-framed lead, unchanged', (_why, label) => {
    expect(at({ minimised_goal_label: label })).toBe(at({}));
  });

  it('a 48-character goal label still rides at every leadCap site at the cap, and the cage admits the longest', () => {
    const long = 'q'.repeat(48);
    for (const s of LEAD_CAP_SITES) {
      const label = labelFor(s, MAX_HEADLINE_CHARS);
      const text = buildAnalysisResultHeadline({ ...inputs(s, label).clean, minimised_goal_label: long });
      expect(text, s.site).toContain(`came out lowest for ${long} in`);
      expect(isAllowedRunAnalysisAssistantText(text), s.site).toBe(true);
    }
  });
});

describe('L4 — the cage', () => {
  const lead = '15% Loyalty Discount came out lowest for monthly cancellations in 71% of runs of this model.';
  it('admits the minimise lead alone and beside the untested sentence', () => {
    expect(isAllowedRunAnalysisAssistantText(lead)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText(`${lead}${DISCLOSURE}`)).toBe(true);
    expect(isAllowedRunAnalysisAssistantText('15% Loyalty Discount came out lowest for monthly cancellations in this model.')).toBe(true);
  });
  it('REJECTS it beside a sentence that says the direction was assumed (both forms)', () => {
    expect(isAllowedRunAnalysisAssistantText(`${lead}${DIRECTION_ASSUMED}`)).toBe(false);
    expect(isAllowedRunAnalysisAssistantText(`15% Loyalty Discount came out lowest for monthly cancellations in this model.${DIRECTION_ASSUMED}`)).toBe(false);
  });
});
