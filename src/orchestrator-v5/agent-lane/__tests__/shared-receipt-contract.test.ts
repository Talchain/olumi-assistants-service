import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { prepareProvisionalCandidate, withCountInterventionRanges } from '../runtime/build-model.js';
import { verifiedFactorLevel, verifiedOptionSetting } from '../verified-option-setting.js';

function setting(quote: string, additional = false): CandidateModel {
  return {
    goal: { metric: 'Completed jobs', value: 100, unit: 'jobs', operator: '>=', horizon_months: null, provenance: 'explicit' },
    constraints: [], factors: [{ label: 'Engineers', unit: 'engineers', baseline_known: true,
      baseline_value: 3, provenance: 'explicit', role: 'controllable', baseline_evidence: { quote } }],
    options: [{ label: 'Hire 3 engineers', provenance: 'explicit', interventions: [{ factor_label: 'Engineers',
      value: 3, unit: 'engineers', value_kind: additional ? 'additional' : 'absolute', provenance: 'explicit', stated_evidence: { quote } }] }],
    outcomes: [], risks: [], links: [],
  };
}
const optionVerified = (m: CandidateModel, brief: string) => verifiedOptionSetting(m, m.options[0]!, m.options[0]!.interventions![0]!, brief);

describe('DL #94 6101950357 shared receipt contract', () => {
  it('i a withheld point retains its independently written likely range and computed uncertainty', () => {
    const bank: { answers: { brief: string; output_text: string }[] } = JSON.parse(readFileSync(new URL('./fixtures/class1-known-zero-raw.json', import.meta.url), 'utf8'));
    const answer = bank.answers[2]!;
    const raw: CandidateModel = JSON.parse(answer.output_text);
    const model = withCountInterventionRanges(prepareProvisionalCandidate(raw).candidate, answer.brief);
    const option = model.options.find(o => o.label === 'Launch starter tier')!;
    const iv = option.interventions!.find(i => i.factor_label === 'Starter-tier subscribers')!;
    expect(iv.provenance).toBe('ai_proposed');
    expect(iv.range).toStrictEqual({ low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction',
      source_quote: 'The starter tier would win about 150 new subscribers, between 80 and 250.' });
    const graph = admitCandidateModel(model, {}, answer.brief);
    const factor = graph.nodes.find(n => n.label === 'Starter-tier subscribers')!;
    const cell = graph.nodes.find(n => n.label === option.label)!.interventions![factor.id]!;
    expect(cell).toMatchObject({ raw_value: 150, source: 'cee_hypothesis', range: iv.range });
    expect(cell.range?.meaning).toBe('likely_range');
    const computed = setting('We have 3 engineers.');
    computed.options[0]!.interventions = [{ factor_label: 'Engineers', value: 2, value_kind: 'additional',
      unit: 'engineers', provenance: 'explicit' }];
    const retained = admitCandidateModel(prepareProvisionalCandidate(computed).candidate);
    const count = retained.nodes.find(n => n.label === 'Engineers')!;
    expect(retained.nodes.find(n => n.kind === 'option')!.interventions![count.id])
      .toMatchObject({ raw_value: 5, source: 'cee_hypothesis', value_confidence: 'medium' });
  });
  for (const additional of [false, true]) {
    it(`ii an option-setting question binds its own quantity (${additional ? 'additive' : 'absolute'})`, () => {
      const quote = 'Should we hire 3 engineers?';
      expect(optionVerified(setting(quote, additional), quote)).toBe(true);
    });
    it(`ii an option-setting proposal binds its own quantity (${additional ? 'additive' : 'absolute'})`, () => {
      const quote = 'Hire 3 engineers.';
      expect(optionVerified(setting(quote, additional), quote)).toBe(true);
    });
  }
  it('i/ii an observed-level question stays uncredited despite an exact owned quantity and receipt', () => {
    const quote = 'We have 3 engineers?'; const m = setting(quote);
    expect(verifiedFactorLevel(m, m.factors[0]!, quote)).toBe(false);
    expect(admitCandidateModel(m, {}, quote).nodes.find(n => n.label === 'Engineers')!.observed_state)
      .toMatchObject({ raw_value: 3, source: 'cee_inference', user_material_unverified: true });
  });
  for (const quote of ['Should they hire 3 engineers?', 'Our supplier could hire 3 engineers.',
    'Should we hire at most 3 engineers?', 'Should we hire more than 3 engineers?',
    'Should we not hire 3 engineers?', 'Should we hire 3 contractors?', 'Should we hire 3 engineers a month?']) {
    it(`ii refuses ${quote}`, () => {
      expect(optionVerified(setting(quote), quote)).toBe(false);
      expect(optionVerified(setting(quote, true), quote)).toBe(false);
    });
  }
  it('ii an option name or an unquoted question alone is not authority', () => {
    const quote = 'Should we hire 3 engineers?'; const m = setting(quote);
    delete m.options[0]!.interventions![0]!.stated_evidence;
    expect(optionVerified(m, quote)).toBe(false);
    const wrong = setting(quote); wrong.options[0]!.label = 'Hire 3 contractors';
    expect(optionVerified(wrong, quote)).toBe(false);
  });
});
