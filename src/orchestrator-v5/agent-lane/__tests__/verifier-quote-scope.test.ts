/**
 * Recovery Batch B, V1: SYS2 owns the figure-credit verifier (DL #94 6120805174). AIE 6120633627 asks to scope the
 * check to the bound claim, not every earlier quoted label.
 *
 * Served capacity brief (J1 LEVEL_BRIEF; live run 2026-10-12T020148Z): its first sentence quotes the two option
 * labels. At be084b06, `directContext` refused any figure with a quote mark anywhere before its sentence, so
 * "Our existing team resolves 80 tickets per week" was never credited, and neither was the known-good 920 receipt
 * placed after it. The rule now: a quotation refuses credit only when the credited figure itself lies inside it.
 */
import { describe, expect, it } from 'vitest';
import { findStatedAmounts } from '../../../cee/provenance/stated-amounts.js';
import type { CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel, verifiedOptionSetting } from '../verified-option-setting.js';
import { probes } from './fixtures/r5-verified-cases.js';

/** DGAI e2e/core/journey/J1-whole-poc.journey.spec.ts LEVEL_BRIEF @40c7b914, verbatim. */
const CAPACITY = 'We are comparing two staffing options, labelled exactly "Keep current staffing" and "Add one specialist". Use the exact goal label "Weekly support capacity". Our existing team resolves 80 tickets per week. Keep current staffing adds no specialist. Add one specialist adds one specialist. Each additional specialist resolves about 20 tickets per week, between 10 and 30. Total weekly support capacity is defined as the existing 80 tickets per week plus the additional specialist capacity. Goal: weekly support capacity of at least 100 tickets per week. This target is an absolute level, with no deadline.';
/** The known-good receipt (credit-stated-factor-levels "a complete, entity-named count receipt credits"). */
const Q920 = 'Our clinic completes 920 appointments each month.';

function draft(quote: string): CandidateModel {
  return {
    goal: { metric: 'Weekly support capacity', operator: '>=', target_stated: true, frame: 'level', value: 100, unit: 'tickets per week',
      horizon_months: null, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: null, scope: null },
    constraints: [], options: [], risks: [], outcomes: [], unknowns: [], links: [],
    factors: [{ label: 'Completed appointments', role: 'observable', baseline_known: true, baseline_value: 920, unit: 'appointments/month',
      provenance: 'explicit', plausible_max: 2000, baseline_evidence: { quote } }],
  } as unknown as CandidateModel;
}
const credits = (brief: string, quote = Q920): boolean => { const d = draft(quote); return verifiedFactorLevel(d, d.factors[0]!, brief); };

describe('V1 factor level: a quotation refuses only the figure inside it', () => {
  it('POSITIVE CONTROL (first): the 920 receipt alone as the brief is credited', () => {
    expect(credits(Q920)).toBe(true);
  });
  it('RED at be084b06: the same receipt after the capacity brief\'s quoted option labels is credited', () => {
    expect(credits(`${CAPACITY} ${Q920}`)).toBe(true);
  });
  it('RED at be084b06: a quoted label in the SAME sentence, after the figure, does not block it', () => {
    const q = 'Our clinic completes 920 appointments each month, labelled "steady state" on the rota.';
    expect(credits(q, q)).toBe(true);
  });
  it('apostrophes are not quotations ("Let\'s", "we\'re", "our developers\' time")', () => {
    expect(credits(`Let's be careful: we're short of our developers' time. ${Q920}`)).toBe(true);
  });
  it('STAYS REFUSED: the figure inside a double quotation that opened in an earlier sentence', () => {
    const q = `${Q920}"`;
    expect(credits(`The brochure reads, "We are a busy practice. ${q}`, q)).toBe(false);
  });
  it('STAYS REFUSED: the figure inside a single quotation that opened in an earlier sentence', () => {
    const q = `${Q920}'`;
    expect(credits(`The brochure reads, 'We are a busy practice. ${q}`, q)).toBe(false);
  });
  it('STAYS REFUSED (fail closed): an unclosed double quote before the figure runs to the end of the brief', () => {
    expect(credits(`The brochure reads, "We are a busy practice. ${Q920}`)).toBe(false);
  });
  it('STAYS REFUSED: the heading rule is unchanged ("Advisor suggested:" on the line above)', () => {
    expect(credits(`Advisor suggested:\n${Q920}`)).toBe(false);
  });
});

/** As verified-option-setting.test.ts `setting` (G2): one sentence, one option, one factor. */
function setting(brief: string, sentence: string) {
  const base = structuredClone(probes[0]!.model);
  const template = structuredClone(base.options[1]!);
  template.label = 'Saturday clinics';
  template.interventions = [{ ...template.interventions![0]!, factor_label: 'Saturday clinics', value: 4, unit: 'clinics/month',
    stated_evidence: { quote: sentence, start: 0, end: sentence.length, amount_start: findStatedAmounts(sentence).find(n => n.magnitude === 4)!.index,
      option_quote: sentence, option_start: 0, option_end: sentence.length } }];
  const model: CandidateModel = { ...base, options: [template, { ...base.options[0]!, label: 'Continue unchanged' }],
    factors: [{ ...base.factors[0]!, label: 'Saturday clinics', unit: 'clinics/month' }], links: [], risks: [], outcomes: [], constraints: [] };
  return verifiedOptionSetting(model, model.options[0]!, model.options[0]!.interventions![0]!, brief);
}
const G2 = 'One option is to run 4 Saturday clinics a month.';

describe('V1 option setting: the same rule on the other caller of the shared check', () => {
  it('POSITIVE CONTROL (first): G2 alone is credited', () => {
    expect(setting(G2, G2)).toBe(true);
  });
  it('RED at be084b06: G2 after a sentence quoting the option labels is credited', () => {
    expect(setting(`We call the options "Saturday clinics" and "Continue unchanged". ${G2}`, G2)).toBe(true);
  });
  it('STAYS REFUSED: G2 inside a quotation that opened in an earlier sentence', () => {
    const q = `${G2}"`;
    expect(setting(`The rota note reads, "We are reviewing hours. ${q}`, q)).toBe(false);
  });
});
