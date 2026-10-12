import { describe, expect, it } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { verifiedFactorLevel } from '../verified-option-setting.js';
import { valueAuthorshipOf } from '../turn-context/guidance-signals.js';
import { nodeProvenanceDisplay } from '../../../cee/transforms/provenance-display.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

const SERVED = 'Our bike-share scheme has 1,500 registered riders today';
function candidate(quote: string, label = 'Registered riders today', value = 1500, unit = 'riders'): CandidateModel {
  return {
    goal: { metric: 'Operating surplus', value: 10000, unit: 'GBP/month', operator: '>=', horizon_months: null, provenance: 'explicit' },
    factors: [{ label, unit, baseline_value: value, baseline_known: true, provenance: 'explicit', role: 'observable',
      plausible_max: 10000, baseline_evidence: { quote } }],
    constraints: [], options: [], risks: [], outcomes: [], links: [],
  };
}
const verified = (m: CandidateModel, brief = m.factors[0]!.baseline_evidence!.quote) => verifiedFactorLevel(m, m.factors[0]!, brief);
function admittedLevel(m: CandidateModel, brief: string) {
  const admitted = admitCandidateModel(m, {}, brief);
  const reloaded = GraphV3.parse(JSON.parse(JSON.stringify(projectGraphForPersistence(admitted))));
  return reloaded.nodes.find(n => n.kind === 'factor' && n.label === m.factors[0]!.label)!.observed_state!;
}

describe('RUN28 structural first-person factor ownership', () => {
  it('credits the served bike-share scheme receipt and keeps real user authorship after projection and reload', () => {
    const m = candidate(SERVED);
    expect(verified(m)).toBe(true);
    const os = admittedLevel(m, SERVED);
    expect(os).toMatchObject({ value: 0.15, raw_value: 1500, unit: 'riders', source: 'brief_extraction', extractionType: 'explicit' });
    expect(valueAuthorshipOf(os)).toBe('yours');
    expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('from_brief');
  });
  it('an unlisted noun phrase needs no organisation vocabulary membership', () => {
    expect(verified(candidate('Our neighbourhood mobility cooperative has 1,500 registered riders today'))).toBe(true);
  });
  it('the existing first-person subject still credits its own current figure', () => {
    expect(verified(candidate('We have 1,500 registered riders today'))).toBe(true);
  });
  it('a state-verb-shaped noun inside the bound quantity keeps its governing is predicate', () => {
    expect(verified(candidate('Our contractor spend change is £0.', 'Contractor spend change', 0, 'GBP'))).toBe(true);
  });
  for (const [reason, quote] of [
    ['council is a third party', 'Our city council has 1,500 registered riders today'],
    ['a competitor possessive is not our figure', "Our competitor's depot has 1,500 registered riders today"],
    ['reported assertion', 'Our bike-share scheme reports 1,500 registered riders today'],
    ['claimed assertion', 'Our bike-share scheme claims it has 1,500 registered riders today'],
    ['attribution', 'According to our bike-share scheme, it has 1,500 registered riders today'],
    ['target role', 'Our target is 1,500 registered riders today'],
    ['plan role', 'Our bike-share scheme plan is 1,500 registered riders today'],
    ['forecast role', 'Our bike-share scheme forecast is 1,500 registered riders today'],
    ['limit role', 'Our bike-share scheme limit is 1,500 registered riders today'],
    ['future auxiliary', 'Our bike-share scheme will have 1,500 registered riders today'],
    ['hypothetical auxiliary', 'Our bike-share scheme would have 1,500 registered riders today'],
    ['prospective auxiliary', 'Our bike-share scheme could have 1,500 registered riders today'],
    ['possibility auxiliary', 'Our bike-share scheme may have 1,500 registered riders today'],
    ['uncertain auxiliary', 'Our bike-share scheme might have 1,500 registered riders today'],
    ['obligation auxiliary', 'Our bike-share scheme must have 1,500 registered riders today'],
    ['capability auxiliary', 'Our bike-share scheme can have 1,500 registered riders today'],
    ['new clause subject', 'Our bike-share scheme, the depot has 1,500 registered riders today'],
    ['missing first-person owner', 'The bike-share scheme has 1,500 registered riders today'],
    ['another quantity', 'Our bike-share scheme has 1,500 electric scooters today'],
    ['wrong period', 'Our bike-share scheme has 1,500 registered riders a month'],
  ]) {
    it(`withholds ${reason}`, () => {
      const m = candidate(quote);
      expect(verified(m)).toBe(false);
      const os = admittedLevel(m, quote);
      expect(os.source).toBe('cee_inference');
      expect(os.user_material_unverified).toBe(true);
      expect(valueAuthorshipOf(os)).toBe('unknown');
      expect(nodeProvenanceDisplay(os.extractionType, os)).toBe('unverified_brief');
    });
  }
  it('gross additions about 60 cannot attest a net growth factor', () => {
    const quote = 'Our bike-share scheme adds about 60 new riders a month';
    const m = candidate(quote, 'Net monthly registered rider growth', 60, 'riders/month');
    expect(verified(m)).toBe(false);
    const os = admittedLevel(m, quote);
    expect(os).toMatchObject({ raw_value: 60, source: 'cee_inference', user_material_unverified: true });
    expect(valueAuthorshipOf(os)).toBe('unknown');
  });
  it('a sentence holding the goal ceiling cannot attest a current level', () => {
    const m = candidate(SERVED);
    expect(verified({ ...m, goal: { ...m.goal, metric: 'Registered riders', unit: 'riders', value: 1500, operator: '<=' } })).toBe(false);
  });
  it('a matching constraint ceiling cannot attest its current level', () => {
    const m = candidate(SERVED);
    expect(verified({ ...m, constraints: [{ metric: 'Registered riders today', unit: 'riders', value: 1500, operator: '<=', provenance: 'explicit' }] })).toBe(false);
  });
  it('an ambiguous duplicate quantity still withholds the receipt', () => {
    const m = candidate(SERVED);
    expect(verified({ ...m, factors: [...m.factors, { ...m.factors[0]! }] })).toBe(false);
  });
  it('missing, paraphrased and non-unique receipts remain unverified', () => {
    const m = candidate(SERVED);
    expect(verified({ ...m, factors: [{ ...m.factors[0]!, baseline_evidence: null }] }, SERVED)).toBe(false);
    expect(verified(m, 'Our bike-share scheme has fifteen hundred registered riders today')).toBe(false);
    expect(verified(m, `${SERVED}. ${SERVED}`)).toBe(false);
  });
  it('a neighbouring correction or ceiling still refuses the owned receipt', () => {
    const quote = `${SERVED}.`;
    expect(verified(candidate(quote), `${quote} Ignore that.`)).toBe(false);
    expect(verified(candidate(quote), `${quote} At most.`)).toBe(false);
  });
});
